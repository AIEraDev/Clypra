import { describe, expect, it, vi } from "vitest";
import { WebGLRasterSurface, createRasterSurface } from "../webglRasterSurface";
import { FilmstripTileCache } from "@/lib/filmstrip/FilmstripTileCache";
import type { TransportArtifact } from "../transport";
import type { FilmstripTileAddress } from "@/lib/filmstrip/filmstripTiers";
import type { RenderEpochId } from "../types";
import { SpatialTier } from "../types";

const eid = (s: string) => s as RenderEpochId;

function makeArtifact(timestampMs: number, width = 80, height = 45): TransportArtifact {
  return {
    frameId: `f-${timestampMs}`,
    contentHash: `h-${timestampMs}`,
    spatialTier: SpatialTier.L0,
    bitmap: { width, height, close: vi.fn() } as unknown as ImageBitmap,
    width,
    height,
    timestampMs,
    epochId: eid("epoch-1"),
    source: "fresh-decode",
  };
}

function makeGl() {
  const gl = {
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
    TEXTURE0: 0x84c0,
    TRIANGLES: 0x0004,
    NO_ERROR: 0,
    getError: vi.fn(() => 0),
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ""),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ""),
    deleteShader: vi.fn(),
    getAttribLocation: vi.fn((_program: unknown, name: string) => {
      if (name === "a_pos") return 0;
      if (name === "a_uv") return 1;
      return -1;
    }),
    createVertexArray: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({})),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    texImage2D: vi.fn(),
    texSubImage2D: vi.fn(),
    useProgram: vi.fn(),
    bindVertexArray: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn(() => ({})),
    uniform1i: vi.fn(),
    activeTexture: vi.fn(),
    drawArrays: vi.fn(),
    deleteTexture: vi.fn(),
    deleteBuffer: vi.fn(),
    deleteVertexArray: vi.fn(),
    deleteProgram: vi.fn(),
  };

  return gl as unknown as WebGL2RenderingContext;
}

