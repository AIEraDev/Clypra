import { create } from "zustand";
import type { Track, Clip } from "../types";

interface AffectedClip {
  clipId: string;
  originalStartTime: number;
  shiftedStartTime: number;
}

interface DragState {
  draggingClipId: string;
  targetTrackId: string;
  ghostStartTime: number;
  ghostDuration: number;
  insertMode: boolean; // Alt key held
  affectedClips: AffectedClip[];
}

interface TimelineStore {
  tracks: Track[];
  clips: Clip[];
  zoomLevel: number;
  scrollLeft: number;
  pixelsPerSecond: number;
  dragState: DragState | null;
  addTrack: (type: "video" | "audio" | "text") => void;
  removeTrack: (trackId: string) => void;
  toggleTrackLock: (trackId: string) => void;
  toggleTrackMute: (trackId: string) => void;
  toggleTrackVisibility: (trackId: string) => void;
  addClip: (clip: Clip) => void;
  removeClip: (clipId: string) => void;
  updateClip: (clipId: string, updates: Partial<Clip>) => void;
  moveClip: (clipId: string, startTime: number) => void;
  setZoom: (level: number) => void;
  setScrollLeft: (left: number) => void;
  splitClipAtTime: (clipId: string, time: number) => void;
  getTimelineEndTime: () => number;
  setDragState: (state: DragState | null) => void;
  calculateShiftedPositions: (trackId: string, ghostStart: number, ghostDuration: number, draggingId: string, insertMode: boolean) => AffectedClip[];
  swapClips: () => { error: string | null };
}

const trackHeights: Record<string, number> = {
  video: 68,
  audio: 52,
  text: 56,
};

