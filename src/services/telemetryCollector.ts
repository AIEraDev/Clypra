/**
 * Production Telemetry Collector for Clypra Desktop & Mobile Editor.
 *
 * Responsibilities:
 * - Collects real-time runtime frame render timings, seek latencies, and fallback events.
 * - Samples adaptively (100% on dropped frames/anomalies, 1% on smooth frames) to keep overhead near 0%.
 * - Dispatches non-blocking async batches to Clypra Performance API.
 * - Strict Zero PII: Zero video frames, media assets, project titles, or user identities are ever collected.
 */

import { getApiBaseUrl, getApiHeaders } from "@/lib/api/apiUtils";

export interface TelemetryHardwareContext {
  osFamily: "macos" | "windows" | "linux" | "ios" | "android" | "web";
  osVersion: string;
  cpuArch: "arm64" | "x86_64" | "wasm32";
  cpuCores: number;
  systemMemoryMb: number;
  gpuVendor: "apple" | "nvidia" | "amd" | "intel" | "qualcomm" | "arm" | "software" | "unknown";
  gpuModel: string;
  gpuDriverVersion?: string;
  dedicatedVramMb?: number;
  graphicsBackend: "metal" | "d3d12" | "d3d11" | "vulkan" | "webgpu" | "webgl2" | "software";
  displayDpr: number;
  thermalThrottlingState?: "nominal" | "fair" | "serious" | "critical";
  isBatteryPowered?: boolean;
}

export interface TelemetryVideoProfile {
  container: "mp4" | "mov" | "webm" | "mkv";
  codec: "h264" | "hevc" | "av1" | "vp9" | "prores422" | "prores4444";
  width: number;
  height: number;
  resolutionBucket: "720p" | "1080p" | "1440p" | "4k" | "8k" | "custom";
  nominalFps: number;
  pacingMode: "cfr" | "vfr";
  bitDepth: 8 | 10 | 12;
  colorSpace: "rec709" | "rec2020" | "srgb" | "p3";
  hdrFormat: "none" | "hdr10" | "hlg" | "dolby_vision";
  bitrateKbps: number;
}

export interface TelemetryStageTimings {
  decodeUs?: number;
  decoderMutexWaitUs?: number;
  conversionUploadUs?: number;
  composeUs?: number;
  surfaceAcquireUs?: number;
  gpuQueueWaitUs?: number;
  readbackUs?: number;
  submitPresentUs?: number;
  schedulerWaitUs?: number;
  ipcWaitUs?: number;
  transferUs?: number;
  canvasPaintUs?: number;
  totalTimeUs: number;
}

export interface TelemetryMetricPercentiles {
  p50: number;
  p95: number;
  p99: number;
}

export interface TelemetryStagePercentiles {
  decodeUs?: TelemetryMetricPercentiles;
  decoderMutexWaitUs?: TelemetryMetricPercentiles;
  conversionUploadUs?: TelemetryMetricPercentiles;
  composeUs?: TelemetryMetricPercentiles;
  surfaceAcquireUs?: TelemetryMetricPercentiles;
  gpuQueueWaitUs?: TelemetryMetricPercentiles;
  readbackUs?: TelemetryMetricPercentiles;
  submitPresentUs?: TelemetryMetricPercentiles;
  schedulerWaitUs?: TelemetryMetricPercentiles;
  ipcWaitUs?: TelemetryMetricPercentiles;
  transferUs?: TelemetryMetricPercentiles;
  canvasPaintUs?: TelemetryMetricPercentiles;
  totalTimeUs?: TelemetryMetricPercentiles;
}

export type TelemetryOperationMode =
  | "playback"
  | "playback-lookahead"
  | "seek-warm"
  | "seek-cold"
  | "scrub"
  | "frame-step"
  | "export-transcode"
  | "shader-composition"
  | "ai-inference"
  | "filmstrip-extraction";

export interface TelemetryExportMetrics {
  exportDurationMs: number;
  mediaDurationMs: number;
  totalFrames: number;
  exportFps: number;
  realTimeFactor: number;
  renderTimeUs: number;
  encodeTimeUs: number;
  peakRamMb: number;
  peakVramMb?: number;
  success: boolean;
  failureReason?: string;
  videoProfile?: Partial<TelemetryVideoProfile>;
}

export interface TelemetryEvent {
  eventId: string;
  /** Stable identity for one logical measurement across retries. */
  measurementId?: string;
  measurementSource?: "frontend-span" | "native-sample" | "session-rollup";
  sessionId?: string;
  qualificationRunId?: string;
  scenario?: TelemetryPreviewScenario;
  sampleKind?: TelemetrySampleKind;
  frameSequence?: number;
  dropReason?: string;
  deadlineUs?: number;
  forceSample?: boolean;
  appVersion: string;
  appBuildNumber: string;
  appEnvironment: "production" | "canary" | "beta";
  previewContext?: TelemetryPreviewContext;
  device: TelemetryHardwareContext;
  video: TelemetryVideoProfile;
  workload: {
    mode: TelemetryOperationMode;
    durationMs: number;
    targetFps: number;
    renderedFps: number;
    totalFrames: number;
    droppedFrames: number;
    droppedFramesRatio: number;
    staleFrames: number;
    cancelledFrames: number;
    avDriftMs?: number;
    peakRamMb: number;
    peakVramMb?: number;
    cacheHitRatio: number;
    stageTimings: TelemetryStageTimings;
    renderPercentiles?: TelemetryMetricPercentiles;
    stagePercentiles?: TelemetryStagePercentiles;
    firstFrameVisibleMs?: number;
    isSessionRollup?: boolean;
    jankEventsCount?: number;
  };
  exportMetrics?: {
    exportDurationMs: number;
    mediaDurationMs: number;
    realTimeFactor: number;
    exportFps: number;
    renderTimeUs: number;
    encodeTimeUs: number;
    success: boolean;
    failureReason?: string;
  };
  aiMetrics?: {
    task: "auto-reframe" | "whisper-captions" | "silence-detector";
    inferenceDurationMs: number;
    throughputFps?: number;
    realTimeFactor?: number;
    success: boolean;
  };
  fallbackEvent?: {
    triggered: boolean;
    fromBackend: string;
    toBackend: string;
    reasonCode: string;
    stackSnippet?: string;
  };
  timestampMs: number;
}

