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
  deleteProject: (projectId: string) => Promise<void>;
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

    // Clear timeline state for new project
    import("./timelineStore").then(({ useTimelineStore }) => {
      useTimelineStore.setState({ tracks: [], clips: [] });
    });

    get().scheduleAutoSave();
  },

  loadProject: (project) => {
    // Clear existing state first
    set({ project, mediaAssets: [] });

    // Clear timeline state
    import("./timelineStore").then(({ useTimelineStore }) => {
      useTimelineStore.setState({ tracks: [], clips: [] });
    });
  },

  addMediaAsset: (asset) => {
    set((state) => ({
      mediaAssets: [...state.mediaAssets, asset],
    }));
    get().scheduleAutoSave();

    // Trigger background thumbnail pre-extraction for video assets.
    // The Low → Medium → High density cascade is handled entirely in Rust
    // (preload_video_thumbnails queues each level after the previous completes).
    if (asset.type === "video" && asset.path && asset.duration) {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        import("../lib/tauri").then(({ normalizePathForTauriInvoke }) => {
          const videoPath = normalizePathForTauriInvoke(asset.path);
          // Fire-and-forget: do not await, errors must not block the import
          invoke("preload_video_thumbnails", { videoPath, duration: asset.duration }).catch((err) => {
            console.error("[addMediaAsset] preload_video_thumbnails failed:", err);
          });
        });
      });
    }
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

  deleteProject: async (projectId) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("delete_project", { projectId });

      // Remove from recent projects list
      set((state) => ({
        recentProjects: state.recentProjects.filter((p) => p.id !== projectId),
      }));

      // If the deleted project is currently open, close it
      const currentProject = get().project;
      if (currentProject && currentProject.id === projectId) {
        set({ project: null, mediaAssets: [] });
      }

      console.log("[DeleteProject] Project deleted:", projectId);
    } catch (error) {
      console.error("[DeleteProject] Failed to delete project:", error);
      throw error;
    }
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

            // Convert camelCase to snake_case for Rust backend
            const projectData = {
              id: project.id,
              name: project.name,
              created_at: project.createdAt,
              modified_at: Date.now(),
              aspect_ratio: project.aspectRatio,
              canvas_width: project.canvasWidth,
              canvas_height: project.canvasHeight,
              frame_rate: project.frameRate,
              duration: project.duration,
              tracks,
              clips,
              media_assets: mediaAssets,
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

        // Convert camelCase to snake_case for Rust backend
        const projectData = {
          id: project.id,
          name: project.name,
          created_at: project.createdAt,
          modified_at: Date.now(),
          aspect_ratio: project.aspectRatio,
          canvas_width: project.canvasWidth,
          canvas_height: project.canvasHeight,
          frame_rate: project.frameRate,
          duration: project.duration,
          tracks,
          clips,
          media_assets: mediaAssets,
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
