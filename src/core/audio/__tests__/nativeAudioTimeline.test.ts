import { describe, expect, it } from "vitest";
import type { Clip, MediaAsset, Track } from "@/types";
import { normalizeClipAudioProperties } from "@/types/audio";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import { buildNativeAudioTimeline } from "../nativeAudioTimeline";
import { getActiveAudioClips } from "@/core/timeline/audioClips";

describe("native audio timeline contract", () => {
  it("converts active clips to relative native ticks with trims and fades", () => {
    const track: Track = {
      id: "audio-track",
      name: "Audio",
      type: "audio",
      muted: false,
      locked: false,
      visible: true,
      height: 52,
      volume: 0.8,
    };
    const asset: MediaAsset = {
      id: "asset",
      name: "voice.wav",
      path: "/media/voice.wav",
      type: "audio",
      duration: 30,
      size: 1024,
    };
    const clip = {
      id: "clip",
      trackId: track.id,
      mediaId: asset.id,
      startTime: 2,
      duration: 5,
      trimIn: 1.25,
      trimOut: 6.25,
      fadeIn: 0.5,
      fadeOut: 0.75,
    } as Clip;

    const snapshot = buildNativeAudioTimeline([clip], [track], [asset], 1, 10);

    expect(snapshot.clips).toMatchObject([
      {
        clipId: "clip",
        path: "/media/voice.wav",
        timelineStartTicks: 1_000_000,
        sourceStartTicks: 1_250_000,
        durationTicks: 5_000_000,
        gain: 0.8,
        fadeInTicks: 500_000,
        fadeOutTicks: 750_000,
        fadeInCurve: "linear",
        fadeOutCurve: "linear",
      },
    ]);
    expect(snapshot.clips[0].volumeKeyframes).toHaveLength(2);
  });

  it("carries a timeline fade edit through the export and native playback adapters", () => {
    const track: Track = {
      id: "audio-track", name: "Audio", type: "audio", muted: false, locked: false, visible: true, height: 52,
    };
    const asset: MediaAsset = {
      id: "asset", name: "voice.wav", path: "/media/voice.wav", type: "audio", duration: 5, size: 1,
    };
    const clip: Clip = {
      id: "clip", kind: "audio", trackId: track.id, mediaId: asset.id,
      startTime: 0, duration: 5, trimIn: 0, trimOut: 5,
      x: 0, y: 0, width: 0, height: 0, opacity: 1, rotation: 0,
      fadeIn: 0,
      audio: normalizeClipAudioProperties({ kind: "audio", fadeIn: 0 }),
    };

    const edited = new TransformClipCommand(clip.id, { fadeIn: 0 }, { fadeIn: 1.25 }).apply({ clips: [clip], epoch: 0 }).clips[0];

    expect(edited.audio?.fadeIn.duration).toBe(1.25);
    expect(getActiveAudioClips([edited], [track], [asset], 0, 5)[0].fadeIn).toBe(1.25);
    expect(buildNativeAudioTimeline([edited], [track], [asset], 0, 5).clips[0].fadeInTicks).toBe(1_250_000);
  });

  it("carries clip mute into the native/export shared audio contract", () => {
    const track: Track = {
      id: "audio-track", name: "Audio", type: "audio", muted: false, locked: false, visible: true, height: 52,
    };
    const asset: MediaAsset = {
      id: "asset", name: "voice.wav", path: "/media/voice.wav", type: "audio", duration: 5, size: 1,
    };
    const clip: Clip = {
      id: "clip", kind: "audio", trackId: track.id, mediaId: asset.id,
      startTime: 0, duration: 5, trimIn: 0, trimOut: 5,
      x: 0, y: 0, width: 0, height: 0, opacity: 1, rotation: 0,
      audio: normalizeClipAudioProperties({ kind: "audio", audio: { muted: true } }),
    };

    expect(getActiveAudioClips([clip], [track], [asset], 0, 5)[0].volume).toBe(0);
    expect(buildNativeAudioTimeline([clip], [track], [asset], 0, 5).clips[0].gain).toBe(0);
  });
});
