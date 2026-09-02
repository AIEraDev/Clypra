/**
 * Timeline Draft State Store — Clypra Ephemeral Interaction Layer
 *
 * Provides an isolated, non-persistent state layer for active drag, trim,
 * and slip gestures. Decouples 60/120 FPS cursor tracking and snapping
 * lines from persistent timeline mutations, preventing redundant auto-saves
 * and timeline epoch increments during active user interaction.
 */

import { create } from "zustand";

export type TimelineGestureType = "move" | "trim-start" | "trim-end" | "slip" | "slide";

export interface DraftClipDescriptor {
  id: string;
  trackId: string;
  startTime: number;
  duration: number;
  trimIn?: number;
  trimOut?: number;
}

export interface SnapGuideDescriptor {
  time: number;
  type: "timeline-start" | "clip-start" | "clip-end" | "playhead";
  trackId?: string;
}

export interface InsertionTargetDescriptor {
  trackId: string | null;
  time: number | null;
}

export interface CommittedGestureResult {
  gesture: TimelineGestureType;
  clips: DraftClipDescriptor[];
}

interface TimelineDraftState {
  // ── Gesture State ────────────────────────────────────────────────
  activeGesture: TimelineGestureType | null;
  isDrafting: boolean;

  // ── Draft Geometry ───────────────────────────────────────────────
  draftClips: Record<string, DraftClipDescriptor>;
  originalClips: Record<string, DraftClipDescriptor>;
  insertionTarget: InsertionTargetDescriptor | null;
  snapGuides: SnapGuideDescriptor[];

  // ── Actions ──────────────────────────────────────────────────────
  startGesture: (
    gesture: TimelineGestureType,
    clips: DraftClipDescriptor[],
  ) => void;

  updateDraft: (
    draftClips: DraftClipDescriptor[],
    insertionTarget?: InsertionTargetDescriptor | null,
    snapGuides?: SnapGuideDescriptor[],
  ) => void;

  commitGesture: () => CommittedGestureResult | null;
  cancelGesture: () => void;
}

export const useTimelineDraftStore = create<TimelineDraftState>((set, get) => ({
  activeGesture: null,
  isDrafting: false,
  draftClips: {},
  originalClips: {},
  insertionTarget: null,
  snapGuides: [],

  startGesture: (gesture, clips) => {
    const clipMap: Record<string, DraftClipDescriptor> = {};
    for (const clip of clips) {
      clipMap[clip.id] = { ...clip };
    }
    set({
      activeGesture: gesture,
      isDrafting: true,
      draftClips: clipMap,
      originalClips: clipMap,
      insertionTarget: null,
      snapGuides: [],
    });
  },

  updateDraft: (draftClips, insertionTarget, snapGuides) => {
    set((state) => {
      if (!state.isDrafting) return state;
      const nextDraftMap = { ...state.draftClips };
      for (const clip of draftClips) {
        nextDraftMap[clip.id] = { ...clip };
      }
      return {
        draftClips: nextDraftMap,
        insertionTarget: insertionTarget !== undefined ? insertionTarget : state.insertionTarget,
        snapGuides: snapGuides !== undefined ? snapGuides : state.snapGuides,
      };
    });
  },

  commitGesture: () => {
    const state = get();
    if (!state.isDrafting || !state.activeGesture) return null;

    const result: CommittedGestureResult = {
      gesture: state.activeGesture,
      clips: Object.values(state.draftClips),
    };

    set({
      activeGesture: null,
      isDrafting: false,
      draftClips: {},
      originalClips: {},
      insertionTarget: null,
      snapGuides: [],
    });

    return result;
  },

  cancelGesture: () => {
    set({
      activeGesture: null,
      isDrafting: false,
      draftClips: {},
      originalClips: {},
      insertionTarget: null,
      snapGuides: [],
    });
  },
}));
