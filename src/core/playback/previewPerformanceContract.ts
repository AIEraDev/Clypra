/**
 * Shared contract for preview-path qualification and telemetry.
 *
 * This module is intentionally in-memory only. A qualification run is a
 * diagnostic session, never a persisted user preference or localStorage flag.
 */

export type PreviewPerformanceScenario =
  | "playback"
  | "seek"
  | "scrub"
  | "paused-interaction"
  | "qualification";

export type PreviewPerformancePath = "native" | "webview";

export type PreviewPerformanceSampleKind =
  | "frame-anomaly"
  | "window-rollup"
  | "qualification-summary"
  | "interaction";

export const PREVIEW_PERFORMANCE_BUDGETS = {
  targetFps: 60,
  playbackFrameBudgetUs: 16_667,
  interactionP95BudgetMs: 100,
  droppedFrameRatio: 0.01,
  qualificationDurationMs: 30_000,
  minimumPreliminaryFrames: 300,
  minimumQualifiedFrames: 1_500,
} as const;

export interface PreviewQualificationState {
  status: "idle" | "running" | "complete" | "cancelled";
  runId: string | null;
  path: PreviewPerformancePath | null;
  scenario: "qualification";
  durationMs: number;
  startedAtMs: number | null;
  completedPaths: PreviewPerformancePath[];
}

export interface PreviewQualificationCallbacks {
  onPathChange?: (path: PreviewPerformancePath) => void;
  onComplete?: () => void;
  /** Keeps both passes tied to the same project/render-settings snapshot. */
  isSnapshotValid?: () => boolean;
}

const idleState = (): PreviewQualificationState => ({
  status: "idle",
  runId: null,
  path: null,
  scenario: "qualification",
  durationMs: PREVIEW_PERFORMANCE_BUDGETS.qualificationDurationMs,
  startedAtMs: null,
  completedPaths: [],
});

function makeRunId(): string {
  return `qualification_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Coordinates one Native pass followed by one WebView pass. */
class PreviewQualificationController {
  private state: PreviewQualificationState = idleState();
  private listeners = new Set<(state: PreviewQualificationState) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private callbacks: PreviewQualificationCallbacks = {};

  getState(): PreviewQualificationState {
    return { ...this.state, completedPaths: [...this.state.completedPaths] };
  }

  subscribe(listener: (state: PreviewQualificationState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  start(
    callbacks: PreviewQualificationCallbacks = {},
    durationMs: number = PREVIEW_PERFORMANCE_BUDGETS.qualificationDurationMs,
  ): PreviewQualificationState {
    this.cancel(false);
    this.callbacks = callbacks;
    this.state = {
      status: "running",
      runId: makeRunId(),
      path: "native",
      scenario: "qualification",
      durationMs: Math.max(1_000, Math.round(durationMs)),
      startedAtMs: Date.now(),
      completedPaths: [],
    };
    this.emit();
    this.callbacks.onPathChange?.("native");
    this.schedulePathChange();
    return this.getState();
  }

  cancel(markCancelled = true): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.state.status === "running" && markCancelled) {
      this.state = { ...this.state, status: "cancelled", path: null };
      this.emit();
    } else if (markCancelled) {
      this.state = idleState();
      this.emit();
    }
  }

  private schedulePathChange(): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.state.status !== "running") return;

      if (this.state.path === "native") {
        if (this.callbacks.isSnapshotValid && !this.callbacks.isSnapshotValid()) {
          this.cancel();
          return;
        }
        this.state = {
          ...this.state,
          path: "webview",
          completedPaths: [...this.state.completedPaths, "native"],
          startedAtMs: Date.now(),
        };
        this.emit();
        this.callbacks.onPathChange?.("webview");
        this.schedulePathChange();
        return;
      }

      if (this.callbacks.isSnapshotValid && !this.callbacks.isSnapshotValid()) {
        this.cancel();
        return;
      }
      this.state = {
        ...this.state,
        status: "complete",
        path: null,
        completedPaths: [...this.state.completedPaths, "webview"],
      };
      this.emit();
      this.callbacks.onComplete?.();
    }, this.state.durationMs);
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export const previewQualificationController = new PreviewQualificationController();
