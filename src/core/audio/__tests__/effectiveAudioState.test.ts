import { describe, expect, it } from "vitest";
import type { Clip, Track } from "@/types";
import { normalizeClipAudioProperties } from "@/types/audio";
import { buildAudioAutomationSlice, evaluateEffectiveAudioState, isTrackAudible } from "../effectiveAudioState";

const track: Track = { id: "audio", type: "audio", name: "Audio", muted: false, locked: false, visible: true, height: 52, volume: 0.5 };
const clip: Clip = {
  id: "clip", kind: "audio", trackId: track.id, mediaId: "asset", startTime: 10, duration: 4, trimIn: 0, trimOut: 4,
  x: 0, y: 0, width: 0, height: 0, opacity: 1, rotation: 0,
  audio: normalizeClipAudioProperties({
    kind: "audio",
    audio: {
      gainDb: -6.0206,
      volumeKeyframes: [
        { id: "a", time: 0, gain: 0.5, easing: "linear" },
        { id: "b", time: 2, gain: 1, easing: "linear" },
        { id: "c", time: 4, gain: 0.5, easing: "exponential" },
      ],
      fadeIn: { duration: 1, curve: "s-curve" },
      fadeOut: { duration: 1, curve: "linear" },
    },
  }),
};

describe("effective audio state", () => {
  it("composes structured gain, track gain, automation, and fade at a timeline time", () => {
    const state = evaluateEffectiveAudioState(clip, track, 11.5, { tracks: [track] });
    // -6dB = 0.5, track = 0.5, keyframe at 1.5s = 0.875, fade-in is complete.
    expect(state.staticGain).toBeCloseTo(0.25, 3);
    expect(state.automationGain).toBeCloseTo(0.875, 3);
    expect(state.gain).toBeCloseTo(0.21875, 3);
  });

  it("rebases automation with evaluated boundary points for native preview and export", () => {
    const slice = buildAudioAutomationSlice(clip.audio?.volumeKeyframes, 1, 2);
    expect(slice[0]).toMatchObject({ time: 0, gain: 0.75 });
    expect(slice[1]).toMatchObject({ time: 1, gain: 1 });
    expect(slice[2].time).toBe(2);
    expect(slice[2].gain).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it("implements solo without changing stored mute state", () => {
    const other: Track = { ...track, id: "other", solo: true };
    expect(isTrackAudible(track, [track, other])).toBe(false);
    expect(track.muted).toBe(false);
    expect(isTrackAudible(other, [track, other])).toBe(true);
  });

  it("keeps hidden tracks audible until the separate audio policy mutes or solos them", () => {
    const hidden = { ...track, visible: false };

    // Visibility is a compositor concern. Audio contribution is controlled by
    // mute/solo, so hiding a video track must not silently remove its sound.
    expect(isTrackAudible(hidden, [hidden])).toBe(true);
    expect(evaluateEffectiveAudioState(clip, hidden, 11.5, { tracks: [hidden] }).muted).toBe(false);
  });
});
