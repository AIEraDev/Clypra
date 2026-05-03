import { create } from "zustand";
import type { MediaAsset } from "../types";
import { usePlaybackStore } from "./playbackStore";

interface UIStore {
  selectedClipId: string | null;
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

  selectClip: (clipId: string | null) => void;
  selectTrack: (trackId: string | null) => void;
  setPreviewMedia: (mediaId: string | null) => void;
  setActivePanel: (panel: "media" | "properties") => void;
  toggleExportModal: () => void;
  toggleNewProjectModal: () => void;
  toggleSettingsModal: () => void;

  // Preview mode actions
  previewAsset: (asset: MediaAsset) => void;
  exitSourceMode: () => void;
  markSourceIn: (time: number) => void;
  markSourceOut: (time: number) => void;
}

export const useUIStore = create<UIStore>((set, get) => ({
  selectedClipId: null,
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

  selectClip: (clipId) => {
    set({ selectedClipId: clipId });
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
  previewAsset: (asset) => {
    // Get playback store state
    const { isPlaying, pause } = usePlaybackStore.getState();

    // Pause timeline if playing before switching to source mode
    if (isPlaying) {
      pause();
    }

    set({
      previewMode: "source",
      sourceAsset: asset,
      sourceInPoint: null,
      sourceOutPoint: null,
      previewMediaId: asset.id, // Keep selection in sync
    });
  },

  exitSourceMode: () => {
    set({
      previewMode: "program",
      sourceAsset: null,
      sourceInPoint: null,
      sourceOutPoint: null,
    });
  },

  markSourceIn: (time) => {
    set({ sourceInPoint: time });
  },

  markSourceOut: (time) => {
    set({ sourceOutPoint: time });
  },
}));
