import { create } from "zustand";
import type { Project, MediaAsset } from "../types";

interface ProjectStore {
  project: Project | null;
  mediaAssets: MediaAsset[];
  recentProjects: Project[];
  createProject: (name: string, aspectRatio: string, frameRate: 24 | 30 | 60) => void;
  loadProject: (project: Project) => void;
  addMediaAsset: (asset: MediaAsset) => void;
  removeMediaAsset: (assetId: string) => void;
  updateProject: (updates: Partial<Project>) => void;
  setRecentProjects: (projects: Project[]) => void;
  closeProject: () => void;
  scheduleAutoSave: () => void;
}

const getAspectRatioDimensions = (ratio: string): { width: number; height: number } => {
  const map: Record<string, { width: number; height: number }> = {
    "16:9": { width: 1920, height: 1080 },
    "9:16": { width: 1080, height: 1920 },
    "1:1": { width: 1080, height: 1080 },
    "4:3": { width: 1440, height: 1080 },
    "21:9": { width: 2520, height: 1080 },
  };
  return map[ratio] || map["16:9"];
};

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
const AUTO_SAVE_DELAY = 500; // ms

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  mediaAssets: [],
  recentProjects: [],

  createProject: (name, aspectRatio, frameRate) => {
    const dims = getAspectRatioDimensions(aspectRatio);
    const project: Project = {
      id: `project-${Date.now()}`,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      aspectRatio: aspectRatio as any,
      canvasWidth: dims.width,
      canvasHeight: dims.height,
      frameRate,
      duration: 0,
    };
    set({ project, mediaAssets: [] });
    get().scheduleAutoSave();
  },

  loadProject: (project) => {
    set({ project });
  },

  addMediaAsset: (asset) => {
    set((state) => ({
      mediaAssets: [...state.mediaAssets, asset],
    }));
    get().scheduleAutoSave();
  },

  removeMediaAsset: (assetId) => {
    set((state) => ({
      mediaAssets: state.mediaAssets.filter((a) => a.id !== assetId),
    }));
    get().scheduleAutoSave();
  },

  updateProject: (updates) => {
    set((state) => ({
      project: state.project ? { ...state.project, ...updates, updatedAt: Date.now() } : null,
    }));
    get().scheduleAutoSave();
  },

  setRecentProjects: (projects) => {
    set({ recentProjects: projects });
  },

  closeProject: () => {
    // Ensure any pending auto-save completes before closing
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      // Trigger immediate save
      const state = get();
      const { project, mediaAssets } = state;

      if (project) {
        (async () => {
          try {
            const { useTimelineStore } = await import("./timelineStore");
            const { tracks, clips } = useTimelineStore.getState();

            const projectData = {
              ...project,
              updatedAt: Date.now(),
              tracks,
              clips,
              mediaAssets,
            };

            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("save_project", {
              projectData: JSON.stringify(projectData),
            });

            console.log("[CloseProject] Final save completed:", project.name);
          } catch (error) {
            console.error("[CloseProject] Failed to save project:", error);
          }
        })();
      }
    }

    set({ project: null, mediaAssets: [] });
  },

  scheduleAutoSave: () => {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }

    autoSaveTimer = setTimeout(async () => {
      const state = get();
      const { project, mediaAssets } = state;

      if (!project) return;

      try {
        // Import timeline store to get tracks and clips
        const { useTimelineStore } = await import("./timelineStore");
        const { tracks, clips } = useTimelineStore.getState();

        const projectData = {
          ...project,
          updatedAt: Date.now(),
          tracks,
          clips,
          mediaAssets,
        };

        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("save_project", {
          projectData: JSON.stringify(projectData),
        });

        console.log("[AutoSave] Project saved:", project.name);
      } catch (error) {
        console.error("[AutoSave] Failed to save project:", error);
      }
    }, AUTO_SAVE_DELAY);
  },
}));
