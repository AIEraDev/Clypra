import type {
  AudioChannelMode,
  AudioDownmixMode,
  AudioFadeCurve,
  Clip,
  MediaAsset,
  Track,
} from "@/types";
import {
  getActiveAudioClips,
  type ExportAudioClipConfig,
} from "@/core/timeline/audioClips";
import {
  replaceNativeAudioClips,
  startNativeAudio,
} from "@/lib/platform/tauri";
import type { NativeAudioClipStatus } from "@/lib/platform/nativeCore";

export const NATIVE_AUDIO_TIME_SCALE = 1_000_000;

export interface NativeAudioTimelineClip {
  clipId: string;
  path: string;
  timelineStartTicks: number;
  sourceStartTicks: number;
  durationTicks: number;
  gain: number;
  pan: number;
  fadeInTicks: number;
  fadeOutTicks: number;
  fadeInCurve: AudioFadeCurve;
  fadeOutCurve: AudioFadeCurve;
  /** Relative clip ticks, not seconds. */
  volumeKeyframes: Array<{
    id: string;
    time: number;
    gain: number;
    easing?: "linear" | "exponential" | "bezier";
  }>;
  channelMode: AudioChannelMode;
  downmix: AudioDownmixMode;
  channelMap?: number[];
  preservePitch: boolean;
}

export interface NativeAudioTimelineSnapshot {
  startTime: number;
  endTime: number;
  clips: NativeAudioTimelineClip[];
}

export interface NativeAudioTimelineSyncResult {
  snapshot: NativeAudioTimelineSnapshot;
  installed: NativeAudioClipStatus[];
}

export interface NativeAudioTimelineOptions {
  /** Preview transport speed is a monitoring control and must not alter voice pitch. */
  preserveTransportPitch?: boolean;
}

/**
 * Convert the shared timeline audio query into the native clock contract.
 * The snapshot is relative to `startTime`, matching export audio semantics.
 */
export function buildNativeAudioTimeline(
  clips: Clip[],
  tracks: Track[],
  assets: MediaAsset[],
  startTime: number,
  endTime: number,
  options: NativeAudioTimelineOptions = {},
): NativeAudioTimelineSnapshot {
  const active = getActiveAudioClips(clips, tracks, assets, startTime, endTime);
  return {
    startTime,
    endTime,
    clips: active.map((clip) => toNativeAudioTimelineClip(clip, options)),
  };
}

/**
 * Replace the native audio graph from one immutable timeline snapshot.
 * Decode happens natively; only clip metadata crosses the IPC boundary.
 */
export async function syncNativeAudioTimeline(
  clips: Clip[],
  tracks: Track[],
  assets: MediaAsset[],
  startTime: number,
  endTime: number,
  options: NativeAudioTimelineOptions = {},
): Promise<NativeAudioTimelineSyncResult> {
  const snapshot = buildNativeAudioTimeline(
    clips,
    tracks,
    assets,
    startTime,
    endTime,
    options,
  );
  await startNativeAudio();
  // Native decodes the complete candidate before atomically replacing the
  // current graph. This prevents clear-first gaps and stale partial installs.
  const installed = await replaceNativeAudioClips(snapshot.clips);

  return {
    snapshot,
    installed,
  };
}

function toNativeAudioTimelineClip(
  config: ExportAudioClipConfig,
  options: NativeAudioTimelineOptions,
): NativeAudioTimelineClip {
  return {
    clipId: config.clipId,
    path: config.path,
    timelineStartTicks: secondsToTicks(config.startTime),
    sourceStartTicks: secondsToTicks(config.trimIn),
    durationTicks: secondsToTicks(config.duration),
    gain: config.volume,
    pan: config.pan,
    fadeInTicks: secondsToTicks(config.fadeIn),
    fadeOutTicks: secondsToTicks(config.fadeOut),
    fadeInCurve: config.fadeInCurve,
    fadeOutCurve: config.fadeOutCurve,
    volumeKeyframes: config.volumeKeyframes.map((point) => ({
      ...point,
      time: secondsToTicks(point.time),
    })),
    channelMode: config.channelMode,
    downmix: config.downmix,
    channelMap: config.channelMap,
    preservePitch:
      options.preserveTransportPitch === true || config.preservePitch,
  };
}

function secondsToTicks(seconds: number): number {
  return Math.max(0, Math.round(seconds * NATIVE_AUDIO_TIME_SCALE));
}
