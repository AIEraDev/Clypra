/**
 * Audio Sync Engine Hook — Clypra React Integration
 *
 * Imperative bridge between timeline state, Web Audio API AudioEngine,
 * and the master PlaybackClock.
 *
 * CRITICAL PERFORMANCE GUARANTEE:
 * Does NOT call setState or mutate React state during 60 FPS playback.
 * All audio voice synchronization runs imperatively on the animation frame loop.
 */

import { useEffect, useMemo, useRef } from "react";
import { getPlaybackClock } from "@/core/playback/PlaybackClock";
import { AudioEngine } from "@/core/audio/AudioEngine";
import {
  getSharedAudioEngine,
  prewarmSharedAudioBuffers,
  resumeSharedAudioEngine,
  stopSharedAudioEngine,
} from "@/core/audio/audioRuntime";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { isTauriRuntime } from "@/lib/platform/tauri";
import {
  createAudioPlaybackAdapter,
  type AudioPlaybackAdapter,
  type AudioPlaybackSource,
} from "@/core/audio/AudioPlaybackAdapter";
import { telemetryCollector } from "@/services/telemetryCollector";
import { getActiveSessionOrNull } from "@/core/runtime/ProjectSession";
import { getNativeAudioDiagnostics } from "@/lib/platform/tauri";
import type { AudioEngineTelemetrySnapshot } from "@/core/audio/AudioEngine";
import { expandCompoundClips } from "@/core/timeline/compoundClips";

interface UseAudioSyncEngineOptions {
  audioEngine?: AudioEngine;
  volume?: number;
  muted?: boolean;
  /** Enable the native CPAL timeline authority when running in Tauri. */
  nativeMode?: boolean;
}

export function getGlobalAudioEngine(): AudioEngine {
  if (isTauriRuntime()) {
    throw new Error("Web Audio is not available for native Tauri program preview");
  }
  return getSharedAudioEngine();
}

/** Resume the shared audible engine from a user-gesture transport action. */
export function resumeGlobalAudioEngine(): void {
  if (isTauriRuntime()) return;
  resumeSharedAudioEngine();
}

/** Flush shared voices when the project preview is leaving the editor. */
export function stopGlobalAudioEngine(): void {
  if (isTauriRuntime()) return;
  stopSharedAudioEngine();
}

