/**
 * Timeline Store
 *
 * OWNERSHIP: Editable timeline domain state (single source of truth)
 * PERSISTENCE: Persistent (saved/loaded by projectStore)
 * MUTABILITY: Mutable (user edits, operations)
 *
 * Responsibilities:
 * - Own all timeline composition state (tracks, clips, selections)
 * - Provide mutation operations (add/remove/update clips/tracks)
 * - Maintain timeline view state (zoom, scroll)
 * - Emit epoch changes for render invalidation
 *
 * Does NOT:
 * - Persist to disk (projectStore handles serialization)
 * - Manage runtime resources (ProjectSession handles playback/scheduler)
 * - Reset itself (only projectStore loads/clears on project switch)
 *
 * Architecture principle:
 * This is the authoritative source for "what is on the timeline right now"
 * All other systems (render, playback, export) consume this as immutable input
 */

import { create } from "zustand";
import type { Track, TrackType, Clip, TextClip, TransitionTimelineItem, TransitionType } from "@/types";
import type { Gap } from "@/types/gap";
import { generateId, getCounter } from "@/lib/id";
import { detectGaps, createGap, insertGapWithRipple, removeGapWithRipple, resizeGap, packTrack } from "@/lib/gapEngine";
import { recalculateTextClipBounds } from "@/lib/textClip";
import { useUIStore } from "./uiStore";
import { useProjectStore } from "./projectStore";
import { clampTimelinePixelsPerSecond, clampTimelineZoom, TIMELINE_PPS_PER_ZOOM, TIMELINE_ZOOM_DEFAULT } from "../lib/timelineZoom";
import { getTimelineContentEnd, normalizeClipTiming } from "@/lib/timelineClip";
import { autoSaveMiddleware } from "./middleware/autoSaveMiddleware";

interface TimelineStore {
  tracks: Track[];
  clips: Clip[];
  gaps: Gap[]; // NEW: First-class gap entities
  transitions: TransitionTimelineItem[];
  /**
   * First created video track - UI metadata only.
   * Used for: default drop target, visual highlighting, user expectations.
   * NOT used for: enforcement, validation, or blocking operations.
   * The compositor resolves frames by time, not by track constraints.
   */
  mainVideoTrackId: string | null;
  /**
   * Timeline epoch - increments on every timeline mutation.
   * Used for cache invalidation in render engine and evaluation.
   */
  epoch: number;
  zoomLevel: number;
  scrollLeft: number;
  viewportWidth: number;
  pixelsPerSecond: number;
  rippleEditEnabled: boolean;
  snapEnabled: boolean;
  /** Active snap guides (vertical alignment indicators during resize/drag) */
  snapGuides: Array<{ time: number; type: "clip-start" | "clip-end" | "playhead" }>;
  setSnapGuides: (guides: Array<{ time: number; type: "clip-start" | "clip-end" | "playhead" }>) => void;
  clearSnapGuides: () => void;
  /** @internal Batch nesting depth — do not read directly */
  _batchDepth: number;
  /** @internal Deferred epoch flag — do not read directly */
  _pendingEpochIncrement: boolean;
  /** Execute a batch of mutations safely. Epoch increment is deferred until the block completes. */
  withBatch: (fn: () => void) => void;
  /** Increment epoch (for cache invalidation) */
  incrementEpoch: () => void;
  /** Hydrate timeline state from project load (atomic operation) */
  hydrateFromProject: (payload: { tracks?: any[]; clips?: any[]; transitions?: TransitionTimelineItem[] }) => void;
  addTrack: (type: TrackType) => void;
  /** Inserts a track at index (clamped); returns the new track id. */
  insertTrackAt: (type: TrackType, index: number) => string;
  removeTrack: (trackId: string) => void;
  toggleTrackLock: (trackId: string) => void;
  toggleTrackMute: (trackId: string) => void;
  toggleTrackVisibility: (trackId: string) => void;
  addClip: (clip: Clip) => void;
  removeClip: (clipId: string) => void;
  updateClip: (clipId: string, updates: Partial<Clip>) => void;
  addTransition: (transition: TransitionTimelineItem) => void;
  removeTransition: (transitionId: string) => void;
  createTransitionBetweenClips: (fromClipId: string, toClipId: string, type: TransitionType, duration?: number) => { transition?: TransitionTimelineItem; error: string | null };
  moveClip: (clipId: string, startTime: number) => void;
  setZoom: (level: number) => void;
  /** Clamps to the SRP zoom range and syncs `zoomLevel` to `pixelsPerSecond / 100`. */
  setPixelsPerSecond: (pps: number) => void;
  setScrollLeft: (left: number) => void;
  setViewportWidth: (width: number) => void;
  getTimelineEndTime: () => number;
  swapClips: () => { error: string | null };
  toggleRippleEdit: () => void;
  toggleSnapEnabled: () => void;
  rippleTrimClip: (clipId: string, side: "left" | "right", deltaTime: number) => void;
  // Sequence-based operations
  insertClipAtIndex: (clipId: string, trackId: string, index: number) => void;
  normalizeTrack: (trackId: string) => void;
  getTrackClips: (trackId: string) => Clip[];
  removeEmptyNonMainTracks: (candidateTrackIds?: string[]) => void;
  // Gap operations
  insertGap: (trackId: string, startTime: number, duration: number) => Gap | null;
  removeGap: (gapId: string) => void;
  resizeGapDuration: (gapId: string, newDuration: number) => void;
  toggleGapProtection: (gapId: string) => void;
  detectAndSyncGaps: (trackId?: string) => void;
  packTrackGaps: (trackId: string) => void;
}

