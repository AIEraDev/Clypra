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
import type {
  Project,
  MediaAsset,
  TransitionTimelineItem,
  TimelineMarker,
} from "@/types";
import type { Gap } from "@/types/gap";
import type { CaptionTrack } from "@/types/captions";
import {
  AUDIO_MODEL_VERSION,
  CAPTION_MODEL_VERSION,
  MAX_PROJECT_NAME_LENGTH,
} from "@/types";
import {
  toRustProject,
  type ProjectPersistenceSnapshot,
} from "@/types/serialization";
import { generateId } from "@/lib/utils/id";
import { convertRawConfigToDefinition } from "@/features/text-effects/lib/definitionConversion";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";
import {
  calculateTextClipSize,
  resolveTextEffectDefinition,
} from "@/lib/text/textClip";
import { useSettingsStore } from "./settingsStore";
import {
  saveSnapshot,
  clearSnapshot,
} from "@/core/runtime/CrashRecoveryService";
import { lifecycleMonitor } from "@/core/monitoring/LifecycleMonitor";
import { TRACK_TYPE_CONFIG } from "@/lib/timeline/trackTypeConfig";
import { getActiveSessionOrNull } from "@/core/runtime/ProjectSession";
import { tracePlayback } from "@/core/playback/playbackTrace";
import {
  clearNativeSurfaceReadiness,
  ensureNativeSurfaceReadiness,
  hideNativeSurfaceWhenIdle,
  waitForNativeSurfaceReady,
} from "@/core/runtime/nativeSurfaceLifecycle";
import { toast } from "@/lib/toast";
import {
  suppressAutoSave,
  enableAutoSave,
} from "./middleware/autoSaveMiddleware";
import type {
  ProjectSaveResult,
  RecentProjectEntry,
} from "@/core/platform/platform";
// import { TIMELINE_PPS_PER_ZOOM, TIMELINE_ZOOM_DEFAULT } from "@/lib/timelineZoom";

