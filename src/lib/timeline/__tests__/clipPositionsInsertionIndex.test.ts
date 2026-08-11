import { describe, it, expect } from "vitest";
import { findInsertionIndex } from "../clipPositions";
import type { Clip } from "@/types";

describe("clipPositions — findInsertionIndex gap center positioning", () => {
  it("calculates correct insertion index for pointer coordinates past the first clip", () => {
    const restClips: Clip[] = [
      {
        id: "c1",
        trackId: "t1",
        mediaId: "m1",
        name: "Clip 1",
        startTime: 0,
        duration: 10, // 0 to 10s (0 to 100px at 10px/s)
        trimIn: 0,
        trimOut: 10,
        kind: "video",
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      },
      {
        id: "c2",
        trackId: "t1",
        mediaId: "m2",
        name: "Clip 2",
        startTime: 10,
        duration: 5, // 10 to 15s (100 to 150px at 10px/s)
        trimIn: 0,
        trimOut: 5,
        kind: "video",
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      },
    ];


    const pixelsPerSecond = 10;

    // Pointer at 50px (midpoint of Clip 1).
    // Pointer at < 50px should insert at index 0. Pointer >= 50px should insert at index 1.
    const indexBeforeMid1 = findInsertionIndex({
      restClips,
      pointerX: 45,
      pixelsPerSecond,
      currentInsertionIndex: null,
    });
    expect(indexBeforeMid1).toBe(0);

    const indexAfterMid1 = findInsertionIndex({
      restClips,
      pointerX: 55,
      pixelsPerSecond,
      currentInsertionIndex: null,
    });
    expect(indexAfterMid1).toBe(1);

    // Midpoint of Clip 2 is 125px (100px start + 25px half duration).
    // Pointer at 110px is before 125px -> should yield index 1 (between Clip 1 and Clip 2).
    // Pointer at 135px is after 125px -> should yield index 2 (after Clip 2).
    const indexBetweenClips = findInsertionIndex({
      restClips,
      pointerX: 110,
      pixelsPerSecond,
      currentInsertionIndex: null,
    });
    expect(indexBetweenClips).toBe(1);

    const indexAfterClip2 = findInsertionIndex({
      restClips,
      pointerX: 135,
      pixelsPerSecond,
      currentInsertionIndex: null,
    });
    expect(indexAfterClip2).toBe(2);
  });
});
