import { describe, expect, it } from "vitest";
import { DetachAudioCommand } from "../DetachAudioCommand";
import type { Clip, Track } from "@/types";

const videoTrack: Track = { id: "video-1", type: "video", name: "Video", muted: false, locked: false, visible: true, height: 80 };
const audioTrack: Track = { id: "audio-1", type: "audio", name: "Audio", muted: false, locked: false, visible: true, height: 60 };
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

  // ── Regression: Bug B — existing audio clip disappears on detach ──────────
  it("creates a new audio track when the only audio track already has clips (regression: Bug B)", () => {
    // Existing standalone audio clip occupies audioTrack
    const standaloneAudio: Clip = {
      id: "standalone-audio", trackId: audioTrack.id, mediaId: "asset-audio", kind: "audio",
      startTime: 2, duration: 6, trimIn: 0, trimOut: 6,
      x: 0, y: 0, width: 0, height: 0, opacity: 1, rotation: 0,
    };
    const clips = [source, standaloneAudio];
    const command = new DetachAudioCommand(source, "/media/source.mp4", [videoTrack, audioTrack], clips);
    const result = command.apply({ tracks: [videoTrack, audioTrack], clips, mainVideoTrackId: videoTrack.id, epoch: 0 });

    const audioTracks = result.tracks.filter((t) => t.type === "audio");
    expect(audioTracks).toHaveLength(2); // New track created — existing track not reused

    const detachedClip = result.clips.find((c) => c.detachedFromClipId === source.id);
    expect(detachedClip).toBeDefined();
    expect(detachedClip?.trackId).not.toBe(audioTrack.id); // Goes on the NEW track, not the existing one

    // Standalone clip is untouched and still on its original track
    expect(result.clips.find((c) => c.id === standaloneAudio.id)?.trackId).toBe(audioTrack.id);
  });

  it("reuses an empty audio track when no clips are assigned to it (no regression)", () => {
    // audioTrack exists but is empty — safe to reuse
    const command = new DetachAudioCommand(source, "/media/source.mp4", [videoTrack, audioTrack], [source]);
    const result = command.apply({ tracks: [videoTrack, audioTrack], clips: [source], mainVideoTrackId: videoTrack.id, epoch: 0 });

    const audioTracks = result.tracks.filter((t) => t.type === "audio");
    expect(audioTracks).toHaveLength(1); // Empty track reused — no new track created

    const detachedClip = result.clips.find((c) => c.detachedFromClipId === source.id);
    expect(detachedClip?.trackId).toBe(audioTrack.id);
  });
});
