/**
 * filmstripScheduling.test.ts
 *
 * Validates:
 * - FILMSTRIP-003: Playhead-nearest frames have highest dispatch priority (radial distance)
 * - FILMSTRIP-008: Rapid playhead movement cancels/deprioritizes obsolete work
 * - FILMSTRIP-010: Maximum decode concurrency never exceeds configured limits
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FilmstripCache } from "../../renderEngine/FilmstripCache";
import { SpatialTier } from "../../renderEngine/types";
import * as transport from "../../renderEngine/transport";

vi.mock("../../renderEngine/transport", async () => {
  const actual = await vi.importActual<typeof import("../../renderEngine/transport")>(
    "../../renderEngine/transport"
  );
  return {
    ...actual,
    requestFilmstripArtifacts: vi.fn(),
  };
});

describe("FILMSTRIP Scheduling & Priority Pipeline", () => {
  let cache: FilmstripCache;
  let mockRequestArtifacts: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cache = new FilmstripCache(100);
    mockRequestArtifacts = vi.mocked(transport.requestFilmstripArtifacts);
    mockRequestArtifacts.mockReset();
  });

  afterEach(() => {
    cache.dispose();
  });

  it("FILMSTRIP-003: Dispatches requests in strict radial proximity order from visible playhead", () => {
    let capturedTimestampsMs: number[] = [];

    mockRequestArtifacts.mockImplementation((opts: any) => {
      capturedTimestampsMs = opts.timestampsMs;
      return vi.fn();
    });

    // Setup a scenario where visible center time is ~58s
    // clip: startTime = 0s, trimIn = 0s, trimOut = 120s, duration = 120s
    // viewport: scrollLeft = 2400px, viewportWidth = 1000px, pps = 50px/s
    // visible range in px: [2400, 3400] -> visible center = 2900px = 58s
    cache.requestFilmstrip({
      clipId: "clip-schedule-1",
      videoPath: "/test-video.mp4",
      trimIn: 0,
      trimOut: 120,
      duration: 120,
      clipStartTime: 0,
      clipWidthPx: 6000,
      spatialTier: SpatialTier.L1,
      epochId: "epoch-sched-1" as any,
      viewportScrollLeft: 2400,
      viewportWidth: 1000,
      pixelsPerSecond: 50,
      playheadTime: 58,
      onUpdate: vi.fn(),
    });

    expect(mockRequestArtifacts).toHaveBeenCalledTimes(1);
    expect(capturedTimestampsMs.length).toBeGreaterThan(0);

    // Visible center is ~58s (58000ms)
    // The first timestamp in capturedTimestampsMs should be the one closest to 58000ms
    const firstTs = capturedTimestampsMs[0];
    const diffToCenter = Math.abs(firstTs - 58000);

    // Assert that the first requested timestamp is within 5s of visible center
    expect(diffToCenter).toBeLessThanOrEqual(5000);

    // Verify timestamps are strictly sorted by ascending radial distance to visible center
    for (let i = 1; i < capturedTimestampsMs.length; i++) {
      const prevDiff = Math.abs(capturedTimestampsMs[i - 1] - 58000);
      const currDiff = Math.abs(capturedTimestampsMs[i] - 58000);
      expect(currDiff).toBeGreaterThanOrEqual(prevDiff);
    }
  });

  it("FILMSTRIP-008: Rapid playhead jump cancels previous request and re-prioritizes new center", () => {
    const cancelFn1 = vi.fn();
    let capturedTimestampsCall1: number[] = [];
    let capturedTimestampsCall2: number[] = [];

    mockRequestArtifacts.mockImplementationOnce((opts: any) => {
      capturedTimestampsCall1 = opts.timestampsMs;
      return cancelFn1;
    });

    // Step 1: Initial position at 10s (scrollLeft = 500px, pps = 50 -> center = 15s)
    cache.requestFilmstrip({
      clipId: "clip-scrub-1",
      videoPath: "/scrub.mp4",
      trimIn: 0,
      trimOut: 120,
      duration: 120,
      clipStartTime: 0,
      clipWidthPx: 6000,
      spatialTier: SpatialTier.L1,
      epochId: "epoch-1" as any,
      viewportScrollLeft: 500,
      viewportWidth: 1000,
      pixelsPerSecond: 50,
      playheadTime: 15,
      onUpdate: vi.fn(),
    });

    expect(cancelFn1).not.toHaveBeenCalled();

    // Step 2: User jumps playhead to 90s (scrollLeft = 4000px) with new epoch
    const cancelFn2 = vi.fn();
    mockRequestArtifacts.mockImplementationOnce((opts: any) => {
      capturedTimestampsCall2 = opts.timestampsMs;
      return cancelFn2;
    });

    cache.requestFilmstrip({
      clipId: "clip-scrub-1",
      videoPath: "/scrub.mp4",
      trimIn: 0,
      trimOut: 120,
      duration: 120,
      clipStartTime: 0,
      clipWidthPx: 6000,
      spatialTier: SpatialTier.L1,
      epochId: "epoch-2" as any,
      viewportScrollLeft: 4000, // center = (4000 + 500) / 50 = 90s
      viewportWidth: 1000,
      pixelsPerSecond: 50,
      playheadTime: 90,
      onUpdate: vi.fn(),
    });

    // Old in-flight request must be cancelled immediately
    expect(cancelFn1).toHaveBeenCalledTimes(1);

    // New request must have 90s area at index 0
    expect(capturedTimestampsCall2[0]).toBeGreaterThanOrEqual(85000);
    expect(capturedTimestampsCall2[0]).toBeLessThanOrEqual(95000);
  });

  it("FILMSTRIP-010: Preload request specifies bounded concurrency", () => {
    let capturedConcurrency: number | undefined;

    mockRequestArtifacts.mockImplementation((opts: any) => {
      capturedConcurrency = opts.concurrency;
      return vi.fn();
    });

    cache.preloadAssetCoarseBaseline({
      videoPath: "/preload-test.mp4",
      duration: 3600, // 1 hour
    });

    expect(mockRequestArtifacts).toHaveBeenCalled();
    // Concurrency must be bounded (<= 2) to prevent saturating UI thread or hardware decoders
    expect(capturedConcurrency).toBeDefined();
    expect(capturedConcurrency).toBeLessThanOrEqual(2);
  });
});