const trackHeights: Record<string, number> = {
  video: 68,
  audio: 52,
  text: 30,
  sticker: 30,
};
const MIN_TRIM_DURATION_SEC = 1;

/** Where to insert a new row when dropping off-track: video/text at top; audio under first video (or append if no video). */
export function getInsertIndexForNewTrack(tracks: Track[], trackType: TrackType): number {
  if (trackType === "video" || trackType === "text" || trackType === "sticker") {
    return 0;
  }
  const mainIdx = tracks.findIndex((t) => t.type === "video");
  if (mainIdx >= 0) {
    return mainIdx + 1;
  }
  return tracks.length;
}

/**
 * Smart track insertion that respects drop position context.
 * Uses newTrackPosition and betweenTrackIds to determine exact insertion point.
 */
export function getInsertIndexForNewTrackSmart(
  tracks: Track[],
  trackType: TrackType,
  context?: {
    newTrackPosition?: "above" | "below" | "between" | null;
    betweenTrackIds?: { aboveId: string; belowId: string };
  },
): number {
  // If no context, use legacy behavior
  if (!context || !context.newTrackPosition) {
    return getInsertIndexForNewTrack(tracks, trackType);
  }

  const { newTrackPosition, betweenTrackIds } = context;

  // Above all tracks
  if (newTrackPosition === "above") {
    return 0;
  }

  // Below all tracks
  if (newTrackPosition === "below") {
    return tracks.length;
  }

  // Between specific tracks
  if (newTrackPosition === "between" && betweenTrackIds) {
    const belowIndex = tracks.findIndex((t) => t.id === betweenTrackIds.belowId);
    if (belowIndex >= 0) {
      return belowIndex; // Insert at the position of the "below" track (pushing it down)
    }
  }

  // Fallback to legacy behavior
  return getInsertIndexForNewTrack(tracks, trackType);
}

