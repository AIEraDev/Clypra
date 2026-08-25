import { describe, expect, it } from "vitest";
import { RelinkAudioCommand, UnlinkAudioCommand } from "../UnlinkAudioCommand";
import { TransformClipCommand } from "../TransformCommand";
import type { Clip, Track } from "@/types";

const videoTrack: Track = { id: "video", type: "video", name: "Video", muted: false, locked: false, visible: true, height: 80 };
const source: Clip = {
  id: "video-clip", kind: "video", trackId: "video", mediaId: "asset", startTime: 4, duration: 6, trimIn: 1, trimOut: 7,
  x: 0, y: 0, width: 1920, height: 1080, opacity: 1, rotation: 0, volume: 0.7,
};

describe("UnlinkAudioCommand", () => {
  it("creates a movable audio companion and preserves undo/redo identity", () => {
    const command = new UnlinkAudioCommand(source, "/media/video.mp4", [videoTrack]);
    const initial = { tracks: [videoTrack], clips: [source], epoch: 0 };
    const unlinked = command.apply(initial);
    const audio = unlinked.clips.find((clip) => clip.kind === "audio")!;

    expect(audio).toMatchObject({ startTime: 4, audioPath: "/media/video.mp4" });
    expect(audio.audio).toMatchObject({ linkState: "unlinked", linkedClipId: source.id, sourceClipId: source.id });
    expect(unlinked.clips.find((clip) => clip.id === source.id)?.volume).toBe(0);

    const relinked = command.invert().apply(unlinked);
    expect(relinked.clips).toEqual([source]);
    const redone = command.apply(relinked);
    expect(redone.clips.some((clip) => clip.id === audio.id)).toBe(true);
  });

  it("relinks a moved companion and restores the source gain", () => {
    const unlinked = new UnlinkAudioCommand(source, "/media/video.mp4", [videoTrack]).apply({ tracks: [videoTrack], clips: [source], epoch: 0 });
    const audio = unlinked.clips.find((clip) => clip.kind === "audio")!;
    const movedAudio = { ...audio, startTime: 2 };
    const movedState = { ...unlinked, clips: unlinked.clips.map((clip) => clip.id === audio.id ? movedAudio : clip) };
    const relinked = new RelinkAudioCommand(movedState.clips.find((clip) => clip.id === source.id)!, movedAudio).apply(movedState);

    expect(relinked.clips).toHaveLength(1);
    expect(relinked.clips[0].volume).toBeCloseTo(0.7);
    expect(relinked.clips[0].audio?.linkState).toBe("linked");
  });

  it("records the J/L-cut offset when the unlinked companion is moved", () => {
    const unlinked = new UnlinkAudioCommand(source, "/media/video.mp4", [videoTrack]).apply({ tracks: [videoTrack], clips: [source], epoch: 0 });
    const audio = unlinked.clips.find((clip) => clip.kind === "audio")!;
    const moved = new TransformClipCommand(audio.id, { startTime: audio.startTime }, { startTime: 2.5 }).apply(unlinked);
    expect(moved.clips.find((clip) => clip.id === audio.id)?.audio?.linkOffsetSeconds).toBe(-1.5);
  });
});
