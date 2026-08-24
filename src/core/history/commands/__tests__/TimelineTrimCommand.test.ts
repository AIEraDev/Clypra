import { describe, expect, it } from "vitest";
import type { Clip, Track } from "@/types";
import type { Gap } from "@/types/gap";
import { TimelineTrimCommand } from "../TimelineTrimCommand";

const track: Track = {
  id: "track-1",
  type: "video",
  name: "Video 1",
  muted: false,
  locked: false,
  visible: true,
  height: 80,
};

const clip = (id: string, startTime: number, duration: number): Clip => ({
  id,
  trackId: track.id,
  mediaId: id,
  startTime,
  duration,
  trimIn: 0,
  trimOut: duration,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  opacity: 1,
  rotation: 0,
  kind: "video",
});

describe("TimelineTrimCommand", () => {
  it("restores a standard trim as one atomic undo/redo operation", () => {
    const beforeClips = [clip("first", 0, 10), clip("second", 10, 5)];
    const afterClips = [
      { ...beforeClips[0], duration: 8, trimOut: 8 },
      beforeClips[1],
    ];
    const gap: Gap = {
      id: "gap-1",
      trackId: track.id,
      startTime: 8,
      duration: 2,
      type: "auto",
      source: "unknown",
      protected: false,
    };
    const state = { tracks: [track], clips: beforeClips, gaps: [], epoch: 0 };
    const command = new TimelineTrimCommand(beforeClips, afterClips, [], [gap]);

    const trimmed = command.apply(state);
    expect(trimmed.clips).toEqual(afterClips);
    expect(trimmed.gaps).toEqual([gap]);

    const restored = command.invert().apply(trimmed);
    expect(restored.clips).toEqual(beforeClips);
    expect(restored.gaps).toEqual([]);

    const redone = command.apply(restored);
    expect(redone.clips).toEqual(afterClips);
    expect(redone.gaps).toEqual([gap]);
  });

  it("restores downstream ripple positions together with the trimmed clip", () => {
    const beforeClips = [clip("first", 0, 10), clip("second", 10, 5)];
    const afterClips = [
      { ...beforeClips[0], startTime: 2, duration: 8, trimIn: 2 },
      { ...beforeClips[1], startTime: 12 },
    ];
    const state = { tracks: [track], clips: beforeClips, gaps: [], epoch: 0 };
    const command = new TimelineTrimCommand(beforeClips, afterClips, [], []);

    const trimmed = command.apply(state);
    expect(trimmed.clips.map((item) => item.startTime)).toEqual([2, 12]);
    expect(command.invert().apply(trimmed).clips).toEqual(beforeClips);
  });
});
