import { create } from "zustand";
import type { Track, Clip } from "../types";

interface TimelineStore {
  tracks: Track[];
  clips: Clip[];
  zoomLevel: number;
  scrollLeft: number;
  pixelsPerSecond: number;
  rippleEditEnabled: boolean;
  addTrack: (type: "video" | "audio" | "text") => void;
  /** Inserts a track at index (clamped); returns the new track id. */
  insertTrackAt: (type: "video" | "audio" | "text", index: number) => string;
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
  swapClips: () => { error: string | null };
  toggleRippleEdit: () => void;
  rippleTrimClip: (clipId: string, side: "left" | "right", deltaTime: number) => void;
  // Sequence-based operations
  insertClipAtIndex: (clipId: string, trackId: string, index: number) => void;
  normalizeTrack: (trackId: string) => void;
  getTrackClips: (trackId: string) => Clip[];
}

const trackHeights: Record<string, number> = {
  video: 68,
  audio: 52,
  text: 56,
};

/** Where to insert a new row when dropping off-track: video/text at top; audio under first video (or append if no video). */
export function getInsertIndexForNewTrack(tracks: Track[], trackType: "video" | "audio" | "text"): number {
  if (trackType === "video" || trackType === "text") {
    return 0;
  }
  const mainIdx = tracks.findIndex((t) => t.type === "video");
  if (mainIdx >= 0) {
    return mainIdx + 1;
  }
  return tracks.length;
}

export const useTimelineStore = create<TimelineStore>((set, get) => ({
  tracks: [],
  clips: [],
  zoomLevel: 1.0,
  scrollLeft: 0,
  pixelsPerSecond: 100,
  rippleEditEnabled: false,

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

  insertTrackAt: (type, index) => {
    const newTrack: Track = {
      id: `track-${Date.now()}`,
      type,
      name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${Date.now() % 100}`,
      muted: false,
      locked: false,
      visible: true,
      height: trackHeights[type],
    };
    const id = newTrack.id;
    set((state) => {
      const clamped = Math.max(0, Math.min(index, state.tracks.length));
      const next = [...state.tracks];
      next.splice(clamped, 0, newTrack);
      return { tracks: next };
    });
    import("./projectStore").then(({ useProjectStore }) => {
      useProjectStore.getState().scheduleAutoSave();
    });
    return id;
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

  toggleRippleEdit: () => {
    set((state) => ({ rippleEditEnabled: !state.rippleEditEnabled }));
  },

  rippleTrimClip: (clipId, side, deltaTime) => {
    const state = get();
    const clip = state.clips.find((c) => c.id === clipId);
    if (!clip) return;

    const track = state.tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) return;

    // Calculate the new clip dimensions
    let newStartTime = clip.startTime;
    let newDuration = clip.duration;
    let rippleAmount = 0;

    if (side === "right") {
      // Trimming right edge - changes duration
      newDuration = Math.max(0.1, clip.duration + deltaTime);
      rippleAmount = newDuration - clip.duration;
    } else {
      // Trimming left edge - changes both start time and duration
      newStartTime = Math.max(0, clip.startTime + deltaTime);
      const actualDelta = newStartTime - clip.startTime;
      newDuration = clip.duration - actualDelta;
      rippleAmount = actualDelta;

      if (newDuration < 0.1) return; // Don't allow clip to become too small
    }

    // Find all clips downstream on the same track
    const downstreamClips = state.clips
      .filter((c) => {
        if (c.id === clipId) return false;
        if (c.trackId !== clip.trackId) return false;

        // For right edge trim: clips that start after the clip's end
        if (side === "right") {
          return c.startTime >= clip.startTime + clip.duration;
        }
        // For left edge trim: clips that start after the clip's start
        return c.startTime >= clip.startTime;
      })
      .sort((a, b) => a.startTime - b.startTime);

    // Update the trimmed clip and all downstream clips
    set((state) => ({
      clips: state.clips.map((c) => {
        if (c.id === clipId) {
          // Update the clip being trimmed
          const updates: Partial<Clip> = {
            startTime: newStartTime,
            duration: newDuration,
          };

          // Update trim points for media
          if (side === "left") {
            updates.trimIn = clip.trimIn + (newStartTime - clip.startTime);
          } else {
            updates.trimOut = clip.trimIn + newDuration;
          }

          return { ...c, ...updates };
        }

        // Shift downstream clips
        const downstream = downstreamClips.find((dc) => dc.id === c.id);
        if (downstream) {
          return {
            ...c,
            startTime: c.startTime + rippleAmount,
          };
        }

        return c;
      }),
    }));

    // Trigger auto-save
    import("./projectStore").then(({ useProjectStore }) => {
      useProjectStore.getState().scheduleAutoSave();
    });
  },

  // Sequence-based operations for gap engine
  getTrackClips: (trackId) => {
    const state = get();
    return state.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.startTime - b.startTime);
  },

  insertClipAtIndex: (clipId, trackId, index) => {
    const state = get();
    const clip = state.clips.find((c) => c.id === clipId);
    if (!clip) return;

    // Get all clips on target track (excluding the dragged clip)
    const trackClips = state.clips.filter((c) => c.trackId === trackId && c.id !== clipId).sort((a, b) => a.startTime - b.startTime);

    // Insert clip at index
    trackClips.splice(index, 0, clip);

    // Recalculate all positions (no gaps, no overlaps)
    let currentTime = 0;
    const updatedClips = trackClips.map((c) => {
      const updated = { ...c, startTime: currentTime, trackId };
      currentTime += c.duration;
      return updated;
    });

    // Update state with normalized positions
    set((state) => ({
      clips: state.clips.map((c) => {
        const updated = updatedClips.find((uc) => uc.id === c.id);
        return updated || c;
      }),
    }));

    // Trigger auto-save
    import("./projectStore").then(({ useProjectStore }) => {
      useProjectStore.getState().scheduleAutoSave();
    });
  },

  normalizeTrack: (trackId) => {
    const state = get();
    const trackClips = state.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.startTime - b.startTime);

    let currentTime = 0;
    const normalized = trackClips.map((clip) => {
      const updated = { ...clip, startTime: currentTime };
      currentTime += clip.duration;
      return updated;
    });

    set((state) => ({
      clips: state.clips.map((c) => {
        const norm = normalized.find((n) => n.id === c.id);
        return norm || c;
      }),
    }));
  },
}));
