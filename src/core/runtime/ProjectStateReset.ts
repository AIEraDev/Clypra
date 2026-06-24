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
import { getFrameScheduler } from "../scheduler/FrameScheduler";
import { performanceMonitor } from "@/lib/monitoring/PerformanceMonitor";

/**
 * Reset options - allows selective reset for testing
 */
export interface ResetOptions {
  /** Reset history store (undo/redo) */
  resetHistory?: boolean;
  /** Reset playback clock */
  resetPlayback?: boolean;
  /** Reset frame scheduler */
  resetScheduler?: boolean;
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
}

/**
 * Default reset options - reset everything
 */
const DEFAULT_RESET_OPTIONS: Required<ResetOptions> = {
  resetHistory: true,
  resetPlayback: true,
  resetScheduler: true,
  resetUI: true,
  resetDrag: true,
  resetViewport: true,
  resetTransform: true,
  resetMonitoring: true,
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

  console.log("🔄 [PROJECT RESET] Starting complete state reset...");

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 1: Stop Active Operations
  // ═══════════════════════════════════════════════════════════════════════════════

  if (opts.resetPlayback) {
    try {
      const clock = getPlaybackClock();

      // Stop playback (pause + reset to beginning)
      if (clock.state === "playing") {
        clock.pause();
      }

      // Reset time to 0 (CRITICAL: prevents wrong time on next project)
      clock.seek(0);

      resetSubsystems.push("PlaybackClock");
      console.log("  ✅ PlaybackClock reset (stopped and seeked to 0)");
    } catch (error) {
      errors.push({ subsystem: "PlaybackClock", error: error as Error });
      console.error("  ❌ PlaybackClock reset failed:", error);
    }
  }

  if (opts.resetScheduler) {
    try {
      const scheduler = getFrameScheduler();

      // Cancel all pending render jobs
      scheduler.cancelAll();

      // Clear timeline cache (forces fresh render on next project)
      // Note: FrameScheduler doesn't have clearTimelineCache() method yet,
      // but cancelAll() already clears pending jobs

      resetSubsystems.push("FrameScheduler");
      console.log("  ✅ FrameScheduler reset (all jobs cancelled)");
    } catch (error) {
      errors.push({ subsystem: "FrameScheduler", error: error as Error });
      console.error("  ❌ FrameScheduler reset failed:", error);
    }
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
      console.log("  ✅ DragStateStore reset");
    } catch (error) {
      errors.push({ subsystem: "DragStateStore", error: error as Error });
      console.error("  ❌ DragStateStore reset failed:", error);
    }
  }

  if (opts.resetTransform) {
    try {
      const { getTransformController } = await import("@/core/interactions");
      const transformController = getTransformController();

      // Cancel any active transform operation by calling endTransform()
      transformController.endTransform();

      resetSubsystems.push("TransformController");
      console.log("  ✅ TransformController reset");
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
        showSettingsModal: false,
        previewMode: "program",
        sourceAsset: null,
        sourceTextPreset: null,
        sourceInPoint: null,
        sourceOutPoint: null,
      });

      resetSubsystems.push("UIStore");
      console.log("  ✅ UIStore reset");
    } catch (error) {
      errors.push({ subsystem: "UIStore", error: error as Error });
      console.error("  ❌ UIStore reset failed:", error);
    }
  }

  if (opts.resetViewport) {
    try {
      const { getViewportController } = await import("@/core/interactions");
      const viewportController = getViewportController();

      // Reset viewport zoom/pan to defaults
      viewportController.reset();

      resetSubsystems.push("ViewportController");
      console.log("  ✅ ViewportController reset");
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
      console.log("  ✅ HistoryStore reset (undo/redo cleared)");
    } catch (error) {
      errors.push({ subsystem: "HistoryStore", error: error as Error });
      console.error("  ❌ HistoryStore reset failed:", error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 5: Reset Monitoring/Debugging
  // ═══════════════════════════════════════════════════════════════════════════════

  if (opts.resetMonitoring) {
    try {
      // Reset performance monitor (clears aggregated stats)
      performanceMonitor.reset();

      // Clear preview media sync clip filter cache (prevents stale cache across projects)
      const { clearClipFilterCache } = await import("@/components/editor/preview/previewMediaSync");
      clearClipFilterCache();

      resetSubsystems.push("PerformanceMonitor");
      console.log("  ✅ PerformanceMonitor reset");
    } catch (error) {
      errors.push({ subsystem: "PerformanceMonitor", error: error as Error });
      console.error("  ❌ PerformanceMonitor reset failed:", error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════════════

  const success = errors.length === 0;

  if (success) {
    console.log(`✅ [PROJECT RESET] Complete! Reset ${resetSubsystems.length} subsystems`);
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
    resetScheduler: subsystem === "resetScheduler",
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
