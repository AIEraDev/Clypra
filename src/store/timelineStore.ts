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
import type { Track, TrackType, Clip, TextClip, TransitionTimelineItem, TransitionType, TimelineMarker } from "@/types";
import type { Gap } from "@/types/gap";
import { generateId, getCounter } from "@/lib/utils/id";
import { detectGaps, createGap, insertGapWithRipple, removeGapWithRipple, resizeGap, packTrack, mergeAdjacentGaps, validateGap } from "@/lib/timeline/gapEngine";
import { resolveTextClipStyleUpdate } from "@/lib/text/textClip";
import { useUIStore } from "./uiStore";
import { useProjectStore } from "./projectStore";
import { clampTimelinePixelsPerSecond, clampTimelineZoom, TIMELINE_PPS_PER_ZOOM, TIMELINE_ZOOM_DEFAULT } from "../lib/timeline/timelineZoom";
import { getTimelineContentEnd, normalizeClipTiming } from "@/lib/timeline/timelineClip";
import { autoSaveMiddleware } from "./middleware/autoSaveMiddleware";
import { t, type MessageKey } from "@/i18n";

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
  hydrateFromProject: (payload: { tracks?: any[]; clips?: any[]; transitions?: TransitionTimelineItem[]; gaps?: Gap[]; markers?: TimelineMarker[] }) => void;
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
  updateTransition: (transitionId: string, updates: Partial<TransitionTimelineItem>) => void;
  createTransitionBetweenClips: (fromClipId: string, toClipId: string, type: TransitionType, duration?: number, renderer?: string) => { transition?: TransitionTimelineItem; error: string | null };
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
  // Marker operations
  markers: TimelineMarker[];
  addMarker: (time: number, name?: string, color?: string) => string;
  removeMarker: (markerId: string) => void;
  updateMarker: (markerId: string, updates: Partial<TimelineMarker>) => void;
}

const trackHeights: Record<string, number> = {
  video: 68,
  audio: 52,
  text: 30,
  sticker: 30,
  filter: 30,
  "video-effect": 30,
  "body-effect": 30,
  "animated-overlay": 30,
};
const MIN_TRIM_DURATION_SEC = 1;

const defaultTrackNameKeys = {
  video: "timeline.track.video",
  audio: "timeline.track.audio",
  text: "timeline.track.text",
  sticker: "timeline.track.sticker",
  filter: "timeline.track.filter",
  "video-effect": "timeline.track.videoEffect",
  "body-effect": "timeline.track.bodyEffect",
  "animated-overlay": "timeline.track.animatedOverlay",
} as const satisfies Record<TrackType, MessageKey>;

export function getDefaultTrackName(type: TrackType, number: number): string {
  return t(defaultTrackNameKeys[type], { number });
}

/** Where to insert a new row when dropping off-track: video/text at top; audio under first video (or append if no video). */
export function getInsertIndexForNewTrack(tracks: Track[], trackType: TrackType): number {
  if (trackType === "video" || trackType === "text" || trackType === "sticker" || trackType === "filter" || trackType === "video-effect" || trackType === "body-effect") {
    return 0;
  }
  const mainIdx = tracks.findIndex((t) => t.type === "video");
  if (mainIdx >= 0) {
    return mainIdx + 1;
  }
  return tracks.length;
}

/**
 * Find the best insertion index for a new track, grouping effects/filters by their mediaId.
 * For effects and filters, this places new tracks immediately adjacent to existing tracks
 * that use the same effect/filter (same mediaId).
 */