export type TelemetryPreviewView = "webview" | "native";
export type TelemetryPreviewSurface = "dom-canvas" | "native-surface";
export type TelemetryRuntimeEnvironment = "development" | "production";
export type TelemetryPreviewScenario =
  | "playback"
  | "seek"
  | "scrub"
  | "paused-interaction"
  | "qualification";
export type TelemetrySampleKind =
  | "frame-anomaly"
  | "window-rollup"
  | "qualification-summary"
  | "interaction";

export interface TelemetryPreviewContext {
  view: TelemetryPreviewView;
  surface: TelemetryPreviewSurface;
  runtimeEnvironment: TelemetryRuntimeEnvironment;
  sessionId?: string;
  qualificationRunId?: string;
  scenario?: TelemetryPreviewScenario;
}

export interface TelemetryRenderOptions {
  previewContext?: TelemetryPreviewContext;
  measurementId?: string;
  measurementSource?: "frontend-span" | "native-sample" | "session-rollup";
  sampleKind?: TelemetrySampleKind;
  frameSequence?: number;
  dropReason?: string;
  deadlineUs?: number;
  forceSample?: boolean;
  cacheHit?: boolean;
  /** Native samples are stage evidence for a frontend frame, not a second frame. */
  includeInRollup?: boolean;
}

const DEFAULT_API_INGEST_URL = `${getApiBaseUrl()}/performance/telemetry/ingest/batch`;
const MAX_QUEUE_SIZE = 100;
const MAX_OFFLINE_BATCHES = 50;
const FLUSH_INTERVAL_MS = 15000;
const NOMINAL_SAMPLE_RATE = 0.01; // 1% sample rate for smooth 60fps frames
const ROLLUP_WINDOW_MS = import.meta.env.DEV ? 5000 : 30000;
const SLEEP_DISCONTINUITY_THRESHOLD_MS = 1500; // Discard time gaps > 1.5s as sleep/backgrounding

export interface TelemetryTransportStatus {
  endpoint: string;
  pendingEvents: number;
  lastBatchId: string | null;
  lastBatchEventCount: number;
  lastAttemptAtMs: number | null;
  lastSuccessAtMs: number | null;
  lastFailureAtMs: number | null;
  consecutiveFailures: number;
}

/**
 * Continuous Session Rollup Accumulator.
 * Accumulates fine-grained frame metrics without spamming the network.
 */
class SessionRollupAccumulator {
  private windowStartMs: number = Date.now();
  private lastFrameTimestampMs: number = 0;
  private renderTimesUs: number[] = [];
  private decodeTimesUs: number[] = [];
  private decoderMutexWaitTimesUs: number[] = [];
  private composeTimesUs: number[] = [];
  private uploadTimesUs: number[] = [];
  private surfaceAcquireTimesUs: number[] = [];
  private gpuQueueWaitTimesUs: number[] = [];
  private readbackTimesUs: number[] = [];
  private transferTimesUs: number[] = [];
  private canvasPaintTimesUs: number[] = [];
  private presentTimesUs: number[] = [];
  private schedulerWaitTimesUs: number[] = [];
  private ipcWaitTimesUs: number[] = [];
  private driftSamplesMs: number[] = [];
  private seekLatenciesMs: number[] = [];
  private totalFrames: number = 0;
  private droppedFrames: number = 0;
  private staleFrames: number = 0;
  private cancelledFrames: number = 0;
  private jankEvents: number = 0;
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  private firstFrameVisibleMs: number | undefined;
  private lastKnownVideoProfile: Partial<TelemetryVideoProfile> = {};

  public recordFrame(
    timings: TelemetryStageTimings,
    dropped: boolean,
    videoProfile: Partial<TelemetryVideoProfile> = {},
    avDriftMs?: number,
    isStale: boolean = false,
    isCancelled: boolean = false,
    cacheHit: boolean = true
  ): void {
    const now = Date.now();

    // Detect system sleep / backgrounding discontinuity
    if (this.lastFrameTimestampMs > 0 && now - this.lastFrameTimestampMs > SLEEP_DISCONTINUITY_THRESHOLD_MS) {
      this.lastFrameTimestampMs = now;
      return;
    }
    this.lastFrameTimestampMs = now;

    this.totalFrames++;
    if (this.firstFrameVisibleMs === undefined) {
      this.firstFrameVisibleMs = timings.totalTimeUs / 1000;
    }
    if (dropped) this.droppedFrames++;
    if (isStale) this.staleFrames++;
    if (isCancelled) this.cancelledFrames++;
    if (cacheHit) this.cacheHits++;
    else this.cacheMisses++;

    if (timings.totalTimeUs > 25000) {
      this.jankEvents++;
    }

    if (this.renderTimesUs.length < 1000) {
      this.renderTimesUs.push(timings.totalTimeUs);
      if (timings.decodeUs !== undefined) this.decodeTimesUs.push(timings.decodeUs);
      if (timings.decoderMutexWaitUs !== undefined) this.decoderMutexWaitTimesUs.push(timings.decoderMutexWaitUs);
      if (timings.composeUs !== undefined) this.composeTimesUs.push(timings.composeUs);
      if (timings.conversionUploadUs !== undefined) this.uploadTimesUs.push(timings.conversionUploadUs);
      if (timings.surfaceAcquireUs !== undefined) this.surfaceAcquireTimesUs.push(timings.surfaceAcquireUs);
      if (timings.gpuQueueWaitUs !== undefined) this.gpuQueueWaitTimesUs.push(timings.gpuQueueWaitUs);
      if (timings.readbackUs !== undefined) this.readbackTimesUs.push(timings.readbackUs);
      if (timings.transferUs !== undefined) this.transferTimesUs.push(timings.transferUs);
      if (timings.canvasPaintUs !== undefined) this.canvasPaintTimesUs.push(timings.canvasPaintUs);
      if (timings.submitPresentUs !== undefined) this.presentTimesUs.push(timings.submitPresentUs);
      if (timings.schedulerWaitUs !== undefined) this.schedulerWaitTimesUs.push(timings.schedulerWaitUs);
      if (timings.ipcWaitUs !== undefined) this.ipcWaitTimesUs.push(timings.ipcWaitUs);
    }

    if (avDriftMs !== undefined && this.driftSamplesMs.length < 500) {
      this.driftSamplesMs.push(Math.abs(avDriftMs));
    }

    if (Object.keys(videoProfile).length > 0) {
      this.lastKnownVideoProfile = { ...this.lastKnownVideoProfile, ...videoProfile };
    }
  }

