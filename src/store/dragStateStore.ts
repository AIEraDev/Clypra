import { create } from "zustand";
import type { Clip } from "../types";

interface DragStateStore {
  // The clip being dragged (removed from timeline)
  draggingClip: Clip | null;
  originalTrackId: string | null;
  originalStartTime: number | null;

  // Where the clip would be inserted
  insertionTrackId: string | null;
  insertionTime: number | null;

  // Grab offset for accurate cursor positioning
  grabOffsetX: number;
  grabOffsetY: number;

  // Actions
  setDragging: (clip: Clip, trackId: string, startTime: number) => void;
  clearDragging: () => void;
  setInsertion: (trackId: string | null, time: number | null) => void;
  setGrabOffset: (x: number, y: number) => void;
  // ✅ Bug Fix 2: Atomic update to prevent duplicate key errors
  commitDrop: (clipId: string, trackId: string, startTime: number) => void;
}

export const useDragStateStore = create<DragStateStore>((set) => ({
  draggingClip: null,
  originalTrackId: null,
  originalStartTime: null,
  insertionTrackId: null,
  insertionTime: null,
  grabOffsetX: 0,
  grabOffsetY: 0,

  setDragging: (clip, trackId, startTime) => {
    console.log("[STORE] 🎬 setDragging", { clipId: clip.id, trackId, startTime });
    set({
      draggingClip: clip,
      originalTrackId: trackId,
      originalStartTime: startTime,
    });
  },

  clearDragging: () => {
    console.log("[STORE] 🧹 clearDragging");
    set({
      draggingClip: null,
      originalTrackId: null,
      originalStartTime: null,
      insertionTrackId: null,
      insertionTime: null,
      grabOffsetX: 0,
      grabOffsetY: 0,
    });
  },

  setInsertion: (trackId, time) => {
    console.log("[STORE] 📍 setInsertion", { trackId, time });
    set({
      insertionTrackId: trackId,
      insertionTime: time,
    });
  },

  setGrabOffset: (x, y) => {
    console.log("[STORE] 🎯 setGrabOffset", { x, y });
    set({
      grabOffsetX: x,
      grabOffsetY: y,
    });
  },

  // ✅ Bug Fix 2: Atomic update - combines updateClip + clearDragging into one render
  commitDrop: (clipId, trackId, startTime) => {
    console.log("[STORE] 💾 commitDrop", { clipId, trackId, startTime });
    // Import timelineStore dynamically to avoid circular dependency
    const { useTimelineStore } = require("./timelineStore");
    const { updateClip } = useTimelineStore.getState();

    // Update clip position
    updateClip(clipId, { trackId, startTime });

    // Clear drag state in same update cycle
    set({
      draggingClip: null,
      originalTrackId: null,
      originalStartTime: null,
      insertionTrackId: null,
      insertionTime: null,
      grabOffsetX: 0,
      grabOffsetY: 0,
    });
  },
}));
