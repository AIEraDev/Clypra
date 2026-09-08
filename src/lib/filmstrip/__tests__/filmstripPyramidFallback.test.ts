/**
 * filmstripPyramidFallback.test.ts
 *
 * Validates:
 * - Coarse-to-Dense Pyramid Fallback during zoom:
 *   When a dense tile (L1/L2/L3) hasn't decoded yet, RasterSurface stretches
 *   the already-resident L0 coarse tile instead of showing empty shimmer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { RasterSurface, type FilmstripLayout } from "../../renderEngine/rasterSurface";
import { FilmstripTileCache } from "../FilmstripTileCache";
import { SpatialTier } from "../../renderEngine/types";

describe("Coarse-to-Dense Pyramid Fallback Rendering", () => {
  let canvas: HTMLCanvasElement;
  let ctxMock: any;
  let tileCache: FilmstripTileCache;

  beforeEach(() => {
    ctxMock = {
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      createLinearGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
    };

    canvas = {
      width: 600,
      height: 60,
      style: {},
      getContext: vi.fn().mockReturnValue(ctxMock),
    } as any;

    tileCache = new FilmstripTileCache(50);
  });

  it("stretches resident L0 coarse tile when dense L1 tile is in-flight", () => {
    const surface = new RasterSurface(canvas);
    const clipId = "clip-1";
    const videoPath = "source-video.mp4";

    // 1. Populate tileCache with an L0 coarse tile at timestamp 0s
    const l0Bitmap = { width: 160, height: 90, close: vi.fn() } as any;
    tileCache.setTile(
      {
        clipId,
        videoPath,
        zoomTier: SpatialTier.L0,
        tileIndex: 0,
        timestamp: 0,
      },
      {
        frameId: "f0",
        contentHash: "hash-0",
        spatialTier: SpatialTier.L0,
        bitmap: l0Bitmap,
        width: 160,
        height: 90,
        timestampMs: 0,
        epochId: "epoch-1" as any,
      }
    );

    // 2. Render filmstrip for L1 zoom where artifacts array is empty (dense L1 in-flight)
    const layout: FilmstripLayout = {
      clipWidthPx: 300,
      stripHeightPx: 60,
      dpr: 1,
      trimIn: 0,
      trimOut: 10,
      tileWidthPx: 60,
      tileAddresses: [
        {
          clipId,
          videoPath,
          zoomTier: SpatialTier.L1,
          tileIndex: 0,
          timestamp: 0,
        },
      ],
      tileCache,
      clipId,
      videoPath,
    };

    surface.drawFilmstrip([], layout);

    // 3. Verify that drawImage was invoked using the L0 coarse bitmap
    expect(ctxMock.drawImage).toHaveBeenCalledTimes(1);
    expect(ctxMock.drawImage).toHaveBeenCalledWith(
      l0Bitmap,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it("falls back to shimmer placeholder when neither dense nor L0 coarse tile is available", () => {
    const surface = new RasterSurface(canvas);
    const clipId = "clip-cold";
    const videoPath = "cold-video.mp4";

    // Cache is completely empty
    const layout: FilmstripLayout = {
      clipWidthPx: 300,
      stripHeightPx: 60,
      dpr: 1,
      trimIn: 0,
      trimOut: 10,
      tileWidthPx: 60,
      tileAddresses: [
        {
          clipId,
          videoPath,
          zoomTier: SpatialTier.L1,
          tileIndex: 0,
          timestamp: 0,
        },
      ],
      tileCache,
      clipId,
      videoPath,
    };

    surface.drawFilmstrip([], layout);

    // drawImage should NOT have been called, but placeholder shimmer fillRect/stroke should
    expect(ctxMock.drawImage).not.toHaveBeenCalled();
    expect(ctxMock.fillRect).toHaveBeenCalled();
  });
});

// ── Bidirectional Tier Fallback (findBestFallback) ───────────────────────────

describe("FilmstripTileCache – bidirectional findBestFallback", () => {
  function makeBitmap() {
    return { width: 160, height: 90, close: () => {} } as ImageBitmap;
  }

  function makeArtifact(tier: SpatialTier, ts: number) {
    return {
      frameId: `f-${tier}-${ts}`,
      contentHash: `hash-${tier}-${ts}`,
      spatialTier: tier,
      bitmap: makeBitmap(),
      width: 160,
      height: 90,
      timestampMs: ts * 1000,
      epochId: "epoch-1" as any,
    };
  }

  it("returns a higher-tier (L1) tile when target is L0 and no L0 tiles are cached", () => {
    const cache = new FilmstripTileCache(50);
    const clipId = "clip-a";
    const videoPath = "vid.mp4";

    // Only L1 tiles cached — simulates a session where L1 was the last zoom level
    cache.setTile({ clipId, videoPath, zoomTier: SpatialTier.L1, tileIndex: 0, timestamp: 0 }, makeArtifact(SpatialTier.L1, 0));
    cache.setTile({ clipId, videoPath, zoomTier: SpatialTier.L1, tileIndex: 1, timestamp: 5 }, makeArtifact(SpatialTier.L1, 5));

    // Ask for L0 at t=0 — no L0 tile, but L1 is 1 tier away (closest)
    const result = cache.findBestFallback(clipId, SpatialTier.L0, 0, videoPath, 6.0);
    expect(result).not.toBeNull();
    expect(result!.address.zoomTier).toBe(SpatialTier.L1);
  });

  it("prefers closer tier over farther tier (L1 over L3 when target is L2)", () => {
    const cache = new FilmstripTileCache(50);
    const clipId = "clip-b";
    const videoPath = "vid2.mp4";

    // L1 is distance 1 from L2; L3 is also distance 1 from L2. L1 wins (lower on tie).
    cache.setTile({ clipId, videoPath, zoomTier: SpatialTier.L1, tileIndex: 0, timestamp: 0 }, makeArtifact(SpatialTier.L1, 0));
    cache.setTile({ clipId, videoPath, zoomTier: SpatialTier.L3, tileIndex: 0, timestamp: 0 }, makeArtifact(SpatialTier.L3, 0));

    const result = cache.findBestFallback(clipId, SpatialTier.L2, 0, videoPath, 6.0);
    expect(result).not.toBeNull();
    expect(result!.address.zoomTier).toBe(SpatialTier.L1); // L1 preferred over L3 on tie
  });

  it("returns null when no tiles are cached at all", () => {
    const cache = new FilmstripTileCache(50);
    const result = cache.findBestFallback("clip-empty", SpatialTier.L0, 0, "x.mp4", 6.0);
    expect(result).toBeNull();
  });
});