export function useAudioSyncEngine(options: UseAudioSyncEngineOptions = {}) {
  const clips = useTimelineStore((s) => s.clips);
  const expandedClips = useMemo(() => expandCompoundClips(clips), [clips]);
  const tracks = useTimelineStore((s) => s.tracks);
  const timelineEpoch = useTimelineStore((s) => s.epoch);
  const mediaAssets = useProjectStore((s) => s.mediaAssets);
  const project = useProjectStore((s) => s.project);

  // Tauri program preview is native-only. Do not even construct a Web Audio
  // graph there: an inactive fallback still owns buffers, a context clock,
  // and can resume voices during a native handoff. Browser preview retains
  // the shared engine as its single browser authority.
  const engineRef = useRef<AudioEngine | null>(
    options.nativeMode ? null : options.audioEngine ?? getSharedAudioEngine(),
  );
  const rafRef = useRef<number | null>(null);
  const adapterRef = useRef<AudioPlaybackAdapter | null>(null);
  const adapterDisposeChainRef = useRef<Promise<void>>(Promise.resolve());
  const latestAudioSourceRef = useRef<AudioPlaybackSource | null>(null);
  const previousNativeAudioStatusRef = useRef<{
    callbackCount: number;
    renderedFrames: number;
    nonSilentFrames: number;
    mixerLockMisses: number;
    callbackTimeUs: number;
    callbackMaxTimeUs: number;
    callbackOverBudgetCount: number;
    lastError: string | null;
  } | null>(null);

  const timelineDuration = expandedClips.reduce(
    (maximum, clip) => Math.max(maximum, clip.startTime + clip.duration),
    0,
  );
  const totalDuration = project
    ? Math.max(0, project.duration || 0, timelineDuration, getPlaybackClock().duration)
    : 0;
  const latestAudioSource: AudioPlaybackSource | null = project
    ? {
        projectRevision: `${project.id}:${timelineEpoch}`,
        frameRate: project.frameRate,
        duration: totalDuration,
        audioTrackCount: tracks.filter((track) => track.type === "audio" && !track.muted).length,
        clips: expandedClips,
        tracks,
        assets: mediaAssets,
      }
    : null;
  latestAudioSourceRef.current = latestAudioSource;

  // Audio telemetry is sampled away from the real-time callback. One event per
  // five-second active window is enough to expose bottlenecks without turning
  // audio rendering into a telemetry workload or growing while idle.
  useEffect(() => {
    if (!project?.id) return;
    const sessionId = getActiveSessionOrNull()?.sessionId ?? `audio-${Date.now()}`;
    const sample = async () => {
      try {
        if (options.nativeMode && isTauriRuntime()) {
          const diagnostics = await getNativeAudioDiagnostics();
          const status = diagnostics.status;
          const previous = previousNativeAudioStatusRef.current;
          previousNativeAudioStatusRef.current = {
            callbackCount: status.callbackCount,
            renderedFrames: status.renderedFrames,
            nonSilentFrames: status.nonSilentFrames,
            mixerLockMisses: status.mixerLockMisses,
            callbackTimeUs: status.callbackTimeUs,
            callbackMaxTimeUs: status.callbackMaxTimeUs,
            callbackOverBudgetCount: status.callbackOverBudgetCount,
            lastError: status.lastError,
          };
          const callbackCount = Math.max(0, status.callbackCount - (previous?.callbackCount ?? 0));
          const renderedFrames = Math.max(0, status.renderedFrames - (previous?.renderedFrames ?? 0));
          const callbackTimeUs = Math.max(0, status.callbackTimeUs - (previous?.callbackTimeUs ?? 0));
          const mixerLockMisses = Math.max(0, status.mixerLockMisses - (previous?.mixerLockMisses ?? 0));
          const overBudget = Math.max(0, status.callbackOverBudgetCount - (previous?.callbackOverBudgetCount ?? 0));
          const errorChanged = Boolean(status.lastError && status.lastError !== previous?.lastError);
          // CPAL may continue invoking a silent callback while transport is
          // paused. Do not turn that device-idle activity into unbounded DB
          // growth; report an error only once when it first appears.
          if (!status.playing && !errorChanged) return;
          telemetryCollector.recordAudioSnapshot({
            sessionId,
            windowStartMs: Date.now() - 5000,
            backend: "native-cpal",
            runtimeEnvironment: import.meta.env.DEV ? "development" : "production",
            windowDurationMs: 5000,
            sampleRate: status.sampleRate ?? undefined,
            channels: status.channels ?? undefined,
            installedClipCount: diagnostics.installedClips.length,
            activeClipCount: diagnostics.activeClipIds.length,
            callbackCount,
            renderedFrames,
            nonSilentFrames: Math.max(0, status.nonSilentFrames - (previous?.nonSilentFrames ?? 0)),
            underruns: mixerLockMisses,
            mixerLockMisses,
            callbackP95Us: callbackCount > 0 ? Math.round(callbackTimeUs / callbackCount) : 0,
            callbackMaxUs: Math.max(0, status.callbackMaxTimeUs),
            callbackOverBudgetCount: overBudget,
            clockDriftP95Ms: undefined,
            lastError: status.lastError ?? undefined,
            stageTimings: {
              callbackUs: callbackCount > 0 ? Math.round(callbackTimeUs / callbackCount) : 0,
              outputUs: callbackCount > 0 ? Math.round(callbackTimeUs / callbackCount) : 0,
              totalTimeUs: callbackCount > 0 ? Math.round(callbackTimeUs / callbackCount) : 0,
            },
          });
          return;
        }

        if (!options.nativeMode && engineRef.current) {
          const engine = engineRef.current;
          const snapshot: AudioEngineTelemetrySnapshot = engine.takeTelemetrySnapshot();
          if (snapshot.playingSyncCalls === 0) return;
          telemetryCollector.recordAudioSnapshot({
            sessionId,
            windowStartMs: Date.now() - snapshot.windowDurationMs,
            backend: "web-audio",
            runtimeEnvironment: import.meta.env.DEV ? "development" : "production",
            windowDurationMs: snapshot.windowDurationMs,
            activeVoiceCount: snapshot.activeVoiceCount,
            syncCalls: snapshot.syncCalls,
            playingSyncCalls: snapshot.playingSyncCalls,
            bufferHits: snapshot.bufferHits,
            bufferMisses: snapshot.bufferMisses,
            bufferHitRatio: snapshot.bufferHitRatio,
            stageTimings: snapshot.stageTimings,
          });
        }
      } catch (error) {
        console.warn("[audio-telemetry] sample failed", error);
      }
    };
    const handle = window.setInterval(() => void sample(), 5000);
    return () => {
      window.clearInterval(handle);
      previousNativeAudioStatusRef.current = null;
    };
  }, [options.nativeMode, project?.id]);

  // Adapter lifecycle: Initialize and bind to playback source
  useEffect(() => {
    if (!options.nativeMode || !isTauriRuntime() || !project) return;

    const source = latestAudioSourceRef.current;
    if (!source) return;

    const adapter = createAudioPlaybackAdapter({
      clock: getPlaybackClock(),
      forceKind: "native",
      onError: (error) => {
        console.warn("[useAudioSyncEngine] Audio adapter error:", error);
      },
    });

    getPlaybackClock().setNativeClockAuthority(true);
    engineRef.current?.stopAllVoices(false);
    let cancelled = false;
    let initializeStarted = false;

    const initializeAdapter = () => {
      if (initializeStarted || cancelled) return;
      initializeStarted = true;
      void (async () => {
        await adapterDisposeChainRef.current;
        if (cancelled) return;
        adapterRef.current = adapter;
        await adapter.initialize(source);
        if (cancelled || !adapter.isActive) {
          engineRef.current?.stopAllVoices(true);
          return;
        }
        engineRef.current?.stopAllVoices(true);
        const currentSource = latestAudioSourceRef.current;
        if (currentSource && currentSource !== source) {
          adapter.updateSource(currentSource);
        }
        adapter.setOutput(options.volume ?? 100, options.muted ?? false);
      })();
    };
    initializeAdapter();

    return () => {
      cancelled = true;
      engineRef.current?.stopAllVoices(false);
      if (adapterRef.current === adapter) {
        adapterRef.current = null;
      }
      adapterDisposeChainRef.current = adapter.dispose();
    };
  }, [
    options.nativeMode,
    project?.id,
    project?.frameRate,
  ]);

  // Update the audio playback source dynamically when timelineEpoch or project duration changes
  const lastProjectIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!options.nativeMode || !isTauriRuntime() || !project || !adapterRef.current) return;
    if (lastProjectIdRef.current !== project.id) {
      lastProjectIdRef.current = project.id;
      if (!adapterRef.current.isActive) return;
    }

    const source = latestAudioSourceRef.current;
    if (!source) return;
    adapterRef.current.updateSource(source);
  }, [
    options.nativeMode,
    project?.id,
    project?.duration,
    timelineEpoch,
    expandedClips,
    tracks,
    mediaAssets,
  ]);

  useEffect(() => {
    adapterRef.current?.setOutput(options.volume ?? 100, options.muted ?? false);
  }, [options.volume, options.muted]);

  // 1. Asynchronously pre-decode and cache audio buffers whenever timeline clips change
  useEffect(() => {
    if (options.nativeMode) return;
    const assetsById = new Map(mediaAssets.map((asset) => [asset.id, asset]));
    const items = expandedClips
      .map((clip) => {
        const key = clip.mediaId || clip.audioPath || clip.id;
        const source = clip.audioPath || (clip.mediaId ? assetsById.get(clip.mediaId)?.path : undefined);
        return source ? { key, source } : null;
      })
      .filter((item): item is { key: string; source: string } => Boolean(item));
    void prewarmSharedAudioBuffers(items);
  }, [expandedClips, mediaAssets]);

  // 2. High-performance RAF playback synchronizer loop (ZERO REACT DOM RE-RENDERS)
  useEffect(() => {
    if (options.nativeMode) return;
    const clock = getPlaybackClock();
    const engine = engineRef.current;
    if (!engine) return;
    let lastPlayState = clock.state;

    const syncLoop = () => {
      const currentTime = clock.currentTime;
      const isPlaying = clock.state === "playing";
      const speed = clock.speed;

      engine.syncPlayback(
        expandedClips,
        tracks,
        currentTime,
        isPlaying,
        speed,
        options.volume ?? 100,
        options.muted ?? false,
      );

      // Instant flush on play -> pause/stop transition
      if (lastPlayState === "playing" && !isPlaying) {
        engine.stopAllVoices(true);
      }
      lastPlayState = clock.state;

      rafRef.current = requestAnimationFrame(syncLoop);
    };

    rafRef.current = requestAnimationFrame(syncLoop);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [expandedClips, tracks, options.volume, options.muted]);

  // Keep this separate from the sync-loop effect. Timeline edits can recreate
  // the loop while playback continues and must not cut the audible voices.
  useEffect(() => {
    return () => stopGlobalAudioEngine();
  }, []);

  return {
    audioEngine: engineRef.current,
    bufferPool: engineRef.current?.bufferPool ?? null,
  };
}
