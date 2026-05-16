/**
 * UI Store
 *
 * OWNERSHIP: Ephemeral UI interaction state
 * PERSISTENCE: Non-persistent (reset on project switch)
 * MUTABILITY: Mutable (user interactions)
 *
 * Responsibilities:
 * - Track current selections (clips, tracks)
 * - Manage preview mode (program vs source)
 * - Handle source mode state (in/out points)
 * - UI-only state that doesn't affect render output
 *
 * Does NOT:
 * - Persist to disk (intentionally ephemeral)
 * - Own timeline data (timelineStore owns that)
 * - Manage runtime resources (ProjectSession handles that)
 *
 * Architecture principle:
 * This is session-scoped interaction state. It's reset by ProjectSession
 * on project switch because selections don't carry across projects.
 *
 * Future consideration:
 * Some "UI" state may become workspace state (layouts, bookmarks, etc.)
 * and should migrate to a separate persistentWorkspaceStore.
 */

import { create } from "zustand";
import type { MediaAsset, TransformState } from "@/types";

interface UIStore {
  selectedClipIds: string[]; // Multi-select support
  selectedTrackId: string | null;
  // Note: previewMediaId is used for MediaPanel selection state only.
  previewMediaId: string | null;
  activePanel: "media" | "properties";
  showExportModal: boolean;
  showNewProjectModal: boolean;
  showSettingsModal: boolean;

  // Preview mode state
  previewMode: "program" | "source";
  sourceAsset: MediaAsset | null;
  sourceInPoint: number | null;
  sourceOutPoint: number | null;

  // Transform tool state
  activeTransform: TransformState | null;
  transformMode: "select" | "transform" | null;

  selectClip: (clipId: string | null) => void;
  toggleClipSelection: (clipId: string) => void;
  clearSelection: () => void;
  selectTrack: (trackId: string | null) => void;
  setPreviewMedia: (mediaId: string | null) => void;
  setActivePanel: (panel: "media" | "properties") => void;
  toggleExportModal: () => void;
  toggleNewProjectModal: () => void;
  toggleSettingsModal: () => void;

  // Preview mode actions
  previewAsset: (asset: MediaAsset) => void;
  exitSourceMode: () => void;
  markSourceIn: (time: number | null) => void;
  markSourceOut: (time: number | null) => void;

  // Transform tool actions
  startTransform: (state: TransformState) => void;
  updateTransform: (state: TransformState) => void;
  endTransform: () => void;
  setTransformMode: (mode: "select" | "transform" | null) => void;
}

export const useUIStore = create<UIStore>((set, get) => ({
  selectedClipIds: [],
  selectedTrackId: null,
  previewMediaId: null,
  activePanel: "media",
  showExportModal: false,
  showNewProjectModal: false,
  showSettingsModal: false,

  // Preview mode state
  previewMode: "program",
  sourceAsset: null,
  sourceInPoint: null,
  sourceOutPoint: null,

  // Transform tool state
  activeTransform: null,
  transformMode: null,

  selectClip: (clipId) => {
    set({ selectedClipIds: clipId ? [clipId] : [] });
  },

  toggleClipSelection: (clipId) => {
    set((state) => {
      const already = state.selectedClipIds.includes(clipId);
      return {
        selectedClipIds: already ? state.selectedClipIds.filter((id) => id !== clipId) : [...state.selectedClipIds, clipId],
      };
    });
  },

  clearSelection: () => {
    set({ selectedClipIds: [] });
  },

  selectTrack: (trackId) => {
    set({ selectedTrackId: trackId });
  },

  setPreviewMedia: (mediaId) => {
    set({ previewMediaId: mediaId });
  },

  setActivePanel: (panel) => {
    set({ activePanel: panel });
  },

  toggleExportModal: () => {
    set((state) => ({
      showExportModal: !state.showExportModal,
    }));
  },

  toggleNewProjectModal: () => {
    set((state) => ({
      showNewProjectModal: !state.showNewProjectModal,
    }));
  },

  toggleSettingsModal: () => {
    set((state) => ({
      showSettingsModal: !state.showSettingsModal,
    }));
  },

  // Preview mode actions
  // NOTE: Transport context switching (program ↔ source) is handled
  // by the consuming component via session.transportAuthority.setActiveContext().
  // This store only manages UI state (which panel is shown, in/out points).
  previewAsset: (asset) => {
    set({
      previewMode: "source",
      sourceAsset: asset,
      sourceInPoint: null,
      sourceOutPoint: null,
      previewMediaId: asset.id,
    });
  },

  exitSourceMode: () => {
    set({
      previewMode: "program",
      sourceAsset: null,
      sourceInPoint: null,
      sourceOutPoint: null,
      previewMediaId: null,
    });
  },

  markSourceIn: (time) => {
    set({ sourceInPoint: time });
  },

  markSourceOut: (time) => {
    set({ sourceOutPoint: time });
  },

  // Transform tool actions
  startTransform: (state) => {
    set({ activeTransform: state, transformMode: "transform" });
  },

  updateTransform: (state) => {
    set({ activeTransform: state });
  },

  endTransform: () => {
    set({ activeTransform: null, transformMode: "select" });
  },

  setTransformMode: (mode) => {
    set({ transformMode: mode });
  },
}));
