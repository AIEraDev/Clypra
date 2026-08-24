import { describe, expect, it } from "vitest";
import { DetachAudioCommand } from "../DetachAudioCommand";
import type { Clip, Track } from "@/types";

const videoTrack: Track = { id: "video-1", type: "video", name: "Video", muted: false, locked: false, visible: true, height: 80 };
const source: Clip = {
  id: "clip-video", trackId: videoTrack.id, mediaId: "asset-video", kind: "video", startTime: 3, duration: 8,
  trimIn: 1.5, trimOut: 9.5, x: 10, y: 20, width: 1920, height: 1080, opacity: 1, rotation: 0,
  volume: 0.65, fadeIn: 0.4, fadeOut: 0.7,
};

describe("DetachAudioCommand", () => {
  it("creates aligned audio with preserved audio editing properties and mutes video", () => {
    const command = new DetachAudioCommand(source, "/media/source.mp4", [videoTrack]);
    const result = command.apply({ tracks: [videoTrack], clips: [source], mainVideoTrackId: videoTrack.id, epoch: 0 });
    const audio = result.clips.find((clip) => clip.kind === "audio");

    expect(audio).toMatchObject({
      startTime: source.startTime,
      duration: source.duration,
      trimIn: source.trimIn,
      trimOut: source.trimOut,
      volume: source.volume,
      fadeIn: source.fadeIn,
      fadeOut: source.fadeOut,
      audioPath: "/media/source.mp4",
      detachedFromClipId: source.id,
      mediaId: source.mediaId,
    });
    expect(result.clips.find((clip) => clip.id === source.id)?.volume).toBe(0);
    expect(result.tracks.filter((track) => track.type === "audio")).toHaveLength(1);
  });

  it("restores the original timeline and reuses stable IDs on redo", () => {
    const command = new DetachAudioCommand(source, "/media/source.mp4", [videoTrack]);
    const initial = { tracks: [videoTrack], clips: [source], mainVideoTrackId: videoTrack.id, epoch: 0 };
    const detached = command.apply(initial);
    const audioId = detached.clips.find((clip) => clip.detachedFromClipId === source.id)!.id;
    const restored = command.invert().apply(detached);
    const redone = command.apply(restored);

    expect(restored.clips).toEqual([source]);
    expect(restored.tracks).toEqual([videoTrack]);
    expect(redone.clips.find((clip) => clip.id === audioId)?.id).toBe(audioId);
    expect(redone.tracks.find((track) => track.type === "audio")?.id).toBe(detached.tracks.find((track) => track.type === "audio")?.id);
  });

  it("detects an existing generated clip as an idempotency guard", () => {
    const detached: Clip = { ...source, id: "audio-1", kind: "audio", detachedFromClipId: source.id, trackId: "audio-1", audioPath: "/media/source.mp4" };
    expect(DetachAudioCommand.isAlreadyDetached(source, [source, detached])).toBe(true);
  });
});
