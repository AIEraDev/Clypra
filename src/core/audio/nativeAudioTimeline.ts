import type { AudioChannelMode, AudioDownmixMode, AudioFadeCurve, Clip, MediaAsset, Track } from "@/types";
import { getActiveAudioClips, type ExportAudioClipConfig } from "@/core/timeline/audioClips";
import {
  replaceNativeAudioClips,
  startNativeAudio,
} from "@/lib/platform/tauri";
import type { NativeAudioClipStatus } from "@/lib/platform/nativeCore";
import { tracePlayback } from "@/core/playback/playbackTrace";

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
  volumeKeyframes: Array<{ id: string; time: number; gain: number; easing?: "linear" | "exponential" | "bezier" }>;
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
): NativeAudioTimelineSnapshot {
  const active = getActiveAudioClips(clips, tracks, assets, startTime, endTime);
  return {
    startTime,
    endTime,
    clips: active.map(toNativeAudioTimelineClip),
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
): Promise<NativeAudioTimelineSyncResult> {
  const snapshot = buildNativeAudioTimeline(clips, tracks, assets, startTime, endTime);
  await startNativeAudio();
  // Native decodes the complete candidate before atomically replacing the
  // current graph. This prevents clear-first gaps and stale partial installs.
  const installed = await replaceNativeAudioClips(snapshot.clips);
  tracePlayback("native.timeline-ready", {
    clipCount: snapshot.clips.length,
    installedCount: installed.length,
    clips: snapshot.clips.map((clip) => ({
      clipId: clip.clipId,
      timelineStart: clip.timelineStartTicks / NATIVE_AUDIO_TIME_SCALE,
      duration: clip.durationTicks / NATIVE_AUDIO_TIME_SCALE,
      trimIn: clip.sourceStartTicks / NATIVE_AUDIO_TIME_SCALE,
      gain: clip.gain,
    })),
    decoded: installed.map((clip) => ({
      clipId: clip.id,
      sampleCount: clip.sampleCount,
      sampleRate: clip.sampleRate,
      channels: clip.channels,
      duration: clip.durationTicks / NATIVE_AUDIO_TIME_SCALE,
      gain: clip.gain,
    })),
  });
  return {
    snapshot,
    installed,
  };
}

function toNativeAudioTimelineClip(config: ExportAudioClipConfig): NativeAudioTimelineClip {
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
    volumeKeyframes: config.volumeKeyframes.map((point) => ({ ...point, time: secondsToTicks(point.time) })),
    channelMode: config.channelMode,
    downmix: config.downmix,
    channelMap: config.channelMap,
    preservePitch: config.preservePitch,
  };
}

function secondsToTicks(seconds: number): number {
  return Math.max(0, Math.round(seconds * NATIVE_AUDIO_TIME_SCALE));
}
