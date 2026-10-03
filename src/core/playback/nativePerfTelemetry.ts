import type {
  NativeFrameRequest,
  NativePreviewMode,
} from "@/lib/platform/nativeCore";
import { telemetryCollector } from "@/services/telemetryCollector";
import type {
  TelemetryOperationMode,
  TelemetryStageTimings,
  TelemetryPreviewContext,
} from "@/services/telemetryCollector";

export interface NativeFrontendPerfSample {
  requestId: string;
  generation?: number;
  frameIndex: number;
  mode: NativePreviewMode;
  dispatchMs: number;
  ipcMs: number;
  canvasPaintMs?: number;
  /** Time from canvas draw completion to the next rAF callback. */
  paintRafMs?: number;
  /** Rust send timestamp (t8) to WebView receipt (t9), for push transport. */
  transportReceiveMs?: number;
  /** Rust send timestamp (t8) to the canvas paint boundary (t11). */
  frameAgeAtPaintMs?: number;
  transport?: "invoke" | "push-channel";
  totalMs: number;
  dropped: boolean;
  stale: boolean;
  cancelled: boolean;
  dropReason?:
    | "stale"
    | "cancelled"
    | "late-for-audio"
    | "present-failed"
    | "lookahead-miss";
  previewContext?: TelemetryPreviewContext;
  stageTimings?: Partial<TelemetryStageTimings>;
  readbackMaxDimension?: number;
  readbackTier?: number;
  readbackCadenceFps?: number;
  playbackSpeed?: number;
  readbackSourceFrameStride?: number;
}

export interface NativeFrontendStagePercentiles {
  p50: number | null;
  p95: number | null;
  p99: number | null;
  sampleCount: number;
}

export interface NativeFrontendModeStats {
  mode: NativePreviewMode;
  dispatch: NativeFrontendStagePercentiles;
  ipc: NativeFrontendStagePercentiles;
  canvasPaint: NativeFrontendStagePercentiles;
  paintRaf: NativeFrontendStagePercentiles;
  transportReceive: NativeFrontendStagePercentiles;
  frameAgeAtPaint: NativeFrontendStagePercentiles;
  total: NativeFrontendStagePercentiles;
  droppedCount: number;
  staleCount: number;
  cancelledCount: number;
  nativeSurfaceCount: number;
  bridgeCount: number;
  bridgeFallbackReasons: Record<string, number>;
  transportCounts: Record<string, number>;
  /**
   * Unique source frames painted per second, measured over an active-playback
   * window (resets after 500 ms of silence). An UNCH-skipped frame is NOT
   * counted. This is the metric that tells whether the producer delivers
   * distinct content, not just whether requests are being answered.
   */
  uniqueFramesPaintedPerSecond: number | null;
  /**
   * Source timeline advance per wall-clock second, measured over the same
   * active-playback window. Should be ~1.0 at 1× speed, lower if the
   * producer can't keep up.
   */
  playbackClockRate: number | null;
}

export interface NativePushBridgeFrontendStats {
  paintedFrames: number;
  rejectedGenerationPackets: number;
  /** WebView receive silence; not equivalent to Rust flow-control stall. */
  receiverIdle: number;
}

const TRACE_STORAGE_KEY = "clypra:debug:native-perf";
const RING_CAPACITY = 600;

function readTraceFlag(): boolean {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(TRACE_STORAGE_KEY) === "1"
    );
  } catch {
    return false;
  }
}

function percentile(values: number[], pct: number): number | null {
  if (values.length === 0) return null;
  values.sort((left, right) => left - right);
  return values[Math.round((values.length - 1) * pct)] ?? null;
}

function stagePercentiles(
  samples: readonly NativeFrontendPerfSample[],
  pick: (sample: NativeFrontendPerfSample) => number | undefined,
): NativeFrontendStagePercentiles {
  const values = samples
    .map(pick)
    .filter(
      (value): value is number => value !== undefined && Number.isFinite(value),
    );
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    sampleCount: values.length,
  };
}

