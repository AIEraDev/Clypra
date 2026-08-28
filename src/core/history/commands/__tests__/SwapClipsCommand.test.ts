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

  it("deeply snapshots nested metadata for undo", () => {
    const a = {
      ...makeClip("a", 0, 5),
      kind: "compound",
      compoundChildren: [
        { ...makeClip("text-child", 0, 5), kind: "text", styleDefinition: { id: "title", version: "2" } } as any,
        { ...makeClip("audio-child", 0, 5), kind: "audio", audio: { gainDb: -5 } } as any,
      ],
    } as any as Clip;
    const b = makeClip("b", 10, 5);
    const state: { tracks: Track[]; clips: Clip[]; transitions: []; epoch: number } = { tracks: [track], clips: [a, b], transitions: [], epoch: 0 };
    const command = new SwapClipsCommand("a", "b");
    const swapped = command.apply(state);
    (swapped.clips.find((clip: Clip) => clip.id === "a")!.compoundChildren![0] as any).styleDefinition.version = "mutated";
    (swapped.clips.find((clip: Clip) => clip.id === "a")!.compoundChildren![1] as any).audio.gainDb = 12;

    const restored = command.invert().apply(swapped);
    const restoredChildren = restored.clips.find((clip: Clip) => clip.id === "a")!.compoundChildren!;
    expect((restoredChildren[0] as any).styleDefinition).toEqual({ id: "title", version: "2" });
    expect((restoredChildren[1] as any).audio.gainDb).toBe(-5);
  });

  it("rejects a swap that would overlap a third clip", () => {
    const state: { tracks: Track[]; clips: Clip[]; transitions: []; epoch: number } = { tracks: [track], clips: [makeClip("a", 0, 2), makeClip("b", 12, 10), makeClip("c", 2, 10)], transitions: [], epoch: 0 };
    expect(SwapClipsCommand.validate(state, "a", "b")).toContain("overlap");
  });

  it("rejects a cross-track swap that would overlap a destination neighbor", () => {
    const otherTrack: Track = { ...track, id: "track-2", name: "Video 2" };
    const a = { ...makeClip("a", 0, 10), trackId: track.id };
    const b = { ...makeClip("b", 0, 20), trackId: otherTrack.id };
    const neighborOnA = { ...makeClip("neighbor-a", 10, 5), trackId: track.id };
    const neighborOnB = { ...makeClip("neighbor-b", 20, 5), trackId: otherTrack.id };
    const state: { tracks: Track[]; clips: Clip[]; transitions: []; epoch: number } = {
      tracks: [track, otherTrack],
      clips: [a, b, neighborOnA, neighborOnB],
      transitions: [],
      epoch: 0,
    };

    expect(SwapClipsCommand.validate(state, "a", "b")).toContain("overlap");
  });
});