export const useTimelineStore = create<TimelineStore>(
  autoSaveMiddleware((set, get) => ({
    tracks: [],
    clips: [],
    gaps: [], // NEW: Initialize empty gaps array
    transitions: [],
    mainVideoTrackId: null,
    epoch: 0,
    zoomLevel: TIMELINE_ZOOM_DEFAULT,
    scrollLeft: 0,
    viewportWidth: 1200,
    pixelsPerSecond: TIMELINE_ZOOM_DEFAULT * TIMELINE_PPS_PER_ZOOM,
    rippleEditEnabled: false,
    snapEnabled: true,
    snapGuides: [],
    _batchDepth: 0,
    _pendingEpochIncrement: false,

    setSnapGuides: (guides) => set({ snapGuides: guides }),
    clearSnapGuides: () => set({ snapGuides: [] }),

    withBatch: (fn) => {
      set((state) => ({ _batchDepth: state._batchDepth + 1 }));
      try {
        fn();
      } finally {
        set((state) => {
          const newDepth = Math.max(0, state._batchDepth - 1);
          if (newDepth === 0 && state._pendingEpochIncrement) {
            return { _batchDepth: 0, _pendingEpochIncrement: false, epoch: state.epoch + 1 };
          }
          return { _batchDepth: newDepth };
        });
      }
    },

    incrementEpoch: () => {
      set((state) => {
        if (state._batchDepth > 0) {
          return { _pendingEpochIncrement: true };
        }
        return { epoch: state.epoch + 1 };
      });
    },

    hydrateFromProject: (payload) => {
      const finalTracks = payload?.tracks ?? [];
      const finalClipsRaw = payload?.clips ?? [];
      const finalTransitions = payload?.transitions ?? [];
      const finalGaps = (payload as any)?.gaps ?? []; // Load gaps from project (cast for backwards compatibility)

      // Normalize clip timing with media asset data
      const mediaAssets = useProjectStore.getState().mediaAssets;

      const normalizedClips = finalClipsRaw.map((clip: Clip) => {
        const asset = mediaAssets.find((a) => a.id === clip.mediaId);
        return normalizeClipTiming(clip, asset);
      });

      // Atomic state update - all or nothing
      set({
        tracks: finalTracks,
        clips: normalizedClips,
        gaps: finalGaps, // NEW: Load gaps
        transitions: finalTransitions,
        scrollLeft: 0,
        zoomLevel: TIMELINE_ZOOM_DEFAULT,
        pixelsPerSecond: TIMELINE_ZOOM_DEFAULT * TIMELINE_PPS_PER_ZOOM,
        epoch: 0, // Reset epoch on project load
      });

      // If gaps weren't in project file (legacy), detect them
      if (finalGaps.length === 0 && normalizedClips.length > 0) {
        setTimeout(() => {
          get().detectAndSyncGaps();
        }, 0);
      }
    },

    addTrack: (type) => {
      const newTrack: Track = {
        id: generateId("track"),
        type,
        name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${getCounter() % 100}`,
        muted: false,
        locked: false,
        visible: true,
        height: trackHeights[type],
      };
      set((state) => ({
        tracks: [...state.tracks, newTrack],
        mainVideoTrackId: state.mainVideoTrackId ?? (type === "video" ? newTrack.id : null),
      }));
    },

    insertTrackAt: (type, index) => {
      const newTrack: Track = {
        id: generateId("track"),
        type,
        name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${getCounter() % 100}`,
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
        return {
          tracks: next,
          mainVideoTrackId: state.mainVideoTrackId ?? (type === "video" ? newTrack.id : null),
        };
      });
      return id;
    },

    removeTrack: (trackId) => {
      set((state) => ({
        tracks: state.tracks.filter((t) => t.id !== trackId),
        clips: state.clips.filter((c) => c.trackId !== trackId),
        transitions: state.transitions.filter((transition) => transition.placement.trackId !== trackId),
      }));
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
      set((state) => {
        const wasEmpty = state.clips.length === 0;

        // Check for overlap and adjust position if needed
        const trackClips = state.clips.filter((c) => c.trackId === clip.trackId).sort((a, b) => a.startTime - b.startTime);

        let finalStartTime = clip.startTime;
        let hasOverlap = true;

        // Keep checking until no overlaps (handle cascading shifts)
        while (hasOverlap) {
          hasOverlap = false;
          for (const existingClip of trackClips) {
            const existingEnd = existingClip.startTime + existingClip.duration;
            const newEnd = finalStartTime + clip.duration;

            // Check for overlap
            if (finalStartTime < existingEnd && newEnd > existingClip.startTime) {
              // Overlap detected - move to end of conflicting clip
              finalStartTime = existingEnd;
              hasOverlap = true; // Re-check with new position
              break; // Restart the loop from beginning
            }
          }
        }

        // Create clip with safe position
        const safeClip = { ...clip, startTime: finalStartTime };

        // If timeline was empty, switch to program preview and seek to first clip's start time
        if (wasEmpty) {
          // Import dynamically to avoid circular dependency
          import("@/core/runtime/ProjectSession").then(({ getActiveSessionOrNull }) => {
            const session = getActiveSessionOrNull();
            if (session?.transportAuthority) {
              session.transportAuthority.setActiveContext("program");
              // Seek to the new clip's start time for immediate visual feedback
              const firstClipStartTime = safeClip.startTime;
              session.transportAuthority.seek(firstClipStartTime);
            }
          });

          // Exit source mode in UI
          import("./uiStore").then(({ useUIStore }) => {
            useUIStore.getState().exitSourceMode();
          });
        }

        return {
          clips: [...state.clips, safeClip],
          epoch: state.epoch + 1,
        };
      });
    },

    removeClip: (clipId) => {
      set((state) => {
        const clipToRemove = state.clips.find((c) => c.id === clipId);
        const remainingClips = state.clips.filter((c) => c.id !== clipId);

        // If removing the last clip, reset playhead to 00:00
        if (remainingClips.length === 0) {
          // Import dynamically to avoid circular dependency
          import("@/core/runtime/ProjectSession").then(({ getActiveSessionOrNull }) => {
            const session = getActiveSessionOrNull();
            if (session?.transportAuthority) {
              session.transportAuthority.seek(0);
            }
          });
        }

        // Check if the track this clip was on is now empty
        let tracksToKeep = state.tracks;
        if (clipToRemove) {
          const trackId = clipToRemove.trackId;
          const hasOtherClips = remainingClips.some((c) => c.trackId === trackId);

          // If no other clips on this track, remove the track
          if (!hasOtherClips) {
            tracksToKeep = state.tracks.filter((t) => t.id !== trackId);
          }
        }

        const next: Partial<TimelineStore> = {
          clips: remainingClips,
          tracks: tracksToKeep,
          transitions: state.transitions.filter((transition) => transition.fromItemId !== clipId && transition.toItemId !== clipId),
        };
        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }
        return next;
      });
    },

    addTransition: (transition) => {
      set((state) => {
        const next: Partial<TimelineStore> = {
          transitions: [...state.transitions.filter((t) => t.id !== transition.id), transition],
        };
        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }
        return next;
      });
    },

    removeTransition: (transitionId) => {
      set((state) => {
        const next: Partial<TimelineStore> = {
          transitions: state.transitions.filter((transition) => transition.id !== transitionId),
        };
        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }
        return next;
      });
    },

    createTransitionBetweenClips: (fromClipId, toClipId, type, duration = 0.5) => {
      const state = get();
      const fromClip = state.clips.find((clip) => clip.id === fromClipId);
      const toClip = state.clips.find((clip) => clip.id === toClipId);
      if (!fromClip || !toClip) return { error: "Select two clips to add a transition" };
      if (fromClip.trackId !== toClip.trackId) return { error: "Transitions require two clips on the same track" };

      const track = state.tracks.find((t) => t.id === fromClip.trackId);
      if (!track) return { error: "Transition track was not found" };
      if (track.locked) return { error: "Unlock the track before adding a transition" };
      if (track.type === "audio") return { error: "Visual transitions can only be added to video or text tracks" };

      const [left, right] = fromClip.startTime <= toClip.startTime ? [fromClip, toClip] : [toClip, fromClip];
      const leftEnd = left.startTime + left.duration;
      const gap = right.startTime - leftEnd;
      if (gap > 0.001) return { error: "Move clips together before adding a transition" };
      if (left.duration < duration / 2 || right.duration < duration / 2) return { error: "Clips are too short for this transition" };

      const transitionStart = Math.max(0, leftEnd - duration / 2);
      const transition: TransitionTimelineItem = {
        id: generateId("transition"),
        kind: "transition",
        type,
        fromItemId: left.id,
        toItemId: right.id,
        alignment: "center",
        easing: "easeInOut",
        placement: {
          trackId: left.trackId,
          startTime: transitionStart,
          duration,
          role: "effect",
          zIndex: Number.MAX_SAFE_INTEGER,
        },
        effects: { effects: [], version: 0 },
        metadata: {
          createdFrom: "transitions-panel",
        },
      };

      get().addTransition(transition);
      return { transition, error: null };
    },

    updateClip: (clipId, updates) => {
      set((state) => {
        const next: Partial<TimelineStore> = {
          clips: state.clips.map((c) => {
            if (c.id !== clipId) return c;

            // Auto-recalculate bounds for text clips when text/style changes
            const isTextClip = "text" in c;
            const hasManualBounds = "x" in updates || "y" in updates || "width" in updates || "height" in updates;
            const TEXT_STYLE_KEYS: (keyof TextClip)[] = ["text", "fontSize", "fontFamily", "fontWeight", "fontStyle", "styleId", "stroke", "shadow", "background", "letterSpacing"];
            const hasStyleChange = TEXT_STYLE_KEYS.some((k) => k in updates);

            if (isTextClip && hasStyleChange && !hasManualBounds) {
              try {
                const project = useProjectStore.getState().project;
                const canvasWidth = project?.canvasWidth ?? 1920;
                const canvasHeight = project?.canvasHeight ?? 1080;
                return recalculateTextClipBounds(c as TextClip, updates as Partial<TextClip>, canvasWidth, canvasHeight);
              } catch (e) {
                // Fallback: apply updates without recalculation
                console.warn("[updateClip] Bounds recalculation failed, applying raw updates", e);
                return { ...c, ...updates };
              }
            }

            return { ...c, ...updates };
          }),
        };
        // Skip epoch increment during transform preview (high-frequency updates)
        // The final mouseup will commit to history which will increment epoch properly
        const isTransformPreview = "_skipEpochIncrement" in updates && (updates as any)._skipEpochIncrement;
        if (isTransformPreview) {
          // Don't increment epoch for preview updates
          return next;
        }
        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }
        return next;
      });
    },

    moveClip: (clipId, startTime) => {
      set((state) => {
        const next: Partial<TimelineStore> = {
          clips: state.clips.map((c) => (c.id === clipId ? { ...c, startTime } : c)),
        };
        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }
        return next;
      });
    },

    setPixelsPerSecond: (pps) => {
      const clamped = clampTimelinePixelsPerSecond(pps);
      set({
        pixelsPerSecond: clamped,
        zoomLevel: clamped / TIMELINE_PPS_PER_ZOOM,
      });
    },

    setZoom: (level) => {
      get().setPixelsPerSecond(TIMELINE_PPS_PER_ZOOM * clampTimelineZoom(level));
    },

    setScrollLeft: (left) => {
      set({ scrollLeft: left });
    },
    setViewportWidth: (width) => {
      set({ viewportWidth: width });
    },

    getTimelineEndTime: () => {
      const state = get();
      return getTimelineContentEnd(state.clips);
    },

    swapClips: () => {
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
        set((state) => {
          const next: Partial<TimelineStore> = {
            clips: state.clips.map((c) => {
              if (c.id === clipA.id) {
                return { ...c, startTime: clipB.startTime, trackId: clipB.trackId };
              }
              if (c.id === clipB.id) {
                return { ...c, startTime: clipA.startTime, trackId: clipA.trackId };
              }
              return c;
            }),
          };
          if (state._batchDepth > 0) {
            next._pendingEpochIncrement = true;
          } else {
            next.epoch = state.epoch + 1;
          }
          return next;
        });

        return { error: null };
      }

      // Case: same track — recalculate positions flush
      // Ensure left is always the leftmost clip
      const [left, right] = clipA.startTime < clipB.startTime ? [clipA, clipB] : [clipB, clipA];

      const newLeftStart = left.startTime; // right clip takes left's old start
      const newRightStart = left.startTime + right.duration; // left clip follows immediately after right
      const newLeftEnd = newLeftStart + right.duration;
      const newRightEnd = newRightStart + left.duration;

      // Collision check: do the swapped clips overlap any other clips?
      const trackClips = state.clips.filter((c) => c.trackId === left.trackId && c.id !== left.id && c.id !== right.id);

      // Check if either swapped clip overlaps with other clips on the track
      const collision = trackClips.some((c) => {
        const cEnd = c.startTime + c.duration;
        // Check if clip C overlaps with new left position (right clip moved to left)
        const overlapsNewLeft = Math.max(newLeftStart, c.startTime) < Math.min(newLeftEnd, cEnd);
        // Check if clip C overlaps with new right position (left clip moved to right)
        const overlapsNewRight = Math.max(newRightStart, c.startTime) < Math.min(newRightEnd, cEnd);
        return overlapsNewLeft || overlapsNewRight;
      });

      if (collision) {
        return { error: "Not enough space to swap — clips would overlap" };
      }

      set((state) => {
        const next: Partial<TimelineStore> = {
          clips: state.clips.map((c) => {
            if (c.id === left.id) return { ...c, startTime: newRightStart };
            if (c.id === right.id) return { ...c, startTime: newLeftStart };
            return c;
          }),
        };
        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }
        return next;
      });

      return { error: null };
    },

    toggleRippleEdit: () => {
      set((state) => ({ rippleEditEnabled: !state.rippleEditEnabled }));
    },

    toggleSnapEnabled: () => {
      set((state) => ({ snapEnabled: !state.snapEnabled }));
    },

    rippleTrimClip: (clipId, side, deltaTime) => {
      const state = get();
      const clip = state.clips.find((c) => c.id === clipId);
      if (!clip) return;

      const track = state.tracks.find((t) => t.id === clip.trackId);
      if (track?.locked) return;

      // Clamp trimming to underlying media duration when available.
      // Falls back to Infinity (no cap) when the media asset cannot be resolved.
      let mediaDurationBound = Infinity;
      let mediaType: "video" | "audio" | "image" | null = null;
      try {
        // Lazy import to avoid circular deps during store init.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const asset = useProjectStore.getState().mediaAssets?.find((a: any) => a.id === clip.mediaId);
        mediaType = asset?.type ?? null;
        if (asset?.duration && Number.isFinite(asset.duration) && asset.duration > 0) {
          mediaDurationBound = asset.duration;
        }
      } catch {
        // ignore; keep Infinity bound
      }
      if (mediaType === "image") {
        mediaDurationBound = Math.max(mediaDurationBound, 60 * 60); // 1 hour guardrail
      }

      const minDuration = MIN_TRIM_DURATION_SEC;

      // Calculate the new clip dimensions
      let newStartTime = clip.startTime;
      let newDuration = clip.duration;
      let rippleAmount = 0;

      if (side === "right") {
        // Trimming right edge - changes duration
        const maxDuration = Math.max(minDuration, mediaDurationBound - clip.trimIn);
        const desiredDuration = clip.duration + deltaTime;
        newDuration = Math.max(minDuration, Math.min(desiredDuration, maxDuration));
        rippleAmount = newDuration - clip.duration;
      } else {
        // Trimming left edge - changes both start time and duration
        const maxTrimIn = Math.min(mediaDurationBound, clip.trimOut - 0.001);
        const desiredStartTime = clip.startTime + deltaTime;
        const desiredDelta = desiredStartTime - clip.startTime;
        const previousClipEnd = state.clips
          .filter((c) => c.id !== clipId && c.trackId === clip.trackId)
          .reduce((maxEnd, c) => {
            const end = c.startTime + c.duration;
            if (end <= clip.startTime + 1e-6) return Math.max(maxEnd, end);
            return maxEnd;
          }, 0);

        const minDelta = Math.max(-clip.startTime, previousClipEnd - clip.startTime);
        const maxDeltaByDuration = clip.duration - minDuration;
        const maxDeltaByMedia = maxTrimIn - clip.trimIn;
        const clampedDelta = Math.max(minDelta, Math.min(desiredDelta, maxDeltaByDuration, maxDeltaByMedia));

        newStartTime = clip.startTime + clampedDelta;
        newDuration = clip.duration - clampedDelta;
        rippleAmount = clampedDelta;
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
      set((state) => {
        const next: Partial<TimelineStore> = {
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
                updates.duration = clip.trimOut - updates.trimIn;
              } else {
                updates.trimOut = Math.min(clip.trimIn + newDuration, mediaDurationBound);
                updates.duration = updates.trimOut - clip.trimIn;
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
        };
        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }
        return next;
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

      // Check if clip is already at target position (no-op detection)
      if (clip.trackId === trackId) {
        const allTrackClips = state.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.startTime - b.startTime);
        const currentIndex = allTrackClips.findIndex((c) => c.id === clipId);
        if (currentIndex === index) {
          // No-op: clip is already at target position, don't shift anything
          return;
        }
      }

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
      set((state) => {
        const next: Partial<TimelineStore> = {
          clips: state.clips.map((c) => {
            const updated = updatedClips.find((uc) => uc.id === c.id);
            return updated || c;
          }),
        };
        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }
        return next;
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

      set((state) => {
        const next: Partial<TimelineStore> = {
          clips: state.clips.map((c) => {
            const norm = normalized.find((n) => n.id === c.id);
            return norm || c;
          }),
        };
        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }
        return next;
      });
    },

    removeEmptyNonMainTracks: (candidateTrackIds) => {
      set((state) => {
        const mainVideoTrackId = state.mainVideoTrackId ?? state.tracks.find((t) => t.type === "video")?.id ?? null;
        const candidateSet = candidateTrackIds ? new Set(candidateTrackIds) : null;
        const nextTracks = state.tracks.filter((track) => {
          if (track.id === mainVideoTrackId) return true;
          if (candidateSet && !candidateSet.has(track.id)) return true;
          return state.clips.some((c) => c.trackId === track.id);
        });
        return {
          tracks: nextTracks,
          mainVideoTrackId,
        };
      });
    },

    // ═══════════════════════════════════════════════════════════
    // Gap Operations (First-Class Gap Entities)
    // ═══════════════════════════════════════════════════════════
    // GAP OPERATIONS
    // ⚠️ DEPRECATED: These methods are kept for backwards compatibility only.
    // Use GapManager for new code to get undo/redo support:
    //   import { GapManager } from '@/lib/gapManager';
    //   GapManager.insertGap(trackId, startTime, duration);
    // ═══════════════════════════════════════════════════════════

    insertGap: (trackId, startTime, duration) => {
      console.warn("[DEPRECATED] timelineStore.insertGap() - Use GapManager.insertGap() for undo/redo support");

      const state = get();
      const track = state.tracks.find((t) => t.id === trackId);

      if (!track || track.locked) {
        return null;
      }

      const result = insertGapWithRipple(trackId, startTime, duration, state.clips, "user-insert");

      if (!result.success || !result.gap) {
        return null;
      }

      // Shift affected clips
      set((state) => {
        const next: Partial<TimelineStore> = {
          gaps: [...state.gaps, result.gap!],
          clips: state.clips.map((c) => (result.affectedClipIds!.includes(c.id) ? { ...c, startTime: c.startTime + duration } : c)),
        };

        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }

        return next;
      });

      return result.gap;
    },

    removeGap: (gapId) => {
      console.warn("[DEPRECATED] timelineStore.removeGap() - Use GapManager.removeGap() for undo/redo support");

      const state = get();
      const gap = state.gaps.find((g) => g.id === gapId);

      if (!gap) return;

      const track = state.tracks.find((t) => t.id === gap.trackId);
      if (track?.locked) return;

      const result = removeGapWithRipple(gap, state.clips);

      if (!result.success) return;

      // Shift affected clips left
      set((state) => {
        const next: Partial<TimelineStore> = {
          gaps: state.gaps.filter((g) => g.id !== gapId),
          clips: state.clips.map((c) => (result.affectedClipIds!.includes(c.id) ? { ...c, startTime: c.startTime - gap.duration } : c)),
        };

        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }

        return next;
      });
    },

    resizeGapDuration: (gapId, newDuration) => {
      console.warn("[DEPRECATED] timelineStore.resizeGapDuration() - Use GapManager.resizeGap() for undo/redo support");

      const state = get();
      const gap = state.gaps.find((g) => g.id === gapId);

      if (!gap) return;

      const track = state.tracks.find((t) => t.id === gap.trackId);
      if (track?.locked) return;

      const result = resizeGap(gap, newDuration, state.clips);

      if (!result.success || !result.gap) return;

      const deltaTime = newDuration - gap.duration;

      // Update gap and shift affected clips
      set((state) => {
        const next: Partial<TimelineStore> = {
          gaps: state.gaps.map((g) => (g.id === gapId ? result.gap! : g)),
          clips: state.clips.map((c) => (result.affectedClipIds!.includes(c.id) ? { ...c, startTime: c.startTime + deltaTime } : c)),
        };

        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }

        return next;
      });
    },

    toggleGapProtection: (gapId) => {
      console.warn("[DEPRECATED] timelineStore.toggleGapProtection() - Use GapManager.toggleProtection() for undo/redo support");

      set((state) => {
        const next: Partial<TimelineStore> = {
          gaps: state.gaps.map((g) =>
            g.id === gapId
              ? {
                  ...g,
                  protected: !g.protected,
                  type: !g.protected ? "protected" : "manual",
                }
              : g,
          ),
        };

        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }

        return next;
      });
    },

    detectAndSyncGaps: (trackId) => {
      const state = get();
      const tracksToProcess = trackId ? state.tracks.filter((t) => t.id === trackId) : state.tracks;

      let newGaps: Gap[] = [...state.gaps];

      for (const track of tracksToProcess) {
        const trackClips = state.clips.filter((c) => c.trackId === track.id);
        const existingTrackGaps = state.gaps.filter((g) => g.trackId === track.id);

        // Detect new gaps
        const detectedGaps = detectGaps(trackClips, existingTrackGaps);

        // Add newly detected gaps
        newGaps = [...newGaps, ...detectedGaps];
      }

      set((state) => ({
        gaps: newGaps,
      }));
    },

    packTrackGaps: (trackId) => {
      console.warn("[DEPRECATED] timelineStore.packTrackGaps() - Use GapManager.packTrack() for undo/redo support");

      const state = get();
      const track = state.tracks.find((t) => t.id === trackId);

      if (!track || track.locked) return;

      const result = packTrack(trackId, state.clips, state.gaps);

      // Reposition all clips tightly
      const trackClips = state.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.startTime - b.startTime);

      let currentTime = 0;
      const repositionedClips = new Map<string, number>();

      for (const clip of trackClips) {
        repositionedClips.set(clip.id, currentTime);
        currentTime += clip.duration;
      }

      set((state) => {
        // Merge remaining gaps from this track with gaps from other tracks
        const otherTrackGaps = state.gaps.filter((g) => g.trackId !== trackId);
        const allRemainingGaps = [...otherTrackGaps, ...result.remainingGaps];

        const next: Partial<TimelineStore> = {
          gaps: allRemainingGaps,
          clips: state.clips.map((c) => (repositionedClips.has(c.id) ? { ...c, startTime: repositionedClips.get(c.id)! } : c)),
        };

        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }

        return next;
      });
    },
  })),
);
