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
import { AudioBufferPool } from "@/core/audio/AudioBufferPool";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { convertFileSrc } from "@tauri-apps/api/core";
import { isWebviewOrExternalUrl } from "@/lib/platform/pathConversion";

interface UseAudioSyncEngineOptions {
  audioEngine?: AudioEngine;
  volume?: number;
  muted?: boolean;
}

let globalAudioEngine: AudioEngine | null = null;
let globalBufferPool: AudioBufferPool | null = null;

export function getGlobalAudioEngine(): AudioEngine {
  if (!globalAudioEngine) {
    globalBufferPool = new AudioBufferPool(256 * 1024 * 1024);
    globalAudioEngine = new AudioEngine({ bufferPool: globalBufferPool });
  }
  return globalAudioEngine;
}

/** Resume the shared audible engine from a user-gesture transport action. */
export function resumeGlobalAudioEngine(): void {
  if (globalAudioEngine) {
    void globalAudioEngine.resume();
  }
}

/** Flush shared voices when the project preview is leaving the editor. */
export function stopGlobalAudioEngine(): void {
  globalAudioEngine?.stopAllVoices(false);
}

export function useAudioSyncEngine(options: UseAudioSyncEngineOptions = {}) {
  const clips = useTimelineStore((s) => s.clips);
  const tracks = useTimelineStore((s) => s.tracks);
  const mediaAssets = useProjectStore((s) => s.mediaAssets);

  const engineRef = useRef<AudioEngine>(
    options.audioEngine ?? getGlobalAudioEngine(),
  );
  const rafRef = useRef<number | null>(null);

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

      // Synchronize audio voices imperatively
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
    bufferPool: engineRef.current.bufferPool,
  };
}
