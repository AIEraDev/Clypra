import { describe, expect, it } from "vitest";
import { calculateDepartureClosurePositions } from "../clipPositions";
import type { Clip } from "@/types";

const createClip = (id: string, startTime: number, duration: number): Clip => ({
  id,
  trackId: "track-1",
  mediaId: `media-${id}`,
  startTime,
  duration,
  trimIn: 0,
  trimOut: duration,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  opacity: 1,
  rotation: 0,
});

describe("calculateDepartureClosurePositions", () => {
  it("closes only the moved block and preserves an earlier source-track gap", () => {
    const clips = [
      createClip("before", 0, 5),
      createClip("moved", 6, 3),
      createClip("after", 12, 4),
    ];

    const positions = calculateDepartureClosurePositions({
      trackClips: clips,
      draggedClipIds: ["moved"],
      originalPlacements: {
        moved: { trackId: "track-1", startTime: 6, index: 1 },
      },
    });

    expect(positions.get("before")).toBe(0);
    expect(positions.get("after")).toBe(9);
  });

  it("closes a split clip gap when the left half is moved away", () => {
    const clips = [createClip("left", 0, 5), createClip("right", 5, 5)];

    const positions = calculateDepartureClosurePositions({
      trackClips: clips,
      draggedClipIds: ["left"],
      originalPlacements: {
        left: { trackId: "track-1", startTime: 0, index: 0 },
      },
    });

    expect(positions.get("right")).toBe(0);
  });
});
