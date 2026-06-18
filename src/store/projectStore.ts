/**
 * Project Store
 *
 * OWNERSHIP: Project persistence orchestration (facade, not domain owner)
 * PERSISTENCE: Persistent (saves to disk via Tauri)
 * MUTABILITY: Orchestrates mutations, doesn't own mutable state
 *
 * Responsibilities:
 * - Load project metadata from disk
 * - Save project metadata to disk
 * - Manage media assets list
 * - Trigger auto-save on changes
 * - Coordinate project lifecycle (create/open/close)
 *
 * Does NOT:
 * - Own live timeline state (timelineStore is source of truth)
 * - Mutate timeline directly (delegates to timelineStore.hydrateFromProject)
 * - Manage runtime resources (ProjectSession handles that)
 *
 * Architecture principle:
 * This is a persistence facade. It reads timelineStore for save,
 * and delegates to timelineStore.hydrateFromProject() for load.
 * It NEVER directly mutates timeline state via setState().
 */

import { create } from "zustand";
import type { Project, MediaAsset, TransitionTimelineItem } from "@/types";
import { MAX_PROJECT_NAME_LENGTH } from "@/types";
import { toRustProject } from "@/types/serialization";
import { generateId } from "@/lib/utils/id";
import { convertRawConfigToDefinition } from "@/features/text-effects/lib/definitionConversion";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";
import { calculateTextClipSize } from "@/lib/text/textClip";
import { useSettingsStore } from "./settingsStore";
// import { TIMELINE_PPS_PER_ZOOM, TIMELINE_ZOOM_DEFAULT } from "@/lib/timelineZoom";

interface ProjectStore {
  project: Project | null;
  mediaAssets: MediaAsset[];
  recentProjects: Project[];
  toastMessage: string | null;
  toastVariant: "success" | "error" | "warning";
  setToastMessage: (message: string | null, variant?: "success" | "error" | "warning") => void;
  /** Convenience: show toast with variant and auto-dismiss. */
  showToast: (message: string, variant?: "success" | "error" | "warning", durationMs?: number) => void;
  createProject: (name: string, aspectRatio: string, frameRate: 24 | 30 | 60) => void;
  loadProject: (project: Project, payload?: { tracks?: any[]; clips?: any[]; transitions?: TransitionTimelineItem[]; mediaAssets?: MediaAsset[] }) => Promise<void> | void;
  addMediaAsset: (asset: MediaAsset) => void;
  removeMediaAsset: (assetId: string) => void;
  updateProject: (updates: Partial<Project>) => void;
  setRecentProjects: (projects: Project[]) => void;
  renameProject: (projectId: string, newName: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  closeProject: () => Promise<void> | void;
  scheduleAutoSave: () => void;
}

const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

const countGraphemes = (str: string): number => {
  return Array.from(graphemeSegmenter.segment(str)).length;
};

const truncateGraphemes = (str: string, max: number): string => {
  const segments = Array.from(graphemeSegmenter.segment(str));
  return segments
    .slice(0, max)
    .map((s) => s.segment)
    .join("");
};

const sanitizeProjectName = (name: string): string => {
  const trimmed = name.trim();
  if (countGraphemes(trimmed) === 0) return "Untitled Project";
  if (countGraphemes(trimmed) > MAX_PROJECT_NAME_LENGTH) {
    return truncateGraphemes(trimmed, MAX_PROJECT_NAME_LENGTH);
  }
  return trimmed;
};

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

async function preloadTextEffectDefinitionsFromClips(clips: any[] | undefined): Promise<void> {
  if (!clips?.length) return;

  const styleIds = Array.from(new Set(clips.map((clip) => clip?.styleId).filter((id): id is string => typeof id === "string" && id.length > 0)));
  const embeddedDefinitions = clips.map((clip) => clip?.styleDefinition ?? clip?.style_definition).filter((definition) => definition && typeof definition.id === "string");

  if (styleIds.length === 0 && embeddedDefinitions.length === 0) return;

  try {
    const { useEffectsStore } = await import("@/features/text-effects/store/effectsStore");

    if (embeddedDefinitions.length > 0) {
      useEffectsStore.setState((state) => {
        const definitions = { ...state.definitions };
        for (const definition of embeddedDefinitions) {
          definitions[definition.id] = convertRawConfigToDefinition(definition);
        }
        return { definitions };
      });
    }

    const store = useEffectsStore.getState();
    const missingStyleIds = styleIds.filter((id) => !useEffectsStore.getState().definitions[id]);
    if (missingStyleIds.length === 0) return;

    const results = await Promise.allSettled(missingStyleIds.map((id) => store.fetchDefinitionOnlyById(id)));
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.warn(`[LoadProject] Failed to preload text effect definition ${missingStyleIds[index]}:`, result.reason);
      }
    });
  } catch (err) {
    console.warn("[LoadProject] Text effect definition preload failed:", err);
  }
}

