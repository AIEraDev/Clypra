import { create } from "zustand";

interface UIStore {
  selectedClipId: string | null;
  selectedTrackId: string | null;
  // Note: previewMediaId is used for MediaPanel selection state only.
  // Preview rendering is now timeline-driven (see PreviewPanel + previewScene.ts)
  previewMediaId: string | null;
  activePanel: "media" | "properties";
  showExportModal: boolean;
  showNewProjectModal: boolean;
  showSettingsModal: boolean;
  selectClip: (clipId: string | null) => void;
  selectTrack: (trackId: string | null) => void;
  setPreviewMedia: (mediaId: string | null) => void;
  setActivePanel: (panel: "media" | "properties") => void;
  toggleExportModal: () => void;
  toggleNewProjectModal: () => void;
  toggleSettingsModal: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  selectedClipId: null,
  selectedTrackId: null,
  previewMediaId: null,
  activePanel: "media",
  showExportModal: false,
  showNewProjectModal: false,
  showSettingsModal: false,

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
}));