describe("WebGLRasterSurface", () => {
  it("binds only live shader attributes during filmstrip draw", () => {
    const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
    const gl = makeGl();
    const surface = new WebGLRasterSurface(canvas, gl);

    surface.drawFilmstrip([makeArtifact(1000), makeArtifact(2000)], {
      clipWidthPx: 120,
      stripHeightPx: 40,
      dpr: 1,
      tileWidthPx: 60,
    });

    expect(gl.getAttribLocation).toHaveBeenCalledWith(expect.anything(), "a_pos");
    expect(gl.getAttribLocation).toHaveBeenCalledWith(expect.anything(), "a_uv");
    expect(gl.getAttribLocation).not.toHaveBeenCalledWith(expect.anything(), "a_tileIdx");
    expect(gl.enableVertexAttribArray).toHaveBeenCalledWith(0);
    expect(gl.enableVertexAttribArray).toHaveBeenCalledWith(1);
    expect(gl.enableVertexAttribArray).not.toHaveBeenCalledWith(-1);
    expect(gl.vertexAttribPointer).not.toHaveBeenCalledWith(-1, expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });

  it("packs mixed-size artifacts into fixed atlas cells without overlap", () => {
    const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
    const gl = makeGl();
    const surface = new WebGLRasterSurface(canvas, gl);

    surface.drawFilmstrip([makeArtifact(1000, 80, 45), makeArtifact(2000, 120, 68)], {
      clipWidthPx: 120,
      stripHeightPx: 40,
      dpr: 1,
      tileWidthPx: 60,
    });

    expect(gl.texSubImage2D).toHaveBeenNthCalledWith(1, gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, expect.anything());
    expect(gl.texSubImage2D).toHaveBeenNthCalledWith(2, gl.TEXTURE_2D, 0, 120, 0, gl.RGBA, gl.UNSIGNED_BYTE, expect.anything());
  });

  it("accepts portrait artifacts without stretching them to fill tile width", () => {
    const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
    const gl = makeGl();
    const surface = new WebGLRasterSurface(canvas, gl);

    surface.drawFilmstrip([makeArtifact(1000, 90, 160)], {
      clipWidthPx: 96,
      stripHeightPx: 40,
      dpr: 1,
      tileWidthPx: 96,
    });

    const vertices = vi.mocked(gl.bufferData).mock.calls[0][1] as Float32Array;

    // Portrait bitmap (90x160) in 96x40 tile: fits width, crops height vertically
    // The implementation uses center-crop: fits width to tile, crops excess height
    expect(vertices[0]).toBeCloseTo(-1, 4); // TL position x0
    expect(vertices[8]).toBeCloseTo(1, 4); // TR position x1
    // UV coordinates should map to the visible portion of the bitmap
    expect(vertices[10]).toBeGreaterThan(0); // TR uv u1 (positive width)
    expect(vertices[3]).toBeGreaterThan(0); // TL uv v0 (cropped offset)
  });

  it("places exact timestamp slots without nearest-frame substitution", () => {
    const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
    const gl = makeGl();
    const surface = new WebGLRasterSurface(canvas, gl);

    const art10 = makeArtifact(10000);
    const art15 = makeArtifact(15000);
    const art20 = makeArtifact(20000);
    const artifacts = [art10, art15, art20];
    const tileAddresses: FilmstripTileAddress[] = [10, 15, 20].map((timestamp, tileIndex) => ({
      clipId: "clip-1",
      zoomTier: SpatialTier.L0,
      tileIndex,
      timestamp,
    }));

    surface.drawFilmstrip(artifacts, {
      clipWidthPx: 180,
      stripHeightPx: 40,
      dpr: 1,
      tileWidthPx: 60,
      trimIn: 10,
      trimOut: 20,
      tileAddresses,
    });

    const vertices = vi.mocked(gl.bufferData).mock.calls[0][1] as Float32Array;

    // Exact addresses occupy physically mapped slots; tile 0 covers [-1, 0] and tile 1 covers [0, 1].
    expect(vertices[0]).toBeCloseTo(-1, 4);
    expect(vertices[24]).toBeCloseTo(0, 4);

    surface.dispose();
  });

  it("State 2: L2 missing and L0 available in tileCache -> resolves and packs stretched L0 fallback", () => {
    const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
    const gl = makeGl();
    const surface = new WebGLRasterSurface(canvas, gl);
    const tileCache = new FilmstripTileCache(50);

    const l0Artifact = makeArtifact(0, 160, 90);
    tileCache.setTile(
      {
        clipId: "clip-fallback",
        videoPath: "test.mp4",
        zoomTier: SpatialTier.L0,
        tileIndex: 0,
        timestamp: 0,
      },
      l0Artifact
    );

    const tileAddresses: FilmstripTileAddress[] = [
      {
        clipId: "clip-fallback",
        videoPath: "test.mp4",
        zoomTier: SpatialTier.L2,
        tileIndex: 0,
        timestamp: 0,
      },
    ];

    // Pass 0 exact artifacts (L2 in-flight)
    surface.drawFilmstrip([], {
      clipWidthPx: 300,
      stripHeightPx: 60,
      dpr: 1,
      trimIn: 0,
      trimOut: 10,
      tileWidthPx: 60,
      tileAddresses,
      tileCache,
      clipId: "clip-fallback",
      videoPath: "test.mp4",
    });

    // Should upload L0 bitmap to atlas and draw triangles
    expect(gl.texSubImage2D).toHaveBeenCalledTimes(1);
    expect(gl.texSubImage2D).toHaveBeenCalledWith(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, l0Artifact.bitmap);
    expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLES, 0, 6);

    surface.dispose();
  });

  it("State 3: All tiers missing (cold import) -> uploads and renders stylized shimmer quads with slot boundaries", () => {
    const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
    const gl = makeGl();
    const surface = new WebGLRasterSurface(canvas, gl);
    const tileCache = new FilmstripTileCache(50);

    const tileAddresses: FilmstripTileAddress[] = [
      {
        clipId: "clip-cold",
        videoPath: "test.mp4",
        zoomTier: SpatialTier.L2,
        tileIndex: 0,
        timestamp: 0,
      },
    ];

    surface.drawFilmstrip([], {
      clipWidthPx: 300,
      stripHeightPx: 60,
      dpr: 1,
      trimIn: 0,
      trimOut: 10,
      tileWidthPx: 60,
      tileAddresses,
      tileCache,
      clipId: "clip-cold",
      videoPath: "test.mp4",
    });

    expect(gl.clear).toHaveBeenCalledWith(gl.COLOR_BUFFER_BIT);
    // Should upload shimmer pattern and render quads (never blank transparent void)
    expect(gl.texSubImage2D).toHaveBeenCalledWith(gl.TEXTURE_2D, 0, 0, 0, 32, 32, gl.RGBA, gl.UNSIGNED_BYTE, expect.any(Uint8Array));
    expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLES, 0, 6);

    surface.dispose();
  });

  it("factory: createRasterSurface returns WebGLRasterSurface when webgl2 context is supported", () => {
    const gl = makeGl();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn((type: string) => {
        if (type === "webgl2") return gl;
        return null;
      }),
    } as unknown as HTMLCanvasElement;

    const surface = createRasterSurface(canvas);
    expect(surface).toBeInstanceOf(WebGLRasterSurface);
    expect(canvas.getContext).toHaveBeenCalledWith("webgl2", expect.anything());

    surface.dispose();
  });
});
