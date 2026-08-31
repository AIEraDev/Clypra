import type { NativeFrameRequest, NativePreviewMode } from "@/lib/platform/nativeCore";
import { telemetryCollector } from "@/services/telemetryCollector";
import type {
  TelemetryOperationMode,
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
  totalMs: number;
  dropped: boolean;
  stale: boolean;
  cancelled: boolean;
  previewContext?: TelemetryPreviewContext;
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
  total: NativeFrontendStagePercentiles;
  droppedCount: number;
  staleCount: number;
  cancelledCount: number;
}

const TRACE_STORAGE_KEY = "clypra:debug:native-perf";
const RING_CAPACITY = 600;

function readTraceFlag(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(TRACE_STORAGE_KEY) === "1";
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
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    sampleCount: values.length,
  };
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

  finish(options: {
    canvasPaintMs?: number;
    dropped?: boolean;
    stale?: boolean;
    cancelled?: boolean;
  } = {}): void {
    if (this.finished) return;
    this.markIpcFinished();
    this.finished = true;
    this.collector.record({
      requestId: this.request.requestId,
      generation: this.request.generation,
      frameIndex: this.request.frameTime.frameIndex,
      mode: this.mode,
      dispatchMs: Math.max(0, this.dispatchStartedAt - this.startedAt),
      ipcMs: this.ipcMs,
      canvasPaintMs: options.canvasPaintMs,
      totalMs: Math.max(0, performance.now() - this.startedAt),
      dropped: options.dropped === true,
      stale: options.stale === true,
      cancelled: options.cancelled === true,
      previewContext: this.previewContext,
    });
  }
}

class NativePerfCollector {
  private readonly samples = new Map<NativePreviewMode, NativeFrontendPerfSample[]>();
  // Keep the frontend/native boundary observable in every build for now. The
  // collector is bounded and forwards through the existing batched transport;
  // the user telemetry setting can still disable it intentionally.
  private enabled = true;

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

  begin(request: NativeFrameRequest, previewContext?: TelemetryPreviewContext): NativePerfSpan {
    return new NativePerfSpan(this, request, normalizeMode(request.mode), previewContext);
  }

  record(sample: NativeFrontendPerfSample): void {
    if (!this.enabled) return;
    const bucket = this.samples.get(sample.mode);
    if (!bucket) return;
    bucket.push(sample);
    if (bucket.length > RING_CAPACITY) bucket.shift();

    telemetryCollector.recordRenderSpan(
      {
        schedulerWaitUs: Math.round(sample.dispatchMs * 1000),
        ipcWaitUs: Math.round(sample.ipcMs * 1000),
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
        measurementId: `frontend:${sample.requestId}:${sample.frameIndex}`,
        measurementSource: "frontend-span",
      },
    );
  }

  statsFor(mode: NativePreviewMode): NativeFrontendModeStats {
    const samples = this.samples.get(mode) ?? [];
    return {
      mode,
      dispatch: stagePercentiles(samples, (sample) => sample.dispatchMs),
      ipc: stagePercentiles(samples, (sample) => sample.ipcMs),
      canvasPaint: stagePercentiles(samples, (sample) => sample.canvasPaintMs),
      total: stagePercentiles(samples, (sample) => sample.totalMs),
      droppedCount: samples.filter((sample) => sample.dropped).length,
      staleCount: samples.filter((sample) => sample.stale).length,
      cancelledCount: samples.filter((sample) => sample.cancelled).length,
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

  dump(mode?: NativePreviewMode): NativeFrontendPerfSample[] {
    if (mode) return [...(this.samples.get(mode) ?? [])];
    return [...this.samples.values()].flatMap((bucket) => bucket);
  }

  clear(): void {
    for (const bucket of this.samples.values()) bucket.length = 0;
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
