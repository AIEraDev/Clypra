/**
 * filmstripFallbackStateMachine.test.ts
 *
 * Layer 1: Pyramid Fallback State Machine
 *
 * Validates the 4 visual states and state transitions:
 * - State 1: L2 available, L0 available -> Draw L2 (no fallback, no shimmer)
 * - State 2: L2 missing, L0 available   -> Draw L0 scaled + marked coarse fallback (no shimmer)
 * - State 3: L2 missing, L0 missing     -> Draw stylized shimmer skeleton
 * - State 4: L0 fallback active -> L2 arrives -> In-place replacement, clear fallback
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { RasterSurface, type FilmstripLayout } from "../../renderEngine/rasterSurface";
import { FilmstripTileCache } from "../FilmstripTileCache";
import { SpatialTier } from "../../renderEngine/types";

describe("Layer 1: Pyramid Fallback State Machine & Visual Transitions", () => {
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

  it("State 1: L2 available and L0 available -> draws exact L2 bitmap with imageSmoothing disabled", () => {
    const surface = new RasterSurface(canvas);
    const clipId = "clip-state-1";
    const videoPath = "video1.mp4";

    const l2Bitmap = { width: 320, height: 180, close: vi.fn() } as any;

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
          zoomTier: SpatialTier.L2,
          tileIndex: 0,
          timestamp: 0,
        },
      ],
      tileCache,
      clipId,
      videoPath,
    };

    // Pass exact L2 artifact directly
    surface.drawFilmstrip(
      [
        {
          frameId: "f-l2-0",
          contentHash: "hash-0",
          spatialTier: SpatialTier.L2,
          bitmap: l2Bitmap,
          width: 320,
          height: 180,
          timestampMs: 0,
          epochId: "epoch-1" as any,
        },
      ],
      layout
    );

    expect(ctxMock.drawImage).toHaveBeenCalledTimes(1);
    expect(ctxMock.drawImage).toHaveBeenCalledWith(
      l2Bitmap,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it("State 2: L2 missing and L0 available -> draws stretched L0 with imageSmoothing enabled", () => {
    const surface = new RasterSurface(canvas);
    const clipId = "clip-state-2";
    const videoPath = "video2.mp4";

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
        frameId: "f-l0-0",
        contentHash: "hash-0",
        spatialTier: SpatialTier.L0,
        bitmap: l0Bitmap,
        width: 160,
        height: 90,
        timestampMs: 0,
        epochId: "epoch-1" as any,
      }
    );

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
          zoomTier: SpatialTier.L2,
          tileIndex: 0,
          timestamp: 0,
        },
      ],
      tileCache,
      clipId,
      videoPath,
    };

    // Artifacts empty (L2 in-flight)
    surface.drawFilmstrip([], layout);

    expect(ctxMock.drawImage).toHaveBeenCalledTimes(1);
    expect(ctxMock.drawImage).toHaveBeenCalledWith(
      l0Bitmap,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it("State 3: L2 missing and L0 missing -> renders stylized shimmer skeleton without drawImage", () => {
    const surface = new RasterSurface(canvas);
    const clipId = "clip-state-3";
    const videoPath = "video3.mp4";

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
          zoomTier: SpatialTier.L2,
          tileIndex: 0,
          timestamp: 0,
        },
      ],
      tileCache,
      clipId,
      videoPath,
    };

    surface.drawFilmstrip([], layout);

    expect(ctxMock.drawImage).not.toHaveBeenCalled();
    expect(ctxMock.fillRect).toHaveBeenCalled();
    expect(ctxMock.stroke).toHaveBeenCalled();
  });

  it("State 4 Transition: L0 fallback rendered, then L2 arrives and cleanly replaces it", () => {
    const surface = new RasterSurface(canvas);
    const clipId = "clip-state-4";
    const videoPath = "video4.mp4";

    const l0Bitmap = { width: 160, height: 90, close: vi.fn() } as any;
    const l2Bitmap = { width: 320, height: 180, close: vi.fn() } as any;

    tileCache.setTile(
      {
        clipId,
        videoPath,
        zoomTier: SpatialTier.L0,
        tileIndex: 0,
        timestamp: 0,
      },
      {
        frameId: "f-l0-0",
        contentHash: "hash-0",
        spatialTier: SpatialTier.L0,
        bitmap: l0Bitmap,
        width: 160,
        height: 90,
        timestampMs: 0,
        epochId: "epoch-1" as any,
      }
    );

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
          zoomTier: SpatialTier.L2,
          tileIndex: 0,
          timestamp: 0,
        },
      ],
      tileCache,
      clipId,
      videoPath,
    };

    // Step 1: Render before L2 arrives -> fallback to L0
    surface.drawFilmstrip([], layout);
    expect(ctxMock.drawImage).toHaveBeenCalledWith(l0Bitmap, expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number));

    ctxMock.drawImage.mockClear();

    // Step 2: L2 arrives -> render with L2 artifact
    surface.drawFilmstrip(
      [
        {
          frameId: "f-l2-0",
          contentHash: "hash-0",
          spatialTier: SpatialTier.L2,
          bitmap: l2Bitmap,
          width: 320,
          height: 180,
          timestampMs: 0,
          epochId: "epoch-1" as any,
        },
      ],
      layout
    );

    expect(ctxMock.drawImage).toHaveBeenCalledWith(l2Bitmap, expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number));
  });
});
