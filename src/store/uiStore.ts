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
 * - Manage transform state (TransformController handles that)
 * - Manage viewport state (ViewportController handles that)
 *
 * Architecture principle:
 * This is session-scoped interaction state. It's reset by ProjectSession
 * on project switch because selections don't carry across projects.
 *
 * High-frequency interactions (>4Hz) are managed by imperative controllers:
 * - Transform drag → TransformController
 * - Viewport zoom/pan → ViewportController
 *
 * This store only contains user action state (<4Hz).
 *
 * Future consideration:
 * Some "UI" state may become workspace state (layouts, bookmarks, etc.)
 * and should migrate to a separate persistentWorkspaceStore.
 */

import { create } from "zustand";
import type { MediaAsset } from "@/types";

interface UIStore {
  selectedClipIds: string[]; // Multi-select support
  selectedGapId: string | null; // Gap selection (exclusive with clip selection)
  selectedTransitionId: string | null; // Selected transition
  selectedTrackId: string | null;
  // Note: previewMediaId is used for MediaPanel selection state only.
  previewMediaId: string | null;
  activePanel: "media" | "properties";
  showExportModal: boolean;
  showNewProjectModal: boolean;
  showSettingsModal: boolean;
  settingsInitialTab:
    | "appearance"
    | "editor"
    | "shortcuts"
    | "captions"
    | "cache"
    | "about"
    | null;

  previewMode: "program" | "source";
  sourceAsset:
    | (Omit<MediaAsset, "type"> & {
        type: "video" | "audio" | "image" | "text";
      })
    | null;
  sourceTextPreset: any | null;
  sourceInPoint: number | null;
  sourceOutPoint: number | null;

  selectClip: (clipId: string | null) => void;
  toggleClipSelection: (clipId: string) => void;
  selectGap: (gapId: string | null) => void;
  selectTransition: (transitionId: string | null) => void;
  clearSelection: () => void;
  selectTrack: (trackId: string | null) => void;
  setPreviewMedia: (mediaId: string | null) => void;
  setActivePanel: (panel: "media" | "properties") => void;
  toggleExportModal: () => void;
  toggleNewProjectModal: () => void;
  toggleSettingsModal: () => void;
  openSettingsModal: (
    tab?:
      | "appearance"
      | "editor"
      | "shortcuts"
      | "captions"
      | "cache"
      | "about",
  ) => void;

  // Preview mode actions
  previewAsset: (asset: MediaAsset) => void;
  previewTextPreset: (preset: any, type: "effect" | "template") => void;
  exitSourceMode: () => void;
  markSourceIn: (time: number | null) => void;
  markSourceOut: (time: number | null) => void;
}

// const PREVIEW_ZOOM_MIN = 0.1;
// const PREVIEW_ZOOM_MAX = 5.0;
// const PREVIEW_ZOOM_SNAP_EPSILON = 0.005; // tight band so wheel remains responsive

export const useUIStore = create<UIStore>((set, get) => ({
  selectedClipIds: [],
  selectedGapId: null,
  selectedTransitionId: null,
  selectedTrackId: null,
  previewMediaId: null,
  activePanel: "media",
  showExportModal: false,
  showNewProjectModal: false,
  showSettingsModal: false,
  settingsInitialTab: null,

  previewMode: "program",
  sourceAsset: null,
  sourceTextPreset: null,
  sourceInPoint: null,
  sourceOutPoint: null,

  selectClip: (clipId) => {
    set({
      selectedClipIds: clipId ? [clipId] : [],
      selectedGapId: null, // Clear gap selection when selecting clip
      selectedTransitionId: null, // Clear transition selection when selecting clip
    });
  },

  selectGap: (gapId) => {
    set({
      selectedGapId: gapId,
      selectedClipIds: [], // Clear clip selection when selecting gap
      selectedTransitionId: null, // Clear transition selection when selecting gap
    });
  },

  selectTransition: (transitionId) => {
    set({
      selectedTransitionId: transitionId,
      selectedClipIds: [],
      selectedGapId: null,
    });
  },

  toggleClipSelection: (clipId) => {
    set((state) => {
      const already = state.selectedClipIds.includes(clipId);
      return {
        selectedClipIds: already
          ? state.selectedClipIds.filter((id) => id !== clipId)
          : [...state.selectedClipIds, clipId],
        selectedTransitionId: null,
        selectedGapId: null, // TL-07 fix: Clear gap selection when toggling clip selection
      };
    });
  },

  clearSelection: () => {
    set({
      selectedClipIds: [],
      selectedGapId: null,
      selectedTransitionId: null,
    });
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
      settingsInitialTab: null,
    }));
  },

  openSettingsModal: (tab) => {
    set({
      showSettingsModal: true,
      settingsInitialTab: tab || null,
    });
  },

  // Preview mode actions
  // NOTE: Transport context switching (program ↔ source) is handled
  // by the consuming component via session.transportAuthority.setActiveContext().
  // This store only manages UI state (which panel is shown, in/out points).
  previewAsset: (asset) => {
    set({
      previewMode: "source",
      sourceAsset: asset as any,
      sourceInPoint: null,
      sourceOutPoint: null,
      previewMediaId: asset.id,
    });
  },

  previewTextPreset: (preset, type) => {
    set({
      previewMode: "source",
      sourceAsset: {
        id: preset.id,
        name: preset.name || preset.defaultText || "Text",
        type: "text",
        path: "",
        duration: 3.0,
        size: 0,
      } as any,
      sourceTextPreset: { ...preset, presetType: type },
      sourceInPoint: null,
      sourceOutPoint: null,
      previewMediaId: preset.id,
    });
  },

  exitSourceMode: () => {
    set({
      previewMode: "program",
      sourceAsset: null,
      sourceTextPreset: null,
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
}));