interface ProjectStore {
  project: Project | null;
  mediaAssets: MediaAsset[];
  recentProjects: RecentProjectEntry[];
  projectInitialization: ProjectInitializationState | null;
  toastMessage: string | null;
  toastVariant: "success" | "error" | "warning";
  beginProjectInitialization: (projectName: string) => number;
  updateProjectInitialization: (
    initializationId: number,
    phase: ProjectInitializationPhase,
    progress: number,
    message: string,
  ) => void;
  completeProjectInitialization: (initializationId: number) => void;
  failProjectInitialization: (initializationId: number, error: string) => void;
  clearProjectInitialization: () => void;
  setToastMessage: (
    message: string | null,
    variant?: "success" | "error" | "warning",
  ) => void;
  /** Convenience: show toast with variant and auto-dismiss. */
  showToast: (
    message: string,
    variant?: "success" | "error" | "warning",
    durationMs?: number,
  ) => void;
  createProject: (
    name: string,
    aspectRatio: string,
    frameRate: 24 | 30 | 60,
    initialTimeline?: {
      tracks?: any[];
      clips?: any[];
      transitions?: TransitionTimelineItem[];
      gaps?: Gap[];
      canvasWidth?: number;
      canvasHeight?: number;
    },
  ) => Promise<void>;
  createProjectFromTemplate: (
    templateId: string,
    customName?: string,
  ) => Promise<void>;
  loadProject: (
    project: Project,
    payload?: {
      tracks?: any[];
      clips?: any[];
      transitions?: TransitionTimelineItem[];
      gaps?: Gap[];
      markers?: TimelineMarker[];
      captionTracks?: CaptionTrack[];
      mediaAssets?: MediaAsset[];
      mainVideoTrackId?: string | null;
    },
  ) => Promise<void> | void;
  addMediaAsset: (asset: MediaAsset) => void;
  updateMediaAsset: (assetId: string, updates: Partial<MediaAsset>) => void;
  removeMediaAsset: (assetId: string) => void;
  checkMissingMedia: () => Promise<string[]>;
  relinkMediaAsset: (
    assetId: string,
    newPath: string,
  ) => Promise<{ success: boolean; relinkedOtherCount: number }>;
  promptRelinkMedia: (assetId: string) => Promise<boolean>;
  updateProject: (updates: Partial<Project>) => void;
  setProjectThumbnail: (thumbnail: string) => void;
  setRecentProjects: (projects: RecentProjectEntry[]) => void;
  renameProject: (projectId: string, newName: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  closeProject: () => Promise<void> | void;
  /** Persist the current project immediately and verify the storage result. */
  saveCurrentProject: () => Promise<ProjectSaveResult | null>;
  scheduleAutoSave: () => void;
  isDirty: boolean;
  setIsDirty: (isDirty: boolean) => void;
  hasUnsavedChanges: () => boolean;
  flushCrashRecovery: () => Promise<void>;
}

export type ProjectInitializationPhase =
  | "preparing"
  | "loading-assets"
  | "hydrating-timeline"
  | "warming-text"
  | "starting-preview"
  | "verifying-media"
  | "closing"
  | "error";

export interface ProjectInitializationState {
  id: number;
  projectName: string;
  phase: ProjectInitializationPhase;
  progress: number;
  message: string;
  error?: string;
}

const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

// Project transitions are one transaction. Opening, creating, and closing
// projects share this tail so a second request waits for the first request's
// session, native surface, media, and store cleanup to finish.
let projectTransitionTail: Promise<void> = Promise.resolve();

function withProjectTransition<T>(operation: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = projectTransitionTail;
  projectTransitionTail = previous.then(
    () => gate,
    () => gate,
  );

  return previous
    .catch(() => undefined)
    .then(operation)
    .finally(release);
}

let currentLoadId = 0;
let initializationSequence = 0;

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

const getAspectRatioDimensions = (
  ratio: string,
): { width: number; height: number } => {
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
let saveInProgress: Promise<ProjectSaveResult> | null = null;

let crashRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
let crashRecoveryFirstMutation: number | null = null;
const CRASH_RECOVERY_DELAY = 250; // ms
const CRASH_RECOVERY_MAX_WAIT = 1000; // ms

async function captureCurrentProjectSnapshot(): Promise<ProjectPersistenceSnapshot | null> {
  const { project, mediaAssets } = useProjectStore.getState();
  if (!project) return null;

  const { useTimelineStore } = await import("./timelineStore");
  const {
    tracks,
    clips,
    transitions,
    gaps,
    markers,
    captionTracks,
    epoch,
    mainVideoTrackId,
  } = useTimelineStore.getState();

  return {
    project,
    mediaAssets,
    tracks,
    clips,
    transitions,
    gaps,
    markers,
    captionTracks: captionTracks ?? [],
    epoch,
    timelineSchemaVersion: project.timelineSchemaVersion ?? 1,
    migrated: false,
    rustProject: toRustProject(project, {
      tracks,
      clips,
      transitions,
      gaps,
      markers,
      captionTracks: captionTracks ?? [],
      mediaAssets,
      mainVideoTrackId,
    }),
  };
}

async function persistProjectPayload(
  payload: string,
): Promise<ProjectSaveResult> {
  // Serialize saves so a close/update flush cannot race an already-running
  // debounced save and leave the disk file behind the in-memory state.
  if (saveInProgress) {
    await saveInProgress.catch(() => undefined);
  }

  const request = platform.saveProject(payload);
  saveInProgress = request;
  try {
    return await request;
  } finally {
    if (saveInProgress === request) {
      saveInProgress = null;
    }
  }
}

async function persistCurrentProjectSnapshot(
  snapshot: ProjectPersistenceSnapshot,
): Promise<ProjectSaveResult> {
  const { getProjectWorkerClient } = await import("@/core/workers/projectWorkerClient");
  const serialized = await getProjectWorkerClient().serialize(snapshot.rustProject as any);
  return persistProjectPayload(serialized.json);
}

let crashRecoveryPromise: Promise<void> | null = null;

async function flushCrashRecoverySnapshot(
  scheduledProjectId: string,
): Promise<void> {
  const promise = (async () => {
    const state = useProjectStore.getState();
    const { project } = state;
    if (!project || project.id !== scheduledProjectId) return;

    try {
      const snapshot = await captureCurrentProjectSnapshot();
      if (!snapshot || snapshot.project.id !== scheduledProjectId) return;

      lifecycleMonitor.record("AUTO_SAVE_SNAPSHOT_SAVED", {
        projectId: snapshot.project.id,
      });
      await saveSnapshot({
        savedAt: new Date().toISOString(),
        project: snapshot.project,
        mediaAssets: snapshot.mediaAssets,
        tracks: snapshot.tracks,
        clips: snapshot.clips,
        transitions: snapshot.transitions,
        gaps: snapshot.gaps,
        markers: snapshot.markers,
        timelineSchemaVersion: snapshot.project.timelineSchemaVersion ?? 1,
      });
    } catch (_snapshotError) {
      // Non-fatal - snapshot failures are handled gracefully
    }
  })();

  crashRecoveryPromise = promise;
  try {
    await promise;
  } finally {
    if (crashRecoveryPromise === promise) {
      crashRecoveryPromise = null;
    }
  }
}

function scheduleCrashRecoverySnapshot(): void {
  const scheduledProjectId = useProjectStore.getState().project?.id;
  if (!scheduledProjectId) return;

  const now = Date.now();
  if (crashRecoveryFirstMutation === null) {
    crashRecoveryFirstMutation = now;
  }

  const elapsed = now - crashRecoveryFirstMutation;
  if (elapsed >= CRASH_RECOVERY_MAX_WAIT) {
    if (crashRecoveryTimer) {
      clearTimeout(crashRecoveryTimer);
      crashRecoveryTimer = null;
    }
    crashRecoveryFirstMutation = null;
    void flushCrashRecoverySnapshot(scheduledProjectId);
    return;
  }

  if (crashRecoveryTimer) {
    clearTimeout(crashRecoveryTimer);
  }

  crashRecoveryTimer = setTimeout(() => {
    crashRecoveryTimer = null;
    crashRecoveryFirstMutation = null;
    void flushCrashRecoverySnapshot(scheduledProjectId);
  }, CRASH_RECOVERY_DELAY);
}

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

function getDirectoryPath(filePath: string): string {
  const lastSlash = Math.max(
    filePath.lastIndexOf("/"),
    filePath.lastIndexOf("\\"),
  );
  return lastSlash > 0 ? filePath.substring(0, lastSlash) : "";
}

function joinPath(dir: string, file: string): string {
  if (dir.includes("\\")) {
    return `${dir}\\${file}`;
  }
  return `${dir}/${file}`;
}

// Wire up ResourceTracker's active project ID resolver after the module is fully evaluated.
// queueMicrotask ensures this runs after all static imports are resolved (avoids TDZ issues).
// The resolver lets findLeaks() classify which tracked resources belong to a stale project.
queueMicrotask(() => {
  import("@/core/monitoring/ResourceTracker").then(({ resourceTracker }) => {
    resourceTracker.setActiveProjectIdResolver(
      () => useProjectStore.getState().project?.id ?? null,
    );
  });
});

function flattenClips(clips: any[] | undefined): any[] {
  if (!clips?.length) return [];
  const result: any[] = [];
  for (const clip of clips) {
    if (!clip) continue;
    result.push(clip);
    const rawChildren = clip.compoundChildren ?? clip.compound_children;
    if (Array.isArray(rawChildren) && rawChildren.length > 0) {
      result.push(...flattenClips(rawChildren));
    }
  }
  return result;
}

async function preloadTextEffectDefinitionsFromClips(
  clips: any[] | undefined,
): Promise<void> {
  const allClips = flattenClips(clips);
  if (!allClips.length) return;

  const styleIds = Array.from(
    new Set(
      allClips
        .map((clip) => clip?.styleId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  const embeddedDefinitions = allClips
    .map((clip) => clip?.styleDefinition ?? clip?.style_definition)
    .filter((definition) => definition && typeof definition.id === "string");

  if (styleIds.length === 0 && embeddedDefinitions.length === 0) return;

  try {
    const { useEffectsStore } =
      await import("@/features/text-effects/store/effectsStore");

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
    const missingStyleIds = styleIds.filter(
      (id) => !useEffectsStore.getState().definitions[id],
    );
    if (missingStyleIds.length === 0) return;

    await Promise.allSettled(
      missingStyleIds.map((id) => store.fetchDefinitionOnlyById(id)),
    );
  } catch (err) {
    // Preload failed silently
  }
}

function normalizeLoadedTextEffectClipBounds(
  clips: any[] | undefined,
  project: Project,
): any[] {
  if (!clips?.length) return clips ?? [];

  try {
    return clips.map((rawClip) => {
      let clip = rawClip;
      const rawChildren = clip?.compoundChildren ?? clip?.compound_children;
      if (Array.isArray(rawChildren) && rawChildren.length > 0) {
        clip = {
          ...clip,
          compoundChildren: normalizeLoadedTextEffectClipBounds(
            rawChildren,
            project,
          ),
        };
      }

      if (clip?.kind !== "text" || !clip.styleId) return clip;

      const effectDefinition = resolveTextEffectDefinition(
        clip.styleId,
        clip.styleDefinition,
      );
      if (!effectDefinition) return clip;

      const nativeDefinition = effectDefinition as any;
      const nativeWidth =
        nativeDefinition.canvasWidth ?? nativeDefinition.width;
      const nativeHeight =
        nativeDefinition.canvasHeight ?? nativeDefinition.height;
      const nativeFontSize = nativeDefinition.fontSize;
      if (!nativeWidth || !nativeHeight || !nativeFontSize || !clip.fontSize)
        return clip;

      const nativeScale = clip.fontSize / nativeFontSize;
      const oldNativeWidth = nativeWidth * nativeScale;
      const oldNativeHeight = nativeHeight * nativeScale;
      const widthMatchesOldNative =
        Math.abs((clip.width ?? 0) - oldNativeWidth) <=
        Math.max(2, oldNativeWidth * 0.02);
      const heightMatchesOldNative =
        Math.abs((clip.height ?? 0) - oldNativeHeight) <=
        Math.max(2, oldNativeHeight * 0.02);
      if (!widthMatchesOldNative && !heightMatchesOldNative) return clip;

      const sizing = calculateTextClipSize({
        text: clip.text ?? "Text",
        fontFamily:
          clip.fontFamily ??
          effectDefinition.font?.family ??
          "Inter, system-ui, sans-serif",
        fontSize: clip.fontSize,
        fontWeight: clip.fontWeight ?? effectDefinition.font?.weight,
        letterSpacing:
          clip.letterSpacing ?? effectDefinition.font?.letterSpacing,
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
  projectInitialization: null,
  beginProjectInitialization: (projectName) => {
    const id = ++initializationSequence;

    set({
      projectInitialization: {
        id,
        projectName,
        phase: "preparing",
        progress: 4,
        message: "Preparing project…",
      },
    });
    return id;
  },
  updateProjectInitialization: (initializationId, phase, progress, message) => {
    set((state) => {
      if (state.projectInitialization?.id !== initializationId) return state;
      return {
        projectInitialization: {
          ...state.projectInitialization,
          phase,
          progress: Math.max(0, Math.min(99, progress)),
          message,
          error: undefined,
        },
      };
    });
  },
  completeProjectInitialization: (initializationId) => {
    set((state) => {
      if (state.projectInitialization?.id !== initializationId) return state;
      return { projectInitialization: null };
    });
  },
  failProjectInitialization: (initializationId, error) => {
    set((state) => {
      if (state.projectInitialization?.id !== initializationId) return state;
      return {
        projectInitialization: {
          ...state.projectInitialization,
          phase: "error",
          progress: 100,
          message: "Project could not be prepared",
          error,
        },
      };
    });
  },
  clearProjectInitialization: () => set({ projectInitialization: null }),
  toastMessage: null,
  toastVariant: "success" as const,
  isDirty: false,
  setIsDirty: (isDirty) => set({ isDirty }),
  hasUnsavedChanges: () =>
    get().isDirty || autoSaveTimer !== null || crashRecoveryTimer !== null,
  flushCrashRecovery: async () => {
    const currentProjectId = get().project?.id;
    if (!currentProjectId) return;
    if (crashRecoveryTimer) {
      clearTimeout(crashRecoveryTimer);
      crashRecoveryTimer = null;
    }
    crashRecoveryFirstMutation = null;
    await flushCrashRecoverySnapshot(currentProjectId);
  },

  setToastMessage: (message, variant) =>
    set({
      toastMessage: message,
      ...(variant ? { toastVariant: variant } : {}),
    }),

  showToast: (message, variant = "success", durationMs = 3000) => {
    set({ toastMessage: message, toastVariant: variant });
    if (variant === "error") {
      toast.error(message, { duration: durationMs });
    } else if (variant === "warning") {
      toast.warning(message, { duration: durationMs });
    } else {
      toast.success(message, { duration: durationMs });
    }
    if (durationMs > 0) {
      setTimeout(() => set({ toastMessage: null }), durationMs);
    }
  },

  createProject: (name, aspectRatio, frameRate, initialTimeline = {}) =>
    withProjectTransition(async () => {
      const initializationId = get().beginProjectInitialization(
        name.trim() || "Untitled Project",
      );
      get().updateProjectInitialization(
        initializationId,
        "preparing",
        12,
        "Creating project session…",
      );

      // Dispose any existing session BEFORE resetting singletons (BUG-007 fix)
      try {
        const { disposeActiveSession } =
          await import("@/core/runtime/ProjectSession");
        await disposeActiveSession();
      } catch {}

      // Reset all state from any previous project BEFORE creating new one
      try {
        const { resetAllProjectState } =
          await import("@/core/runtime/ProjectStateReset");
        await resetAllProjectState();
      } catch {}

      const sanitizedName = sanitizeProjectName(name);
      const dims = getAspectRatioDimensions(aspectRatio);
      const project: Project = {
        id: generateId("project"),
        name: sanitizedName,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        aspectRatio: aspectRatio as any,
        canvasWidth: initialTimeline.canvasWidth ?? dims.width,
        canvasHeight: initialTimeline.canvasHeight ?? dims.height,
        frameRate,
        duration: 0,
        timelineSchemaVersion: 1,
        audioModelVersion: AUDIO_MODEL_VERSION,
        captionModelVersion: CAPTION_MODEL_VERSION,
      };

      ensureNativeSurfaceReadiness(project.id);
      set({ project, mediaAssets: [], isDirty: false });
      get().updateProjectInitialization(
        initializationId,
        "hydrating-timeline",
        36,
        "Building timeline…",
      );

      // Let timelineStore reset its own state
      try {
        const { useTimelineStore } = await import("./timelineStore");
        useTimelineStore.getState().hydrateFromProject({
          tracks: initialTimeline.tracks ?? [],
          clips: initialTimeline.clips ?? [],
          transitions: initialTimeline.transitions ?? [],
          gaps: initialTimeline.gaps ?? [],
          captionTracks: (initialTimeline as any)?.captionTracks ?? [],
        });
      } catch {}

      // Initialize runtime session
      try {
        const { createProjectSession } =
          await import("@/core/runtime/ProjectSession");
        await createProjectSession(project.id, {
          onProgress: (progress, message) =>
            get().updateProjectInitialization(
              initializationId,
              "warming-text",
              36 + progress * 60,
              message,
            ),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          "[projectStore] Failed to initialize new project session:",
          error,
        );
        get().failProjectInitialization(initializationId, message);
        return;
      }

      get().completeProjectInitialization(initializationId);
      get().scheduleAutoSave();
    }),

  createProjectFromTemplate: async (templateId, customName) => {
    const { getTemplateById } =
      await import("@/features/templates/projectTemplates");
    const template = getTemplateById(templateId);
    if (!template) {
      return;
    }

    const name = customName || template.name;
    const initialTracks = template.initialTracks.map((t) => ({
      id: generateId("track"),
      type: t.type as any,
      name: t.name,
      muted: false,
      locked: false,
      visible: true,
      height:
        TRACK_TYPE_CONFIG[t.type as keyof typeof TRACK_TYPE_CONFIG]?.height ??
        30,
    }));

    // Include the template timeline in the same transaction as project
    // creation. The loading modal must not disappear while a second,
    // untracked hydration pass is still changing the session's scene.
    await get().createProject(name, template.aspectRatio, template.frameRate, {
      canvasWidth: template.width,
      canvasHeight: template.height,
      tracks: initialTracks,
      clips: [],
      transitions: [],
      gaps: [],
    });
  },

  loadProject: (project, payload) =>
    withProjectTransition(async () => {
      const loadId = ++currentLoadId;
      const initializationId = get().beginProjectInitialization(project.name);
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
      }
      suppressAutoSave();
      const previousProject = get().project;
      const previousMediaAssets = get().mediaAssets;
      const { useTimelineStore } = await import("./timelineStore");
      const previousTimeline = {
        tracks: useTimelineStore.getState().tracks,
        clips: useTimelineStore.getState().clips,
        transitions: useTimelineStore.getState().transitions,
        gaps: useTimelineStore.getState().gaps,
        markers: useTimelineStore.getState().markers,
      };
      try {
        // ═══════════════════════════════════════════════════════════════════════════════
        // PHASE 1: Dispose Previous Runtime & Reset State
        // ═══════════════════════════════════════════════════════════════════════════════
        try {
          const { disposeActiveSession } =
            await import("@/core/runtime/ProjectSession");
          await disposeActiveSession();
        } catch (err) {}

        if (currentLoadId !== loadId) return;

        // Reset all project-scoped state BEFORE loading new project
        try {
          const { resetAllProjectState } =
            await import("@/core/runtime/ProjectStateReset");
          await resetAllProjectState();
        } catch (err) {}

        if (currentLoadId !== loadId) return;

        // ═══════════════════════════════════════════════════════════════════════════════
        // PHASE 2: Load Project & Media Assets
        // ═══════════════════════════════════════════════════════════════════════════════
        get().updateProjectInitialization(
          initializationId,
          "loading-assets",
          18,
          "Loading project assets…",
        );
        ensureNativeSurfaceReadiness(project.id);
        set({ project, mediaAssets: payload?.mediaAssets ?? [] });

        const allPayloadClips = flattenClips(payload?.clips);
        await preloadTextEffectDefinitionsFromClips(allPayloadClips);
        if (currentLoadId !== loadId) return;

        // Preload filters from clips
        try {
          const { filterCacheManager } =
            await import("@/features/filters/cache/filterCache");
          await filterCacheManager.initialize();

          const filterClips = allPayloadClips.filter(
            (clip: any) => clip.kind === "filter" && clip.mediaId,
          );

          if (filterClips.length > 0) {
            for (const clip of filterClips) {
              try {
                // Check if already cached
                if (!filterCacheManager.isCached(clip.mediaId)) {
                  // Create FilterAsset from complete clip data (stored on save)
                  const filterAsset = {
                    id: clip.mediaId,
                    name: clip.name || "Filter",
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
              } catch (err) {}
            }
          }
        } catch (err) {
          // Non-fatal - filters will be downloaded on-demand
        }

        if (currentLoadId !== loadId) return;

        // Preload text templates and their fonts with persistent caching
        get().updateProjectInitialization(
          initializationId,
          "warming-text",
          32,
          "Preparing text styles and fonts…",
        );
        try {
          const { useTemplateStore } =
            await import("@/features/text-templates/templateStore");
          await useTemplateStore
            .getState()
            .preloadTemplatesAndFontsForClips(allPayloadClips);
        } catch (err) {
          // Preload failed silently
        }

        if (currentLoadId !== loadId) return;

        // ═══════════════════════════════════════════════════════════════════════════════
        // PHASE 3: Hydrate Timeline State
        // ═══════════════════════════════════════════════════════════════════════════════
        get().updateProjectInitialization(
          initializationId,
          "hydrating-timeline",
          48,
          "Building timeline…",
        );
        const normalizedClips = normalizeLoadedTextEffectClipBounds(
          payload?.clips ?? [],
          project,
        );
        useTimelineStore.getState().hydrateFromProject({
          tracks: payload?.tracks ?? [],
          clips: normalizedClips,
          transitions: payload?.transitions ?? [],
          gaps: payload?.gaps ?? [],
          markers: payload?.markers ?? [],
          ...(payload?.captionTracks !== undefined
            ? { captionTracks: payload.captionTracks }
            : {}),
          ...(payload?.mainVideoTrackId !== undefined
            ? { mainVideoTrackId: payload.mainVideoTrackId }
            : {}),
          cleanEmptyTracks: true,
        });

        if (currentLoadId !== loadId) return;

        // ═══════════════════════════════════════════════════════════════════════════════
        // PHASE 4: Initialize New Runtime Session
        // ═══════════════════════════════════════════════════════════════════════════════
        get().updateProjectInitialization(
          initializationId,
          "starting-preview",
          58,
          "Initializing preview runtime…",
        );
        const { createProjectSession } =
          await import("@/core/runtime/ProjectSession");
        await createProjectSession(project.id, {
          onProgress: (progress, message) =>
            get().updateProjectInitialization(
              initializationId,
              "warming-text",
              58 + progress * 38,
              message,
            ),
        });

        if (currentLoadId !== loadId) return;

        // ═══════════════════════════════════════════════════════════════════════════════
        // PHASE 5: Prewarm Video Decoders (required before opening)
        // ═══════════════════════════════════════════════════════════════════════════════
        get().updateProjectInitialization(
          initializationId,
          "starting-preview",
          94,
          "Prewarming media decoders…",
        );
        try {
          const { prewarmDecoders } = await import("@/lib/platform/tauri");
          const videoAssets = (payload?.mediaAssets ?? []).filter(
            (a) => a.type === "video",
          );
          if (videoAssets.length > 0) {
            const videoPaths = videoAssets.map((a) => a.path);
            // This is part of the open barrier so first play cannot compete
            // with native decoder initialization.
            await prewarmDecoders(videoPaths);
          }
        } catch (err) {
          // The platform helper already degrades safely; keep opening if the
          // optional prewarm command itself cannot be loaded.
          console.warn("[projectStore] Video decoder prewarm unavailable", err);
        }

        get().updateProjectInitialization(
          initializationId,
          "starting-preview",
          96,
          "Waiting for native preview surface…",
        );
        await waitForNativeSurfaceReady(project.id);

        // ═══════════════════════════════════════════════════════════════════════════════
        // PHASE 6: Verify Media Files on Disk (required before opening)
        // ═══════════════════════════════════════════════════════════════════════════════
        get().updateProjectInitialization(
          initializationId,
          "verifying-media",
          97,
          "Verifying project media…",
        );
        const loadedProjectId = project.id;
        const missingIds = await get().checkMissingMedia();
        const currentProject = get().project;
        if (currentProject?.id === loadedProjectId && missingIds.length > 0) {
          get().showToast(
            `${missingIds.length} media file${missingIds.length > 1 ? "s are" : " is"} missing or offline. Use Relink Media to locate.`,
            "warning",
            5000,
          );
        }

        if (currentLoadId !== loadId) return;
        set({ isDirty: false });
        get().completeProjectInitialization(initializationId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        get().failProjectInitialization(initializationId, message);
        // A failed hydration/session transition must not leave an empty or
        // half-loaded project visible. Rebuild the previous active state.
        try {
          const { disposeActiveSession, createProjectSession } =
            await import("@/core/runtime/ProjectSession");
          await disposeActiveSession();
          const { resetAllProjectState } =
            await import("@/core/runtime/ProjectStateReset");
          await resetAllProjectState();
          set({ project: previousProject, mediaAssets: previousMediaAssets });
          useTimelineStore.getState().hydrateFromProject({
            ...previousTimeline,
            cleanEmptyTracks: false,
          });
          if (previousProject) await createProjectSession(previousProject.id);
        } catch (rollbackError) {
          console.error(
            "[projectStore] Failed to restore previous project after load failure",
            rollbackError,
          );
        }
        throw error;
      } finally {
        enableAutoSave();
      }
    }),

  addMediaAsset: (asset) => {
    set((state) => {
      // Check if asset with same path already exists
      const existingAsset = state.mediaAssets.find(
        (a) => a.path === asset.path,
      );

      if (existingAsset) {
        return state; // No change
      }

      return {
        mediaAssets: [...state.mediaAssets, asset],
      };
    });
    get().scheduleAutoSave();

    // Trigger eager background baseline preload for video assets on project import.
    // Bounded to <=300 L0 tiles at low concurrency so tiles are warm before timeline drop.
    if (
      asset.type === "video" &&
      asset.path &&
      typeof asset.duration === "number" &&
      asset.duration > 0
    ) {
      try {
        const session = getActiveSessionOrNull();
        if (session && session.state === "active") {
          session.renderRuntime.preloadAssetCoarseBaseline({
            videoPath: asset.path,
            duration: asset.duration,
          });
        }
      } catch (err) {
        console.warn(
          "[projectStore] Failed to trigger coarse baseline preload for asset:",
          asset.path,
          err,
        );
      }
    }
  },

  updateMediaAsset: (assetId, updates) => {
    set((state) => ({
      mediaAssets: state.mediaAssets.map((a) =>
        a.id === assetId ? { ...a, ...updates } : a,
      ),
    }));
    get().scheduleAutoSave();
  },

  removeMediaAsset: (assetId) => {
    set((state) => ({
      mediaAssets: state.mediaAssets.filter((a) => a.id !== assetId),
    }));
    get().scheduleAutoSave();
  },

  checkMissingMedia: async () => {
    const assets = get().mediaAssets;
    if (!assets.length) return [];

    const missingIds: string[] = [];
    const updatedAssets = await Promise.all(
      assets.map(async (asset) => {
        if (
          !asset.path ||
          asset.path.startsWith("data:") ||
          asset.path.startsWith("http:") ||
          asset.path.startsWith("https:") ||
          asset.path.startsWith("asset://")
        ) {
          return asset.isMissing ? { ...asset, isMissing: false } : asset;
        }

        try {
          const exists = await platform.fileExists(asset.path);
          if (!exists) {
            missingIds.push(asset.id);
            return { ...asset, isMissing: true };
          } else if (asset.isMissing) {
            return { ...asset, isMissing: false };
          }
          return asset;
        } catch {
          missingIds.push(asset.id);
          return { ...asset, isMissing: true };
        }
      }),
    );

    const hasChanges = updatedAssets.some(
      (a, i) => a.isMissing !== assets[i].isMissing,
    );
    if (hasChanges) {
      set({ mediaAssets: updatedAssets });
    }

    return missingIds;
  },

  relinkMediaAsset: async (assetId, newPath) => {
    const currentAssets = get().mediaAssets;
    const targetAsset = currentAssets.find((a) => a.id === assetId);
    if (!targetAsset) return { success: false, relinkedOtherCount: 0 };

    try {
      // 1. Probe new file metadata
      const filename = getFileName(newPath);
      let metadata: any = {
        duration: targetAsset.duration,
        width: targetAsset.width,
        height: targetAsset.height,
      };
      try {
        metadata = await platform.getMediaMetadata(newPath);
      } catch (e) {
        console.warn(
          "[projectStore] Metadata probe fallback during relink:",
          e,
        );
      }

      // 2. Extract new poster frame if video
      let newPosterFrame = targetAsset.posterFrame;
      if (targetAsset.type === "video") {
        try {
          newPosterFrame = await platform.extractPosterFrame(
            newPath,
            metadata.duration || targetAsset.duration || 1,
            window.devicePixelRatio || 1.0,
          );
        } catch (e) {
          console.warn(
            "[projectStore] Poster frame extraction fallback during relink:",
            e,
          );
        }
      } else if (targetAsset.type === "image") {
        newPosterFrame = platform.convertFileSrc(newPath);
      }

      const updatedTargetAsset: MediaAsset = {
        ...targetAsset,
        path: newPath,
        name: filename,
        duration: metadata.duration || targetAsset.duration,
        width: metadata.width || targetAsset.width,
        height: metadata.height || targetAsset.height,
        posterFrame: newPosterFrame,
        isMissing: false,
      };

      // 3. Scan same directory for other missing assets (automatic sibling relinking)
      const newDir = getDirectoryPath(newPath);
      let relinkedOtherCount = 0;
      const otherUpdatedAssets: MediaAsset[] = [];

      for (const asset of currentAssets) {
        if (asset.id === assetId) continue;
        if (asset.isMissing && newDir) {
          const siblingFileName = getFileName(asset.path);
          const candidatePath = joinPath(newDir, siblingFileName);
          try {
            const exists = await platform.fileExists(candidatePath);
            if (exists) {
              let sibMeta: any = {
                duration: asset.duration,
                width: asset.width,
                height: asset.height,
              };
              try {
                sibMeta = await platform.getMediaMetadata(candidatePath);
              } catch {}
              let sibPoster = asset.posterFrame;
              if (asset.type === "video") {
                try {
                  sibPoster = await platform.extractPosterFrame(
                    candidatePath,
                    sibMeta.duration || asset.duration || 1,
                    window.devicePixelRatio || 1.0,
                  );
                } catch {}
              } else if (asset.type === "image") {
                sibPoster = platform.convertFileSrc(candidatePath);
              }
              otherUpdatedAssets.push({
                ...asset,
                path: candidatePath,
                name: siblingFileName,
                duration: sibMeta.duration || asset.duration,
                width: sibMeta.width || asset.width,
                height: sibMeta.height || asset.height,
                posterFrame: sibPoster,
                isMissing: false,
              });
              relinkedOtherCount++;
              continue;
            }
          } catch {}
        }
        otherUpdatedAssets.push(asset);
      }

      // Update media assets in store
      const allUpdatedAssets = otherUpdatedAssets.map((a) =>
        a.id === assetId ? updatedTargetAsset : a,
      );
      const finalAssets = allUpdatedAssets.some((a) => a.id === assetId)
        ? allUpdatedAssets
        : [...allUpdatedAssets, updatedTargetAsset];
      set({ mediaAssets: finalAssets });

      // 4. Update timeline clips referencing relinked assets
      try {
        const { useTimelineStore } = await import("./timelineStore");
        const timelineState = useTimelineStore.getState();
        const relinkedMap = new Map<string, MediaAsset>();
        finalAssets.forEach((a) => {
          if (a.isMissing === false) relinkedMap.set(a.id, a);
        });

        const updatedClips = timelineState.clips.map((clip) => {
          const relinked = relinkedMap.get(clip.mediaId);
          if (!relinked) return clip;
          if (
            typeof relinked.duration === "number" &&
            relinked.duration > 0 &&
            clip.trimOut > relinked.duration
          ) {
            const nextTrimOut = relinked.duration;
            const nextDuration = Math.max(0.1, nextTrimOut - clip.trimIn);
            return {
              ...clip,
              trimOut: nextTrimOut,
              duration: nextDuration,
            };
          }
          return clip;
        });

        useTimelineStore.setState({ clips: updatedClips });
      } catch (err) {
        console.warn(
          "[projectStore] Failed to update timeline clips during relink:",
          err,
        );
      }

      // 5. Invalidate waveform cache
      try {
        const { clearWaveformServiceCache } =
          await import("@/core/audio/waveformService");
        clearWaveformServiceCache();
      } catch {}

      // 6. Schedule auto-save
      get().scheduleAutoSave();
      return { success: true, relinkedOtherCount };
    } catch (error) {
      console.error("[projectStore] Failed to relink media asset:", error);
      return { success: false, relinkedOtherCount: 0 };
    }
  },

  promptRelinkMedia: async (assetId) => {
    const asset = get().mediaAssets.find((a) => a.id === assetId);
    if (!asset) return false;

    const filters =
      asset.type === "audio"
        ? [
            {
              name: "Audio Files",
              extensions: ["mp3", "wav", "aac", "flac", "m4a", "ogg"],
            },
          ]
        : asset.type === "image"
          ? [
              {
                name: "Image Files",
                extensions: ["png", "jpg", "jpeg", "webp", "svg", "gif"],
              },
            ]
          : [
              {
                name: "Media Files",
                extensions: ["mp4", "mov", "mkv", "webm", "flv", "avi"],
              },
            ];

    try {
      const selected = await platform.openFileDialog({
        multiple: false,
        filters,
      });

      if (!selected || !selected.length || !selected[0].path) {
        return false;
      }

      const newPath = selected[0].path;
      const { success, relinkedOtherCount } = await get().relinkMediaAsset(
        assetId,
        newPath,
      );

      if (success) {
        if (relinkedOtherCount > 0) {
          get().showToast(
            `Relinked ${asset.name} and ${relinkedOtherCount} other missing file(s)`,
          );
        } else {
          get().showToast(`Relinked ${asset.name} successfully`);
        }
        return true;
      } else {
        get().showToast(`Failed to relink ${asset.name}`, "error");
        return false;
      }
    } catch (err) {
      console.error("[projectStore] promptRelinkMedia error:", err);
      get().showToast(`Failed to relink media`, "error");
      return false;
    }
  },

  updateProject: (updates) => {
    set((state) => ({
      project: state.project
        ? { ...state.project, ...updates, updatedAt: Date.now() }
        : null,
    }));
    get().scheduleAutoSave();
  },

  setProjectThumbnail: (thumbnail) => {
    set((state) => {
      if (!state.project || state.project.thumbnail === thumbnail) return state;
      const updatedProject = { ...state.project, thumbnail };
      const updatedRecent = state.recentProjects.map((p) =>
        p.kind === "ready" && p.id === updatedProject.id
          ? { ...p, thumbnail }
          : p,
      );
      return {
        project: updatedProject,
        recentProjects: updatedRecent,
      };
    });
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
        recentProjects: state.recentProjects.map((p) =>
          p.kind === "ready" && p.id === projectId
            ? { ...p, name: sanitizedName }
            : p,
        ),
      }));

      // If this project is currently open, update it too
      const currentProject = get().project;
      if (currentProject && currentProject.id === projectId) {
        set((state) => ({
          project: state.project
            ? { ...state.project, name: sanitizedName }
            : null,
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
      get().showToast("Failed to delete project", "error");
      throw error;
    }
  },

  closeProject: () =>
    withProjectTransition(async () => {
      currentLoadId++; // Cancel any active load
      get().clearProjectInitialization();

      // Hide the process-global child surface before disposing the session. This
      // is awaited through the same queue used by preview React effects, so an
      // old unmount cannot hide a surface belonging to the next project.
      await hideNativeSurfaceWhenIdle().catch((error) => {
        console.warn(
          "[projectStore] Native preview surface was already unavailable during close",
          error,
        );
      });

      // Cancel the debounce, then always flush the latest in-memory state. This
      // is intentionally independent of the auto-save preference and timer.
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
      }

      if (get().project) {
        try {
          await get().saveCurrentProject();
          get().showToast("Project saved");
        } catch (error) {
          get().showToast("Failed to save before closing", "error");
          throw error;
        }
      }

      // saveCurrentProject may schedule a crash-recovery flush. Finish that
      // write before clearing the snapshot, otherwise close and reopen can race
      // and recreate the snapshot that close is meant to remove.
      if (crashRecoveryPromise) {
        await crashRecoveryPromise.catch((error) => {
          console.warn(
            "[projectStore] Crash-recovery flush did not finish cleanly during close",
            error,
          );
        });
      }

      // ═══════════════════════════════════════════════════════════════════════════════
      // PHASE 1: Dispose Runtime Session
      // ═══════════════════════════════════════════════════════════════════════════════
      // Dispose runtime after we've saved timeline state to avoid save-read race
      try {
        const { disposeActiveSession } =
          await import("@/core/runtime/ProjectSession");
        await disposeActiveSession();
      } catch (err) {}

      // ═══════════════════════════════════════════════════════════════════════════════
      // PHASE 2: Reset All Project-Scoped State (CENTRALIZED)
      // ═══════════════════════════════════════════════════════════════════════════════
      try {
        const { resetAllProjectState } =
          await import("@/core/runtime/ProjectStateReset");
        await resetAllProjectState();
      } catch (err) {}

      // ═══════════════════════════════════════════════════════════════════════════════
      // PHASE 3: Clear ProjectStore State
      // ═══════════════════════════════════════════════════════════════════════════════
      const closedProjectId = get().project?.id;
      if (closedProjectId) clearNativeSurfaceReadiness(closedProjectId);
      set({ project: null, mediaAssets: [], isDirty: false });

      // ═══════════════════════════════════════════════════════════════════════════════
      // PHASE 4: Reset Timeline State
      // ═══════════════════════════════════════════════════════════════════════════════
      // Let timelineStore clear its own state
      try {
        const { useTimelineStore } = await import("./timelineStore");
        useTimelineStore.getState().hydrateFromProject({
          tracks: [],
          clips: [],
          transitions: [],
          gaps: [],
          captionTracks: [],
        });
      } catch (err) {}

      // ═══════════════════════════════════════════════════════════════════════════════
      // PHASE 5: Clear Crash-Recovery Snapshot & Thumbnail State
      // ═══════════════════════════════════════════════════════════════════════════════
      // On a clean close, cancel any pending timers and remove the IndexedDB snapshot
      // so we don't prompt for recovery the next time the user opens the application.
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
      }
      if (crashRecoveryTimer) {
        clearTimeout(crashRecoveryTimer);
        crashRecoveryTimer = null;
      }
      crashRecoveryFirstMutation = null;

      lifecycleMonitor.record("PROJECT_DISPOSE", {
        projectId: closedProjectId,
      });
      // Crash-recovery cleanup is part of a clean close. Await it so reopening
      // cannot immediately see a stale recovery snapshot from this project.
      await clearSnapshot().catch((error) => {
        console.warn(
          "[projectStore] Failed to clear crash-recovery snapshot during close",
          error,
        );
      });
      try {
        const { projectThumbnailService } =
          await import("@/core/thumbnails/ProjectThumbnailService");
        projectThumbnailService.reset();
      } catch {}
    }),

  saveCurrentProject: async () => {
    // Capture only after any earlier save has completed so this explicit
    // flush reflects the latest in-memory state, not an older queued payload.
    if (saveInProgress) {
      await saveInProgress.catch(() => undefined);
    }
    const snapshot = await captureCurrentProjectSnapshot();
    if (!snapshot) return null;
    const result = await persistCurrentProjectSnapshot(snapshot);
    if (result?.verified) {
      set({ isDirty: false });
    }
    const currentProjectId = get().project?.id;
    if (currentProjectId) {
      void flushCrashRecoverySnapshot(currentProjectId);
    }
    return result;
  },

  scheduleAutoSave: () => {
    set({ isDirty: true });

    // Independent crash recovery: ALWAYS maintains IndexedDB safety snapshot
    // even if the user has disabled automatic filesystem writes (autoSave: false).
    scheduleCrashRecoverySnapshot();

    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }

    // Respect the auto-save toggle from settings for writing to the filesystem
    if (!useSettingsStore.getState().autoSave) return;

    // ✅ FIX-001: Capture project ID at schedule time to prevent cross-project corruption
    const scheduledProjectId = get().project?.id;
    if (!scheduledProjectId) return;

    autoSaveTimer = setTimeout(async () => {
      const state = get();
      const { project } = state;

      if (!project) return;

      // ✅ FIX-001: Validate project hasn't changed during debounce window
      if (project.id !== scheduledProjectId) {
        return;
      }

      try {
        const snapshot = await captureCurrentProjectSnapshot();
        if (!snapshot || snapshot.project.id !== scheduledProjectId) return;

        const result = await persistCurrentProjectSnapshot(snapshot);
        if (result?.verified) {
          set({ isDirty: false });
        }
        get().showToast("Project saved");

        // ── Canonical Project Thumbnail Generation ───────────────────────
        try {
          const { projectThumbnailService } =
            await import("@/core/thumbnails/ProjectThumbnailService");
          projectThumbnailService.requestThumbnailUpdate(
            snapshot.project,
            {
              tracks: snapshot.tracks,
              clips: snapshot.clips,
              transitions: snapshot.transitions,
              gaps: snapshot.gaps,
              markers: snapshot.markers,
              mediaAssets: snapshot.mediaAssets,
              epoch: snapshot.epoch,
            },
            { isAutoSave: true },
          );
        } catch (_thumbError) {
          // Non-fatal background task
        }
      } catch (error) {
        // Background operation — silent fail
      }
    }, AUTO_SAVE_DELAY);
  },
}));
