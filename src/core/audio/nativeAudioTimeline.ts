import type { Clip, MediaAsset, Track } from "@/types";
import { getActiveAudioClips, type ExportAudioClipConfig } from "@/core/timeline/audioClips";
import {
  clearNativeAudioClip,
  getNativeAudioClips,
  loadNativeAudioClip,
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
  fadeInTicks: number;
  fadeOutTicks: number;
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
  await clearNativeAudioClip();
  await Promise.all(snapshot.clips.map((clip) => loadNativeAudioClip(clip)));
  return {
    snapshot,
    installed: await getNativeAudioClips(),
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
    fadeInTicks: secondsToTicks(config.fadeIn),
    fadeOutTicks: secondsToTicks(config.fadeOut),
  };
}

function secondsToTicks(seconds: number): number {
  return Math.max(0, Math.round(seconds * NATIVE_AUDIO_TIME_SCALE));
}
