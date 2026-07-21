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
import { platform } from "@/core/platform";
import type { Project, MediaAsset, TransitionTimelineItem } from "@/types";
import { MAX_PROJECT_NAME_LENGTH } from "@/types";
import { toRustProject } from "@/types/serialization";
import { generateId } from "@/lib/utils/id";
import { convertRawConfigToDefinition } from "@/features/text-effects/lib/definitionConversion";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";
import { calculateTextClipSize } from "@/lib/text/textClip";
import { useSettingsStore } from "./settingsStore";
import { saveSnapshot, clearSnapshot } from "@/core/runtime/CrashRecoveryService";
import { t } from "@/i18n";
import { lifecycleMonitor } from "@/lib/monitoring/LifecycleMonitor";
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

const graphemeSegmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });

// ✅ FIX-005: Load mutex to prevent concurrent project loads
let loadInProgress: Promise<void> | null = null;
let currentLoadId = 0;

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
  if (countGraphemes(trimmed) === 0) return t("launch.untitledProject");
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

// Wire up ResourceTracker's active project ID resolver after the module is fully evaluated.
// queueMicrotask ensures this runs after all static imports are resolved (avoids TDZ issues).
// The resolver lets findLeaks() classify which tracked resources belong to a stale project.
queueMicrotask(() => {
  import("@/lib/monitoring/ResourceTracker").then(({ resourceTracker }) => {
    resourceTracker.setActiveProjectIdResolver(() => useProjectStore.getState().project?.id ?? null);
  });
});

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

    await Promise.allSettled(missingStyleIds.map((id) => store.fetchDefinitionOnlyById(id)));
  } catch (err) {
    // Preload failed silently
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
        text: clip.text ?? t("project.defaultText"),
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
    console.trace("[ProjectLifecycle] createProject invoked");
    console.log("🆕 [PROJECT STORE] Creating new project:", name);

    // Dispose any existing session BEFORE resetting singletons (BUG-007 fix)
    try {
      const { disposeActiveSession } = await import("@/core/runtime/ProjectSession");
      await disposeActiveSession();
    } catch (err) {
      console.error("❌ [PROJECT STORE] Session disposal failed:", err);
    }

    // Reset all state from any previous project BEFORE creating new one
    try {
      const { resetAllProjectState } = await import("@/core/runtime/ProjectStateReset");
      const resetResult = await resetAllProjectState();

      if (!resetResult.success) {
        console.warn("⚠️ Some subsystems failed to reset:", resetResult.errors);
      }
    } catch (err) {
      console.error("❌ [PROJECT STORE] State reset failed:", err);
    }

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
    console.log("  ✅ Project created");

    // Let timelineStore reset its own state
    try {
      const { useTimelineStore } = await import("./timelineStore");
      useTimelineStore.getState().hydrateFromProject({ tracks: [], clips: [], transitions: [], gaps: [] });
      console.log("  ✅ Timeline initialized");
    } catch (err) {
      console.error("  ❌ Timeline initialization failed:", err);
    }

    // Initialize runtime session
    try {
      const { createProjectSession } = await import("@/core/runtime/ProjectSession");
      await createProjectSession(project.id);
      console.log("  ✅ Session initialized");
    } catch (err) {
      console.error("  ❌ Session initialization failed:", err);
    }

    get().scheduleAutoSave();
    console.log("✅ [PROJECT STORE] New project created successfully");
  },

  loadProject: async (project, payload) => {
    console.trace("[ProjectLifecycle] loadProject invoked", { projectId: project.id, projectName: project.name });
    const loadId = ++currentLoadId;

    // ✅ FIX-005: Wait for previous load to complete to prevent concurrent load races
    if (loadInProgress) {
      console.log("[PROJECT STORE] Waiting for previous load to complete...");
      await loadInProgress;
    }

    // Check if we were superceded while waiting for the previous load
    if (loadId !== currentLoadId) {
      console.log("[PROJECT STORE] Load request superceded before starting:", project.name);
      return;
    }

    // Wrap load logic in a promise we can track
    loadInProgress = (async () => {
      try {
        console.log("📂 [PROJECT STORE] Loading project:", project.name, "clips:", payload?.clips?.length, "mediaAssets:", payload?.mediaAssets?.length);

        // ═══════════════════════════════════════════════════════════════════════════════
        // PHASE 1: Dispose Previous Runtime & Reset State
        // ═══════════════════════════════════════════════════════════════════════════════
        try {
          const { disposeActiveSession } = await import("@/core/runtime/ProjectSession");
          await disposeActiveSession();
          console.log("  ✅ Previous session disposed");
        } catch (err) {
          console.error("  ❌ Previous session disposal failed:", err);
        }

        if (currentLoadId !== loadId) return;

        // Reset all project-scoped state BEFORE loading new project
        try {
          const { resetAllProjectState } = await import("@/core/runtime/ProjectStateReset");
          const resetResult = await resetAllProjectState();

          if (!resetResult.success) {
            console.warn("⚠️ Some subsystems failed to reset:", resetResult.errors);
          }
        } catch (err) {
          console.error("❌ [PROJECT STORE] State reset failed:", err);
        }

        if (currentLoadId !== loadId) return;

        // ═══════════════════════════════════════════════════════════════════════════════
        // PHASE 2: Load Project & Media Assets
        // ═══════════════════════════════════════════════════════════════════════════════
        set({ project, mediaAssets: payload?.mediaAssets ?? [] });
        console.log("  ✅ Project and media assets loaded");

        await preloadTextEffectDefinitionsFromClips(payload?.clips);
        if (currentLoadId !== loadId) return;

        // Preload filters from clips
        try {
          const { filterCacheManager } = await import("@/features/filters/cache/filterCache");
          await filterCacheManager.initialize();

          const filterClips = (payload?.clips ?? []).filter((clip: any) => clip.kind === "filter" && clip.mediaId);

          if (filterClips.length > 0) {
            console.log(`  ⏳ Pre-caching ${filterClips.length} filter(s)...`);

            for (const clip of filterClips) {
              try {
                // Check if already cached
                if (!filterCacheManager.isCached(clip.mediaId)) {
                  // Create FilterAsset from complete clip data (stored on save)
                  const filterAsset = {
                    id: clip.mediaId,
                    name: clip.name || t("project.defaultFilter"),
                    type: "filter" as const,
                    category: clip.category || "essentials", // Use stored category
                    description: "",
                    thumbnail: "",
                    url: clip.url, // Stored URL for re-fetching if needed
                    pipeline: clip.pipeline,
                    gradingParams: clip.gradingParams, // Critical: GPU shader parameters
                    effectStack: clip.effectStack,
                  };

                  await filterCacheManager.ensureDownloaded(filterAsset as any);
                }
              } catch (err) {
                console.warn(`  ⚠️ Failed to pre-cache filter ${clip.mediaId}:`, err);
              }
            }

            console.log(`  ✅ Filters pre-cached`);
          }
        } catch (err) {
          console.warn("  ⚠️ Filter pre-caching failed:", err);
          // Non-fatal - filters will be downloaded on-demand
        }

        if (currentLoadId !== loadId) return;

        // Preload text templates and their fonts with persistent caching
        try {
          const { useTemplateStore } = await import("@/features/text-templates/templateStore");
          await useTemplateStore.getState().preloadTemplatesAndFontsForClips(payload?.clips ?? []);
        } catch (err) {
          // Preload failed silently
        }

        if (currentLoadId !== loadId) return;

        // ═══════════════════════════════════════════════════════════════════════════════
        // PHASE 3: Hydrate Timeline State
        // ═══════════════════════════════════════════════════════════════════════════════
        try {
          const { useTimelineStore } = await import("./timelineStore");
          const normalizedClips = normalizeLoadedTextEffectClipBounds(payload?.clips ?? [], project);
          useTimelineStore.getState().hydrateFromProject({
            tracks: payload?.tracks ?? [],
            clips: normalizedClips,
            transitions: payload?.transitions ?? [],
            gaps: (payload as any)?.gaps ?? [],
            markers: (payload as any)?.markers ?? [],
          });
          console.log("  ✅ Timeline hydrated");
        } catch (err) {
          console.error("  ❌ Timeline hydration failed:", err);
          // On error, reset timeline to empty state
          import("./timelineStore").then(({ useTimelineStore }) => useTimelineStore.getState().hydrateFromProject({ tracks: [], clips: [], transitions: [], gaps: [] })).catch(() => {});
        }

        if (currentLoadId !== loadId) return;

        // ═══════════════════════════════════════════════════════════════════════════════
        // PHASE 4: Initialize New Runtime Session
        // ═══════════════════════════════════════════════════════════════════════════════
        try {
          const { createProjectSession } = await import("@/core/runtime/ProjectSession");
          await createProjectSession(project.id);
          console.log("  ✅ New session initialized");
        } catch (err) {
          console.error("  ❌ Session initialization failed:", err);
        }

        if (currentLoadId !== loadId) return;

        // ═══════════════════════════════════════════════════════════════════════════════
        // PHASE 5: Prewarm Video Decoders (Background)
        // ═══════════════════════════════════════════════════════════════════════════════
        try {
          const { prewarmDecoders } = await import("@/lib/platform/tauri");
          const videoAssets = (payload?.mediaAssets ?? []).filter((a) => a.type === "video");
          if (videoAssets.length > 0) {
            const videoPaths = videoAssets.map((a) => a.path);
            // ✅ FIX (RACE-002): Capture project ID before the async call. Validate it in the
            // .then() callback so that if the user switches projects during the Rust decode
            // operation the stale result is discarded instead of polluting the decoder pool.
            const projectIdAtPrewarm = project.id;
            prewarmDecoders(videoPaths).then((count) => {
              const currentProject = get().project;
              if (!currentProject || currentProject.id !== projectIdAtPrewarm) {
                console.log(`[PREWARM] Project switched during prewarming, result discarded (was: ${projectIdAtPrewarm})`);
                return;
              }
              console.log(`  ✅ Prewarmed ${count}/${videoPaths.length} video decoders`);
            });
          }
        } catch (err) {
          // Prewarming failed silently - graceful degradation
        }

        console.log("✅ [PROJECT STORE] Project loaded successfully");
      } finally {
        // ✅ FIX-005: Clear load mutex after completion
        loadInProgress = null;
      }
    })();

    return loadInProgress;
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
      await platform.renameProject(projectId, sanitizedName);

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

      get().showToast(t("project.renamed"));
    } catch (error) {
      get().showToast(t("project.renameFailed"), "error");
      throw error;
    }
  },

  deleteProject: async (projectId) => {
    try {
      await platform.deleteProject(projectId);

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
      get().showToast(t("project.deleteFailed"), "error");
      throw error;
    }
  },

  closeProject: async () => {
    console.trace("[ProjectLifecycle] closeProject invoked");
    console.log("🏠 [PROJECT STORE] Closing project...");
    currentLoadId++; // Cancel any active load

    // Ensure any pending auto-save completes before closing
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null; // ✅ FIX-002: Clear timer reference to prevent stale timer from firing
      const state = get();
      const { project, mediaAssets } = state;

      if (project) {
        try {
          const { useTimelineStore } = await import("./timelineStore");
          const { tracks, clips, transitions, gaps, markers } = useTimelineStore.getState();

          // Convert camelCase to snake_case using centralized serialization
          const rustProject = toRustProject(project, { tracks, clips, transitions, gaps, markers, mediaAssets });

          await platform.saveProject(JSON.stringify(rustProject));

          get().showToast(t("project.saved"));
        } catch (error) {
          get().showToast(t("project.saveBeforeCloseFailed"), "error");
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // PHASE 1: Dispose Runtime Session
    // ═══════════════════════════════════════════════════════════════════════════════
    // Dispose runtime after we've saved timeline state to avoid save-read race
    try {
      const { disposeActiveSession } = await import("@/core/runtime/ProjectSession");
      await disposeActiveSession();
      console.log("  ✅ ProjectSession disposed");
    } catch (err) {
      console.error("  ❌ ProjectSession disposal failed:", err);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // PHASE 2: Reset All Project-Scoped State (CENTRALIZED)
    // ═══════════════════════════════════════════════════════════════════════════════
    try {
      const { resetAllProjectState } = await import("@/core/runtime/ProjectStateReset");
      const resetResult = await resetAllProjectState();

      if (!resetResult.success) {
        console.warn("⚠️ Some subsystems failed to reset:", resetResult.errors);
      }
    } catch (err) {
      console.error("❌ [PROJECT STORE] State reset failed:", err);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // PHASE 3: Clear ProjectStore State
    // ═══════════════════════════════════════════════════════════════════════════════
    const closedProjectId = get().project?.id;
    set({ project: null, mediaAssets: [] });
    console.log("  ✅ ProjectStore cleared");

    // ═══════════════════════════════════════════════════════════════════════════════
    // PHASE 4: Reset Timeline State
    // ═══════════════════════════════════════════════════════════════════════════════
    // Let timelineStore clear its own state
    try {
      const { useTimelineStore } = await import("./timelineStore");
      useTimelineStore.getState().hydrateFromProject({ tracks: [], clips: [], transitions: [], gaps: [] });
      console.log("  ✅ TimelineStore reset");
    } catch (err) {
      console.error("  ❌ TimelineStore reset failed:", err);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // PHASE 5: Clear Crash-Recovery Snapshot
    // ═══════════════════════════════════════════════════════════════════════════════
    // On a clean close, remove the IndexedDB snapshot so we don't prompt for
    // recovery the next time the user opens the application.
    lifecycleMonitor.record("PROJECT_DISPOSE", { projectId: closedProjectId });
    clearSnapshot().catch((err) => {
      console.warn("[PROJECT STORE] Failed to clear crash-recovery snapshot:", err);
    });

    console.log("✅ [PROJECT STORE] Project closed successfully");
  },

  scheduleAutoSave: () => {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }

    // Respect the auto-save toggle from settings
    if (!useSettingsStore.getState().autoSave) return;

    // ✅ FIX-001: Capture project ID at schedule time to prevent cross-project corruption
    const scheduledProjectId = get().project?.id;
    if (!scheduledProjectId) return;

    autoSaveTimer = setTimeout(async () => {
      const state = get();
      const { project, mediaAssets } = state;

      if (!project) return;

      // ✅ FIX-001: Validate project hasn't changed during debounce window
      if (project.id !== scheduledProjectId) {
        console.log("[AUTO-SAVE] Project switched during debounce window, cancelling save for", scheduledProjectId);
        return;
      }

      try {
        // Import timeline store to get tracks and clips
        const { useTimelineStore } = await import("./timelineStore");
        const { tracks, clips, transitions, gaps, markers } = useTimelineStore.getState();

        // Convert camelCase to snake_case using centralized serialization
        const rustProject = toRustProject(project, { tracks, clips, transitions, gaps, markers, mediaAssets });

        await platform.saveProject(JSON.stringify(rustProject));
        get().showToast(t("project.saved"));

        // ── Crash recovery snapshot ──────────────────────────────────────
        // Persist a recovery snapshot so the user can restore their work if
        // the application crashes or the browser refreshes unexpectedly.
        try {
          const { tracks, clips, transitions, gaps } = useTimelineStore.getState();
          lifecycleMonitor.record("AUTO_SAVE_SNAPSHOT_SAVED", { projectId: project.id });
          // Fire-and-forget — we never want snapshot writes to block the UI
          saveSnapshot({
            savedAt: new Date().toISOString(),
            project,
            mediaAssets,
            tracks,
            clips,
            transitions,
          }).catch((err) => {
            console.warn("[AUTO-SAVE] Failed to persist crash-recovery snapshot:", err);
          });
        } catch (_snapshotError) {
          // Ignore — snapshot failures are non-fatal
        }
      } catch (error) {
        // Background operation — silent fail
      }
    }, AUTO_SAVE_DELAY);
  },
}));
