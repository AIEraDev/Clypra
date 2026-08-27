/**
 * Canonical audio evaluation contract.
 *
 * Playback, export, waveform rendering, and the property UI must use these
 * pure functions rather than independently interpreting legacy clip fields.
 */

import type { AudioFadeCurve, AudioKeyframe, Clip, Track } from "@/types";
import { dbToLinearGain, getClipAudioProperties } from "@/types/audio";

export interface EffectiveAudioState {
  muted: boolean;
  gain: number;
  staticGain: number;
  automationGain: number;
  fadeGain: number;
  pan: number;
  fadeIn: { duration: number; curve: AudioFadeCurve };
  fadeOut: { duration: number; curve: AudioFadeCurve };
  keyframes: AudioKeyframe[];
  effects: ReturnType<typeof getClipAudioProperties>["effects"];
  preservePitch: boolean;
  channelConfig: ReturnType<typeof getClipAudioProperties>["channelConfig"];
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function evaluateAudioKeyframes(
  keyframes: AudioKeyframe[] | undefined,
  time: number,
  defaultGain = 1,
  presorted = false,
): number {
  if (!keyframes?.length) return defaultGain;
  const sorted = presorted ? keyframes : [...keyframes].sort((a, b) => a.time - b.time);
  if (time <= sorted[0].time) return sorted[0].gain;
  if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].gain;

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const from = sorted[index];
    const to = sorted[index + 1];
    if (time < from.time || time > to.time) continue;
    const span = to.time - from.time;
    const t = span <= 0.0001 ? 1 : clamp((time - from.time) / span, 0, 1);
    if (to.easing === "exponential") {
      const start = Math.max(0.0001, from.gain);
      const end = Math.max(0.0001, to.gain);
      return start * Math.pow(end / start, t);
    }
    const eased = to.easing === "bezier" ? t * t * (3 - 2 * t) : t;
    return from.gain + (to.gain - from.gain) * eased;
  }
  return defaultGain;
}

export function evaluateFadeCurve(progress: number, curve: AudioFadeCurve): number {
  const t = clamp(progress, 0, 1);
  switch (curve) {
    case "exponential": return t * t;
    case "logarithmic": return Math.sqrt(t);
    case "s-curve": return t * t * (3 - 2 * t);
    default: return t;
  }
}

export function isTrackAudible(track: Track | undefined, tracks: Track[] = []): boolean {
  if (!track || track.muted) return false;
  const hasSolo = tracks.some((candidate) => candidate.solo);
  return !hasSolo || Boolean(track.solo);
}

export function evaluateEffectiveAudioState(
  clip: Clip,
  track: Track | undefined,
  timelineTime: number,
  options: {
    tracks?: Track[];
    masterVolume?: number;
    masterMuted?: boolean;
    /** Preview transport speed is a monitoring control, so it keeps pitch stable. */
    preserveTransportPitch?: boolean;
  } = {},
): EffectiveAudioState {
  const audio = getClipAudioProperties(clip);
  const timeIntoClip = clamp(timelineTime - clip.startTime, 0, Math.max(0, clip.duration));
  const automationGain = evaluateAudioKeyframes(audio.volumeKeyframes, timeIntoClip, 1, true);
  const fadeInGain = audio.fadeIn.duration > 0
    ? evaluateFadeCurve(timeIntoClip / audio.fadeIn.duration, audio.fadeIn.curve)
    : 1;
  const fadeOutGain = audio.fadeOut.duration > 0
    ? evaluateFadeCurve((clip.duration - timeIntoClip) / audio.fadeOut.duration, audio.fadeOut.curve)
    : 1;
  const muted = Boolean(options.masterMuted) || audio.muted || !isTrackAudible(track, options.tracks) || (track?.volume ?? 1) <= 0 || (options.masterVolume ?? 1) <= 0;
  const staticGain = dbToLinearGain(audio.gainDb) * (track?.volume ?? 1) * (options.masterVolume ?? 1);
  const fadeGain = Math.min(fadeInGain, fadeOutGain);
  return {
    muted,
    staticGain,
    automationGain,
    fadeGain,
    gain: muted ? 0 : staticGain * automationGain * fadeGain,
    pan: audio.pan,
    fadeIn: audio.fadeIn,
    fadeOut: audio.fadeOut,
    keyframes: audio.volumeKeyframes,
    effects: audio.effects,
    preservePitch: options.preserveTransportPitch === true || audio.speed.preservePitch,
    channelConfig: audio.channelConfig,
  };
}

/** Keyframes rebased to an exported/native slice, including boundary samples. */
export function buildAudioAutomationSlice(
  keyframes: AudioKeyframe[] | undefined,
  clipLocalStart: number,
  duration: number,
): AudioKeyframe[] {
  const source = [...(keyframes ?? [])].sort((a, b) => a.time - b.time);
  const end = clipLocalStart + Math.max(0, duration);
  const points: AudioKeyframe[] = [
    { id: "slice-start", time: 0, gain: evaluateAudioKeyframes(source, clipLocalStart, 1, true), easing: "linear" },
    ...source.filter((point) => point.time > clipLocalStart && point.time < end)
      .map((point) => ({ ...point, time: point.time - clipLocalStart })),
  ];
  if (duration > 0) points.push({ id: "slice-end", time: duration, gain: evaluateAudioKeyframes(source, end, 1, true), easing: "linear" });
  return points;
}
