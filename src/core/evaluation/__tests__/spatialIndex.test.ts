import { describe, it, expect } from "vitest";
import {
  TimelineIntervalTree,
  type TimelineIntervalItem,
  DEFAULT_BOUNDARY_TOLERANCE_SECS,
} from "../spatialIndex";

interface MockClip extends TimelineIntervalItem {
  id: string;
  startTime: number;
  duration: number;
  trackId: string;
}

describe("TimelineIntervalTree", () => {
  it("handles empty item collections correctly", () => {
    const tree = new TimelineIntervalTree<MockClip>([]);
    expect(tree.count).toBe(0);
    expect(tree.maxEndTime).toBe(0);

    const out: MockClip[] = [];
    const res = tree.queryPoint(5.0, DEFAULT_BOUNDARY_TOLERANCE_SECS, out);
    expect(res).toHaveLength(0);
    expect(res).toBe(out);

    expect(tree.queryRange(0, 10)).toHaveLength(0);
  });

  it("accurately reports maxEndTime across multi-track intervals", () => {
    const clips: MockClip[] = [
      { id: "c1", startTime: 0, duration: 5, trackId: "t1" },
      { id: "c2", startTime: 10, duration: 25.5, trackId: "t1" },
      { id: "c3", startTime: 2, duration: 8, trackId: "t2" },
      { id: "c4", startTime: 15, duration: 4, trackId: "t3" },
    ];
    const tree = new TimelineIntervalTree(clips);
    expect(tree.count).toBe(4);
    // c2 ends at 10 + 25.5 = 35.5
    expect(tree.maxEndTime).toBe(35.5);
  });

  it("correctly queries overlapping clips at point in time", () => {
    const clips: MockClip[] = [
      { id: "c1", startTime: 0, duration: 10, trackId: "video-1" },
      { id: "c2", startTime: 5, duration: 10, trackId: "video-2" },
      { id: "c3", startTime: 20, duration: 5, trackId: "video-1" },
      { id: "c4", startTime: 0, duration: 30, trackId: "audio-1" },
    ];
    const tree = new TimelineIntervalTree(clips);

    // At t = 2.0: c1 and c4 are active
    const t2 = tree.queryPoint(2.0).map((c) => c.id).sort();
    expect(t2).toEqual(["c1", "c4"]);

    // At t = 7.0: c1, c2, and c4 are active
    const t7 = tree.queryPoint(7.0).map((c) => c.id).sort();
    expect(t7).toEqual(["c1", "c2", "c4"]);

    // At t = 12.0: c2 and c4 are active
    const t12 = tree.queryPoint(12.0).map((c) => c.id).sort();
    expect(t12).toEqual(["c2", "c4"]);

    // At t = 22.0: c3 and c4 are active
    const t22 = tree.queryPoint(22.0).map((c) => c.id).sort();
    expect(t22).toEqual(["c3", "c4"]);

    // At t = 35.0: none active
    const t35 = tree.queryPoint(35.0);
    expect(t35).toHaveLength(0);
  });

  it("respects boundary conditions on consecutive abutted clips", () => {
    const clips: MockClip[] = [
      { id: "clipA", startTime: 0, duration: 5, trackId: "t1" },
      { id: "clipB", startTime: 5, duration: 5, trackId: "t1" },
    ];
    const tree = new TimelineIntervalTree(clips);

    // Right before cut point: clipA is active
    const beforeCut = tree.queryPoint(4.999);
    expect(beforeCut.map((c) => c.id)).toEqual(["clipA"]);

    // Exactly at cut point t = 5.0: clipB is active, clipA is closed (time < end)
    const atCut = tree.queryPoint(5.0);
    expect(atCut.map((c) => c.id)).toEqual(["clipB"]);

    // Inside clipB
    const insideB = tree.queryPoint(7.5);
    expect(insideB.map((c) => c.id)).toEqual(["clipB"]);

    // After clipB
    const afterB = tree.queryPoint(10.0);
    expect(afterB).toHaveLength(0);
  });

  it("handles tolerance for IEEE-754 precision drift", () => {
    const clips: MockClip[] = [
      { id: "clip1", startTime: 1.0, duration: 2.0, trackId: "t1" },
    ];
    const tree = new TimelineIntervalTree(clips);

    // Query slightly before startTime (e.g. 0.99995 with 1e-4 tolerance)
    const justBefore = tree.queryPoint(0.99995, 1e-4);
    expect(justBefore.map((c) => c.id)).toEqual(["clip1"]);

    // Query well before startTime
    const wellBefore = tree.queryPoint(0.999, 1e-4);
    expect(wellBefore).toHaveLength(0);
  });

  it("supports zero-allocation output buffer reuse", () => {
    const clips: MockClip[] = [
      { id: "c1", startTime: 0, duration: 10, trackId: "t1" },
      { id: "c2", startTime: 5, duration: 10, trackId: "t2" },
    ];
    const tree = new TimelineIntervalTree(clips);

    const scratchBuffer: MockClip[] = [];

    // Query 1
    const res1 = tree.queryPoint(2.0, DEFAULT_BOUNDARY_TOLERANCE_SECS, scratchBuffer);
    expect(res1).toBe(scratchBuffer);
    expect(scratchBuffer.map((c) => c.id)).toEqual(["c1"]);

    // Query 2 reusing same buffer
    const res2 = tree.queryPoint(7.0, DEFAULT_BOUNDARY_TOLERANCE_SECS, scratchBuffer);
    expect(res2).toBe(scratchBuffer);
    expect(scratchBuffer.map((c) => c.id).sort()).toEqual(["c1", "c2"]);

    // Query 3 with no results
    const res3 = tree.queryPoint(20.0, DEFAULT_BOUNDARY_TOLERANCE_SECS, scratchBuffer);
    expect(res3).toBe(scratchBuffer);
    expect(scratchBuffer).toHaveLength(0);
  });

  it("accurately handles queryRange for viewport windowing", () => {
    const clips: MockClip[] = [
      { id: "c1", startTime: 0, duration: 5, trackId: "t1" },   // 0..5
      { id: "c2", startTime: 6, duration: 4, trackId: "t1" },   // 6..10
      { id: "c3", startTime: 12, duration: 8, trackId: "t1" },  // 12..20
      { id: "c4", startTime: 25, duration: 5, trackId: "t1" },  // 25..30
    ];
    const tree = new TimelineIntervalTree(clips);

    // Range [4, 7] overlaps c1 (0..5) and c2 (6..10)
    const range1 = tree.queryRange(4, 7).map((c) => c.id).sort();
    expect(range1).toEqual(["c1", "c2"]);

    // Range [15, 18] overlaps only c3
    const range2 = tree.queryRange(15, 18).map((c) => c.id);
    expect(range2).toEqual(["c3"]);

    // Range [21, 24] in the gap between c3 and c4
    const rangeGap = tree.queryRange(21, 24);
    expect(rangeGap).toHaveLength(0);

    // Full range [0, 30] returns all
    const rangeAll = tree.queryRange(0, 30).map((c) => c.id).sort();
    expect(rangeAll).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("maintains 100% parity with linear scan across 1,000 randomized clips", () => {
    // Generate 1,000 synthetic clips across 10 tracks with varying durations
    const clips: MockClip[] = [];
    const count = 1000;
    let seed = 42;
    function pseudoRandom() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    }

    for (let i = 0; i < count; i++) {
      const trackId = `track-${Math.floor(pseudoRandom() * 10)}`;
      const startTime = pseudoRandom() * 600; // 0 to 10 minutes
      const duration = 0.5 + pseudoRandom() * 15; // 0.5s to 15.5s
      clips.push({
        id: `clip-${i}`,
        startTime,
        duration,
        trackId,
      });
    }

    const tree = new TimelineIntervalTree(clips);
    expect(tree.count).toBe(count);

    // Verify maxEndTime matches reduce
    const expectedMaxEndTime = clips.reduce(
      (m, c) => Math.max(m, c.startTime + c.duration),
      0,
    );
    expect(tree.maxEndTime).toBeCloseTo(expectedMaxEndTime, 6);

    // Query 100 randomized timestamps across the timeline
    const outBuffer: MockClip[] = [];
    for (let q = 0; q < 100; q++) {
      const time = pseudoRandom() * 620;
      const treeResults = tree.queryPoint(time, 1e-4, outBuffer).map((c) => c.id).sort();

      // Canonical linear scan baseline
      const linearResults = clips
        .filter((c) => c.startTime <= time + 1e-4 && time < c.startTime + c.duration)
        .map((c) => c.id)
        .sort();

      expect(treeResults).toEqual(linearResults);
    }
  });
});
