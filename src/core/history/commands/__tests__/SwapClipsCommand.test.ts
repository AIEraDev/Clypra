import { describe, expect, it } from "vitest";
import { SwapClipsCommand } from "../SwapClipsCommand";
import type { Clip, Track } from "@/types";

const track: Track = { id: "track-1", type: "video", name: "Video 1", muted: false, locked: false, visible: true, height: 68 };
const makeClip = (id: string, startTime: number, duration: number): Clip => ({
  id,
  trackId: track.id,
  mediaId: `${id}-asset`,
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
  volume: 1,
});

describe("SwapClipsCommand", () => {
  it("swaps through a reversible command and preserves the original positions on undo", () => {
    const state: { tracks: Track[]; clips: Clip[]; transitions: []; epoch: number } = { tracks: [track], clips: [makeClip("a", 0, 5), makeClip("b", 10, 5)], transitions: [], epoch: 0 };
    const command = new SwapClipsCommand("a", "b");
    const swapped = command.apply(state);
    expect(swapped.clips.find((clip) => clip.id === "a")?.startTime).toBe(10);
    expect(swapped.clips.find((clip) => clip.id === "b")?.startTime).toBe(0);

    const restored = command.invert().apply(swapped);
    expect(restored.clips.find((clip: Clip) => clip.id === "a")?.startTime).toBe(0);
    expect(restored.clips.find((clip: Clip) => clip.id === "b")?.startTime).toBe(10);
  });

  it("rejects a swap that would overlap a third clip", () => {
    const state: { tracks: Track[]; clips: Clip[]; transitions: []; epoch: number } = { tracks: [track], clips: [makeClip("a", 0, 2), makeClip("b", 12, 10), makeClip("c", 2, 10)], transitions: [], epoch: 0 };
    expect(SwapClipsCommand.validate(state, "a", "b")).toContain("overlap");
  });
});
