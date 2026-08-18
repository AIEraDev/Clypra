/**
 * Project State Reset - Centralized State Cleanup
 *
 * This module provides centralized state reset functionality to ensure
 * complete cleanup when closing projects. It addresses the issue where
 * state from one project leaks into another, causing bugs and confusion.
 *
 * PROBLEM:
 * When closing a project and opening another, various stores and controllers
 * retain state from the previous project, leading to:
 * - Stale undo/redo history
 * - Wrong playback position
 * - Incorrect RAF loop state
 * - Lingering drag/transform state
 * - Confusing performance metrics
 *
 * SOLUTION:
 * Centralized reset function called during project close that systematically
 * resets all stateful subsystems in the correct order.
 *
 * ARCHITECTURE:
 * Reset happens in phases:
 * 1. Stop active operations (playback, drag, transform)
 * 2. Clear interaction state (selections, UI)
 * 3. Reset controllers (viewport, transform)
 * 4. Reset stores (history, drag, UI)
 * 5. Reset singletons (clock, scheduler)
 * 6. Clear monitoring/debugging state
 *
 * USAGE:
 * Called automatically by projectStore.closeProject()
 * Can also be called manually for testing/debugging
 */

import { getPlaybackClock } from "../playback/PlaybackClock";

/**
 * Reset options - allows selective reset for testing
 */
export interface ResetOptions {
  /** Reset history store (undo/redo) */
  resetHistory?: boolean;
  /** Reset playback clock */
  resetPlayback?: boolean;

  /** Reset UI store */
  resetUI?: boolean;
  /** Reset drag state */
  resetDrag?: boolean;
  /** Reset viewport controller */
  resetViewport?: boolean;
  /** Reset transform controller */
  resetTransform?: boolean;
  /** Reset performance monitors */
  resetMonitoring?: boolean;
  /** Flush GPU texture cache */
  resetGPUCache?: boolean;
}

/**
 * Default reset options - reset everything
 */
const DEFAULT_RESET_OPTIONS: Required<ResetOptions> = {
  resetHistory: true,
  resetPlayback: true,

  resetUI: true,
  resetDrag: true,
  resetViewport: true,
  resetTransform: true,
  resetMonitoring: true,
  resetGPUCache: true,
};

/**
 * Reset result - reports what was reset and any errors
 */
export interface ResetResult {
  success: boolean;
  errors: Array<{ subsystem: string; error: Error }>;
  resetSubsystems: string[];
}

/**
 * Reset all project-scoped state.
 * Call this when closing a project to ensure clean slate for next project.
 *
 * @param options - Optional selective reset configuration
 * @returns Reset result with success status and any errors
 */
