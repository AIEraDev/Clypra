import { describe, it, expect } from "vitest";
import { mergeAdjacentGaps, createGap } from "../gapEngine";

describe("gapEngine — mergeAdjacentGaps Track Isolation", () => {
  it("should not merge adjacent/overlapping gaps that belong to different tracks", () => {
    const gapTrack1 = createGap({
      trackId: "track-1",
      startTime: 0,
      duration: 5,
      type: "auto",
      source: "unknown",
    });

    const gapTrack2 = createGap({
      trackId: "track-2",
      startTime: 4,
      duration: 6,
      type: "auto",
      source: "unknown",
    });

    const result = mergeAdjacentGaps([gapTrack1, gapTrack2]);

    // Should return 2 distinct gaps because they are on different tracks
    expect(result.length).toBe(2);
    expect(result.find((g) => g.trackId === "track-1")?.duration).toBe(5);
    expect(result.find((g) => g.trackId === "track-2")?.duration).toBe(6);
  });

  it("should correctly merge adjacent gaps on the same track", () => {
    const gap1 = createGap({
      trackId: "track-1",
      startTime: 0,
      duration: 5,
      type: "auto",
      source: "unknown",
    });

    const gap2 = createGap({
      trackId: "track-1",
      startTime: 5,
      duration: 5,
      type: "auto",
      source: "unknown",
    });

    const result = mergeAdjacentGaps([gap1, gap2]);

    expect(result.length).toBe(1);
    expect(result[0].trackId).toBe("track-1");
    expect(result[0].startTime).toBe(0);
    expect(result[0].duration).toBe(10);
  });
});