function normalizeLoadedTextEffectClipBounds(clips: any[] | undefined, project: Project): any[] {
  if (!clips?.length) return clips ?? [];

  try {
    const definitions = useEffectsStore.getState().definitions;

    return clips.map((clip) => {
      if (clip?.kind !== "text" || !clip.styleId) return clip;

      const effectDefinition = definitions[clip.styleId] ?? clip.styleDefinition;
      if (!effectDefinition) return clip;

      const nativeDefinition = effectDefinition as any;
      const nativeWidth = nativeDefinition.canvasWidth ?? nativeDefinition.width;
      const nativeHeight = nativeDefinition.canvasHeight ?? nativeDefinition.height;
      const nativeFontSize = nativeDefinition.fontSize;
      if (!nativeWidth || !nativeHeight || !nativeFontSize || !clip.fontSize) return clip;

      const nativeScale = clip.fontSize / nativeFontSize;
      const oldNativeWidth = nativeWidth * nativeScale;
      const oldNativeHeight = nativeHeight * nativeScale;
      const widthMatchesOldNative = Math.abs((clip.width ?? 0) - oldNativeWidth) <= Math.max(2, oldNativeWidth * 0.02);
      const heightMatchesOldNative = Math.abs((clip.height ?? 0) - oldNativeHeight) <= Math.max(2, oldNativeHeight * 0.02);
      if (!widthMatchesOldNative && !heightMatchesOldNative) return clip;

      const sizing = calculateTextClipSize({
        text: clip.text ?? "Text",
        fontFamily: clip.fontFamily ?? effectDefinition.font?.family ?? "Inter, system-ui, sans-serif",
        fontSize: clip.fontSize,
        fontWeight: clip.fontWeight ?? effectDefinition.font?.weight,
        letterSpacing: clip.letterSpacing ?? effectDefinition.font?.letterSpacing,
        lineHeight: clip.lineHeight ?? effectDefinition.font?.lineHeight,
        styleId: clip.styleId,
        effectDefinition,
        stroke: clip.stroke,
        shadow: clip.shadow,
        background: clip.background,
        canvasWidth: project.canvasWidth,
      });

      const centerX = (clip.x ?? 0) + (clip.width ?? sizing.width) / 2;
      const centerY = (clip.y ?? 0) + (clip.height ?? sizing.height) / 2;
      return {
        ...clip,
        x: centerX - sizing.width / 2,
        y: centerY - sizing.height / 2,
        width: sizing.width,
        height: sizing.height,
      };
    });
  } catch {
    return clips;
  }
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  mediaAssets: [],
  recentProjects: [],
  toastMessage: null,
  toastVariant: "success" as const,

  setToastMessage: (message, variant) => set({ toastMessage: message, ...(variant ? { toastVariant: variant } : {}) }),

  showToast: (message, variant = "success", durationMs = 3000) => {
    set({ toastMessage: message, toastVariant: variant });
    if (durationMs > 0) {
      setTimeout(() => set({ toastMessage: null }), durationMs);
    }
  },

  createProject: async (name, aspectRatio, frameRate) => {
    const sanitizedName = sanitizeProjectName(name);
    const dims = getAspectRatioDimensions(aspectRatio);
    const project: Project = {
      id: generateId("project"),
      name: sanitizedName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      aspectRatio: aspectRatio as any,
      canvasWidth: dims.width,
      canvasHeight: dims.height,
      frameRate,
      duration: 0,
      timelineSchemaVersion: 1,
    };
    set({ project, mediaAssets: [] });

    // Let timelineStore reset its own state
    try {
      const { useTimelineStore } = await import("./timelineStore");
      useTimelineStore.getState().hydrateFromProject({ tracks: [], clips: [], transitions: [] });
    } catch (err) {
      console.error("[CreateProject] Failed to hydrate timeline:", err);
    }

    // Initialize runtime session
    try {
      const { createProjectSession } = await import("@/core/runtime/ProjectSession");
      await createProjectSession(project.id);
    } catch (err) {
      console.error("[CreateProject] Runtime initialization failed:", err);
    }

    get().scheduleAutoSave();
  },

  loadProject: async (project, payload) => {
    // Dispose previous runtime first
    try {
      const { disposeActiveSession } = await import("@/core/runtime/ProjectSession");
      await disposeActiveSession();
    } catch (err) {
      console.error("[LoadProject] Runtime disposal failed:", err);
    }

    // Apply project and mediaAssets (projectStore owns these)
    set({ project, mediaAssets: payload?.mediaAssets ?? [] });

    await preloadTextEffectDefinitionsFromClips(payload?.clips);

    // Let timelineStore hydrate its own state (respects ownership boundary)
    try {
      const { useTimelineStore } = await import("./timelineStore");
      const normalizedClips = normalizeLoadedTextEffectClipBounds(payload?.clips ?? [], project);
      useTimelineStore.getState().hydrateFromProject({
        tracks: payload?.tracks ?? [],
        clips: normalizedClips,
        transitions: payload?.transitions ?? [],
        gaps: (payload as any)?.gaps ?? [], // Load gaps from project
      });
    } catch (err) {
      // On error, reset timeline to empty state
      import("./timelineStore").then(({ useTimelineStore }) => useTimelineStore.getState().hydrateFromProject({ tracks: [], clips: [], transitions: [], gaps: [] })).catch((resetErr) => console.error("[LoadProject] Failed to reset timeline:", resetErr));
    }

    // Initialize runtime LAST — stores are now fully populated
    try {
      const { createProjectSession } = await import("@/core/runtime/ProjectSession");
      await createProjectSession(project.id);
    } catch (err) {
      console.error("[LoadProject] Runtime initialization failed:", err);
    }
  },

  addMediaAsset: (asset) => {
    set((state) => {
      // Check if asset with same path already exists
      const existingAsset = state.mediaAssets.find((a) => a.path === asset.path);

      if (existingAsset) {
        return state; // No change
      }

      return {
        mediaAssets: [...state.mediaAssets, asset],
      };
    });
    get().scheduleAutoSave();

    // Trigger background thumbnail pre-extraction for video assets.
    // The Low → Medium → High density cascade is handled entirely in Rust
    // Native decoder handles on-demand extraction via decode_frames_streaming
    // No preloading needed - decoder is fast enough (3-15ms per frame)
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

  renameProject: async (projectId, newName) => {
    const sanitizedName = sanitizeProjectName(newName);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("rename_project", { projectId, newName: sanitizedName });

      // Update in recent projects list
      set((state) => ({
        recentProjects: state.recentProjects.map((p) => (p.id === projectId ? { ...p, name: sanitizedName } : p)),
      }));

      // If this project is currently open, update it too
      const currentProject = get().project;
      if (currentProject && currentProject.id === projectId) {
        set((state) => ({
          project: state.project ? { ...state.project, name: sanitizedName } : null,
        }));
      }

      get().showToast("Project renamed");
    } catch (error) {
      get().showToast("Failed to rename project", "error");
      throw error;
    }
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
    } catch (error) {
      get().showToast("Failed to delete project", "error");
      throw error;
    }
  },

  closeProject: async () => {
    // Ensure any pending auto-save completes before closing
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      const state = get();
      const { project, mediaAssets } = state;

      if (project) {
        try {
          const { useTimelineStore } = await import("./timelineStore");
          const { tracks, clips, transitions, gaps } = useTimelineStore.getState();

          // Convert camelCase to snake_case using centralized serialization
          const rustProject = toRustProject(project, { tracks, clips, transitions, gaps, mediaAssets });

          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("save_project", {
            projectData: JSON.stringify(rustProject),
          });

          get().showToast("Project saved");
        } catch (error) {
          get().showToast("Failed to save before closing", "error");
        }
      }
    }
    // Dispose runtime after we've saved timeline state to avoid save-read race
    try {
      const { disposeActiveSession } = await import("@/core/runtime/ProjectSession");
      await disposeActiveSession();
    } catch (err) {
      console.error("[CloseProject] Error disposing runtime:", err);
    }

    // Now clear project and media assets
    set({ project: null, mediaAssets: [] });

    // Let timelineStore clear its own state
    import("./timelineStore")
      .then(({ useTimelineStore }) => {
        useTimelineStore.getState().hydrateFromProject({ tracks: [], clips: [], transitions: [] });
      })
      .catch((err) => {
        console.error("[CloseProject] Failed to reset timeline:", err);
      });
  },

  scheduleAutoSave: () => {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }

    // Respect the auto-save toggle from settings
    if (!useSettingsStore.getState().autoSave) return;

    autoSaveTimer = setTimeout(async () => {
      const state = get();
      const { project, mediaAssets } = state;

      if (!project) return;

      try {
        // Import timeline store to get tracks and clips
        const { useTimelineStore } = await import("./timelineStore");
        const { tracks, clips, transitions, gaps } = useTimelineStore.getState();

        // Convert camelCase to snake_case using centralized serialization
        const rustProject = toRustProject(project, { tracks, clips, transitions, gaps, mediaAssets });

        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("save_project", {
          projectData: JSON.stringify(rustProject),
        });
        get().showToast("Project saved");
      } catch (error) {
        console.error("[AutoSave] Failed to save project:", error);
        // Background operation — log only, don't show error toast
      }
    }, AUTO_SAVE_DELAY);
  },
}));
