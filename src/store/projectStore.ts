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

export const useProjectStore = create<ProjectStore>((set) => ({
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
  },

  loadProject: (project) => {
    set({ project });
  },

  addMediaAsset: (asset) => {
    set((state) => ({
      mediaAssets: [...state.mediaAssets, asset],
    }));
  },

  removeMediaAsset: (assetId) => {
    set((state) => ({
      mediaAssets: state.mediaAssets.filter((a) => a.id !== assetId),
    }));
  },

  updateProject: (updates) => {
    set((state) => ({
      project: state.project ? { ...state.project, ...updates, updatedAt: Date.now() } : null,
    }));
  },

  setRecentProjects: (projects) => {
    set({ recentProjects: projects });
  },

  closeProject: () => {
    set({ project: null, mediaAssets: [] });
  },
}));