export function getInsertIndexForNewTrackGrouped(tracks: Track[], clips: Clip[], trackType: TrackType, mediaId?: string): number {
  // Only apply grouping logic for effects and filters
  if (!mediaId || (trackType !== "filter" && trackType !== "video-effect" && trackType !== "body-effect" && trackType !== "animated-overlay")) {
    return getInsertIndexForNewTrack(tracks, trackType);
  }

  // Find all tracks of the same type that have clips with the same mediaId
  const siblingTrackIndices: number[] = [];

  tracks.forEach((track, index) => {
    if (track.type === trackType) {
      const hasMatchingClip = clips.some((clip) => clip.trackId === track.id && clip.mediaId === mediaId);
      if (hasMatchingClip) {
        siblingTrackIndices.push(index);
      }
    }
  });

  // If we found sibling tracks with the same effect, insert immediately after the last one
  if (siblingTrackIndices.length > 0) {
    const lastSiblingIndex = Math.max(...siblingTrackIndices);
    return lastSiblingIndex + 1;
  }

  // No siblings found, use default placement
  return getInsertIndexForNewTrack(tracks, trackType);
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
    markers: [],
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
            console.log(`📊 [TIMELINE] ✅ Epoch incremented: ${state.epoch} → ${state.epoch + 1}`);
            return { _batchDepth: 0, _pendingEpochIncrement: false, epoch: state.epoch + 1 };
          }
          return { _batchDepth: newDepth };
        });
      }
    },

    incrementEpoch: () => {
      // console.log("📊 [TIMELINE] incrementEpoch called");
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
      const finalGaps = (payload as any)?.gaps ?? []; // Load gaps from project
      const finalMarkers: TimelineMarker[] = (payload as any)?.markers ?? [];

      // Normalize clip timing with media asset data
      const mediaAssets = useProjectStore.getState().mediaAssets;

      const normalizedClips = finalClipsRaw.map((clip: Clip) => {
        const asset = mediaAssets.find((a) => a.id === clip.mediaId);
        return normalizeClipTiming(clip, asset);
      });

      //  fix: Reset mainVideoTrackId and re-derive from loaded tracks
      const newMainVideoTrackId = finalTracks.find((t) => t.type === "video")?.id ?? null;

      // Atomic state update - all or nothing
      set({
        tracks: finalTracks,
        clips: normalizedClips,
        gaps: finalGaps, // Load gaps from project
        transitions: finalTransitions,
        markers: finalMarkers,
        scrollLeft: 0,
        zoomLevel: TIMELINE_ZOOM_DEFAULT,
        pixelsPerSecond: TIMELINE_ZOOM_DEFAULT * TIMELINE_PPS_PER_ZOOM,
        epoch: 0, // Reset epoch on project load
        mainVideoTrackId: newMainVideoTrackId,
        snapGuides: [],
        rippleEditEnabled: false,
        snapEnabled: true,
        _batchDepth: 0,
        _pendingEpochIncrement: false,
      });

      // If no gaps in project file (legacy), detect them once after state is loaded
      if (finalGaps.length === 0 && normalizedClips.length > 0) {
        // Use requestAnimationFrame instead of setTimeout for better timing
        requestAnimationFrame(() => {
          // Double-check we still have no gaps (race condition protection)
          const currentState = get();
          if (currentState.gaps.length === 0) {
            currentState.detectAndSyncGaps();
          }
        });
      }
    },

    addTrack: (type) => {
      const newTrack: Track = {
        id: generateId("track"),
        type,
        name: getDefaultTrackName(type, getCounter() % 100),
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
        name: getDefaultTrackName(type, getCounter() % 100),
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
      // TL- fix: Also cascade-remove gaps for the deleted track
      set((state) => ({
        tracks: state.tracks.filter((t) => t.id !== trackId),
        clips: state.clips.filter((c) => c.trackId !== trackId),
        transitions: state.transitions.filter((transition) => transition.placement.trackId !== trackId),
        gaps: state.gaps.filter((g) => g.trackId !== trackId),
      }));
    },

    toggleTrackLock: (trackId) => {
      set((state) => ({
        tracks: state.tracks.map((track) => (track.id === trackId ? { ...track, locked: !track.locked } : track)),
      }));
    },

    // HIDDEN-006 fix: toggleTrackMute and toggleTrackVisibility now increment epoch
    // so the evaluation cache is invalidated and the render pipeline sees the change.
    toggleTrackMute: (trackId) => {
      set((state) => {
        const next: Partial<TimelineStore> = {
          tracks: state.tracks.map((track) => (track.id === trackId ? { ...track, muted: !track.muted } : track)),
        };
        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }
        return next;
      });
    },

    toggleTrackVisibility: (trackId) => {
      set((state) => {
        const next: Partial<TimelineStore> = {
          tracks: state.tracks.map((track) => (track.id === trackId ? { ...track, visible: !track.visible } : track)),
        };
        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }
        return next;
      });
    },

    addClip: (clip) => {
      set((state) => {
        // Prevent adding duplicate clips with the same ID
        const existingClip = state.clips.find((c) => c.id === clip.id);
        if (existingClip) {
          return state; // Return unchanged state
        }

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
          // console.log(`🎯 [TIMELINE] First clip added to empty timeline! Current clock time before seek:`, {
          //   clipStartTime: safeClip.startTime,
          //   clipDuration: clip.duration,
          //   clipId: clip.id,
          // });
          // 1) Update UI first so preview panel closes before transport switch
          try {
            useUIStore.getState().exitSourceMode();
          } catch (e) {
            // swallow - defensive in case store is not ready
          }

          // 2) Then switch transport context and seek (dynamic import to avoid heavier cycles)
          import("@/core/runtime/ProjectSession")
            .then(({ getActiveSessionOrNull }) => {
              const session = getActiveSessionOrNull();
              if (session?.transportAuthority) {
                session.transportAuthority.setActiveContext("program");
                // Seek to the new clip's start time for immediate visual feedback
                const firstClipStartTime = safeClip.startTime;
                // console.log(`⏩ [TIMELINE] Seeking playhead to first clip start: ${firstClipStartTime}`);
                session.transportAuthority.seek(firstClipStartTime);
              }
            })
            .catch(() => {});
        }

        // TL- fix: Respect batch epoch gating (consistent with all other mutations)
        const next: Partial<TimelineStore> = {
          clips: [...state.clips, safeClip],
        };
        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }
        return next;
      });

      // Trigger background preload if the added clip has a templateId
      if (clip.templateId) {
        import("@/features/text-templates/templateStore")
          .then(({ useTemplateStore }) => {
            useTemplateStore.getState().preloadTemplatesAndFontsForClips([clip]);
          })
          .catch(() => {});
      }

      // Detect and sync gaps on the affected track after clip addition
      // Use requestAnimationFrame to ensure state update is complete
      requestAnimationFrame(() => {
        get().detectAndSyncGaps(clip.trackId);
      });
    },

    removeClip: (clipId) => {
      const state = get();
      const clipToRemove = state.clips.find((c) => c.id === clipId);
      const removedTrackId = clipToRemove?.trackId;

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
        let gapsToKeep = state.gaps;
        let mainVideoTrackId = state.mainVideoTrackId;
        let removedTrackIdForCleanup: string | null = null;
        if (clipToRemove) {
          const trackId = clipToRemove.trackId;
          const hasOtherClips = remainingClips.some((c) => c.trackId === trackId);

          // If no other clips on this track, remove the track
          if (!hasOtherClips) {
            tracksToKeep = state.tracks.filter((t) => t.id !== trackId);
            // TL- fix: Also cascade-remove gaps for the auto-removed track
            gapsToKeep = state.gaps.filter((g) => g.trackId !== trackId);
            removedTrackIdForCleanup = trackId;
            // TL- fix: Re-derive mainVideoTrackId if the removed track was the main video track
            if (mainVideoTrackId === trackId) {
              mainVideoTrackId = tracksToKeep.find((t) => t.type === "video")?.id ?? null;
            }
          }
        }

        const next: Partial<TimelineStore> = {
          clips: remainingClips,
          tracks: tracksToKeep,
          gaps: gapsToKeep,
          mainVideoTrackId,
          transitions: state.transitions.filter((transition) => transition.fromItemId !== clipId && transition.toItemId !== clipId),
        };
        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }

        // TL- fix: Clear selectedTrackId if the auto-removed track was selected
        if (removedTrackIdForCleanup) {
          try {
            const uiState = useUIStore.getState();
            if (uiState.selectedTrackId === removedTrackIdForCleanup) {
              useUIStore.setState({ selectedTrackId: null });
            }
          } catch {
            // Defensive — UIStore may not be initialized during tests
          }
        }

        return next;
      });

      // Detect and sync gaps on the affected track after clip removal
      // Use requestAnimationFrame to ensure state update is complete
      if (removedTrackId) {
        requestAnimationFrame(() => {
          get().detectAndSyncGaps(removedTrackId);
        });
      }
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

    updateTransition: (transitionId, updates) => {
      set((state) => {
        const next: Partial<TimelineStore> = {
          transitions: state.transitions.map((t) => (t.id === transitionId ? { ...t, ...updates } : t)),
        };
        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }
        return next;
      });
    },

    createTransitionBetweenClips: (fromClipId, toClipId, type, duration = 0.5, renderer) => {
      const state = get();
      const fromClip = state.clips.find((clip) => clip.id === fromClipId);
      const toClip = state.clips.find((clip) => clip.id === toClipId);
      if (!fromClip || !toClip) return { error: t("timeline.error.transition.selectTwoClips") };
      if (fromClip.trackId !== toClip.trackId) return { error: t("timeline.error.transition.sameTrack") };

      const track = state.tracks.find((t) => t.id === fromClip.trackId);
      if (!track) return { error: t("timeline.error.transition.trackNotFound") };
      if (track.locked) return { error: t("timeline.error.transition.trackLocked") };
      if (track.type === "audio") return { error: t("timeline.error.transition.visualTracksOnly") };

      const [left, right] = fromClip.startTime <= toClip.startTime ? [fromClip, toClip] : [toClip, fromClip];
      const leftEnd = left.startTime + left.duration;
      const gap = right.startTime - leftEnd;
      if (gap > 0.001) return { error: t("timeline.error.transition.clipsAdjacent") };
      if (left.duration < duration / 2 || right.duration < duration / 2) return { error: t("timeline.error.transition.clipsTooShort") };

      const transitionStart = Math.max(0, leftEnd - duration / 2);
      const transition: TransitionTimelineItem = {
        id: generateId("transition"),
        kind: "transition",
        type,
        renderer, // Store renderer ID from API transition
        fromItemId: left.id,
        toItemId: right.id,
        alignment: "center",
        easing: "ease-in-out",
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

            const isTextClip = "text" in c;
            if (isTextClip) {
              try {
                const project = useProjectStore.getState().project;
                const canvasWidth = project?.canvasWidth ?? 1920;
                const canvasHeight = project?.canvasHeight ?? 1080;
                return { ...c, ...resolveTextClipStyleUpdate(c as TextClip, updates as Partial<TextClip>, canvasWidth, canvasHeight) };
              } catch (e) {
                return { ...c, ...updates };
              }
            }

            return { ...c, ...updates };
          }),
        };
        // Skip epoch increment during transform preview (high-frequency updates)
        // The final mouseup will commit to history which will increment epoch properly
        const isTransformPreview = "_skipEpochIncrement" in updates && (updates as any)._skipEpochIncrement;

        // EXCEPTION: For text templates, always increment epoch even during transform preview
        // because templates need to re-render at different scales in real-time
        const clip = state.clips.find((c) => c.id === clipId);
        const isTextTemplate = clip && "templateId" in clip && (clip as TextClip).templateId;
        const isResizing = updates.width !== undefined || updates.height !== undefined;

        if (isTransformPreview && !(isTextTemplate && isResizing)) {
          // Don't increment epoch for preview updates (except template resizing)
          return next;
        }
        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }
        return next;
      });

      // Trigger preload if templateId is updated
      if (updates.templateId) {
        import("@/features/text-templates/templateStore")
          .then(({ useTemplateStore }) => {
            useTemplateStore.getState().preloadTemplatesAndFontsForClips([{ templateId: updates.templateId }]);
          })
          .catch(() => {});
      }
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
        return { error: t("timeline.error.swap.selectTwoClips") };
      }

      const state = get();
      const clipA = state.clips.find((c) => c.id === selectedClipIds[0]);
      const clipB = state.clips.find((c) => c.id === selectedClipIds[1]);

      if (!clipA || !clipB) {
        return { error: t("timeline.error.swap.clipsNotFound") };
      }

      // Case: different tracks — simple position + track swap
      if (clipA.trackId !== clipB.trackId) {
        set((state) => {
          // TL- fix: Update transition references when clips swap tracks
          const updatedTransitions = state.transitions.map((t) => {
            let updated = t;
            // If transition references clipA, update its track to clipB's track
            if (t.fromItemId === clipA.id || t.toItemId === clipA.id) {
              updated = { ...updated, placement: { ...updated.placement, trackId: clipB.trackId } };
            }
            // If transition references clipB, update its track to clipA's track
            if (t.fromItemId === clipB.id || t.toItemId === clipB.id) {
              updated = { ...updated, placement: { ...updated.placement, trackId: clipA.trackId } };
            }
            return updated;
          });

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
            transitions: updatedTransitions,
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
        return { error: t("timeline.error.swap.notEnoughSpace") };
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
      // DEPRECATED: Use GapManager.insertGap() for undo/redo support

      const state = get();
      const track = state.tracks.find((t) => t.id === trackId);

      if (!track || track.locked) {
        return null;
      }

      const result = insertGapWithRipple(trackId, startTime, duration, state.clips, state.gaps, "user-insert");

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
      // DEPRECATED: Use GapManager.removeGap() for undo/redo support

      const state = get();
      const gap = state.gaps.find((g) => g.id === gapId);

      if (!gap) return;

      const track = state.tracks.find((t) => t.id === gap.trackId);
      if (track?.locked) return;

      const result = removeGapWithRipple(gap, state.clips, state.gaps);

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
      // DEPRECATED: Use GapManager.resizeGap() for undo/redo support

      const state = get();
      const gap = state.gaps.find((g) => g.id === gapId);

      if (!gap) return;

      const track = state.tracks.find((t) => t.id === gap.trackId);
      if (track?.locked) return;

      const result = resizeGap(gap, newDuration, state.clips, state.gaps);

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
      // DEPRECATED: Use GapManager.toggleProtection() for undo/redo support

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

      // Start with gaps from tracks we're NOT processing (keep them as-is)
      const trackIdsToProcess = new Set(tracksToProcess.map((t) => t.id));
      let newGaps: Gap[] = state.gaps.filter((g) => !trackIdsToProcess.has(g.trackId));

      for (const track of tracksToProcess) {
        const trackClips = state.clips.filter((c) => c.trackId === track.id);

        // COMPLETE REDETECTION: Detect all gaps fresh (don't preserve existing)
        // This ensures gaps always have the correct duration after clip moves
        const detectedGaps = detectGaps(trackClips, []);

        // Preserve protected gaps (match by position and update duration)
        const existingProtectedGaps = state.gaps.filter((g) => g.trackId === track.id && g.protected);

        // For each protected gap, check if it still exists and update its duration
        const validProtectedGaps: Gap[] = [];
        for (const protectedGap of existingProtectedGaps) {
          // Check if there's a detected gap that overlaps with this protected gap
          // This ensures the protected gap is preserved (with its ID/protection)
          // even if it was truncated/shifted (e.g. from the left)
          const matchingGap = detectedGaps.find((detected) => {
            const detectedEnd = detected.startTime + detected.duration;
            const protectedEnd = protectedGap.startTime + protectedGap.duration;
            const overlapStart = Math.max(detected.startTime, protectedGap.startTime);
            const overlapEnd = Math.min(detectedEnd, protectedEnd);
            return overlapStart < overlapEnd - 0.001; // Overlaps by at least 1ms
          });

          if (matchingGap) {
            // Gap still exists - update duration and mark as protected
            validProtectedGaps.push({
              ...matchingGap,
              id: protectedGap.id,
              protected: true,
              type: protectedGap.type,
              metadata: protectedGap.metadata,
            });

            // Remove from detectedGaps so we don't duplicate it
            const index = detectedGaps.indexOf(matchingGap);
            if (index > -1) {
              detectedGaps.splice(index, 1);
            }
          }
          // If no matching gap, the protected gap was filled by a clip (don't preserve)
        }

        // Combine valid protected gaps with new detected gaps
        newGaps = [...newGaps, ...validProtectedGaps, ...detectedGaps];
      }

      // Merge adjacent auto-detected gaps to reduce visual clutter
      const mergedGaps = mergeAdjacentGaps(newGaps);

      // Local helper to check if two gaps arrays are equal to avoid unnecessary updates/re-renders
      const areGapsEqual = (a: Gap[], b: Gap[]): boolean => {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
          const ga = a[i];
          const gb = b[i];
          if (ga.id !== gb.id || ga.trackId !== gb.trackId || Math.abs(ga.startTime - gb.startTime) > 0.001 || Math.abs(ga.duration - gb.duration) > 0.001 || ga.type !== gb.type || ga.source !== gb.source || ga.protected !== gb.protected) {
            return false;
          }
        }
        return true;
      };

      if (!areGapsEqual(state.gaps, mergedGaps)) {
        set({ gaps: mergedGaps });
      }
    },

    packTrackGaps: (trackId) => {
      // DEPRECATED: Use GapManager.packTrack() for undo/redo support

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

    // ─── Marker actions ──────────────────────────────────────────────────────

    addMarker: (time, name = "Marker", color = "purple") => {
      const id = generateId("marker");
      const marker: TimelineMarker = { id, time, name, color };
      set((state) => ({
        markers: [...state.markers, marker].sort((a, b) => a.time - b.time),
        epoch: state.epoch + 1,
      }));
      return id;
    },

    removeMarker: (markerId) => {
      set((state) => ({
        markers: state.markers.filter((m) => m.id !== markerId),
        epoch: state.epoch + 1,
      }));
    },

    updateMarker: (markerId, updates) => {
      set((state) => ({
        markers: state.markers
          .map((m) => (m.id === markerId ? { ...m, ...updates } : m))
          .sort((a, b) => a.time - b.time),
        epoch: state.epoch + 1,
      }));
    },
  })),
);
