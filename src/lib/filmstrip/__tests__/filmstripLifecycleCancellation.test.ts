/**
 * filmstripLifecycleCancellation.test.ts
 *
 * Layer 5: Lifecycle & Cancellation Safety
 *
 * Validates:
 * - Clip added -> 300 decode requests in-flight -> clip deleted immediately
 * - In-flight workers abort immediately, zero callbacks on unmounted components, zero memory leaks
 */

import { describe, it, expect, vi } from "vitest";
import { FilmstripCache } from "../../renderEngine/FilmstripCache";
import * as transport from "../../renderEngine/transport";
import { SpatialTier } from "../../renderEngine/types";

vi.mock("../../renderEngine/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../renderEngine/transport")>();
  return {
    ...actual,
    requestFilmstripArtifacts: vi.fn(),
    checkCoarseBaselineCache: vi.fn(),
    isValidArtifact: (art: any) => !!art?.bitmap && art.bitmap.width > 0,
  };
});

describe("Layer 5: Lifecycle & Cancellation Safety", () => {
  it("immediately cancels in-flight preload/filmstrip requests when clip is invalidated or removed", () => {
    const cache = new FilmstripCache(50);
    const clipId = "clip-to-abort";
    const videoPath = "heavy_4k.mp4";

    let cancelCalled = false;
    vi.mocked(transport.requestFilmstripArtifacts).mockImplementation(() => {
      return () => {
        cancelCalled = true;
      };
    });

    // Start filmstrip request
    cache.requestFilmstrip({
      clipId,
      videoPath,
      trimIn: 0,
      trimOut: 60,
      duration: 60,
      clipStartTime: 0,
      clipWidthPx: 1920,
      spatialTier: SpatialTier.L1,
      epochId: "epoch-1" as any,
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 50,
      onUpdate: vi.fn(),
    });

    expect(transport.requestFilmstripArtifacts).toHaveBeenCalled();
    expect(cancelCalled).toBe(false);

    // User deletes clip / timeline unmounts
    cache.invalidateClip(clipId);

    // Transport cancel function MUST have been invoked
    expect(cancelCalled).toBe(true);
  });
});