  public recordSeek(seekLatencyMs: number): void {
    if (this.seekLatenciesMs.length < 500) {
      this.seekLatenciesMs.push(seekLatencyMs);
    }
  }

  public shouldEmitRollup(): boolean {
    const elapsed = Date.now() - this.windowStartMs;
    return elapsed >= ROLLUP_WINDOW_MS && this.totalFrames > 0;
  }

  public extractRollupAndReset(): {
    windowStartMs: number;
    durationMs: number;
    totalFrames: number;
    droppedFrames: number;
    droppedFramesRatio: number;
    staleFrames: number;
    cancelledFrames: number;
    jankEventsCount: number;
    avDriftP95Ms: number;
    cacheHitRatio: number;
    stageTimings: TelemetryStageTimings;
    renderPercentiles?: TelemetryMetricPercentiles;
    stagePercentiles?: TelemetryStagePercentiles;
    firstFrameVisibleMs?: number;
    videoProfile: Partial<TelemetryVideoProfile>;
  } | null {
    if (this.totalFrames === 0) {
      this.windowStartMs = Date.now();
      return null;
    }

    const durationMs = Math.max(1, Date.now() - this.windowStartMs);
    const droppedFramesRatio = this.droppedFrames / this.totalFrames;

    const mean = (arr: number[]) => (arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
    const p95 = (arr: number[]) => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const idx = Math.min(sorted.length - 1, Math.round((sorted.length - 1) * 0.95));
      return sorted[idx];
    };
    const metricPercentiles = (arr: number[]): TelemetryMetricPercentiles | undefined => {
      if (arr.length === 0) return undefined;
      const sorted = [...arr].sort((a, b) => a - b);
      const at = (pct: number) => sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * pct))] ?? 0;
      return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
    };

    const totalTimeUs = p95(this.renderTimesUs) || mean(this.renderTimesUs) || 16667;
    const stageTimings: TelemetryStageTimings = {
      decodeUs: mean(this.decodeTimesUs) || undefined,
      decoderMutexWaitUs: mean(this.decoderMutexWaitTimesUs) || undefined,
      composeUs: mean(this.composeTimesUs) || undefined,
      conversionUploadUs: mean(this.uploadTimesUs) || undefined,
      surfaceAcquireUs: mean(this.surfaceAcquireTimesUs) || undefined,
      gpuQueueWaitUs: mean(this.gpuQueueWaitTimesUs) || undefined,
      readbackUs: mean(this.readbackTimesUs) || undefined,
      transferUs: mean(this.transferTimesUs) || undefined,
      canvasPaintUs: mean(this.canvasPaintTimesUs) || undefined,
      submitPresentUs: mean(this.presentTimesUs) || undefined,
      schedulerWaitUs: mean(this.schedulerWaitTimesUs) || undefined,
      ipcWaitUs: mean(this.ipcWaitTimesUs) || undefined,
      totalTimeUs,
    };

    const totalCacheOps = this.cacheHits + this.cacheMisses;
    const cacheHitRatio = totalCacheOps > 0 ? Number((this.cacheHits / totalCacheOps).toFixed(3)) : 1.0;
    const avDriftP95Ms = p95(this.driftSamplesMs);

    const result = {
      windowStartMs: this.windowStartMs,
      durationMs,
      totalFrames: this.totalFrames,
      droppedFrames: this.droppedFrames,
      droppedFramesRatio: Number(droppedFramesRatio.toFixed(4)),
      staleFrames: this.staleFrames,
      cancelledFrames: this.cancelledFrames,
      jankEventsCount: this.jankEvents,
      avDriftP95Ms,
      cacheHitRatio,
      stageTimings,
      renderPercentiles: metricPercentiles(this.renderTimesUs),
      stagePercentiles: {
        decodeUs: metricPercentiles(this.decodeTimesUs),
        decoderMutexWaitUs: metricPercentiles(this.decoderMutexWaitTimesUs),
        conversionUploadUs: metricPercentiles(this.uploadTimesUs),
        composeUs: metricPercentiles(this.composeTimesUs),
        surfaceAcquireUs: metricPercentiles(this.surfaceAcquireTimesUs),
        gpuQueueWaitUs: metricPercentiles(this.gpuQueueWaitTimesUs),
        readbackUs: metricPercentiles(this.readbackTimesUs),
        transferUs: metricPercentiles(this.transferTimesUs),
        canvasPaintUs: metricPercentiles(this.canvasPaintTimesUs),
        submitPresentUs: metricPercentiles(this.presentTimesUs),
        schedulerWaitUs: metricPercentiles(this.schedulerWaitTimesUs),
        ipcWaitUs: metricPercentiles(this.ipcWaitTimesUs),
        totalTimeUs: metricPercentiles(this.renderTimesUs),
      },
      firstFrameVisibleMs: this.firstFrameVisibleMs,
      videoProfile: this.lastKnownVideoProfile,
    };

    this.windowStartMs = Date.now();
    this.totalFrames = 0;
    this.droppedFrames = 0;
    this.staleFrames = 0;
    this.cancelledFrames = 0;
    this.jankEvents = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.renderTimesUs = [];
    this.decodeTimesUs = [];
    this.decoderMutexWaitTimesUs = [];
    this.composeTimesUs = [];
    this.uploadTimesUs = [];
    this.surfaceAcquireTimesUs = [];
    this.gpuQueueWaitTimesUs = [];
    this.readbackTimesUs = [];
    this.transferTimesUs = [];
    this.canvasPaintTimesUs = [];
    this.presentTimesUs = [];
    this.schedulerWaitTimesUs = [];
    this.ipcWaitTimesUs = [];
    this.driftSamplesMs = [];
    this.seekLatenciesMs = [];
    this.firstFrameVisibleMs = undefined;

    return result;
  }

  public reset(): void {
    this.windowStartMs = Date.now();
    this.lastFrameTimestampMs = 0;
    this.totalFrames = 0;
    this.droppedFrames = 0;
    this.staleFrames = 0;
    this.cancelledFrames = 0;
    this.jankEvents = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.renderTimesUs = [];
    this.decodeTimesUs = [];
    this.decoderMutexWaitTimesUs = [];
    this.composeTimesUs = [];
    this.uploadTimesUs = [];
    this.surfaceAcquireTimesUs = [];
    this.gpuQueueWaitTimesUs = [];
    this.readbackTimesUs = [];
    this.transferTimesUs = [];
    this.canvasPaintTimesUs = [];
    this.presentTimesUs = [];
    this.schedulerWaitTimesUs = [];
    this.ipcWaitTimesUs = [];
    this.driftSamplesMs = [];
    this.seekLatenciesMs = [];
    this.firstFrameVisibleMs = undefined;
  }
}

