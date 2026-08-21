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

import { useEffect, useRef } from "react";
import { getPlaybackClock } from "@/core/playback/PlaybackClock";
import { AudioEngine } from "@/core/audio/AudioEngine";
import {
  getSharedAudioEngine,
  resumeSharedAudioEngine,
  stopSharedAudioEngine,
} from "@/core/audio/audioRuntime";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { convertFileSrc } from "@tauri-apps/api/core";
import { isWebviewOrExternalUrl } from "@/lib/platform/pathConversion";
import { isTauriRuntime } from "@/lib/platform/tauri";
import { NativeAudioPreviewController } from "@/core/audio/nativeAudioPreviewController";

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
  const nativeControllerRef = useRef<NativeAudioPreviewController | null>(null);
  const nativeDisposeChainRef = useRef<Promise<void>>(Promise.resolve());

  // Native audio is brought up before transport starts. While it is warming,
  // browser voices stay silent so the first Play action cannot switch audio
  // authorities halfway through a frame.
  useEffect(() => {
    if (!options.nativeMode || !isTauriRuntime() || !project) return;

    // Project metadata can legitimately lag behind the timeline after media
    // import (the preview clock derives the real duration from clip bounds).
    // Native audio must use that same duration contract or a stale `0` makes
    // its first position sample look like an end-of-timeline event.
    const timelineDuration = clips.reduce(
      (maximum, clip) => Math.max(maximum, clip.startTime + clip.duration),
      0,
    );
    const playbackDuration = getPlaybackClock().duration;
    const nativeDuration = Math.max(
      0,
      project.duration || 0,
      timelineDuration,
      playbackDuration,
    );

    const controller = new NativeAudioPreviewController({
      clock: getPlaybackClock(),
      source: {
        projectRevision: `${project.id}:${timelineEpoch}`,
        frameRate: project.frameRate,
        duration: nativeDuration,
        audioTrackCount: tracks.filter((track) => track.type === "audio" && !track.muted).length,
        clips,
        tracks,
        assets: mediaAssets,
      },
      onError: (error) => {
        console.warn("[useAudioSyncEngine] Native audio controller error:", error);
      },
    });
    // Claim the clock synchronously, before any awaited native loading. A
    // user can press Play during decode/configuration; that must not make
    // PlaybackClock create a temporary Web Audio context in the gap.
    getPlaybackClock().setNativeClockAuthority(true);
    // A stale browser graph must be silent before native initialization begins.
    // Native mode has one audible authority. Quiesce any voices left by a
    // previous controller before the native stream is initialized; otherwise
    // native startup can overlap the old Web Audio graph for one or more RAFs.
    engineRef.current?.stopAllVoices(false);
    let cancelled = false;
    let initializeStarted = false;

    const initializeNativeController = () => {
      if (initializeStarted || cancelled) return;
      initializeStarted = true;
      void (async () => {
        await nativeDisposeChainRef.current;
        if (cancelled) return;
        nativeControllerRef.current = controller;
        const enabled = await controller.initialize();
        if (cancelled || !enabled) {
          // Native Tauri playback is mandatory. Staying silent is safer than
          // silently switching to a second clock/audio implementation.
          engineRef.current?.stopAllVoices(true);
          if (!cancelled) {
            console.error(
              "[useAudioSyncEngine] Native program-preview audio could not initialize; browser fallback is disabled.",
            );
          }
          return;
        }
        engineRef.current?.stopAllVoices(true);
        controller.setOutput(options.volume ?? 100, options.muted ?? false);
      })();
    };
    // Warm the native graph while paused. Starting native audio lazily from
    // the first Play click allowed WebAudio to begin immediately and then be
    // replaced by CPAL mid-play, which caused the initial A/V discontinuity.
    initializeNativeController();

    return () => {
      cancelled = true;
      engineRef.current?.stopAllVoices(false);
      if (nativeControllerRef.current === controller) {
        nativeControllerRef.current = null;
      }
      nativeDisposeChainRef.current = controller.dispose();
    };
  }, [
    options.nativeMode,
    project?.id,
    project?.frameRate,
    project?.duration,
    timelineEpoch,
    clips,
    tracks,
    mediaAssets,
  ]);

  useEffect(() => {
    nativeControllerRef.current?.setOutput(options.volume ?? 100, options.muted ?? false);
  }, [options.volume, options.muted]);

  // 1. Asynchronously pre-decode and cache audio buffers whenever timeline clips change
  useEffect(() => {
    if (options.nativeMode) return;
    const engine = engineRef.current;
    if (!engine) return;
    const pool = engine.bufferPool;

    for (const clip of clips) {
      const audioKey = clip.mediaId || clip.audioPath || clip.id;
      if (pool.has(audioKey)) continue;

      // Resolve audio source URL from mediaAssets or audioPath
      let sourceUrl: string | undefined = clip.audioPath;
      if (!sourceUrl && clip.mediaId) {
        const asset = mediaAssets.find((a) => a.id === clip.mediaId);
        if (asset) {
          sourceUrl = asset.path;
        }
      }

      if (sourceUrl) {
        const resolvedSrc = isWebviewOrExternalUrl(sourceUrl)
          ? sourceUrl
          : convertFileSrc(sourceUrl);
        pool.load(audioKey, resolvedSrc).catch((err) => {
          console.warn(
            `[useAudioSyncEngine] Failed to pre-decode audio for clip ${clip.id}:`,
            err,
          );
        });
      }
    }
  }, [clips, mediaAssets]);

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
        clips,
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
  }, [clips, tracks, options.volume, options.muted]);

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
