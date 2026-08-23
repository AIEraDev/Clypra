import type { Clip, MediaAsset, Track } from "@/types";
import { getActiveAudioClips, type ExportAudioClipConfig } from "@/core/timeline/audioClips";
import {
  clearNativeAudioClip,
  getNativeAudioClips,
  loadNativeAudioClip,
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
  const installed = await getNativeAudioClips();
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
    fadeInTicks: secondsToTicks(config.fadeIn),
    fadeOutTicks: secondsToTicks(config.fadeOut),
  };
}

function secondsToTicks(seconds: number): number {
  return Math.max(0, Math.round(seconds * NATIVE_AUDIO_TIME_SCALE));
}