export function previewFrameDeadlineUs(sample: NativeFrontendPerfSample): number {
  // Playback frames deliberately follow the adaptive readback cadence. Using
  // a fixed 60 Hz deadline marks every expected 30 Hz bridge frame as jank.
  if (sample.mode === "playback" && (sample.readbackCadenceFps ?? 0) > 0) {
    return Math.round(1_000_000 / (sample.readbackCadenceFps as number));
  }
  return 16_667;
}

export class NativePerfSpan {
  private readonly startedAt = performance.now();
  private dispatchStartedAt = this.startedAt;
  private ipcStartedAt: number | null = null;
  private ipcMs = 0;
  private finished = false;

  constructor(
    private readonly collector: NativePerfCollector,
    private readonly request: NativeFrameRequest,
    private readonly mode: NativePreviewMode,
    private readonly previewContext?: TelemetryPreviewContext,
    /** Immutable limits used to create this WebView RGBA request. */
    private readonly readbackPolicy?: Pick<
      NativeFrontendPerfSample,
      | "readbackMaxDimension"
      | "readbackTier"
      | "readbackCadenceFps"
      | "playbackSpeed"
      | "readbackSourceFrameStride"
    >,
  ) {}

  markDispatchStarted(): void {
    if (this.finished) return;
    this.dispatchStartedAt = performance.now();
  }

  markIpcStarted(): void {
    if (this.finished) return;
    this.ipcStartedAt = performance.now();
  }

  markIpcFinished(): void {
    if (this.finished || this.ipcStartedAt === null) return;
    this.ipcMs += Math.max(0, performance.now() - this.ipcStartedAt);
    this.ipcStartedAt = null;
  }

  finish(
    options: {
      canvasPaintMs?: number;
      transportReceiveMs?: number;
      frameAgeAtPaintMs?: number;
      transport?: "invoke" | "push-channel";
      dropped?: boolean;
      stale?: boolean;
      cancelled?: boolean;
      dropReason?:
        | "stale"
        | "cancelled"
        | "late-for-audio"
        | "present-failed"
        | "lookahead-miss";
      stageTimings?: Partial<TelemetryStageTimings>;
      readbackMaxDimension?: number;
      readbackTier?: number;
      readbackCadenceFps?: number;
      playbackSpeed?: number;
      readbackSourceFrameStride?: number;
    } = {},
  ): void {
    if (this.finished) return;
    this.markIpcFinished();
    this.finished = true;
    // The synchronous canvas draw is the delivery boundary. The following
    // rAF is retained as a separate compositor-observation metric; including
    // it in `totalMs` waits for another frame tick and turns a 30 FPS bridge
    // delivery into a misleading ~15 FPS latency measurement.
    const deliveredAt = performance.now();
    const deliveryTotalMs = Math.max(0, deliveredAt - this.startedAt);
    const record = (paintRafMs?: number) => this.collector.record({
      requestId: this.request.requestId,
      generation: this.request.generation,
      frameIndex: this.request.frameTime.frameIndex,
      mode: this.mode,
      dispatchMs: Math.max(0, this.dispatchStartedAt - this.startedAt),
      ipcMs: this.ipcMs,
      canvasPaintMs: options.canvasPaintMs,
      paintRafMs,
      transportReceiveMs: options.transportReceiveMs,
      frameAgeAtPaintMs: options.frameAgeAtPaintMs,
      transport: options.transport,
      totalMs: deliveryTotalMs,
      dropped: options.dropped === true,
      stale: options.stale === true,
      cancelled: options.cancelled === true,
      dropReason: options.dropReason,
      previewContext: this.previewContext,
      stageTimings: options.stageTimings,
      readbackMaxDimension:
        options.readbackMaxDimension ?? this.readbackPolicy?.readbackMaxDimension,
      readbackTier: options.readbackTier ?? this.readbackPolicy?.readbackTier,
      readbackCadenceFps:
        options.readbackCadenceFps ?? this.readbackPolicy?.readbackCadenceFps,
      playbackSpeed: options.playbackSpeed ?? this.readbackPolicy?.playbackSpeed,
      readbackSourceFrameStride:
        options.readbackSourceFrameStride ??
        this.readbackPolicy?.readbackSourceFrameStride,
    });
    // Canvas APIs are synchronous but do not prove that the browser compositor
    // presented the pixels. A following rAF is the least-invasive WebView
    // boundary we can observe without introducing a per-frame IPC reply.
    if (
      options.canvasPaintMs !== undefined &&
      typeof requestAnimationFrame !== "undefined"
    ) {
      const paintCommittedAt = performance.now();
      requestAnimationFrame(() =>
        record(Math.max(0, performance.now() - paintCommittedAt)),
      );
    } else {
      record();
    }
  }
}

