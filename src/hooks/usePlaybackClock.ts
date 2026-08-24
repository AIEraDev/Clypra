/**
 * Playback Clock Hook
 *
 * Provides UI snapshots of playback state (throttled to 10fps).
 * For render loops, read clock.time imperatively instead.
 *
 * Architecture: Single global PlaybackClock singleton shared by all consumers.
 * ProjectSession references the same singleton. Disposal handled by destroyRuntime().
 *
 * Usage:
 *   // For UI (timecode display, scrubber position)
 *   const { time, state } = usePlaybackClock();
 *
 *   // For render loops (canvas, etc.)
 *   const clock = getPlaybackClock();
 *   requestAnimationFrame(() => {
 *     const time = clock.time; // Imperative read
 *     render(time);
 *   });
 */

import { useEffect, useState, useMemo, useRef } from "react";
import { getPlaybackClock, type PlaybackClockState } from "../core/playback";
import type { TransportAuthority, PlaybackContextStateSnapshot } from "../core/playback";
import { getActiveSessionOrNull } from "@/core/runtime/ProjectSession";
import { resumeGlobalAudioEngine } from "@/hooks/useAudioSyncEngine";
import { isTauriRuntime } from "@/lib/platform/tauri";

/**
 * Hook for UI snapshots of playback state.
 * Updates are throttled to 10fps to avoid React render storms.
 *
 * For high-frequency reads (render loops), use getPlaybackClock() directly.
 */
export function usePlaybackClock(): PlaybackClockState {
  const clock = getPlaybackClock();
  const [state, setState] = useState<PlaybackClockState>(clock.getState());

  useEffect(() => {
    // Subscribe to throttled updates (10fps max)
    const unsubscribe = clock.subscribe((newState) => {
      setState(newState);
    });

    return unsubscribe;
  }, [clock]);

  return state;
}

/**
 * Hook for discrete playback status (isPlaying and duration) without subscribing
 * to continuous time updates. Prevents large container components from re-rendering
 * on every animation frame during playback.
 */
export function usePlaybackStatus(): { isPlaying: boolean; duration: number; state: PlaybackClockState["state"] } {
  const clock = getPlaybackClock();
  const [status, setStatus] = useState(() => {
    const s = clock.getState();
    return {
      isPlaying: s.state === "playing",
      duration: s.duration,
      state: s.state,
    };
  });

  useEffect(() => {
    let lastState = clock.getState().state;
    let lastDuration = clock.getState().duration;

    const unsubscribe = clock.subscribe((newState) => {
      const isPlaying = newState.state === "playing";
      const duration = newState.duration;
      const state = newState.state;

      if (state !== lastState || duration !== lastDuration) {
        lastState = state;
        lastDuration = duration;
        setStatus({ isPlaying, duration, state });
      }
    });

    return unsubscribe;
  }, [clock]);

  return status;
}

/**
 * Hook for playback controls.
 * Returns imperative control functions (no state).
 * Functions are memoized to prevent unnecessary re-renders.
 */
export function usePlaybackControls() {
  const clock = getPlaybackClock();

  return useMemo(
    () => ({
      play: () => clock.play(),
      pause: () => clock.pause(),
      stop: () => clock.stop(),
      seek: (time: number) => clock.seek(time),
      setSpeed: (speed: number) => clock.setSpeed(speed),
      setDuration: (duration: number) => clock.setDuration(duration),
      setFrameRate: (fps: number) => clock.setFrameRate(fps),
    }),
    [clock],
  );
}

/**
 * Get transport authority from the active project session.
 * Returns null if no session is active.
 *
 * Reads directly on each render — the session object is stable
 * and React re-renders components on project open/close.
 */
export function useTransport(): TransportAuthority | null {
  return getActiveSessionOrNull()?.transportAuthority ?? null;
}

/**
 * Hook for transport controls via the active authority.
 * Works with whichever context is currently active (program or source).
 */
export function useTransportControls() {
  const authority = useTransport();

  return useMemo(
    () => {
      const prepareProgramPreviewAudio = () => {
        // Source Preview owns its visible HTMLMediaElement. Never unlock or
        // resume the program-preview pool/engine while source media is active.
        if (authority?.getActiveType() !== "program") return;
        if (isTauriRuntime()) return;
        resumeGlobalAudioEngine();
        getActiveSessionOrNull()?.unlockProgramPreviewAudio();
      };

      return {
        play: () => {
          prepareProgramPreviewAudio();
          authority?.play();
        },
        togglePlayback: () => {
          prepareProgramPreviewAudio();
          authority?.togglePlayback();
        },
        pause: () => authority?.pause(),
        stop: () => authority?.stop(),
        seek: (time: number) => authority?.seek(time),
        setSpeed: (speed: number) => authority?.setSpeed(speed),
        setActiveContext: (type: "program" | "source") => authority?.setActiveContext(type),
      };
    },
    [authority],
  );
}

/**
 * Hook for UI snapshots of the active transport context state.
 * Subscribes to both context switches and state changes.
 */
export function useTransportSnapshot(throttleMs = 50): PlaybackContextStateSnapshot & { contextType: "program" | "source" | null } {
  const authority = useTransport();
  const [state, setState] = useState<PlaybackContextStateSnapshot & { contextType: "program" | "source" | null }>(() => {
    const snap = authority?.getSnapshot();
    return {
      time: snap?.time ?? 0,
      state: snap?.state ?? "stopped",
      duration: snap?.duration ?? 0,
      speed: snap?.speed ?? 1,
      contextType: authority?.getActiveType() ?? null,
    };
  });

  const lastUpdateRef = useRef(0);
  const pendingUpdateRef = useRef<number | null>(null);

  useEffect(() => {
    if (!authority) return;

    let ctxUnsub: (() => void) | null = null;

    const subscribeToActive = () => {
      if (ctxUnsub) ctxUnsub();
      const ctx = authority.getActiveContext();
      if (ctx) {
        ctxUnsub = ctx.subscribe((snapshot) => {
          const now = Date.now();
          if (now - lastUpdateRef.current >= throttleMs) {
            lastUpdateRef.current = now;
            setState({ ...snapshot, contextType: ctx.type });
          } else if (!pendingUpdateRef.current) {
            pendingUpdateRef.current = window.setTimeout(() => {
              pendingUpdateRef.current = null;
              lastUpdateRef.current = Date.now();
              setState({ ...snapshot, contextType: ctx.type });
            }, throttleMs - (now - lastUpdateRef.current));
          }
        });
      } else {
        setState({ time: 0, state: "stopped", duration: 0, speed: 1, contextType: null });
      }
    };

    const authUnsub = authority.subscribeToContextSwitch(() => {
      subscribeToActive();
    });

    subscribeToActive();

    return () => {
      authUnsub();
      if (ctxUnsub) ctxUnsub();
      if (pendingUpdateRef.current) window.clearTimeout(pendingUpdateRef.current);
    };
  }, [authority, throttleMs]);

  return state;
}

/**
 * Get playback clock for imperative reads.
 * Re-exported from core for convenience.
 */
export { getPlaybackClock };

/**
 * Format time as timecode.
 */
export function formatTimecode(seconds: number, frameRate: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const frames = Math.floor((seconds % 1) * frameRate);

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}
