import { describe, expect, it } from "vitest";
import {
  AUDIO_MODEL_VERSION,
  dbToLinearGain,
  linearGainToDb,
  normalizeClipAudioProperties,
  synchronizeClipAudioProperties,
} from "../audio";
import { fromRustClip, toRustClip } from "../serialization";
import type { Clip } from "../index";

const baseClip: Clip = {
  id: "clip-audio",
  kind: "audio",
  trackId: "audio-track",
  mediaId: "audio-asset",
  startTime: 0,
  duration: 4,
  trimIn: 0,
  trimOut: 4,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  opacity: 1,
  rotation: 0,
};

describe("ClipAudioProperties", () => {
  it("normalizes legacy fields into the complete versioned shape", () => {
    const audio = normalizeClipAudioProperties({
      kind: "audio",
      volume: 0.5,
      fadeIn: 1.25,
      fadeOut: 0.75,
      fadeInCurve: "exponential",
      audioFX: { pan: 0.4 },
      detachedFromClipId: "video-1",
    });

    expect(audio).toMatchObject({
      audioModelVersion: AUDIO_MODEL_VERSION,
      origin: "detached",
      linkState: "detached",
      gainDb: linearGainToDb(0.5),
      pan: 0.4,
      muted: false,
      fadeIn: { duration: 1.25, curve: "exponential" },
      fadeOut: { duration: 0.75, curve: "linear" },
      channelConfig: { mode: "auto", downmix: "auto" },
      speed: { preservePitch: false },
    });
  });

  it("gives the structured object precedence over legacy fields", () => {
    const audio = normalizeClipAudioProperties({
      kind: "audio",
      volume: 0.25,
      fadeIn: 2,
      audio: {
        audioModelVersion: 1,
        origin: "recorded",
        linkState: "linked",
        gainDb: -3,
        pan: -0.75,
        muted: true,
        volumeKeyframes: [{ id: "kf", time: 1, gain: 0.8 }],
        fadeIn: { duration: 0.5, curve: "s-curve" },
        fadeOut: { duration: 0, curve: "linear" },
        channelConfig: { mode: "mono", downmix: "mono" },
        speed: { preservePitch: true },
      },
    });

    expect(audio.origin).toBe("recorded");
    expect(audio.gainDb).toBe(-3);
    expect(audio.pan).toBe(-0.75);
    expect(audio.muted).toBe(true);
    expect(audio.fadeIn).toEqual({ duration: 0.5, curve: "s-curve" });
    expect(audio.speed.preservePitch).toBe(true);
  });

  it("round-trips the structured model through project clip serialization", () => {
    const clip: Clip = {
      ...baseClip,
      audio: normalizeClipAudioProperties({
        kind: "audio",
        audio: {
          origin: "recorded",
          linkState: "linked",
          gainDb: -6,
          pan: 0.2,
          muted: false,
          volumeKeyframes: [],
          fadeIn: { duration: 0.2, curve: "linear" },
          fadeOut: { duration: 0.3, curve: "exponential" },
          channelConfig: { mode: "stereo", downmix: "stereo" },
          speed: { preservePitch: true },
        },
      }),
    };

    const persisted = toRustClip(clip);
    const restored = fromRustClip(persisted);

    expect(persisted.audio).toMatchObject({ audioModelVersion: AUDIO_MODEL_VERSION, origin: "recorded" });
    expect(restored.audio).toMatchObject({
      audioModelVersion: AUDIO_MODEL_VERSION,
      origin: "recorded",
      gainDb: -6,
      pan: 0.2,
      fadeOut: { duration: 0.3, curve: "exponential" },
      speed: { preservePitch: true },
    });
  });

  it("keeps gain conversion reversible for normal levels and JSON-safe when muted", () => {
    expect(dbToLinearGain(linearGainToDb(0.5))).toBeCloseTo(0.5);
    expect(linearGainToDb(0)).toBe(-96);
    expect(Number.isFinite(linearGainToDb(0))).toBe(true);
  });

  it("keeps a legacy edit and the structured model in lockstep", () => {
    const updates = synchronizeClipAudioProperties(
      {
        ...baseClip,
        volume: 1,
        fadeIn: 0,
        audio: normalizeClipAudioProperties({ kind: "audio", volume: 1, fadeIn: 0 }),
      },
      { volume: 0.5, fadeIn: 0.75, fadeInCurve: "s-curve" },
    );

    expect(updates).toMatchObject({ volume: 0.5, fadeIn: 0.75, fadeInCurve: "s-curve" });
    expect(updates.audio).toMatchObject({
      gainDb: linearGainToDb(0.5),
      muted: false,
      fadeIn: { duration: 0.75, curve: "s-curve" },
    });
  });

  it("migrates an old detached clip without losing its source relationship", () => {
    const restored = fromRustClip({
      ...baseClip,
      kind: "audio",
      audioPath: "/media/source.mp4",
      detachedFromClipId: "source-video",
    });

    expect(restored.detachedFromClipId).toBe("source-video");
    expect(restored.audio).toMatchObject({
      origin: "detached",
      linkState: "detached",
      sourceClipId: "source-video",
    });
  });
});
