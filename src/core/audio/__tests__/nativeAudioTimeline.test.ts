import { describe, expect, it } from "vitest";
import type { Clip, MediaAsset, Track } from "@/types";
import { buildNativeAudioTimeline } from "../nativeAudioTimeline";

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

    expect(snapshot.clips).toEqual([
      {
        clipId: "clip",
        path: "/media/voice.wav",
        timelineStartTicks: 1_000_000,
        sourceStartTicks: 1_250_000,
        durationTicks: 5_000_000,
        gain: 0.8,
        fadeInTicks: 500_000,
        fadeOutTicks: 750_000,
      },
    ]);
  });
});