/** Rolling window state for uniqueFramesPaintedPerSecond / playbackClockRate. */
interface UniqueFrameWindow {
  /** Distinct source frameIndex values seen in the current window. */
  frameIndexes: Set<number>;
  /** wall-clock time (performance.now()) of the first sample in the window. */
  windowStartMs: number;
  /** wall-clock time of the most recent non-dropped sample. */
  lastSampleMs: number;
  /** Source timeline position (in seconds) of the first sample in the window. */
  firstSourceSecs: number | null;
  /** Source timeline position (in seconds) of the most recent sample. */
  lastSourceSecs: number | null;
}

function emptyUniqueFrameWindow(): UniqueFrameWindow {
  return {
    frameIndexes: new Set(),
    windowStartMs: performance.now(),
    lastSampleMs: performance.now(),
    firstSourceSecs: null,
    lastSourceSecs: null,
  };
}

/** Gap longer than this (ms) resets the unique-frame window. */
const UNIQUE_FRAME_WINDOW_RESET_MS = 500;

class NativePerfCollector {
  private readonly samples = new Map<
    NativePreviewMode,
    NativeFrontendPerfSample[]
  >();
  /** Per-mode rolling unique-frame windows. */
  private readonly uniqueWindows = new Map<
    NativePreviewMode,
    UniqueFrameWindow
  >();
  // Keep the frontend/native boundary observable in every build for now. The
  // collector is bounded and forwards through the existing batched transport;
  // the user telemetry setting can still disable it intentionally.
  private enabled = true;
  private pushBridge: NativePushBridgeFrontendStats = {
    paintedFrames: 0,
    rejectedGenerationPackets: 0,
    receiverIdle: 0,
  };