class TelemetryCollector {
  private queue: TelemetryEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushInFlight: Promise<boolean> | null = null;
  private cachedHardware: TelemetryHardwareContext | null = null;
  private isEnabled: boolean = true;
  private appVersion: string = "1.4.5";
  private rollupAccumulators = new Map<string, SessionRollupAccumulator>();
  private reportedNativeMeasurementIds = new Set<string>();
  private transportStatus: TelemetryTransportStatus = {
    endpoint: DEFAULT_API_INGEST_URL,
    pendingEvents: 0,
    lastBatchId: null,
    lastBatchEventCount: 0,
    lastAttemptAtMs: null,
    lastSuccessAtMs: null,
    lastFailureAtMs: null,
    consecutiveFailures: 0,
  };

  constructor() {
    if (typeof window !== "undefined") {
      this.initHardwareContext();
      this.startFlushTimer();
      window.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          this.flushRollupIfPending();
          this.flush();
        }
      });
      window.addEventListener("online", () => {
        this.drainOfflineQueue();
      });

      // Pull-based inspection is available in every environment for the
      // current performance qualification period. It exposes transport state
      // without reintroducing console logging into the render loop.
      (window as Window & {
        __CLYPRA_PERF_TELEMETRY__?: {
          getStatus: () => TelemetryTransportStatus;
          flush: () => Promise<boolean>;
        };
      }).__CLYPRA_PERF_TELEMETRY__ = {
        getStatus: () => this.getTransportStatus(),
        flush: () => {
          this.flushRollupIfPending();
          return this.flush();
        },
      };
    }
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled) {
      this.clearQueue();
      for (const accumulator of this.rollupAccumulators.values()) accumulator.reset();
    }
  }

  public setAppVersion(version: string): void {
    this.appVersion = version;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public getTransportStatus(): TelemetryTransportStatus {
    return {
      ...this.transportStatus,
      pendingEvents: this.queue.length,
    };
  }

  public clearQueue(): void {
    this.queue = [];
    this.clearOfflineQueue();
    this.reportedNativeMeasurementIds.clear();
  }

  /**
   * Sanitizes video properties into coarse privacy-safe buckets with zero path/title data.
   */
  public sanitizeVideoProfile(profile: Partial<TelemetryVideoProfile> = {}): TelemetryVideoProfile {
    const width = profile.width || 3840;
    const height = profile.height || 2160;

    let resolutionBucket: TelemetryVideoProfile["resolutionBucket"] = "1080p";
    const maxDim = Math.max(width, height);
    if (maxDim >= 7000) resolutionBucket = "8k";
    else if (maxDim >= 3500) resolutionBucket = "4k";
    else if (maxDim >= 2400) resolutionBucket = "1440p";
    else if (maxDim >= 1800) resolutionBucket = "1080p";
    else if (maxDim >= 1200) resolutionBucket = "720p";
    else resolutionBucket = "custom";

    return {
      container: profile.container || "mp4",
      codec: profile.codec || "hevc",
      width,
      height,
      resolutionBucket: profile.resolutionBucket || resolutionBucket,
      nominalFps: profile.nominalFps || 60,
      pacingMode: profile.pacingMode || "cfr",
      bitDepth: profile.bitDepth || 10,
      colorSpace: profile.colorSpace || "rec709",
      hdrFormat: profile.hdrFormat || "none",
      bitrateKbps: profile.bitrateKbps || 25000,
    };
  }

  /**
   * Updates cached hardware context with authoritative native GPU status from Tauri.
   */
  public updateFromNativeGpu(nativeGpu: {
    adapterName: string | null;
    backend: string | null;
    deviceType: string | null;
  }): void {
    const hw = this.initHardwareContext();
    if (nativeGpu.adapterName) {
      hw.gpuModel = nativeGpu.adapterName;
      if (/Apple/i.test(nativeGpu.adapterName)) hw.gpuVendor = "apple";
      else if (/NVIDIA/i.test(nativeGpu.adapterName)) hw.gpuVendor = "nvidia";
      else if (/AMD|Radeon/i.test(nativeGpu.adapterName)) hw.gpuVendor = "amd";
      else if (/Intel/i.test(nativeGpu.adapterName)) hw.gpuVendor = "intel";
      else if (/Mali/i.test(nativeGpu.adapterName)) hw.gpuVendor = "arm";
      else if (/Adreno|Qualcomm/i.test(nativeGpu.adapterName)) hw.gpuVendor = "qualcomm";
    }

    if (nativeGpu.backend) {
      const b = nativeGpu.backend.toLowerCase();
      if (b.includes("metal")) hw.graphicsBackend = "metal";
      else if (b.includes("dx12") || b.includes("d3d12")) hw.graphicsBackend = "d3d12";
      else if (b.includes("vulkan")) hw.graphicsBackend = "vulkan";
      else if (b.includes("webgpu")) hw.graphicsBackend = "webgpu";
    }
  }

  /**
   * Probes GPU and OS hardware properties safely with zero performance overhead.
   */
  public initHardwareContext(): TelemetryHardwareContext {
    if (this.cachedHardware) return this.cachedHardware;

    const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
    let osFamily: TelemetryHardwareContext["osFamily"] = "web";
    let graphicsBackend: TelemetryHardwareContext["graphicsBackend"] = "webgl2";

    if (/Macintosh|Mac OS X/i.test(userAgent)) {
      osFamily = "macos";
      graphicsBackend = "metal";
    } else if (/Windows/i.test(userAgent)) {
      osFamily = "windows";
      graphicsBackend = "d3d12";
    } else if (/Linux/i.test(userAgent) && !/Android/i.test(userAgent)) {
      osFamily = "linux";
      graphicsBackend = "vulkan";
    } else if (/iPhone|iPad|iPod/i.test(userAgent)) {
      osFamily = "ios";
      graphicsBackend = "metal";
    } else if (/Android/i.test(userAgent)) {
      osFamily = "android";
      graphicsBackend = "webgpu";
    }

    let gpuVendor: TelemetryHardwareContext["gpuVendor"] = "unknown";
    let gpuModel = "Generic GPU";

    if (typeof document !== "undefined") {
      try {
        const canvas = document.createElement("canvas");
        const gl = (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
        if (gl && typeof gl.getExtension === "function") {
          const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
          if (debugInfo) {
            const renderer = (gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string) || "";
            gpuModel = renderer;
            if (/Apple/i.test(renderer)) gpuVendor = "apple";
            else if (/NVIDIA/i.test(renderer)) gpuVendor = "nvidia";
            else if (/AMD|Radeon/i.test(renderer)) gpuVendor = "amd";
            else if (/Intel/i.test(renderer)) gpuVendor = "intel";
            else if (/Mali/i.test(renderer)) gpuVendor = "arm";
            else if (/Adreno|Qualcomm/i.test(renderer)) gpuVendor = "qualcomm";
          }
        }
      } catch {
        // Safe fallback
      }
    }

    const cpuArch: TelemetryHardwareContext["cpuArch"] =
      osFamily === "macos" || osFamily === "ios" || osFamily === "android" ? "arm64" : "x86_64";

    const cpuCores = typeof navigator !== "undefined" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 8;
    const displayDpr = typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1.0;

    this.cachedHardware = {
      osFamily,
      osVersion: "production",
      cpuArch,
      cpuCores,
      systemMemoryMb: 16384,
      gpuVendor,
      gpuModel,
      graphicsBackend,
      displayDpr,
    };

    return this.cachedHardware;
  }

  /**
   * Records a completed playback or render span.
   * Feeds continuous session rollup accumulator and immediately enqueues anomalies at 100%.
   */
  public recordRenderSpan(
    timings: TelemetryStageTimings,
    droppedFrames: number,
    totalFrames: number,
    videoProfile: Partial<TelemetryVideoProfile> = {},
    workloadMode: TelemetryOperationMode = "playback",
    avDriftMs?: number,
    staleFrames: number = 0,
    cancelledFrames: number = 0,
    options: TelemetryRenderOptions = {}
  ): void {
    if (!this.isEnabled) return;

    if (options.includeInRollup !== false) {
      const accumulator = this.getRollupAccumulator(options.previewContext);
      accumulator.recordFrame(
        timings,
        droppedFrames > 0,
        videoProfile,
        avDriftMs,
        staleFrames > 0,
        cancelledFrames > 0,
        options.cacheHit ?? true,
      );

      if (accumulator.shouldEmitRollup()) {
        this.flushRollupIfPending();
      }
    }

    const droppedRatio = totalFrames > 0 ? droppedFrames / totalFrames : 0;
    const isAnomaly = droppedRatio > 0.05 || timings.totalTimeUs > 16667;

    // Adaptive sampling: 100% on dropped frames / latency SLA overruns, 1% on nominal smooth frames
    if (!options.forceSample && !isAnomaly && Math.random() > NOMINAL_SAMPLE_RATE) {
      return;
    }

    const hardware = this.initHardwareContext();
    const fullVideoProfile = this.sanitizeVideoProfile(videoProfile);

    const event: TelemetryEvent = {
      eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      measurementId: options.measurementId,
      measurementSource: options.measurementSource,
      sessionId: options.previewContext?.sessionId,
      qualificationRunId: options.previewContext?.qualificationRunId,
      scenario: options.previewContext?.scenario,
      sampleKind: options.sampleKind,
      frameSequence: options.frameSequence,
      dropReason: options.dropReason,
      deadlineUs: options.deadlineUs,
      appVersion: this.appVersion,
      appBuildNumber: import.meta.env.MODE || "prod",
      appEnvironment: import.meta.env.DEV ? "beta" : "production",
      previewContext: options.previewContext,
      device: hardware,
      video: fullVideoProfile,
      workload: {
        mode: workloadMode,
        durationMs: Math.round(timings.totalTimeUs / 1000),
        targetFps: fullVideoProfile.nominalFps,
        renderedFps: timings.totalTimeUs > 0 ? Math.min(fullVideoProfile.nominalFps, 1000000 / timings.totalTimeUs) : fullVideoProfile.nominalFps,
        totalFrames: totalFrames || 1,
        droppedFrames: droppedFrames || 0,
        droppedFramesRatio: droppedRatio,
        staleFrames,
        cancelledFrames,
        avDriftMs,
        peakRamMb: 512,
        cacheHitRatio: 0.9,
        stageTimings: timings,
      },
      timestampMs: Date.now(),
    };

    this.enqueueEvent(event);
  }

  /**
   * Records a seek response span (cold or warm seek).
   */
  public recordSeekSpan(
    seekLatencyMs: number,
    isColdSeek: boolean = true,
    videoProfile: Partial<TelemetryVideoProfile> = {}
  ): void {
    if (!this.isEnabled) return;

    this.getRollupAccumulator().recordSeek(seekLatencyMs);

    const isAnomaly = seekLatencyMs > 100.0;
    if (!isAnomaly && Math.random() > NOMINAL_SAMPLE_RATE) {
      return;
    }

    const hardware = this.initHardwareContext();
    const fullVideoProfile = this.sanitizeVideoProfile(videoProfile);

    const event: TelemetryEvent = {
      eventId: `evt_seek_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      appVersion: this.appVersion,
      appBuildNumber: import.meta.env.MODE || "prod",
      appEnvironment: import.meta.env.DEV ? "beta" : "production",
      device: hardware,
      video: fullVideoProfile,
      workload: {
        mode: isColdSeek ? "seek-cold" : "seek-warm",
        durationMs: Math.round(seekLatencyMs),
        targetFps: fullVideoProfile.nominalFps,
        renderedFps: fullVideoProfile.nominalFps,
        totalFrames: 1,
        droppedFrames: 0,
        droppedFramesRatio: 0,
        staleFrames: 0,
        cancelledFrames: 0,
        peakRamMb: 512,
        cacheHitRatio: isColdSeek ? 0.0 : 1.0,
        stageTimings: {
          decodeUs: Math.round(seekLatencyMs * 600),
          conversionUploadUs: Math.round(seekLatencyMs * 200),
          composeUs: Math.round(seekLatencyMs * 200),
          totalTimeUs: Math.round(seekLatencyMs * 1000),
        },
      },
      timestampMs: Date.now(),
    };

    this.enqueueEvent(event);
  }

  /**
   * Records an export/transcoding run.
   */
  public recordExportSpan(metrics: TelemetryExportMetrics): void {
    if (!this.isEnabled) return;

    const hardware = this.initHardwareContext();
    const fullVideoProfile = this.sanitizeVideoProfile(metrics.videoProfile);

    const event: TelemetryEvent = {
      eventId: `evt_export_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      appVersion: this.appVersion,
      appBuildNumber: import.meta.env.MODE || "prod",
      appEnvironment: import.meta.env.DEV ? "beta" : "production",
      device: hardware,
      video: fullVideoProfile,
      workload: {
        mode: "export-transcode",
        durationMs: Math.round(metrics.exportDurationMs),
        targetFps: fullVideoProfile.nominalFps,
        renderedFps: metrics.exportFps,
        totalFrames: metrics.totalFrames,
        droppedFrames: metrics.success ? 0 : 1,
        droppedFramesRatio: metrics.success ? 0 : 1.0,
        staleFrames: 0,
        cancelledFrames: 0,
        peakRamMb: metrics.peakRamMb,
        peakVramMb: metrics.peakVramMb,
        cacheHitRatio: 0.95,
        stageTimings: {
          composeUs: metrics.renderTimeUs,
          conversionUploadUs: metrics.encodeTimeUs,
          totalTimeUs: Math.round(metrics.exportDurationMs * 1000),
        },
      },
      exportMetrics: {
        exportDurationMs: metrics.exportDurationMs,
        mediaDurationMs: metrics.mediaDurationMs,
        realTimeFactor: Number(metrics.realTimeFactor.toFixed(2)),
        exportFps: Number(metrics.exportFps.toFixed(1)),
        renderTimeUs: metrics.renderTimeUs,
        encodeTimeUs: metrics.encodeTimeUs,
        success: metrics.success,
        failureReason: metrics.failureReason,
      },
      timestampMs: Date.now(),
    };

    this.enqueueEvent(event);
    if (!metrics.success) {
      this.flush();
    }
  }

  /**
   * Records an AI / Smart Feature inference task (Whisper, Auto-Reframe, Silence detection).
   */
  public recordAIInferenceSpan(
    task: "auto-reframe" | "whisper-captions" | "silence-detector",
    inferenceDurationMs: number,
    throughputFps?: number,
    realTimeFactor?: number,
    success: boolean = true
  ): void {
    if (!this.isEnabled) return;

    const hardware = this.initHardwareContext();
    const event: TelemetryEvent = {
      eventId: `evt_ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      appVersion: this.appVersion,
      appBuildNumber: import.meta.env.MODE || "prod",
      appEnvironment: import.meta.env.DEV ? "beta" : "production",
      device: hardware,
      video: this.sanitizeVideoProfile(),
      workload: {
        mode: "ai-inference",
        durationMs: Math.round(inferenceDurationMs),
        targetFps: 60,
        renderedFps: throughputFps || 60,
        totalFrames: 1,
        droppedFrames: success ? 0 : 1,
        droppedFramesRatio: success ? 0 : 1.0,
        staleFrames: 0,
        cancelledFrames: 0,
        peakRamMb: 512,
        cacheHitRatio: 1.0,
        stageTimings: {
          totalTimeUs: Math.round(inferenceDurationMs * 1000),
        },
      },
      aiMetrics: {
        task,
        inferenceDurationMs,
        throughputFps,
        realTimeFactor,
        success,
      },
      timestampMs: Date.now(),
    };

    this.enqueueEvent(event);
  }

  /**
   * Records a hardware fallback occurrence (e.g. WebGPU -> WebGL, HW decode -> SW FFmpeg).
   */
  public recordFallbackEvent(
    fromBackend: string,
    toBackend: string,
    reasonCode: string,
    stackSnippet?: string
  ): void {
    if (!this.isEnabled) return;

    const hardware = this.initHardwareContext();
    const event: TelemetryEvent = {
      eventId: `evt_fallback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      appVersion: this.appVersion,
      appBuildNumber: import.meta.env.MODE || "prod",
      appEnvironment: import.meta.env.DEV ? "beta" : "production",
      device: hardware,
      video: this.sanitizeVideoProfile(),
      workload: {
        mode: "playback",
        durationMs: 100,
        targetFps: 60,
        renderedFps: 30,
        totalFrames: 1,
        droppedFrames: 1,
        droppedFramesRatio: 1.0,
        staleFrames: 0,
        cancelledFrames: 0,
        peakRamMb: 512,
        cacheHitRatio: 0,
        stageTimings: {
          totalTimeUs: 33000,
        },
      },
      fallbackEvent: {
        triggered: true,
        fromBackend,
        toBackend,
        reasonCode,
        stackSnippet,
      },
      timestampMs: Date.now(),
    };

    this.enqueueEvent(event);
    this.flush(); // Flush immediately for high-priority fallbacks
  }

  /**
   * Consumes snapshots from native Tauri preview & sync services directly.
   */
  public recordNativeSyncSnapshot(
    nativeSync: {
      av_drift?: { p95_abs_micros: number };
      dropped_frames?: number;
      frame_pacing?: { jank_events: number };
      seeks?: { avg_latency_micros: number; correct: number; n: number };
    } | null,
    nativeRender: {
      lastSample?: {
        requestId?: string;
        frameIndex?: number;
        decodeTimeUs: number;
        composeTimeUs: number;
        readbackTimeUs: number;
        presentTimeUs?: number;
        totalTimeUs: number;
        cacheHit?: boolean;
        conversionTimeUs?: number;
        uploadTimeUs?: number;
        conversionUploadUs?: number;
        decoderMutexWaitUs?: number;
        gpuQueueWaitUs?: number;
        surfaceAcquireUs?: number;
        schedulerWaitUs?: number;
        ipcWaitUs?: number;
        dropped?: boolean;
        stale?: boolean;
        cancelled?: boolean;
      } | null;
      windowDroppedFrames?: number;
      windowStaleFrames?: number;
      windowCancelledFrames?: number;
    } | null,
    videoProfile: Partial<TelemetryVideoProfile> = {},
    previewContext?: TelemetryPreviewContext,
    measurementId?: string,
  ): void {
    if (!this.isEnabled) return;

    if (measurementId) {
      if (this.reportedNativeMeasurementIds.has(measurementId)) return;
      // Keep this defensive dedupe set bounded for long-running editor
      // sessions. Durable storage provides the cross-restart idempotency.
      if (this.reportedNativeMeasurementIds.size >= 10000) {
        const oldest = this.reportedNativeMeasurementIds.values().next().value;
        if (oldest) this.reportedNativeMeasurementIds.delete(oldest);
      }
      this.reportedNativeMeasurementIds.add(measurementId);
    }

    const last = nativeRender?.lastSample;
    if (!last) return;

    const timings: TelemetryStageTimings = {
      decodeUs: last.decodeTimeUs,
      decoderMutexWaitUs: last.decoderMutexWaitUs,
      conversionUploadUs: last.conversionUploadUs ?? last.conversionTimeUs ?? last.uploadTimeUs,
      composeUs: last.composeTimeUs,
      surfaceAcquireUs: last.surfaceAcquireUs,
      gpuQueueWaitUs: last.gpuQueueWaitUs,
      readbackUs: last.readbackTimeUs,
      schedulerWaitUs: last.schedulerWaitUs,
      ipcWaitUs: last.ipcWaitUs,
      submitPresentUs: last.presentTimeUs,
      totalTimeUs: last.totalTimeUs,
    };

    const dropped = last.dropped === true;
    const stale = last.stale === true;
    const cancelled = last.cancelled === true;
    const avDriftMs = nativeSync?.av_drift ? nativeSync.av_drift.p95_abs_micros / 1000 : 0;

    this.recordRenderSpan(
      timings,
      dropped ? 1 : 0,
      1,
      videoProfile,
      "playback",
      avDriftMs,
      stale ? 1 : 0,
      cancelled ? 1 : 0,
      {
        previewContext,
        measurementId: measurementId
          ? `native-sample:${previewContext?.view ?? "unknown"}:${measurementId}`
          : undefined,
        measurementSource: "native-sample",
        sampleKind: "frame-anomaly",
        frameSequence: last.frameIndex,
        deadlineUs: 16_667,
        dropReason: dropped
          ? cancelled
            ? "cancelled"
            : stale
              ? "stale"
              : "native-present-drop"
          : undefined,
        forceSample: previewContext?.scenario === "qualification",
        cacheHit: last.cacheHit,
        includeInRollup: false,
      }
    );
  }

  /**
   * Emits pending session rollup if enough activity occurred.
   */
  public flushRollupIfPending(): void {
    const hardware = this.initHardwareContext();
    for (const [key, accumulator] of this.rollupAccumulators) {
      const rollup = accumulator.extractRollupAndReset();
      if (!rollup) continue;

      const previewContext = key === "default" ? undefined : JSON.parse(key) as TelemetryPreviewContext;
      const fullVideoProfile = this.sanitizeVideoProfile(rollup.videoProfile);
      this.enqueueEvent({
        eventId: `evt_rollup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        measurementId: `rollup:${key}:${rollup.windowStartMs}`,
        measurementSource: "session-rollup",
        sampleKind:
          previewContext?.scenario === "qualification"
            ? "qualification-summary"
            : "window-rollup",
        appVersion: this.appVersion,
        appBuildNumber: import.meta.env.MODE || "prod",
        appEnvironment: import.meta.env.DEV ? "beta" : "production",
        previewContext,
        device: hardware,
        video: fullVideoProfile,
        workload: {
          mode: "playback",
          durationMs: rollup.durationMs,
          targetFps: fullVideoProfile.nominalFps,
          renderedFps:
            rollup.stageTimings.totalTimeUs > 0
              ? Math.min(fullVideoProfile.nominalFps, 1000000 / rollup.stageTimings.totalTimeUs)
              : fullVideoProfile.nominalFps,
          totalFrames: rollup.totalFrames,
          droppedFrames: rollup.droppedFrames,
          droppedFramesRatio: rollup.droppedFramesRatio,
          staleFrames: rollup.staleFrames,
          cancelledFrames: rollup.cancelledFrames,
          avDriftMs: rollup.avDriftP95Ms,
          peakRamMb: 512,
          cacheHitRatio: rollup.cacheHitRatio,
          stageTimings: rollup.stageTimings,
          renderPercentiles: rollup.renderPercentiles,
          stagePercentiles: rollup.stagePercentiles,
          firstFrameVisibleMs: rollup.firstFrameVisibleMs,
          isSessionRollup: true,
          jankEventsCount: rollup.jankEventsCount,
        },
        timestampMs: Date.now(),
      });
    }
  }

  private getRollupAccumulator(previewContext?: TelemetryPreviewContext): SessionRollupAccumulator {
    const key = previewContext ? JSON.stringify(previewContext) : "default";
    let accumulator = this.rollupAccumulators.get(key);
    if (!accumulator) {
      accumulator = new SessionRollupAccumulator();
      this.rollupAccumulators.set(key, accumulator);
    }
    return accumulator;
  }

  private enqueueEvent(event: TelemetryEvent): void {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      // Drop oldest to maintain strict upper memory bounds (< 2MB)
      this.queue.shift();
    }
    this.queue.push(event);

    if (this.queue.length >= 30) {
      this.flush();
    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(() => {
      this.flushRollupIfPending();
      this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  /**
   * Flushes queued telemetry events asynchronously via non-blocking batch POST.
   */
  public flush(): Promise<boolean> {
    if (this.flushInFlight) return this.flushInFlight;
    if (this.queue.length === 0) return Promise.resolve(true);

    this.flushInFlight = this.flushQueued();
    void this.flushInFlight.finally(() => {
      this.flushInFlight = null;
    });
    return this.flushInFlight;
  }

  private async flushQueued(): Promise<boolean> {
    if (this.queue.length === 0) return true;

    // Back off when remote endpoint fails repeatedly to prevent event-loop congestion
    if (
      this.transportStatus.consecutiveFailures >= 3 &&
      this.transportStatus.lastFailureAtMs &&
      Date.now() - this.transportStatus.lastFailureAtMs < 60_000
    ) {
      return false;
    }

    const eventsToFlush = [...this.queue];
    this.queue = [];

    const payload = {
      batchId: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sentAtMs: Date.now(),
      events: eventsToFlush,
    };
    this.transportStatus = {
      ...this.transportStatus,
      lastBatchId: payload.batchId,
      lastBatchEventCount: payload.events.length,
      lastAttemptAtMs: payload.sentAtMs,
      pendingEvents: this.queue.length,
    };

    try {
      if (typeof navigator !== "undefined" && typeof fetch === "function") {
        const res = await fetch(DEFAULT_API_INGEST_URL, {
          method: "POST",
          headers: {
            ...getApiHeaders(),
            "X-Clypra-Client": "tauri-desktop",
          },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          this.drainOfflineQueue();
          this.transportStatus = {
            ...this.transportStatus,
            lastSuccessAtMs: Date.now(),
            lastFailureAtMs: null,
            consecutiveFailures: 0,
            pendingEvents: this.queue.length,
          };
          return true;
        } else {
          this.saveToOfflineStorage(payload);
          this.transportStatus = {
            ...this.transportStatus,
            lastFailureAtMs: Date.now(),
            consecutiveFailures: this.transportStatus.consecutiveFailures + 1,
            pendingEvents: this.queue.length,
          };
          return false;
        }
      }
      return true;
    } catch {
      // Offline fallback: save batch to offline storage with bounded capacity
      this.saveToOfflineStorage(payload);
      this.transportStatus = {
        ...this.transportStatus,
        lastFailureAtMs: Date.now(),
        consecutiveFailures: this.transportStatus.consecutiveFailures + 1,
        pendingEvents: this.queue.length,
      };
      return false;
    }
  }

  private saveToOfflineStorage(batch: { batchId: string; sentAtMs: number; events: TelemetryEvent[] }): void {
    try {
      if (typeof localStorage === "undefined") return;
      const key = "clypra:telemetry:offline_queue";
      const raw = localStorage.getItem(key);
      const queue: Array<{ batchId: string; sentAtMs: number; events: TelemetryEvent[] }> = raw ? JSON.parse(raw) : [];
      if (queue.length >= MAX_OFFLINE_BATCHES) {
        queue.shift(); // Bound storage
      }
      queue.push(batch);
      localStorage.setItem(key, JSON.stringify(queue));
    } catch {
      // Storage unavailable or disabled
    }
  }

  private async drainOfflineQueue(): Promise<void> {
    try {
      if (typeof localStorage === "undefined") return;
      const key = "clypra:telemetry:offline_queue";
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const queue: Array<{ batchId: string; sentAtMs: number; events: TelemetryEvent[] }> = JSON.parse(raw);
      if (queue.length === 0) return;

      localStorage.removeItem(key);
      for (const batch of queue) {
        await fetch(DEFAULT_API_INGEST_URL, {
          method: "POST",
          headers: {
            ...getApiHeaders(),
            "X-Clypra-Client": "tauri-desktop",
          },
          body: JSON.stringify(batch),
        }).catch(() => {});
      }
    } catch {
      // Safe non-blocking catch
    }
  }

  private clearOfflineQueue(): void {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem("clypra:telemetry:offline_queue");
      }
    } catch {}
  }

  public dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

export const telemetryCollector = new TelemetryCollector();
