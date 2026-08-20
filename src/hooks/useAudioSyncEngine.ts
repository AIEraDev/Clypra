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
  return getSharedAudioEngine();
}

/** Resume the shared audible engine from a user-gesture transport action. */
export function resumeGlobalAudioEngine(): void {
  resumeSharedAudioEngine();
}

/** Flush shared voices when the project preview is leaving the editor. */
export function stopGlobalAudioEngine(): void {
  stopSharedAudioEngine();
}

export function useAudioSyncEngine(options: UseAudioSyncEngineOptions = {}) {
  const clips = useTimelineStore((s) => s.clips);
  const tracks = useTimelineStore((s) => s.tracks);
  const timelineEpoch = useTimelineStore((s) => s.epoch);
  const mediaAssets = useProjectStore((s) => s.mediaAssets);
  const project = useProjectStore((s) => s.project);

  const engineRef = useRef<AudioEngine>(
    options.audioEngine ?? getSharedAudioEngine(),
  );
  const rafRef = useRef<number | null>(null);
  const nativeControllerRef = useRef<NativeAudioPreviewController | null>(null);
  const nativeActiveRef = useRef(false);
  const nativeDisposeChainRef = useRef<Promise<void>>(Promise.resolve());

  // Native audio is brought up as a controlled replacement. Until its graph is
  // ready, the existing Web Audio path continues to provide audio; once ready,
  // browser voices are flushed before the native clock is allowed to run.
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
    nativeActiveRef.current = false;
    let cancelled = false;
    let initializeStarted = false;

    const initializeOnPlay = (state = getPlaybackClock().getState()) => {
      if (initializeStarted || cancelled || state.state !== "playing") return;
      initializeStarted = true;
      void (async () => {
        await nativeDisposeChainRef.current;
        if (cancelled) return;
        nativeControllerRef.current = controller;
        const enabled = await controller.initialize();
        if (cancelled || !enabled) return;
        engineRef.current.stopAllVoices(true);
        nativeActiveRef.current = true;
        controller.setOutput(options.volume ?? 100, options.muted ?? false);
      })();
    };
    const unsubscribeClock = getPlaybackClock().subscribe(initializeOnPlay);
    initializeOnPlay();

    return () => {
      cancelled = true;
      unsubscribeClock();
      nativeActiveRef.current = false;
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
    const engine = engineRef.current;
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
    const clock = getPlaybackClock();
    const engine = engineRef.current;
    let lastPlayState = clock.state;

    const syncLoop = () => {
      const currentTime = clock.currentTime;
      const isPlaying = clock.state === "playing";
      const speed = clock.speed;

      if (!nativeActiveRef.current) {
        // Synchronize browser audio voices only while native takeover is not
        // active. This prevents two independent audible graphs from playing.
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
    bufferPool: engineRef.current.bufferPool,
  };
}