export const useTimelineStore = create<TimelineStore>((set, get) => ({
  tracks: [],
  clips: [],
  zoomLevel: 1.0,
  scrollLeft: 0,
  pixelsPerSecond: 100,
  dragState: null,

  addTrack: (type) => {
    const newTrack: Track = {
      id: `track-${Date.now()}`,
      type,
      name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${Date.now() % 100}`,
      muted: false,
      locked: false,
      visible: true,
      height: trackHeights[type],
    };
    set((state) => ({
      tracks: [...state.tracks, newTrack],
    }));
    // Trigger auto-save
    import("./projectStore").then(({ useProjectStore }) => {
      useProjectStore.getState().scheduleAutoSave();
    });
  },

  removeTrack: (trackId) => {
    set((state) => ({
      tracks: state.tracks.filter((t) => t.id !== trackId),
      clips: state.clips.filter((c) => c.trackId !== trackId),
    }));
    // Trigger auto-save
    import("./projectStore").then(({ useProjectStore }) => {
      useProjectStore.getState().scheduleAutoSave();
    });
  },

  toggleTrackLock: (trackId) => {
    set((state) => ({
      tracks: state.tracks.map((track) => (track.id === trackId ? { ...track, locked: !track.locked } : track)),
    }));
  },

  toggleTrackMute: (trackId) => {
    set((state) => ({
      tracks: state.tracks.map((track) => (track.id === trackId ? { ...track, muted: !track.muted } : track)),
    }));
  },

  toggleTrackVisibility: (trackId) => {
    set((state) => ({
      tracks: state.tracks.map((track) => (track.id === trackId ? { ...track, visible: !track.visible } : track)),
    }));
  },

  addClip: (clip) => {
    set((state) => ({
      clips: [...state.clips, clip],
    }));
    // Trigger auto-save
    import("./projectStore").then(({ useProjectStore }) => {
      useProjectStore.getState().scheduleAutoSave();
    });
  },

  removeClip: (clipId) => {
    set((state) => ({
      clips: state.clips.filter((c) => c.id !== clipId),
    }));
    // Trigger auto-save
    import("./projectStore").then(({ useProjectStore }) => {
      useProjectStore.getState().scheduleAutoSave();
    });
  },

  updateClip: (clipId, updates) => {
    set((state) => ({
      clips: state.clips.map((c) => (c.id === clipId ? { ...c, ...updates } : c)),
    }));
    // Trigger auto-save
    import("./projectStore").then(({ useProjectStore }) => {
      useProjectStore.getState().scheduleAutoSave();
    });
  },

  moveClip: (clipId, startTime) => {
    set((state) => ({
      clips: state.clips.map((c) => (c.id === clipId ? { ...c, startTime } : c)),
    }));
    // Trigger auto-save
    import("./projectStore").then(({ useProjectStore }) => {
      useProjectStore.getState().scheduleAutoSave();
    });
  },

  setZoom: (level) => {
    const clamped = Math.max(0.5, Math.min(level, 5));
    set({
      zoomLevel: clamped,
      pixelsPerSecond: 100 * clamped,
    });
  },

  setScrollLeft: (left) => {
    set({ scrollLeft: left });
  },

  splitClipAtTime: (clipId, time) => {
    const state = get();
    const clip = state.clips.find((c) => c.id === clipId);
    if (!clip) return;

    const clipEndTime = clip.startTime + clip.duration;
    if (time <= clip.startTime || time >= clipEndTime) return;

    const timeSinceStart = time - clip.startTime;
    const newClip: Clip = {
      ...clip,
      id: `clip-${Date.now()}`,
      startTime: time,
      duration: clip.duration - timeSinceStart,
      trimIn: clip.trimIn + timeSinceStart,
    };

    set((state) => ({
      clips: [...state.clips.map((c) => (c.id === clipId ? { ...c, duration: timeSinceStart, trimOut: clip.trimOut - (clip.duration - timeSinceStart) } : c)), newClip],
    }));
  },

  getTimelineEndTime: () => {
    const state = get();
    return state.clips.reduce((maxTime, clip) => {
      const clipEndTime = clip.startTime + clip.duration;
      return Math.max(maxTime, clipEndTime);
    }, 0);
  },

  setDragState: (state) => {
    set({ dragState: state });
  },

  calculateShiftedPositions: (trackId, ghostStart, ghostDuration, draggingId, insertMode) => {
    if (!insertMode) return []; // No shifting in overwrite mode

    const state = get();
    // Get all clips on the same track, excluding the one being dragged
    const trackClips = state.clips.filter((c) => c.trackId === trackId && c.id !== draggingId).sort((a, b) => a.startTime - b.startTime);

    return trackClips.map((clip) => {
      // Clips that start at or after the ghost insertion point → shift right
      if (clip.startTime >= ghostStart) {
        return {
          clipId: clip.id,
          originalStartTime: clip.startTime,
          shiftedStartTime: clip.startTime + ghostDuration,
        };
      }
      // Clips before ghost → don't move
      return {
        clipId: clip.id,
        originalStartTime: clip.startTime,
        shiftedStartTime: clip.startTime,
      };
    });
  },

  swapClips: () => {
    const { useUIStore } = require("./uiStore");
    const { selectedClipIds } = useUIStore.getState();

    // Guard: exactly 2 clips must be selected
    if (selectedClipIds.length !== 2) {
      return { error: "Select exactly 2 clips to swap" };
    }

    const state = get();
    const clipA = state.clips.find((c) => c.id === selectedClipIds[0]);
    const clipB = state.clips.find((c) => c.id === selectedClipIds[1]);

    if (!clipA || !clipB) {
      return { error: "Selected clips not found" };
    }

    // Case: different tracks — simple position + track swap
    if (clipA.trackId !== clipB.trackId) {
      set((state) => ({
        clips: state.clips.map((c) => {
          if (c.id === clipA.id) {
            return { ...c, startTime: clipB.startTime, trackId: clipB.trackId };
          }
          if (c.id === clipB.id) {
            return { ...c, startTime: clipA.startTime, trackId: clipA.trackId };
          }
          return c;
        }),
      }));

      // Trigger auto-save
      import("./projectStore").then(({ useProjectStore }) => {
        useProjectStore.getState().scheduleAutoSave();
      });

      return { error: null };
    }

    // Case: same track — recalculate positions flush
    // Ensure left is always the leftmost clip
    const [left, right] = clipA.startTime < clipB.startTime ? [clipA, clipB] : [clipB, clipA];

    const newLeftStart = left.startTime; // left clip stays at same start
    const newRightStart = left.startTime + right.duration; // right fills left's old spot
    const newLeftEnd = newRightStart + left.duration;

    // Collision check: does the swapped left clip overlap anything after it?
    const trackClips = state.clips.filter((c) => c.trackId === left.trackId && c.id !== left.id && c.id !== right.id).sort((a, b) => a.startTime - b.startTime);

    const clipAfterRight = trackClips.find((c) => c.startTime >= right.startTime);

    if (clipAfterRight && newLeftEnd > clipAfterRight.startTime) {
      return { error: "Not enough space to swap — clips would overlap" };
    }

    set((state) => ({
      clips: state.clips.map((c) => {
        if (c.id === left.id) return { ...c, startTime: newRightStart };
        if (c.id === right.id) return { ...c, startTime: newLeftStart };
        return c;
      }),
    }));

    // Trigger auto-save
    import("./projectStore").then(({ useProjectStore }) => {
      useProjectStore.getState().scheduleAutoSave();
    });

    return { error: null };
  },
}));