export async function resetAllProjectState(options: ResetOptions = {}): Promise<ResetResult> {
  const opts = { ...DEFAULT_RESET_OPTIONS, ...options };
  const errors: Array<{ subsystem: string; error: Error }> = [];
  const resetSubsystems: string[] = [];

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 1: Stop Active Operations
  // ═══════════════════════════════════════════════════════════════════════════════

  if (opts.resetPlayback) {
    try {
      const { resetPlaybackClock } = await import("../playback/PlaybackClock");
      resetPlaybackClock();

      resetSubsystems.push("PlaybackClock");
    } catch (error) {
      errors.push({ subsystem: "PlaybackClock", error: error as Error });
      console.error("  ❌ PlaybackClock reset failed:", error);
    }
  }

  // The audible preview engine is shared by the React preview and survives
  // session disposal. Flush it explicitly so audio cannot continue on the
  // launch screen after a project is closed.
  try {
    const { stopGlobalAudioEngine } = await import("@/hooks/useAudioSyncEngine");
    stopGlobalAudioEngine();
    resetSubsystems.push("GlobalAudioEngine");
  } catch (error) {
    errors.push({ subsystem: "GlobalAudioEngine", error: error as Error });
    console.error("  ❌ GlobalAudioEngine reset failed:", error);
  }



  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 2: Reset Interaction State
  // ═══════════════════════════════════════════════════════════════════════════════

  if (opts.resetDrag) {
    try {
      const { useDragStateStore } = await import("@/store/dragStateStore");

      // Use clearDragging() method which resets all drag state
      useDragStateStore.getState().clearDragging();

      resetSubsystems.push("DragStateStore");
    } catch (error) {
      errors.push({ subsystem: "DragStateStore", error: error as Error });
      console.error("  ❌ DragStateStore reset failed:", error);
    }
  }

  // Reset auto-save middleware suspension (BUG-006 fix)
  // If a project was closed mid-drag, _suspended may be permanently true
  try {
    const { resumeAutoSave } = await import("@/store/middleware/autoSaveMiddleware");
    resumeAutoSave();

    resetSubsystems.push("AutoSaveMiddleware");
  } catch (error) {
    errors.push({ subsystem: "AutoSaveMiddleware", error: error as Error });
    console.error("  ❌ AutoSaveMiddleware reset failed:", error);
  }

  if (opts.resetTransform) {
    try {
      const { resetTransformController } = await import("@/core/interactions");
      resetTransformController();

      resetSubsystems.push("TransformController");
    } catch (error) {
      errors.push({ subsystem: "TransformController", error: error as Error });
      console.error("  ❌ TransformController reset failed:", error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 3: Reset UI State
  // ═══════════════════════════════════════════════════════════════════════════════

  if (opts.resetUI) {
    try {
      const { useUIStore } = await import("@/store/uiStore");

      useUIStore.setState({
        selectedClipIds: [],
        selectedGapId: null,
        selectedTransitionId: null,
        selectedTrackId: null,
        previewMediaId: null,
        activePanel: "media",
        showExportModal: false,
        showNewProjectModal: false, // SC-BUG-006 fix
        showSettingsModal: false,
        previewMode: "program",
        sourceAsset: null,
        sourceTextPreset: null,
        sourceInPoint: null,
        sourceOutPoint: null,
      });

      resetSubsystems.push("UIStore");
    } catch (error) {
      errors.push({ subsystem: "UIStore", error: error as Error });
      console.error("  ❌ UIStore reset failed:", error);
    }
  }

  if (opts.resetViewport) {
    try {
      const { resetViewportController } = await import("@/core/interactions");
      resetViewportController();

      resetSubsystems.push("ViewportController");
    } catch (error) {
      errors.push({ subsystem: "ViewportController", error: error as Error });
      console.error("  ❌ ViewportController reset failed:", error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 4: Reset History
  // ═══════════════════════════════════════════════════════════════════════════════

  if (opts.resetHistory) {
    try {
      const { useHistoryStore } = await import("@/store/historyStore");

      // Clear undo/redo history (CRITICAL: prevents undoing into previous project)
      useHistoryStore.getState().clear();

      resetSubsystems.push("HistoryStore");
    } catch (error) {
      errors.push({ subsystem: "HistoryStore", error: error as Error });
      console.error("  ❌ HistoryStore reset failed:", error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASES 4b–6: Independent store / cache resets — run concurrently.
  // These modules have no ordering dependency on each other, so we batch all
  // their dynamic imports into a single Promise.all to avoid paying N × import
  // latency serially (which caused test timeouts in Vitest's module runner).
  // ═══════════════════════════════════════════════════════════════════════════════

  await Promise.all([
    // TemplateStore (SC-BUG-002 fix)
    import("@/features/text-templates/templateStore")
      .then(({ useTemplateStore }) => {
        useTemplateStore.getState().reset();
        resetSubsystems.push("TemplateStore");
      })
      .catch((error) => {
        errors.push({ subsystem: "TemplateStore", error: error as Error });
        console.error("  ❌ TemplateStore reset failed:", error);
      }),

    // FavoritesStore (SC-HIDDEN-002 / Q2 fix)
    import("@/store/favoritesStore")
      .then(({ useFavoritesStore }) => {
        useFavoritesStore.setState({ downloadingIds: [] });
        resetSubsystems.push("FavoritesStore");
      })
      .catch((error) => {
        errors.push({ subsystem: "FavoritesStore", error: error as Error });
        console.error("  ❌ FavoritesStore reset failed:", error);
      }),

    // previewMediaSync filter cache
    opts.resetMonitoring
      ? import("@/components/editor/preview/previewMediaSync")
          .then(({ clearClipFilterCache }) => {
            clearClipFilterCache();
            resetSubsystems.push("Monitoring");
          })
          .catch((error) => {
            errors.push({ subsystem: "Monitoring", error: error as Error });
            console.error("  ❌ Monitoring reset failed:", error);
          })
      : Promise.resolve(),

    // ResourceCache (BUG-003 fix)
    import("../resources/ResourceCache")
      .then(({ resetResourceCache }) => {
        resetResourceCache();
        resetSubsystems.push("ResourceCache");
      })
      .catch((error) => {
        errors.push({ subsystem: "ResourceCache", error: error as Error });
        console.error("  ❌ ResourceCache reset failed:", error);
      }),

    // BodyMaskCache (SC-BUG-004 fix)
    import("@/features/body-effects/segmentation/maskCache")
      .then(({ bodyMaskCache }) => {
        bodyMaskCache.clear();
        resetSubsystems.push("BodyMaskCache");
      })
      .catch((error) => {
        errors.push({ subsystem: "BodyMaskCache", error: error as Error });
        console.error("  ❌ BodyMaskCache clear failed:", error);
      }),

    // EvaluationCache (PREV-BUG-002 fix) — prevents cross-project scene contamination
    import("../evaluation/evaluator")
      .then(({ clearEvaluationCache }) => {
        clearEvaluationCache();
        resetSubsystems.push("EvaluationCache");
      })
      .catch((error) => {
        errors.push({ subsystem: "EvaluationCache", error: error as Error });
        console.error("  ❌ EvaluationCache clear failed:", error);
      }),



    // GlobalGPUCache
    opts.resetGPUCache
      ? import("@/lib/cache/globalGPUCache")
          .then(({ globalGPUCache }) => {
            const evicted = globalGPUCache.clearAllTextures();
            resetSubsystems.push("GlobalGPUCache");
          })
          .catch((error) => {
            errors.push({ subsystem: "GlobalGPUCache", error: error as Error });
            console.error("  ❌ GlobalGPUCache flush failed:", error);
          })
      : Promise.resolve(),
  ]);

  // ═══════════════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════════════

  const success = errors.length === 0;

  if (success) {
  } else {
    console.warn(`⚠️ [PROJECT RESET] Completed with ${errors.length} errors. Reset ${resetSubsystems.length} subsystems`);
    errors.forEach(({ subsystem, error }) => {
      console.error(`  - ${subsystem}: ${error.message}`);
    });
  }

  return {
    success,
    errors,
    resetSubsystems,
  };
}

/**
 * Quick reset for specific subsystems.
 * Useful for testing or selective cleanup.
 */
export async function resetSubsystem(subsystem: keyof ResetOptions): Promise<void> {
  await resetAllProjectState({
    [subsystem]: true,
    // Disable all others
    resetHistory: subsystem === "resetHistory",
    resetPlayback: subsystem === "resetPlayback",

    resetUI: subsystem === "resetUI",
    resetDrag: subsystem === "resetDrag",
    resetViewport: subsystem === "resetViewport",
    resetTransform: subsystem === "resetTransform",
    resetMonitoring: subsystem === "resetMonitoring",
  });
}

/**
 * Check if any subsystem has stale state.
 * Useful for debugging state leakage.
 */
export async function detectStaleState(): Promise<{
  hasStaleState: boolean;
  staleSubsystems: string[];
  details: Record<string, any>;
}> {
  const staleSubsystems: string[] = [];
  const details: Record<string, any> = {};

  try {
    // Check PlaybackClock
    const clock = getPlaybackClock();
    if (clock.time !== 0) {
      staleSubsystems.push("PlaybackClock");
      details.PlaybackClock = { time: clock.time, state: clock.state };
    }

    // Check HistoryStore
    const { useHistoryStore } = await import("@/store/historyStore");
    const historyState = useHistoryStore.getState().state;
    if (historyState.size > 0) {
      staleSubsystems.push("HistoryStore");
      details.HistoryStore = { size: historyState.size, canUndo: historyState.canUndo };
    }

    // Check UIStore
    const { useUIStore } = await import("@/store/uiStore");
    const uiState = useUIStore.getState();
    if (uiState.selectedClipIds.length > 0 || uiState.selectedGapId || uiState.previewMode !== "program") {
      staleSubsystems.push("UIStore");
      details.UIStore = {
        selectedClips: uiState.selectedClipIds.length,
        previewMode: uiState.previewMode,
      };
    }

    // Check DragStateStore
    const { useDragStateStore } = await import("@/store/dragStateStore");
    const dragState = useDragStateStore.getState();
    if (dragState.draggingClip) {
      staleSubsystems.push("DragStateStore");
      details.DragStateStore = { draggingClip: dragState.draggingClip };
    }
  } catch (error) {
    console.error("Error detecting stale state:", error);
  }

  return {
    hasStaleState: staleSubsystems.length > 0,
    staleSubsystems,
    details,
  };
}
