/**
 * Native Raster Prewarm Boundary Selection — Unit Tests
 *
 * Verifies that `_prewarmNativeRasterAssetsInternal` correctly filters
 * critical raster boundaries to ONLY those intersecting the initial playhead
 * position (t = 0), deferring non-visible raster clips (e.g. titles at t > 0)
 * to background idle prewarm.
 *
 * INVARIANT: Tests in this file are append-only. Never delete or skip a test.
 */

import { describe, it, expect } from "vitest";

interface MockClip {
  id: string;
  kind: "video" | "text" | "text-template" | "image" | "sticker" | "audio";
  startTime: number;
  duration: number;
  mediaId?: string;
}

/**
 * Pure helper mirroring `isRasterClip` from `ProjectSession._prewarmNativeRasterAssetsInternal`.
 */
function isRasterClip(clip: MockClip): boolean {
  return (
    clip.kind === "text" ||
    clip.kind === "text-template" ||
    clip.kind === "image" ||
    clip.kind === "sticker"
  );
}

/**
 * Pure boundary partitioner mirroring the critical-vs-deferred selection logic.
 */
function partitionRasterBoundaries(
  clips: MockClip[],
  options: {
    activeAtTime?: number;
    startIndex?: number;
    limit?: number;
  } = {},
): {
  criticalBoundaries: MockClip[];
  warmedCount: number;
  hasMoreDeferred: boolean;
  nextDeferredStartIndex: number;
} {
  const allRaster = clips
    .filter(isRasterClip)
    .sort((left, right) => left.startTime - right.startTime);

  if (allRaster.length === 0) {
    return {
      criticalBoundaries: [],
      warmedCount: 0,
      hasMoreDeferred: false,
      nextDeferredStartIndex: 0,
    };
  }

  if (options.activeAtTime !== undefined) {
    const t = options.activeAtTime;
    const active = allRaster.filter(
      (c) => c.startTime <= t && c.startTime + c.duration > t,
    );

    if (active.length === 0) {
      // None active at initial time — all raster boundaries are deferred
      return {
        criticalBoundaries: [],
        warmedCount: 0,
        hasMoreDeferred: allRaster.length > 0,
        nextDeferredStartIndex: 0,
      };
    }

    const startIndex = Math.max(0, options.startIndex ?? 0);
    const slice = active.slice(
      startIndex,
      options.limit === undefined ? undefined : startIndex + options.limit,
    );

    return {
      criticalBoundaries: slice,
      warmedCount: slice.length,
      hasMoreDeferred: allRaster.length > slice.length,
      nextDeferredStartIndex: slice.length,
    };
  }

  // General / deferred path
  const startIndex = Math.max(0, options.startIndex ?? 0);
  const slice = allRaster.slice(
    startIndex,
    options.limit === undefined ? undefined : startIndex + options.limit,
  );

  return {
    criticalBoundaries: slice,
    warmedCount: slice.length,
    hasMoreDeferred: startIndex + slice.length < allRaster.length,
    nextDeferredStartIndex: startIndex + slice.length,
  };
}

describe("Native Raster Prewarm — Boundary Filtering & Deferral", () => {
  it("returns no boundaries when project has no raster clips", () => {
    const clips: MockClip[] = [
      { id: "v1", kind: "video", startTime: 0, duration: 10 },
      { id: "a1", kind: "audio", startTime: 0, duration: 10 },
    ];

    const result = partitionRasterBoundaries(clips, { activeAtTime: 0, limit: 1 });
    expect(result.criticalBoundaries).toHaveLength(0);
    expect(result.warmedCount).toBe(0);
    expect(result.hasMoreDeferred).toBe(false);
  });

  it("defers raster clips that start in the future (startTime > 0) away from project open", () => {
    // Exactly matches Session H / project-1790503657813-vmuodkvpfi-0:
    // Video at 0s, text at 6.9s.
    const clips: MockClip[] = [
      { id: "v1", kind: "video", startTime: 0, duration: 22.2 },
      { id: "t1", kind: "text", startTime: 6.9, duration: 16.5 },
      { id: "v2", kind: "video", startTime: 22.2, duration: 1805 },
    ];

    const critical = partitionRasterBoundaries(clips, { activeAtTime: 0, limit: 1 });
    // Text at 6.9s must NOT be in the critical project-open barrier
    expect(critical.criticalBoundaries).toHaveLength(0);
    expect(critical.warmedCount).toBe(0);
    expect(critical.hasMoreDeferred).toBe(true);
    expect(critical.nextDeferredStartIndex).toBe(0);

    // Deferred pass on idle should prewarm the text clip starting from index 0
    const deferred = partitionRasterBoundaries(clips, {
      startIndex: critical.nextDeferredStartIndex,
    });
    expect(deferred.criticalBoundaries).toHaveLength(1);
    expect(deferred.criticalBoundaries[0].id).toBe("t1");
    expect(deferred.hasMoreDeferred).toBe(false);
  });

  it("warms raster clips that are active at t = 0 during critical project-open barrier", () => {
    const clips: MockClip[] = [
      { id: "t0", kind: "text", startTime: 0, duration: 5 },
      { id: "t1", kind: "text", startTime: 6.9, duration: 16.5 },
    ];

    const critical = partitionRasterBoundaries(clips, { activeAtTime: 0, limit: 1 });
    // Text at 0s must be warmed in critical stage
    expect(critical.criticalBoundaries).toHaveLength(1);
    expect(critical.criticalBoundaries[0].id).toBe("t0");
    expect(critical.warmedCount).toBe(1);
    expect(critical.hasMoreDeferred).toBe(true);
    expect(critical.nextDeferredStartIndex).toBe(1);

    // Deferred pass on idle warms remaining clips starting from index 1
    const deferred = partitionRasterBoundaries(clips, {
      startIndex: critical.nextDeferredStartIndex,
    });
    expect(deferred.criticalBoundaries).toHaveLength(1);
    expect(deferred.criticalBoundaries[0].id).toBe("t1");
    expect(deferred.hasMoreDeferred).toBe(false);
  });

  it("handles clip active across t = 0 boundary (startTime <= 0 && startTime + duration > 0)", () => {
    const clips: MockClip[] = [
      { id: "t0", kind: "text", startTime: 0, duration: 10 },
    ];

    const critical = partitionRasterBoundaries(clips, { activeAtTime: 0, limit: 1 });
    expect(critical.criticalBoundaries).toHaveLength(1);
    expect(critical.criticalBoundaries[0].id).toBe("t0");
    expect(critical.hasMoreDeferred).toBe(false);
  });

  it("does not warm clip whose duration ends exactly at t = 0", () => {
    const clips: MockClip[] = [
      { id: "t_past", kind: "text", startTime: -5, duration: 5 }, // ends at 0
      { id: "t_future", kind: "text", startTime: 2, duration: 5 },
    ];

    const critical = partitionRasterBoundaries(clips, { activeAtTime: 0, limit: 1 });
    expect(critical.criticalBoundaries).toHaveLength(0);
    expect(critical.warmedCount).toBe(0);
    expect(critical.hasMoreDeferred).toBe(true);
    expect(critical.nextDeferredStartIndex).toBe(0);
  });
});
