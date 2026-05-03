import { create } from "zustand";

interface PlaybackStore {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  frameRate: number;
  intervalId: number | null;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (time: number) => void;
  setDuration: (duration: number) => void;
  setFrameRate: (fps: number) => void;
}

export const usePlaybackStore = create<PlaybackStore>((set, get) => ({
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  frameRate: 30,
  intervalId: null,

  play: () => {
    const state = get();
    if (state.isPlaying) return;

    set({ isPlaying: true });

    const intervalId = window.setInterval(() => {
      const current = get();
      const frameTime = 1 / current.frameRate;
      const newTime = current.currentTime + frameTime;

      if (newTime >= current.duration) {
        // Pause at the end instead of stopping (which resets to 0)
        // Clamp to duration to ensure we don't exceed it
        set({ currentTime: current.duration, isPlaying: false, intervalId: null });
        if (current.intervalId) {
          clearInterval(current.intervalId);
        }
      } else {
        set({ currentTime: newTime });
      }
    }, 16) as unknown as number;

    set({ intervalId });
  },

  pause: () => {
    const state = get();
    if (state.intervalId) {
      clearInterval(state.intervalId);
    }
    set({ isPlaying: false, intervalId: null });
  },

  stop: () => {
    const state = get();
    if (state.intervalId) {
      clearInterval(state.intervalId);
    }
    set({ isPlaying: false, currentTime: 0, intervalId: null });
  },

  seek: (time) => {
    const state = get();
    if (state.intervalId) {
      clearInterval(state.intervalId);
    }
    const clamped = Math.max(0, Math.min(time, state.duration));
    set({ currentTime: clamped, isPlaying: false, intervalId: null });
  },

  setDuration: (duration) => {
    set({ duration });
  },

  setFrameRate: (fps) => {
    set({ frameRate: fps });
  },
}));
