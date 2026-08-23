/**
 * FilmstripTileCache L0 Pinning & Fallback Resilience Tests
 *
 * Verifies:
 * 1. L0 baseline coarse tiles are protected from LRU eviction when dense L1/L2/L3 tiles churn.
 * 2. Multi-clip memory budget hard ceiling: total memory remains bounded across dozens of clips.
 * 3. End-to-end Image 2 reproduction: WebGLRasterSurface draws stretched L0 fallback rather than shimmer mid-zoom after dense tile eviction.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { FilmstripTileCache } from "../FilmstripTileCache";
import { SpatialTier } from "../../renderEngine/types";
import type { FilmstripTileAddress } from "../filmstripTiers";
import type { TransportArtifact } from "../../renderEngine/transport";
import { WebGLRasterSurface } from "../../renderEngine/webglRasterSurface";

function makeArtifact(clipId: string, zoomTier: SpatialTier, timestampMs: number, width = 160, height = 90): TransportArtifact {
  return {
    frameId: `${clipId}-${zoomTier}-${timestampMs}`,
    contentHash: `hash-${clipId}-${zoomTier}-${timestampMs}`,
    spatialTier: zoomTier,
    bitmap: { width, height, close: vi.fn() } as unknown as ImageBitmap,
    width,
    height,
    timestampMs,
    epochId: "epoch-1" as any,
    source: "fresh-decode",
  };
}

function makeAddress(clipId: string, zoomTier: SpatialTier, tileIndex: number, timestamp: number, videoPath?: string): FilmstripTileAddress {
  return { clipId, zoomTier, tileIndex, timestamp, videoPath };
}

function makeGl() {
  return {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    TEXTURE_2D: 0x0de1,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    NEAREST: 0x2600,
    CLAMP_TO_EDGE: 0x812f,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    COLOR_BUFFER_BIT: 0x4000,
    ARRAY_BUFFER: 0x8892,
    DYNAMIC_DRAW: 0x88e8,
    FLOAT: 0x1406,
    TRIANGLES: 0x0004,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ""),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ""),
    deleteProgram: vi.fn(),
    useProgram: vi.fn(),
    getAttribLocation: vi.fn((_, name) => (name === "a_pos" ? 0 : name === "a_uv" ? 1 : -1)),
    getUniformLocation: vi.fn(() => ({})),
    uniform1i: vi.fn(),
    createVertexArray: vi.fn(() => ({})),
    bindVertexArray: vi.fn(),
    deleteVertexArray: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    deleteBuffer: vi.fn(),
    createTexture: vi.fn(() => ({})),
    bindTexture: vi.fn(),
    deleteTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    texSubImage2D: vi.fn(),
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    drawArrays: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    activeTexture: vi.fn(),
  } as unknown as WebGL2RenderingContext;
}

describe("FilmstripTileCache L0 Pinning & Multi-Clip Ceiling", () => {
  it("protects L0 baseline coarse tiles from LRU eviction when dense tiles churn", () => {
    // 0.2MB budget (200KB = ~3.5 tiles of 160x90x4 = 57.6KB each)
    const cache = new FilmstripTileCache(0.2);

    // 1. Pre-populate 2 coarse L0 baseline tiles (timestamp 0s and 5s)
    const l0Addr0 = makeAddress("clip-1", SpatialTier.L0, 0, 0);
    const l0Art0 = makeArtifact("clip-1", SpatialTier.L0, 0);
    const l0Addr1 = makeAddress("clip-1", SpatialTier.L0, 1, 5);
    const l0Art1 = makeArtifact("clip-1", SpatialTier.L0, 5000);

    cache.setTile(l0Addr0, l0Art0);
    cache.setTile(l0Addr1, l0Art1);

    expect(cache.hasTile(l0Addr0)).toBe(true);
    expect(cache.hasTile(l0Addr1)).toBe(true);

    // 2. Churn cache with 10 dense L2 tiles, forcing frequent evictions
    for (let i = 0; i < 10; i++) {
      const denseAddr = makeAddress("clip-1", SpatialTier.L2, i, i * 0.5);
      const denseArt = makeArtifact("clip-1", SpatialTier.L2, i * 500);
      cache.setTile(denseAddr, denseArt);
    }

    // 3. Dense tiles should have been evicted under LRU pressure...
    const stats = cache.getStats();
    expect(stats.memoryBytes).toBeLessThanOrEqual(stats.budgetBytes);

    // 4. ...BUT both L0 baseline tiles MUST remain 100% resident and intact!
    expect(cache.hasTile(l0Addr0)).toBe(true);
    expect(cache.hasTile(l0Addr1)).toBe(true);
    expect(l0Art0.bitmap.close).not.toHaveBeenCalled();
    expect(l0Art1.bitmap.close).not.toHaveBeenCalled();

    // 5. findBestFallback continues to resolve L0 baseline
    const fallback = cache.findBestFallback("clip-1", SpatialTier.L2, 0.2);
    expect(fallback).not.toBeNull();
    expect(fallback!.artifact).toBe(l0Art0);

    cache.dispose();
  });

  it("enforces hard memory ceiling across dozens of clips with L0 tiles", () => {
    // 0.5MB budget (~8 tiles of 57.6KB max)
    const cache = new FilmstripTileCache(0.5);

    // Add 30 distinct clips, each with an L0 tile
    for (let c = 0; c < 30; c++) {
      const clipId = `clip-${c}`;
      const addr = makeAddress(clipId, SpatialTier.L0, 0, 0);
      const art = makeArtifact(clipId, SpatialTier.L0, 0);
      cache.setTile(addr, art);
    }

    const stats = cache.getStats();
    // Hard ceiling guarantee: total memory must NOT exceed budget despite 30 clips
    expect(stats.memoryBytes).toBeLessThanOrEqual(stats.budgetBytes);
    expect(stats.tileCount).toBeLessThanOrEqual(9);

    // Most recent clip's L0 tile is present
    expect(cache.hasTile(makeAddress("clip-29", SpatialTier.L0, 0, 0))).toBe(true);

    cache.dispose();
  });

  it("End-to-End Image 2 Reproduction: WebGLRasterSurface renders stretched L0 fallback after dense tile eviction", () => {
    const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
    const gl = makeGl();
    const surface = new WebGLRasterSurface(canvas, gl);

    // Tight cache budget to force eviction
    const tileCache = new FilmstripTileCache(0.2);

    // 1. Initial clip import: L0 coarse tile cached at t = 2.0s
    const l0Addr = makeAddress("clip-zoom", SpatialTier.L0, 0, 2.0, "video.mp4");
    const l0Artifact = makeArtifact("clip-zoom", SpatialTier.L0, 2000, 160, 90);
    tileCache.setTile(l0Addr, l0Artifact);

    // 2. User deep zooms on a different region, generating dense L2 tiles and forcing LRU eviction
    for (let i = 0; i < 8; i++) {
      const denseAddr = makeAddress("clip-zoom", SpatialTier.L2, i, 50.0 + i * 0.1, "video.mp4");
      const denseArt = makeArtifact("clip-zoom", SpatialTier.L2, 50000 + i * 100);
      tileCache.setTile(denseAddr, denseArt);
    }

    // 3. User zooms/pans back to t = 2.0s at L2 (which has no exact L2 tile decoded yet)
    const targetAddresses: FilmstripTileAddress[] = [
      {
        clipId: "clip-zoom",
        videoPath: "video.mp4",
        zoomTier: SpatialTier.L2,
        tileIndex: 0,
        timestamp: 2.0,
      },
    ];

    surface.drawFilmstrip([], {
      clipWidthPx: 300,
      stripHeightPx: 60,
      dpr: 1,
      trimIn: 0,
      trimOut: 10,
      tileWidthPx: 60,
      tileAddresses: targetAddresses,
      tileCache,
      clipId: "clip-zoom",
      videoPath: "video.mp4",
    });

    // 4. Assert: WebGLRasterSurface uploaded the surviving L0 fallback bitmap to atlas and drew quad
    expect(gl.texSubImage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      l0Artifact.bitmap
    );
    expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLES, 0, 6);

    surface.dispose();
    tileCache.dispose();
  });
});