  constructor() {
    for (const mode of [
      "playback",
      "playback-lookahead",
      "seek",
      "scrub",
      "frame-step",
      "prefetch",
    ] as NativePreviewMode[]) {
      this.samples.set(mode, []);
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) this.clear();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  begin(
    request: NativeFrameRequest,
    previewContext?: TelemetryPreviewContext,
    readbackPolicy?: Pick<
      NativeFrontendPerfSample,
      | "readbackMaxDimension"
      | "readbackTier"
      | "readbackCadenceFps"
      | "playbackSpeed" | "readbackSourceFrameStride"
    >,
  ): NativePerfSpan {
    return new NativePerfSpan(
      this,
      request,
      normalizeMode(request.mode),
      previewContext,
      readbackPolicy,
    );
  }

  record(sample: NativeFrontendPerfSample): void {
    if (!this.enabled) return;
    const bucket = this.samples.get(sample.mode);
    if (!bucket) return;
    bucket.push(sample);
    if (bucket.length > RING_CAPACITY) bucket.shift();

    // PR2: maintain unique-frame window for non-dropped playback samples.
    // An UNCH-skipped frame has no frameIndex advancement — it's handled in
    // NativeProgramPreview.tsx by not calling span.finish() at all, so
    // dropped frames here are legitimate late/stale drops, not UNCH skips.
    if (!sample.dropped && !sample.stale && !sample.cancelled) {
      const nowMs = performance.now();
      let win = this.uniqueWindows.get(sample.mode);
      if (!win || nowMs - win.lastSampleMs > UNIQUE_FRAME_WINDOW_RESET_MS) {
        win = emptyUniqueFrameWindow();
        win.windowStartMs = nowMs;
        this.uniqueWindows.set(sample.mode, win);
      }
      win.frameIndexes.add(sample.frameIndex);
      win.lastSampleMs = nowMs;
      // Derive source timeline seconds from frameIndex + cadence fps if available
      if (sample.readbackCadenceFps && sample.readbackCadenceFps > 0) {
        const sourceSecs = sample.frameIndex / sample.readbackCadenceFps;
        if (win.firstSourceSecs === null) win.firstSourceSecs = sourceSecs;
        win.lastSourceSecs = sourceSecs;
      }
    }

    telemetryCollector.recordRenderSpan(
      {
        ...sample.stageTimings,
        schedulerWaitUs: Math.round(sample.dispatchMs * 1000),
        // This is intentionally the end-to-end WebView bridge duration, not
        // a claim about queueing inside Tauri IPC alone. It includes native
        // render/readback, payload serialization, and canvas-bound response
        // delivery. Native stage samples carry the decomposition.
        ipcWaitUs: Math.round(sample.ipcMs * 1000),
        canvasPaintUs:
          sample.canvasPaintMs !== undefined
            ? Math.round(sample.canvasPaintMs * 1000)
            : undefined,
        webviewPaintRafUs:
          sample.paintRafMs !== undefined
            ? Math.round(sample.paintRafMs * 1000)
            : undefined,
        // The native invoke boundary includes the RGBA payload transfer for
        // WebView. Surface that measured bridge duration as transfer cost;
        // native-sample readback remains the GPU/CPU readback measurement.
        transferUs:
          sample.previewContext?.view === "webview"
            ? Math.round(sample.ipcMs * 1000)
            : undefined,
        totalTimeUs: Math.round(sample.totalMs * 1000),
      },
      sample.dropped ? 1 : 0,
      1,
      {},
      toTelemetryMode(sample.mode),
      undefined,
      sample.stale ? 1 : 0,
      sample.cancelled ? 1 : 0,
      {
        previewContext: sample.previewContext,
        measurementId: `frontend:${sample.previewContext?.view ?? "unknown"}:${sample.previewContext?.surface ?? "unknown"}:${sample.requestId}:${sample.frameIndex}`,
        measurementSource: "frontend-span",
        sampleKind: "frame-anomaly",
        frameSequence: sample.frameIndex,
        deadlineUs: previewFrameDeadlineUs(sample),
        dropReason: sample.dropped
          ? (sample.dropReason ??
            (sample.cancelled
              ? "cancelled"
              : sample.stale
                ? "stale"
                : "present-failed"))
          : undefined,
        forceSample: sample.previewContext?.scenario === "qualification",
        // Native stage samples are the authoritative frame stream. The
        // frontend span is still retained for boundary diagnostics, but must
        // not count the same native frame a second time in session totals.
        includeInRollup: sample.previewContext?.view !== "native",
        readbackMaxDimension: sample.readbackMaxDimension,
        readbackTier: sample.readbackTier,
        readbackCadenceFps: sample.readbackCadenceFps,
        playbackSpeed: sample.playbackSpeed,
        readbackSourceFrameStride: sample.readbackSourceFrameStride,
      },
    );
  }

  statsFor(mode: NativePreviewMode): NativeFrontendModeStats {
    const samples = this.samples.get(mode) ?? [];
    const bridgeFallbackReasons: Record<string, number> = {};
    const transportCounts: Record<string, number> = {};
    for (const sample of samples) {
      const reason = sample.previewContext?.presenterFallbackReason;
      if (reason) bridgeFallbackReasons[reason] = (bridgeFallbackReasons[reason] ?? 0) + 1;
      if (sample.transport) transportCounts[sample.transport] = (transportCounts[sample.transport] ?? 0) + 1;
    }

    // PR2: compute unique-frame and clock-rate metrics from the rolling window.
    const win = this.uniqueWindows.get(mode);
    let uniqueFramesPaintedPerSecond: number | null = null;
    let playbackClockRate: number | null = null;
    if (win && win.frameIndexes.size > 0) {
      const wallSecs = (win.lastSampleMs - win.windowStartMs) / 1_000;
      if (wallSecs >= 0.5) {
        uniqueFramesPaintedPerSecond = win.frameIndexes.size / wallSecs;
        if (
          win.firstSourceSecs !== null &&
          win.lastSourceSecs !== null &&
          win.lastSourceSecs !== win.firstSourceSecs
        ) {
          const sourceSecs = win.lastSourceSecs - win.firstSourceSecs;
          playbackClockRate = sourceSecs / wallSecs;
        }
      }
    }

    return {
      mode,
      dispatch: stagePercentiles(samples, (sample) => sample.dispatchMs),
      ipc: stagePercentiles(samples, (sample) => sample.ipcMs),
      canvasPaint: stagePercentiles(samples, (sample) => sample.canvasPaintMs),
      paintRaf: stagePercentiles(samples, (sample) => sample.paintRafMs),
      transportReceive: stagePercentiles(samples, (sample) => sample.transportReceiveMs),
      frameAgeAtPaint: stagePercentiles(samples, (sample) => sample.frameAgeAtPaintMs),
      total: stagePercentiles(samples, (sample) => sample.totalMs),
      droppedCount: samples.filter((sample) => sample.dropped).length,
      staleCount: samples.filter((sample) => sample.stale).length,
      cancelledCount: samples.filter((sample) => sample.cancelled).length,
      nativeSurfaceCount: samples.filter(
        (sample) => sample.previewContext?.presenterMode === "native-surface",
      ).length,
      bridgeCount: samples.filter(
        (sample) => sample.previewContext?.presenterMode === "bridge",
      ).length,
      bridgeFallbackReasons,
      transportCounts,
      uniqueFramesPaintedPerSecond,
      playbackClockRate,
    };
  }


  allStats(): NativeFrontendModeStats[] {
    return [
      "playback",
      "playback-lookahead",
      "seek",
      "scrub",
      "frame-step",
      "prefetch",
    ].map((mode) => this.statsFor(mode as NativePreviewMode));
  }

  recordPushBridgeFrame(): void {
    this.pushBridge.paintedFrames += 1;
  }

  recordPushBridgeRejectedGeneration(): void {
    this.pushBridge.rejectedGenerationPackets += 1;
  }

  recordPushBridgeReceiverIdle(): void {
    this.pushBridge.receiverIdle += 1;
  }

  pushBridgeStats(): NativePushBridgeFrontendStats {
    return { ...this.pushBridge };
  }

  dump(mode?: NativePreviewMode): NativeFrontendPerfSample[] {
    if (mode) return [...(this.samples.get(mode) ?? [])];
    return [...this.samples.values()].flatMap((bucket) => bucket);
  }

  clear(): void {
    for (const bucket of this.samples.values()) bucket.length = 0;
    this.uniqueWindows.clear();
    this.pushBridge = { paintedFrames: 0, rejectedGenerationPackets: 0, receiverIdle: 0 };
  }
}

function normalizeMode(mode: NativeFrameRequest["mode"]): NativePreviewMode {
  if (mode === "frameStep") return "frame-step";
  return mode ?? "seek";
}

function toTelemetryMode(mode: NativePreviewMode): TelemetryOperationMode {
  if (mode === "seek") return "seek-cold";
  if (mode === "prefetch") return "playback-lookahead";
  return mode;
}

export const nativePerfCollector = new NativePerfCollector();

export function setNativePerfTraceEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(TRACE_STORAGE_KEY, enabled ? "1" : "0");
    }
  } catch {
    // The in-memory flag still controls collection when storage is unavailable.
  }
  nativePerfCollector.setEnabled(enabled);
}
