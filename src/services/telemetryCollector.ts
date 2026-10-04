/**
 * Production Telemetry Collector for Clypra Desktop & Mobile Editor.
 *
 * Responsibilities:
 * - Collects real-time runtime frame render timings, seek latencies, and fallback events.
 * - Samples adaptively (100% on dropped frames/anomalies, 1% on smooth frames) to keep overhead near 0%.
 * - Routes all events to perfLogService for file-based accumulation. The completed session file
 *   is uploaded as a single payload at session close instead of hundreds of per-rollup API calls.
 * - Strict Zero PII: Zero video frames, media assets, project titles, or user identities are ever collected.
 */

import { getApiBaseUrl, getApiHeaders } from "@/lib/api/apiUtils";
import { perfLogService, type PerfLogKind } from "@/services/perfLogService";
import { getAppVersionSync } from "@/lib/app/appVersion";
import type { WorkerPerfRollup } from "@/core/monitoring/WorkerPerfCollector";

export interface TelemetryHardwareContext {
  osFamily: "macos" | "windows" | "linux" | "ios" | "android" | "web";
  osVersion: string;
  cpuArch: "arm64" | "x86_64" | "wasm32";
  cpuCores: number;
  systemMemoryMb: number;
  gpuVendor:
    | "apple"
    | "nvidia"
    | "amd"
    | "intel"
    | "qualcomm"
    | "arm"
    | "software"
    | "unknown";
  gpuModel: string;
  gpuDriverVersion?: string;
  gpuVendorId?: number;
  gpuDeviceId?: number;
  gpuDriver?: string;
  gpuDriverInfo?: string;
  isSoftwareAdapter?: boolean;
  dedicatedVramMb?: number;
  graphicsBackend:
    | "metal"
    | "d3d12"
    | "d3d11"
    | "vulkan"
    | "webgpu"
    | "webgl2"
    | "software";
  displayDpr: number;
  thermalThrottlingState?: "nominal" | "fair" | "serious" | "critical";
  isBatteryPowered?: boolean;
  isHybridGpu?: boolean;
}

/**
 * Software adapters must never be counted as Intel/AMD/NVIDIA hardware.
 * Windows reports the Microsoft Basic Render Driver through D3D12, which used
 * to match the generic Intel fallback in some fleet reports.
 */
function classifyGpuVendor(
  adapterName: string,
): TelemetryHardwareContext["gpuVendor"] {
  if (
    /microsoft basic render driver|swiftshader|llvmpipe|software renderer|warp/i.test(
      adapterName,
    )
  ) {
    return "software";
  }
  if (/Apple/i.test(adapterName)) return "apple";
  if (/NVIDIA/i.test(adapterName)) return "nvidia";
  if (/AMD|Radeon/i.test(adapterName)) return "amd";
  if (/Intel/i.test(adapterName)) return "intel";
  if (/Mali/i.test(adapterName)) return "arm";
  if (/Adreno|Qualcomm/i.test(adapterName)) return "qualcomm";
  return "unknown";
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
  actorWaitUs?: number;
  demuxWaitUs?: number;
  conversionUploadUs?: number;
  composeUs?: number;
  surfaceAcquireUs?: number;
  gpuQueueWaitUs?: number;
  readbackUs?: number;
  /** CPU-side submit-to-map_async-complete bracket. */
  mapWaitUs?: number;
  submitPresentUs?: number;
  schedulerWaitUs?: number;
  lookaheadWaitUs?: number;
  coldStartInitUs?: number;
  queueResidencyUs?: number;
  ipcWaitUs?: number;
  transferUs?: number;
  canvasPaintUs?: number;
  /** Time from canvas draw completion to the next rAF callback. */
  webviewPaintRafUs?: number;
  totalTimeUs: number;
}

/** Media location class: fixed disk, removable drive, network share, or unknown. */
export type MediaLocationClass = "fixed" | "removable" | "network" | "unknown";

/** One timestamped span in the cold-start lifecycle. */
export interface ColdSpan {
  stage: string;
  /** Microseconds from process start to when this span began. */
  startedAtUs: number;
  /** Wall-clock work duration of this span in microseconds. */
  workUs: number;
  /** Duration an interactive or UI thread was blocked awaiting this span. */
  waitedByInteractiveUs: number;
  /** True if the result came from a persistent cache. */
  cached: boolean;
  /** True if the operation succeeded; false on failure/early return. */
  ok: boolean;
  /** Subsystem purpose: "preview", "filmstrip", "waveform", "export", or "probe". */
  purpose?: string;
  /** Monotonic ordinal clip index within the session (1, 2, ...). */
  clipIndex?: number;
  /** Container format name (e.g. "mov,mp4,m4a,3gp,3g2,mj2"). */
  containerFormat?: string;
  /** Media file size quantized to 64 MiB buckets (e.g. 64, 128, 192, 256...) */
  fileSizeBucketMb?: number;
  /** Media location classification (never leaks path). */
  mediaLocation?: MediaLocationClass;
}

/** Cumulative aggregate for a specific cold-start stage across the entire session. */
export interface StageAggregate {
  count: number;
  totalWorkUs: number;
  maxWorkUs: number;
  totalWaitedUs: number;
  maxWaitedUs: number;
  okCount: number;
  errCount: number;
}

/** Known audio cold-path counters. */
export interface AudioColdMetrics {
  pcmBytes: number;
  capTruncations: number;
  cliFallbacks: number;
}

/** User-visible launch and playback readiness milestones. */
export interface LaunchMilestones {
  preMainMs?: number;
  windowCreatedAtUs?: number;
  windowShownAtUs?: number;
  domContentLoadedMs?: number;
  appMountedMs?: number;
  shellPaintedMs?: number;
  firstSoundAtUs?: number;
  firstSoundLatencyUs?: number;
  interactiveAtUs?: number;
  firstFrameAtUs?: number;
  firstFramePaintedMs?: number;
  smoothPlaybackAtUs?: number;
  smoothPlaybackTargetFps?: number;
}

/** Cold-start report section, collected once per session. */
export interface ColdStartReport {
  /** Unix wall-clock milliseconds at process start. */
  processEpochMs: number;
  /** Pre-main time in ms (OS process creation to main() entry). */
  preMainMs?: number;
  /** System uptime at process start in seconds. */
  systemUptimeSecs?: number;
  /** User-visible milestones. */
  milestones: LaunchMilestones;
  /** Known audio cold-path risks. */
  audioMetrics: AudioColdMetrics;
  /** Aggregates per stage. */
  aggregates: Record<string, StageAggregate>;
  /** Spans discarded when ring buffer exceeded capacity. */
  droppedSpans: number;
  /** Spans in insertion order, up to ring capacity (512). */
  spans: ColdSpan[];
}

/** Whether stage timings came from an instrumented pipeline or only a total duration. */
export type TelemetryStageTimingsSource = "measured" | "unattributed";

export interface TelemetryMetricPercentiles {
  p50: number;
  p95: number;
  p99: number;
}

export interface TelemetryStagePercentiles {
  decodeUs?: TelemetryMetricPercentiles;
  decoderMutexWaitUs?: TelemetryMetricPercentiles;
  actorWaitUs?: TelemetryMetricPercentiles;
  conversionUploadUs?: TelemetryMetricPercentiles;
  composeUs?: TelemetryMetricPercentiles;
  surfaceAcquireUs?: TelemetryMetricPercentiles;
  gpuQueueWaitUs?: TelemetryMetricPercentiles;
  readbackUs?: TelemetryMetricPercentiles;
  mapWaitUs?: TelemetryMetricPercentiles;
  submitPresentUs?: TelemetryMetricPercentiles;
  schedulerWaitUs?: TelemetryMetricPercentiles;
  lookaheadWaitUs?: TelemetryMetricPercentiles;
  coldStartInitUs?: TelemetryMetricPercentiles;
  queueResidencyUs?: TelemetryMetricPercentiles;
  ipcWaitUs?: TelemetryMetricPercentiles;
  transferUs?: TelemetryMetricPercentiles;
  canvasPaintUs?: TelemetryMetricPercentiles;
  webviewPaintRafUs?: TelemetryMetricPercentiles;
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

export type TelemetrySubsystem =
  | "preview"
  | "audio"
  | "text"
  | "sticker"
  | "composition";

/** Content-free composition pressure sampled from the evaluated editor scene. */
export interface TelemetryCompositionSample {
  sessionId?: string;
  previewContext?: TelemetryPreviewContext;
  visualLayerCount: number;
  mediaLayerCount: number;
  videoLayerCount: number;
  imageLayerCount: number;
  textLayerCount: number;
  stickerLayerCount: number;
  activeAudioClipCount: number;
}

export interface TelemetryCompositionMetrics {
  windowDurationMs: number;
  observedFrames: number;
  multiStackedFrames: number;
  maxVisualLayers: number;
  maxMediaLayers: number;
  maxAudioClips: number;
  visualLayerPercentiles: TelemetryMetricPercentiles;
  mediaLayerPercentiles: TelemetryMetricPercentiles;
  videoLayerPercentiles: TelemetryMetricPercentiles;
  imageLayerPercentiles: TelemetryMetricPercentiles;
  textLayerPercentiles: TelemetryMetricPercentiles;
  stickerLayerPercentiles: TelemetryMetricPercentiles;
  audioClipPercentiles: TelemetryMetricPercentiles;
}

export type TelemetryStickerFormat = "lottie" | "gif" | "static";
export type TelemetryStickerRendererPath =
  | "worker-offscreen"
  | "native-raster"
  | "webview-canvas";
export type TelemetryStickerPhase =
  | "sticker-prefetch"
  | "visible-playback"
  | "interactive-preview";
export type TelemetryStickerOperation = "render" | "prefetch" | "decode";

export interface TelemetryStickerPercentiles {
  p50: number;
  p95: number;
  p99: number;
}

export interface TelemetryStickerStagePercentiles {
  decodeUs?: TelemetryStickerPercentiles;
  rasterUs?: TelemetryStickerPercentiles;
  readbackUs?: TelemetryStickerPercentiles;
  transferUs?: TelemetryStickerPercentiles;
  totalTimeUs?: TelemetryStickerPercentiles;
}

export interface TelemetryStickerMetrics {
  format: TelemetryStickerFormat;
  rendererPath: TelemetryStickerRendererPath;
  phase: TelemetryStickerPhase;
  operation: TelemetryStickerOperation;
  runtimeEnvironment: "development" | "production";
  windowDurationMs: number;
  renderCount: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRatio: number;
  layerCount: number;
  outputPixels: number;
  renderPercentiles: TelemetryStickerPercentiles;
  stagePercentiles: TelemetryStickerStagePercentiles;
}

export interface TelemetryStickerRenderInput {
  format: TelemetryStickerFormat;
  rendererPath: TelemetryStickerRendererPath;
  phase: TelemetryStickerPhase;
  operation?: TelemetryStickerOperation;
  sessionId?: string;
  decodeUs?: number;
  rasterUs?: number;
  readbackUs?: number;
  transferUs?: number;
  totalTimeUs: number;
  cacheHit?: boolean;
  layerCount?: number;
  outputPixels?: number;
}

export type TelemetryTextKind = "plain" | "effect" | "template";
export type TelemetryTextRendererPath =
  | "native-raster"
  | "webview-canvas"
  | "studio-preview";
export type TelemetryTextPhase =
  | "session-prewarm"
  | "text-prefetch"
  | "visible-playback"
  | "interactive-preview";

/** The work being measured, independent of where it was rendered. */
export type TelemetryTextOperation =
  | "render"
  | "entrance"
  | "exit"
  | "animation"
  | "content-edit"
  | "property-edit"
  | "transform"
  | "resize"
  | "prefetch";

export type TelemetryTextProperty =
  | "content"
  | "color"
  | "fontFamily"
  | "fontSize"
  | "fontWeight"
  | "fontStyle"
  | "lineHeight"
  | "letterSpacing"
  | "alignment"
  | "effect"
  | "template"
  | "transform"
  | "resize";

export interface TelemetryTextPercentiles {
  p50: number;
  p95: number;
  p99: number;
}

export interface TelemetryTextStagePercentiles {
  fontWaitUs?: TelemetryTextPercentiles;
  compileUs?: TelemetryTextPercentiles;
  rasterUs?: TelemetryTextPercentiles;
  readbackUs?: TelemetryTextPercentiles;
  transferUs?: TelemetryTextPercentiles;
  paintUs?: TelemetryTextPercentiles;
  totalTimeUs?: TelemetryTextPercentiles;
}

export interface TelemetryTextMetrics {
  kind: TelemetryTextKind;
  rendererPath: TelemetryTextRendererPath;
  phase: TelemetryTextPhase;
  operation: TelemetryTextOperation;
  property?: TelemetryTextProperty;
  runtimeEnvironment: "development" | "production";
  windowDurationMs: number;
  renderCount: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRatio: number;
  layerCount: number;
  outputPixels: number;
  renderPercentiles: TelemetryTextPercentiles;
  stagePercentiles: TelemetryTextStagePercentiles;
  /** Interaction latency is a transaction metric, never a render sample. */
  interactionPercentiles?: TelemetryTextPercentiles;
  interactionStagePercentiles?: TelemetryTextStagePercentiles;
  interactionRenderCount?: number;
  stageCoverage?: "complete" | "partial" | "unattributed";
  unattributedTimeUs?: number;
  /** Present for completed editing/gesture events, not render windows. */
  interactionDurationUs?: number;
  inputToPreviewUs?: number;
  contentLength?: number;
  lineCount?: number;
  layoutWidth?: number;
  layoutHeight?: number;
}

export type TelemetryAudioBackend = "native-cpal" | "web-audio";

export interface TelemetryAudioStageTimings {
  decodeUs?: number;
  bufferWaitUs?: number;
  mixerUs?: number;
  callbackUs?: number;
  outputUs?: number;
  seekUs?: number;
  clockPollUs?: number;
  totalTimeUs: number;
}

/** One bounded, non-real-time audio health window. */
export interface TelemetryAudioMetrics {
  backend: TelemetryAudioBackend;
  runtimeEnvironment: "development" | "production";
  windowDurationMs: number;
  sampleRate?: number;
  channels?: number;
  installedClipCount?: number;
  activeClipCount?: number;
  activeVoiceCount?: number;
  syncCalls?: number;
  playingSyncCalls?: number;
  /** Transport speed during this audio-health window. */
  playbackSpeed?: number;
  callbackCount?: number;
  renderedFrames?: number;
  nonSilentFrames?: number;
  bufferHits?: number;
  bufferMisses?: number;
  bufferHitRatio?: number;
  underruns?: number;
  mixerLockMisses?: number;
  callbackP95Us?: number;
  callbackMaxUs?: number;
  callbackOverBudgetCount?: number;
  seekCount?: number;
  seekP95Ms?: number;
  clockDriftP95Ms?: number;
  lastError?: string;
  /** Present only for the first program-preview play after graph installation. */
  startup?: TelemetryAudioStartupMetrics;
  stageTimings: TelemetryAudioStageTimings;
}

export interface TelemetryAudioStartupMetrics {
  outcome: "audible" | "silent-timeout" | "failed" | "superseded";
  initializationUs: number;
  playCommandUs?: number;
  firstAudibleUs?: number;
  installedClipCount: number;
  activeClipCount: number;
  callbackCountDelta: number;
  nonSilentFramesDelta: number;
  failureReason?: string;
}

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
  /** Terminal source frames recovered by repeating the prior full composition. */
  sourceEofFallbackFrames?: number;
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
  interaction?: TelemetryInteraction;
  subsystem?: TelemetrySubsystem;
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
    /** Unattributed totals must not be used to name a decode/upload/compose bottleneck. */
    stageTimingsSource?: TelemetryStageTimingsSource;
    renderPath?: string;
    capabilityPolicy?: "full" | "reduced" | "proxy" | string;
    capabilityProbeUs?: number;
    renderPercentiles?: TelemetryMetricPercentiles;
    stagePercentiles?: TelemetryStagePercentiles;
    firstFrameVisibleMs?: number;
    isSessionRollup?: boolean;
    jankEventsCount?: number;
    throttledAnomaliesCount?: number;
    /** Embedded WebView readback dimension limit (e.g., 480px on Windows, 960px on macOS). */
    readbackMaxDimension?: number;
    /** Current adaptive readback tier (0=320px, 1=480px, 2=600px, 3=720px, 4=840px, 5=960px). */
    readbackTier?: number;
    /** Adaptive readback target cadence in FPS (e.g., 10, 20, 24, 30). */
    readbackCadenceFps?: number;
    /** Transport speed active when this embedded-preview request was sent. */
    playbackSpeed?: number;
    /** Source frames intentionally advanced between CPU-readback presentations. */
    readbackSourceFrameStride?: number;
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
    sourceEofFallbackFrames?: number;
  };
  aiMetrics?: {
    task:
      | "auto-reframe"
      | "whisper-captions"
      | "silence-detector"
      | "body-segmentation"
      | "subject-cutout";
    inferenceDurationMs: number;
    throughputFps?: number;
    realTimeFactor?: number;
    success: boolean;
    runtimeUsed?: string;
    target?: string;
  };
  audioMetrics?: TelemetryAudioMetrics;
  textMetrics?: TelemetryTextMetrics;
  stickerMetrics?: TelemetryStickerMetrics;
  compositionMetrics?: TelemetryCompositionMetrics;
  workerMetrics?: WorkerPerfRollup;
  fallbackEvent?: {
    triggered: boolean;
    fromBackend: string;
    toBackend: string;
    reasonCode: string;
    stackSnippet?: string;
  };
  sourcePreviewDiagnostic?: TelemetrySourcePreviewDiagnosticInput;
  timestampMs: number;
}

export interface TelemetrySourcePreviewDiagnosticInput {
  status:
    | "mount"
    | "ready"
    | "error"
    | "blank_video_detected"
    | "recovery_start"
    | "recovery_success"
    | "recovery_failed";
  assetId?: string;
  assetName?: string;
  assetPath?: string;
  mediaType?: "video" | "audio" | "image" | "text";
  srcUrl?: string;
  errorCode?: number;
  errorMessage?: string;
  networkState?: number;
  readyState?: number;
  duration?: number;
  width?: number;
  height?: number;
  hasPreviewProxy?: boolean;
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

export type TelemetryInteractionName =
  | "play"
  | "pause"
  | "seek"
  | "scrub"
  | "timeline-click-seek"
  | "keyboard-seek"
  | "timeline-edit";
export type TelemetryInteractionOutcome = "completed" | "superseded" | "failed";

/** Bounded, content-free timing for one editor transport action. */
export interface TelemetryInteraction {
  id: string;
  name: TelemetryInteractionName;
  outcome: TelemetryInteractionOutcome;
  queueWaitUs?: number;
  audioSeekUs?: number;
  audioTransportUs?: number;
  inputToAudioUs?: number;
  inputToDemandUs?: number;
  decodeQueueWaitUs?: number;
  firstProxyFrameUs?: number;
  settledFrameUs?: number;
  coalescedUpdates?: number;
  supersededCount?: number;
  avErrorUs?: number;
  correct?: boolean;
}

export interface TelemetryPreviewContext {
  view: TelemetryPreviewView;
  surface: TelemetryPreviewSurface;
  runtimeEnvironment: TelemetryRuntimeEnvironment;
  /** Presenter selected for this frame, independently of decoder path. */
  presenterMode?: "native-surface" | "bridge";
  /** Why a continuous frame used the bridge instead of the retained surface. */
  presenterFallbackReason?:
    | "surface-creation-failed"
    | "adapter-unsupported"
    | "resize"
    | "occlusion"
    | "device-lost"
    | "policy-override"
    | "paused-exact-frame"
    | "unknown";
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
  capabilityPolicy?: "full" | "reduced" | "proxy" | string;
  capabilityProbeUs?: number;
  interaction?: TelemetryInteraction;
  stageTimingsSource?: TelemetryStageTimingsSource;
  renderPath?: string;
  /** Native samples are stage evidence for a frontend frame, not a second frame. */
  includeInRollup?: boolean;
  readbackMaxDimension?: number;
  readbackTier?: number;
  readbackCadenceFps?: number;
  playbackSpeed?: number;
  readbackSourceFrameStride?: number;
}

export interface TelemetryAudioSnapshotInput extends TelemetryAudioMetrics {
  sessionId: string;
  windowStartMs: number;
  measurementId?: string;
}

export interface TelemetryTextRenderInput {
  kind: TelemetryTextKind;
  rendererPath: TelemetryTextRendererPath;
  phase: TelemetryTextPhase;
  operation?: TelemetryTextOperation;
  property?: TelemetryTextProperty;
  interactionId?: string;
  sessionId?: string;
  fontWaitUs?: number;
  compileUs?: number;
  rasterUs?: number;
  readbackUs?: number;
  transferUs?: number;
  paintUs?: number;
  totalTimeUs: number;
  cacheHit?: boolean;
  layerCount?: number;
  outputPixels?: number;
  contentLength?: number;
  lineCount?: number;
  layoutWidth?: number;
  layoutHeight?: number;
}

export interface TelemetryTextInteractionInput {
  kind?: TelemetryTextKind;
  rendererPath?: TelemetryTextRendererPath;
  operation: Exclude<TelemetryTextOperation, "render" | "prefetch">;
  property?: TelemetryTextProperty;
  phase?: TelemetryTextPhase;
  sessionId?: string;
  interactionId?: string;
  durationUs: number;
  inputToPreviewUs?: number;
  stageTimings?: Partial<
    Pick<
      TelemetryTextRenderInput,
      | "fontWaitUs"
      | "compileUs"
      | "rasterUs"
      | "readbackUs"
      | "transferUs"
      | "paintUs"
      | "totalTimeUs"
    >
  >;
  stageCoverage?: "complete" | "partial" | "unattributed";
  unattributedTimeUs?: number;
  renderCount?: number;
  cacheHits?: number;
  cacheMisses?: number;
  contentLength?: number;
  lineCount?: number;
  layoutWidth?: number;
  layoutHeight?: number;
}

// @deprecated DEFAULT_API_INGEST_URL — the batch ingest endpoint has been
// replaced by the single-file session upload (POST /telemetry/ingest/session).
// This constant is retained only as a tombstone comment; it is no longer used.
// delete this constant when /telemetry/ingest/batch is removed from the API.
// const DEFAULT_API_INGEST_URL = `${getApiBaseUrl()}/performance/telemetry/ingest/batch`;
const MAX_QUEUE_SIZE = 100;
// @deprecated MAX_OFFLINE_BATCHES — offline localStorage queue is no longer
// used. Batches are accumulated locally in the NDJSON session file instead.
// delete when saveToOfflineStorage / drainOfflineQueue are removed.
// const MAX_OFFLINE_BATCHES = 50;
const FLUSH_INTERVAL_MS = 15000;
const NOMINAL_SAMPLE_RATE = 0.01; // 1% sample rate for smooth 60fps frames
const ROLLUP_WINDOW_MS = import.meta.env.DEV ? 5000 : 30000;
const SLEEP_DISCONTINUITY_THRESHOLD_MS = 1500; // Discard time gaps > 1.5s as sleep/backgrounding

/** Maximum individual over-budget latency frame samples emitted per minute. */
const MAX_LATENCY_ANOMALIES_PER_MINUTE = 10;
/** Maximum individual dropped/stale/cancelled frame samples emitted per minute. */
const MAX_DROP_ANOMALIES_PER_MINUTE = 10;
/**
 * Maximum individual seek anomalies emitted per minute. The rollup keeps the
 * distribution; individual samples are only for representative outliers.
 */
const MAX_SEEK_ANOMALIES_PER_MINUTE = 3;
/** Window duration for anomaly quota replenishment (1 minute). */
const ANOMALY_QUOTA_WINDOW_MS = 60000;
/** Minimum interval between intermediate superseded scrub drag events (max 2/sec). */
const SCRUB_INTERACTION_MIN_INTERVAL_MS = 500;

/**
 * Maps a TelemetryEvent to the PerfLogKind used by perfLogService.
 * This determines which "kind" label each line in the NDJSON file gets.
 */
function resolvePerfLogKind(event: TelemetryEvent): PerfLogKind {
  if (event.sourcePreviewDiagnostic) return "media-preview-diagnostic";
  if (event.fallbackEvent?.triggered) return "fallback-event";
  if (event.exportMetrics) return "export-span";
  if (event.aiMetrics) return "ai-inference";
  if (event.audioMetrics) return "audio-snapshot";
  if (event.textMetrics) return "text-rollup";
  if (event.stickerMetrics) return "sticker-rollup";
  if (event.compositionMetrics) return "composition-rollup";
  if (event.workerMetrics) return "worker-rollup";
  if (
    event.workload.mode === "seek-cold" ||
    event.workload.mode === "seek-warm"
  )
    return "seek-span";
  if (event.workload.isSessionRollup) return "frontend-rollup";
  return "frontend-rollup";
}

export interface TelemetryTransportStatus {
  /**
   * @deprecated The batch ingest endpoint has been replaced by the session
   * file upload. This field is retained for the `__CLYPRA_PERF_TELEMETRY__`
   * debug inspector so existing tooling does not break, but will always read
   * "session-file" to signal the new routing.
   */
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
  private actorWaitTimesUs: number[] = [];
  private composeTimesUs: number[] = [];
  private uploadTimesUs: number[] = [];
  private surfaceAcquireTimesUs: number[] = [];
  private gpuQueueWaitTimesUs: number[] = [];
  private readbackTimesUs: number[] = [];
  private mapWaitTimesUs: number[] = [];
  private transferTimesUs: number[] = [];
  private canvasPaintTimesUs: number[] = [];
  private webviewPaintRafTimesUs: number[] = [];
  private presentTimesUs: number[] = [];
  private schedulerWaitTimesUs: number[] = [];
  private lookaheadWaitTimesUs: number[] = [];
  private coldStartInitTimesUs: number[] = [];
  private queueResidencyTimesUs: number[] = [];
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
  private throttledAnomaliesCount: number = 0;
  private firstFrameVisibleMs: number | undefined;
  private lastKnownVideoProfile: Partial<TelemetryVideoProfile> = {};
  private capabilityPolicy?: "full" | "reduced" | "proxy" | string;
  private capabilityProbeUs?: number;
  private readbackMaxDimension?: number;
  private readbackTier?: number;
  private readbackCadenceFps?: number;
  private playbackSpeed?: number;
  private readbackSourceFrameStride?: number;

  public recordThrottledAnomaly(): void {
    this.throttledAnomaliesCount++;
  }

  public getThrottledAnomaliesCount(): number {
    return this.throttledAnomaliesCount;
  }

  public recordFrame(
    timings: TelemetryStageTimings,
    droppedFrames: number,
    totalFrames: number,
    videoProfile: Partial<TelemetryVideoProfile> = {},
    avDriftMs?: number,
    staleFrames: number = 0,
    cancelledFrames: number = 0,
    cacheHit: boolean = true,
    capabilityPolicy?: "full" | "reduced" | "proxy" | string,
    capabilityProbeUs?: number,
    readbackMaxDimension?: number,
    readbackTier?: number,
    readbackCadenceFps?: number,
    playbackSpeed?: number,
    readbackSourceFrameStride?: number,
    deadlineUs: number = 16_667,
  ): void {
    const now = Date.now();

    // Detect system sleep / backgrounding discontinuity
    if (
      this.lastFrameTimestampMs > 0 &&
      now - this.lastFrameTimestampMs > SLEEP_DISCONTINUITY_THRESHOLD_MS
    ) {
      this.lastFrameTimestampMs = now;
      return;
    }
    this.lastFrameTimestampMs = now;

    const normalizedTotalFrames = Math.max(1, Math.floor(totalFrames));
    const normalizedDroppedFrames = Math.min(
      normalizedTotalFrames,
      Math.max(0, Math.floor(droppedFrames)),
    );
    const normalizedStaleFrames = Math.min(
      normalizedTotalFrames,
      Math.max(0, Math.floor(staleFrames)),
    );
    const normalizedCancelledFrames = Math.min(
      normalizedTotalFrames,
      Math.max(0, Math.floor(cancelledFrames)),
    );

    this.totalFrames += normalizedTotalFrames;
    if (this.firstFrameVisibleMs === undefined) {
      this.firstFrameVisibleMs = timings.totalTimeUs / 1000;
    }
    this.droppedFrames += normalizedDroppedFrames;
    this.staleFrames += normalizedStaleFrames;
    this.cancelledFrames += normalizedCancelledFrames;
    if (cacheHit) this.cacheHits++;
    else this.cacheMisses++;

    if (timings.totalTimeUs > deadlineUs) {
      this.jankEvents++;
    }

    if (this.renderTimesUs.length < 1000) {
      this.renderTimesUs.push(timings.totalTimeUs);
      if (timings.decodeUs !== undefined)
        this.decodeTimesUs.push(timings.decodeUs);
      if (timings.decoderMutexWaitUs !== undefined)
        this.decoderMutexWaitTimesUs.push(timings.decoderMutexWaitUs);
      if (timings.actorWaitUs !== undefined)
        this.actorWaitTimesUs.push(timings.actorWaitUs);
      if (timings.composeUs !== undefined)
        this.composeTimesUs.push(timings.composeUs);
      if (timings.conversionUploadUs !== undefined)
        this.uploadTimesUs.push(timings.conversionUploadUs);
      if (timings.surfaceAcquireUs !== undefined)
        this.surfaceAcquireTimesUs.push(timings.surfaceAcquireUs);
      if (timings.gpuQueueWaitUs !== undefined)
        this.gpuQueueWaitTimesUs.push(timings.gpuQueueWaitUs);
      if (timings.readbackUs !== undefined)
        this.readbackTimesUs.push(timings.readbackUs);
      if (timings.mapWaitUs !== undefined)
        this.mapWaitTimesUs.push(timings.mapWaitUs);
      if (timings.transferUs !== undefined)
        this.transferTimesUs.push(timings.transferUs);
      if (timings.canvasPaintUs !== undefined)
        this.canvasPaintTimesUs.push(timings.canvasPaintUs);
      if (timings.webviewPaintRafUs !== undefined)
        this.webviewPaintRafTimesUs.push(timings.webviewPaintRafUs);
      if (timings.submitPresentUs !== undefined)
        this.presentTimesUs.push(timings.submitPresentUs);
      if (timings.schedulerWaitUs !== undefined)
        this.schedulerWaitTimesUs.push(timings.schedulerWaitUs);
      if (timings.lookaheadWaitUs !== undefined)
        this.lookaheadWaitTimesUs.push(timings.lookaheadWaitUs);
      if (timings.coldStartInitUs !== undefined)
        this.coldStartInitTimesUs.push(timings.coldStartInitUs);
      if (timings.queueResidencyUs !== undefined)
        this.queueResidencyTimesUs.push(timings.queueResidencyUs);
      if (timings.ipcWaitUs !== undefined)
        this.ipcWaitTimesUs.push(timings.ipcWaitUs);
    }

    if (avDriftMs !== undefined && this.driftSamplesMs.length < 500) {
      this.driftSamplesMs.push(Math.abs(avDriftMs));
    }

    if (Object.keys(videoProfile).length > 0) {
      this.lastKnownVideoProfile = {
        ...this.lastKnownVideoProfile,
        ...videoProfile,
      };
    }
    if (capabilityPolicy) this.capabilityPolicy = capabilityPolicy;
    if (capabilityProbeUs !== undefined)
      this.capabilityProbeUs = capabilityProbeUs;
    if (readbackMaxDimension !== undefined)
      this.readbackMaxDimension = readbackMaxDimension;
    if (readbackTier !== undefined) this.readbackTier = readbackTier;
    if (readbackCadenceFps !== undefined)
      this.readbackCadenceFps = readbackCadenceFps;
    if (playbackSpeed !== undefined) this.playbackSpeed = playbackSpeed;
    if (readbackSourceFrameStride !== undefined)
      this.readbackSourceFrameStride = readbackSourceFrameStride;
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
    throttledAnomaliesCount: number;
    avDriftP95Ms: number;
    cacheHitRatio: number;
    stageTimings: TelemetryStageTimings;
    renderPercentiles?: TelemetryMetricPercentiles;
    stagePercentiles?: TelemetryStagePercentiles;
    firstFrameVisibleMs?: number;
    videoProfile: Partial<TelemetryVideoProfile>;
    capabilityPolicy?: "full" | "reduced" | "proxy" | string;
    capabilityProbeUs?: number;
    readbackMaxDimension?: number;
    readbackTier?: number;
    readbackCadenceFps?: number;
    playbackSpeed?: number;
    readbackSourceFrameStride?: number;
  } | null {
    if (this.totalFrames === 0) {
      this.windowStartMs = Date.now();
      return null;
    }

    const durationMs = Math.max(1, Date.now() - this.windowStartMs);
    const droppedFramesRatio = this.droppedFrames / this.totalFrames;

    const mean = (arr: number[]) =>
      arr.length > 0
        ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
        : 0;
    const p95 = (arr: number[]) => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const idx = Math.min(
        sorted.length - 1,
        Math.round((sorted.length - 1) * 0.95),
      );
      return sorted[idx];
    };
    const metricPercentiles = (
      arr: number[],
    ): TelemetryMetricPercentiles | undefined => {
      if (arr.length === 0) return undefined;
      const sorted = [...arr].sort((a, b) => a - b);
      const at = (pct: number) =>
        sorted[
          Math.min(sorted.length - 1, Math.round((sorted.length - 1) * pct))
        ] ?? 0;
      return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
    };

    const totalTimeUs =
      p95(this.renderTimesUs) || mean(this.renderTimesUs) || 16667;
    const stageTimings: TelemetryStageTimings = {
      decodeUs: mean(this.decodeTimesUs) || undefined,
      decoderMutexWaitUs: mean(this.decoderMutexWaitTimesUs) || undefined,
      actorWaitUs: mean(this.actorWaitTimesUs) || undefined,
      composeUs: mean(this.composeTimesUs) || undefined,
      conversionUploadUs: mean(this.uploadTimesUs) || undefined,
      surfaceAcquireUs: mean(this.surfaceAcquireTimesUs) || undefined,
      gpuQueueWaitUs: mean(this.gpuQueueWaitTimesUs) || undefined,
      readbackUs: mean(this.readbackTimesUs) || undefined,
      mapWaitUs: mean(this.mapWaitTimesUs) || undefined,
      transferUs: mean(this.transferTimesUs) || undefined,
      canvasPaintUs: mean(this.canvasPaintTimesUs) || undefined,
      webviewPaintRafUs: mean(this.webviewPaintRafTimesUs) || undefined,
      submitPresentUs: mean(this.presentTimesUs) || undefined,
      schedulerWaitUs: mean(this.schedulerWaitTimesUs) || undefined,
      lookaheadWaitUs: mean(this.lookaheadWaitTimesUs) || undefined,
      coldStartInitUs: mean(this.coldStartInitTimesUs) || undefined,
      queueResidencyUs: mean(this.queueResidencyTimesUs) || undefined,
      ipcWaitUs: mean(this.ipcWaitTimesUs) || undefined,
      totalTimeUs,
    };

    const totalCacheOps = this.cacheHits + this.cacheMisses;
    const cacheHitRatio =
      totalCacheOps > 0
        ? Number((this.cacheHits / totalCacheOps).toFixed(3))
        : 1.0;
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
      throttledAnomaliesCount: this.throttledAnomaliesCount,
      avDriftP95Ms,
      cacheHitRatio,
      stageTimings,
      renderPercentiles: metricPercentiles(this.renderTimesUs),
      stagePercentiles: {
        decodeUs: metricPercentiles(this.decodeTimesUs),
        decoderMutexWaitUs: metricPercentiles(this.decoderMutexWaitTimesUs),
        actorWaitUs: metricPercentiles(this.actorWaitTimesUs),
        conversionUploadUs: metricPercentiles(this.uploadTimesUs),
        composeUs: metricPercentiles(this.composeTimesUs),
        surfaceAcquireUs: metricPercentiles(this.surfaceAcquireTimesUs),
        gpuQueueWaitUs: metricPercentiles(this.gpuQueueWaitTimesUs),
        readbackUs: metricPercentiles(this.readbackTimesUs),
        mapWaitUs: metricPercentiles(this.mapWaitTimesUs),
        transferUs: metricPercentiles(this.transferTimesUs),
        canvasPaintUs: metricPercentiles(this.canvasPaintTimesUs),
        webviewPaintRafUs: metricPercentiles(this.webviewPaintRafTimesUs),
        submitPresentUs: metricPercentiles(this.presentTimesUs),
        schedulerWaitUs: metricPercentiles(this.schedulerWaitTimesUs),
        lookaheadWaitUs: metricPercentiles(this.lookaheadWaitTimesUs),
        coldStartInitUs: metricPercentiles(this.coldStartInitTimesUs),
        queueResidencyUs: metricPercentiles(this.queueResidencyTimesUs),
        ipcWaitUs: metricPercentiles(this.ipcWaitTimesUs),
        totalTimeUs: metricPercentiles(this.renderTimesUs),
      },
      firstFrameVisibleMs: this.firstFrameVisibleMs,
      videoProfile: this.lastKnownVideoProfile,
      capabilityPolicy: this.capabilityPolicy,
      capabilityProbeUs: this.capabilityProbeUs,
      readbackMaxDimension: this.readbackMaxDimension,
      readbackTier: this.readbackTier,
      readbackCadenceFps: this.readbackCadenceFps,
      playbackSpeed: this.playbackSpeed,
      readbackSourceFrameStride: this.readbackSourceFrameStride,
    };

    this.windowStartMs = Date.now();
    this.totalFrames = 0;
    this.droppedFrames = 0;
    this.staleFrames = 0;
    this.cancelledFrames = 0;
    this.jankEvents = 0;
    this.throttledAnomaliesCount = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.renderTimesUs = [];
    this.decodeTimesUs = [];
    this.decoderMutexWaitTimesUs = [];
    this.actorWaitTimesUs = [];
    this.composeTimesUs = [];
    this.uploadTimesUs = [];
    this.surfaceAcquireTimesUs = [];
    this.gpuQueueWaitTimesUs = [];
    this.readbackTimesUs = [];
    this.mapWaitTimesUs = [];
    this.transferTimesUs = [];
    this.canvasPaintTimesUs = [];
    this.webviewPaintRafTimesUs = [];
    this.presentTimesUs = [];
    this.schedulerWaitTimesUs = [];
    this.lookaheadWaitTimesUs = [];
    this.coldStartInitTimesUs = [];
    this.queueResidencyTimesUs = [];
    this.ipcWaitTimesUs = [];
    this.driftSamplesMs = [];
    this.seekLatenciesMs = [];
    this.firstFrameVisibleMs = undefined;
    this.capabilityPolicy = undefined;
    this.capabilityProbeUs = undefined;
    this.readbackMaxDimension = undefined;
    this.readbackTier = undefined;
    this.readbackCadenceFps = undefined;
    this.playbackSpeed = undefined;
    this.readbackSourceFrameStride = undefined;

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
    this.throttledAnomaliesCount = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.renderTimesUs = [];
    this.decodeTimesUs = [];
    this.decoderMutexWaitTimesUs = [];
    this.actorWaitTimesUs = [];
    this.composeTimesUs = [];
    this.uploadTimesUs = [];
    this.surfaceAcquireTimesUs = [];
    this.gpuQueueWaitTimesUs = [];
    this.readbackTimesUs = [];
    this.mapWaitTimesUs = [];
    this.transferTimesUs = [];
    this.canvasPaintTimesUs = [];
    this.webviewPaintRafTimesUs = [];
    this.presentTimesUs = [];
    this.schedulerWaitTimesUs = [];
    this.lookaheadWaitTimesUs = [];
    this.coldStartInitTimesUs = [];
    this.queueResidencyTimesUs = [];
    this.ipcWaitTimesUs = [];
    this.driftSamplesMs = [];
    this.seekLatenciesMs = [];
    this.firstFrameVisibleMs = undefined;
    this.capabilityPolicy = undefined;
    this.capabilityProbeUs = undefined;
  }
}

class TextWindowAccumulator {
  private windowStartMs = Date.now();
  private totalTimeUs: number[] = [];
  private stages = new Map<string, number[]>();
  private renderCount = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private layerCount = 0;
  private outputPixels = 0;

  record(input: TelemetryTextRenderInput): void {
    this.renderCount += 1;
    if (input.cacheHit) this.cacheHits += 1;
    else this.cacheMisses += 1;
    this.layerCount += Math.max(0, input.layerCount ?? 1);
    this.outputPixels += Math.max(0, input.outputPixels ?? 0);
    this.totalTimeUs.push(Math.max(0, input.totalTimeUs));
    for (const [key, value] of Object.entries({
      fontWaitUs: input.fontWaitUs,
      compileUs: input.compileUs,
      rasterUs: input.rasterUs,
      readbackUs: input.readbackUs,
      transferUs: input.transferUs,
      paintUs: input.paintUs,
      totalTimeUs: input.totalTimeUs,
    })) {
      if (typeof value !== "number") continue;
      const values = this.stages.get(key) || [];
      if (values.length < 1000) values.push(Math.max(0, value));
      this.stages.set(key, values);
    }
  }

  recordCacheHit(): void {
    this.cacheHits += 1;
  }

  shouldEmit(): boolean {
    return (
      Date.now() - this.windowStartMs >= (import.meta.env.DEV ? 5000 : 30000) &&
      this.renderCount > 0
    );
  }

  extract():
    | (Omit<
        TelemetryTextMetrics,
        | "kind"
        | "rendererPath"
        | "phase"
        | "runtimeEnvironment"
        | "windowDurationMs"
        | "operation"
        | "property"
      > & { windowStartMs: number; windowDurationMs: number })
    | null {
    if (this.renderCount === 0) {
      this.windowStartMs = Date.now();
      return null;
    }
    const percentile = (values: number[]): TelemetryTextPercentiles => {
      if (values.length === 0) return { p50: 0, p95: 0, p99: 0 };
      const sorted = [...values].sort((a, b) => a - b);
      const at = (pct: number) =>
        sorted[
          Math.min(sorted.length - 1, Math.round((sorted.length - 1) * pct))
        ] ?? 0;
      return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
    };
    const stagePercentiles: TelemetryTextStagePercentiles = {};
    for (const [key, values] of this.stages) {
      stagePercentiles[key as keyof TelemetryTextStagePercentiles] =
        percentile(values);
    }
    const result = {
      windowStartMs: this.windowStartMs,
      windowDurationMs: Math.max(1, Date.now() - this.windowStartMs),
      renderCount: this.renderCount,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRatio: Number(
        (
          this.cacheHits / Math.max(1, this.cacheHits + this.cacheMisses)
        ).toFixed(4),
      ),
      layerCount: this.layerCount,
      outputPixels: this.outputPixels,
      renderPercentiles: percentile(this.totalTimeUs),
      stagePercentiles,
    };
    this.windowStartMs = Date.now();
    this.totalTimeUs = [];
    this.stages.clear();
    this.renderCount = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.layerCount = 0;
    this.outputPixels = 0;
    return result;
  }
}

class StickerWindowAccumulator {
  private windowStartMs = Date.now();
  private totalTimeUs: number[] = [];
  private stages = new Map<string, number[]>();
  private renderCount = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private layerCount = 0;
  private outputPixels = 0;

  record(input: TelemetryStickerRenderInput): void {
    this.renderCount += 1;
    if (input.cacheHit) this.cacheHits += 1;
    else this.cacheMisses += 1;
    this.layerCount += Math.max(0, input.layerCount ?? 1);
    this.outputPixels += Math.max(0, input.outputPixels ?? 0);
    this.totalTimeUs.push(Math.max(0, input.totalTimeUs));
    for (const [key, value] of Object.entries({
      decodeUs: input.decodeUs,
      rasterUs: input.rasterUs,
      readbackUs: input.readbackUs,
      transferUs: input.transferUs,
      totalTimeUs: input.totalTimeUs,
    })) {
      if (typeof value !== "number") continue;
      const values = this.stages.get(key) || [];
      if (values.length < 1000) values.push(Math.max(0, value));
      this.stages.set(key, values);
    }
  }

  recordCacheHit(): void {
    this.cacheHits += 1;
  }

  shouldEmit(): boolean {
    return (
      Date.now() - this.windowStartMs >= (import.meta.env.DEV ? 5000 : 30000) &&
      this.renderCount > 0
    );
  }

  extract():
    | (Omit<
        TelemetryStickerMetrics,
        | "format"
        | "rendererPath"
        | "phase"
        | "runtimeEnvironment"
        | "windowDurationMs"
        | "operation"
      > & { windowStartMs: number; windowDurationMs: number })
    | null {
    if (this.renderCount === 0) {
      this.windowStartMs = Date.now();
      return null;
    }
    const percentile = (values: number[]): TelemetryStickerPercentiles => {
      if (values.length === 0) return { p50: 0, p95: 0, p99: 0 };
      const sorted = [...values].sort((a, b) => a - b);
      const at = (pct: number) =>
        sorted[
          Math.min(sorted.length - 1, Math.round((sorted.length - 1) * pct))
        ] ?? 0;
      return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
    };
    const stagePercentiles: TelemetryStickerStagePercentiles = {};
    for (const [key, values] of this.stages) {
      stagePercentiles[key as keyof TelemetryStickerStagePercentiles] =
        percentile(values);
    }
    const result = {
      windowStartMs: this.windowStartMs,
      windowDurationMs: Math.max(1, Date.now() - this.windowStartMs),
      renderCount: this.renderCount,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRatio: Number(
        (
          this.cacheHits / Math.max(1, this.cacheHits + this.cacheMisses)
        ).toFixed(4),
      ),
      layerCount: this.layerCount,
      outputPixels: this.outputPixels,
      renderPercentiles: percentile(this.totalTimeUs),
      stagePercentiles,
    };
    this.windowStartMs = Date.now();
    this.totalTimeUs = [];
    this.stages.clear();
    this.renderCount = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.layerCount = 0;
    this.outputPixels = 0;
    return result;
  }
}

class CompositionWindowAccumulator {
  private windowStartMs = Date.now();
  private samples: TelemetryCompositionSample[] = [];

  record(sample: TelemetryCompositionSample): void {
    if (this.samples.length < 1000) this.samples.push(sample);
  }

  shouldEmit(): boolean {
    return (
      this.samples.length > 0 &&
      Date.now() - this.windowStartMs >= ROLLUP_WINDOW_MS
    );
  }

  extract(): (TelemetryCompositionMetrics & { windowStartMs: number }) | null {
    if (this.samples.length === 0) return null;
    const percentile = (values: number[]): TelemetryMetricPercentiles => {
      const sorted = [...values].sort((a, b) => a - b);
      const at = (pct: number) =>
        sorted[
          Math.min(sorted.length - 1, Math.round((sorted.length - 1) * pct))
        ] ?? 0;
      return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
    };
    const values = (key: keyof TelemetryCompositionSample) =>
      this.samples.map((sample) => Math.max(0, Number(sample[key]) || 0));
    const media = values("mediaLayerCount");
    const visual = values("visualLayerCount");
    const audio = values("activeAudioClipCount");
    const result = {
      windowStartMs: this.windowStartMs,
      windowDurationMs: Math.max(1, Date.now() - this.windowStartMs),
      observedFrames: this.samples.length,
      multiStackedFrames: this.samples.filter(
        (sample) => sample.mediaLayerCount > 1,
      ).length,
      maxVisualLayers: Math.max(...visual),
      maxMediaLayers: Math.max(...media),
      maxAudioClips: Math.max(...audio),
      visualLayerPercentiles: percentile(visual),
      mediaLayerPercentiles: percentile(media),
      videoLayerPercentiles: percentile(values("videoLayerCount")),
      imageLayerPercentiles: percentile(values("imageLayerCount")),
      textLayerPercentiles: percentile(values("textLayerCount")),
      stickerLayerPercentiles: percentile(values("stickerLayerCount")),
      audioClipPercentiles: percentile(audio),
    };
    this.windowStartMs = Date.now();
    this.samples = [];
    return result;
  }
}

class TelemetryCollector {
  private queue: TelemetryEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushInFlight: Promise<boolean> | null = null;
  private cachedHardware: TelemetryHardwareContext | null = null;
  private isEnabled: boolean = true;
  // Version is resolved lazily from the Tauri runtime via appVersion.ts.
  // Falls back to "unknown" until primeAppVersion() resolves (a few ms after startup).
  private get appVersion(): string {
    return getAppVersionSync() ?? "unknown";
  }
  private rollupAccumulators = new Map<string, SessionRollupAccumulator>();
  private reportedNativeMeasurementIds = new Set<string>();
  private reportedAudioMeasurementIds = new Set<string>();
  private reportedTextMeasurementIds = new Set<string>();
  private reportedStickerMeasurementIds = new Set<string>();
  private textAccumulators = new Map<string, TextWindowAccumulator>();
  private stickerAccumulators = new Map<string, StickerWindowAccumulator>();
  private compositionAccumulators = new Map<
    string,
    CompositionWindowAccumulator
  >();
  private anomalyRateLimiter = {
    windowStartMs: Date.now(),
    latencyAnomaliesEmitted: 0,
    dropAnomaliesEmitted: 0,
    seekAnomaliesEmitted: 0,
    peakLatencyUs: 0,
    peakSeekLatencyMs: 0,
  };
  private lastScrubInteractionMs: number = -Infinity;
  private transportStatus: TelemetryTransportStatus = {
    // Batch endpoint is gone — all data flows through perfLogService session file.
    endpoint: "session-file",
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
          this.flushTextWindowsIfPending();
          this.flushStickerWindowsIfPending();
          this.flushCompositionWindowsIfPending(true);
          this.flush();
        }
      });
      // "online" listener removed — offline localStorage queue is no longer
      // used. Session data is accumulated in the NDJSON file by perfLogService.

      // Pull-based inspection is available in every environment for the
      // current performance qualification period. It exposes transport state
      // without reintroducing console logging into the render loop.
      (
        window as Window & {
          __CLYPRA_PERF_TELEMETRY__?: {
            getStatus: () => TelemetryTransportStatus;
            flush: () => Promise<boolean>;
          };
        }
      ).__CLYPRA_PERF_TELEMETRY__ = {
        getStatus: () => this.getTransportStatus(),
        flush: () => {
          this.flushRollupIfPending();
          this.flushTextWindowsIfPending();
          return this.flush();
        },
      };
    }
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled) {
      this.clearQueue();
      for (const accumulator of this.rollupAccumulators.values())
        accumulator.reset();
    }
  }

  public setAppVersion(version: string): void {
    // No-op: version is now read dynamically from the shared appVersion cache
    // (see getAppVersionSync in lib/app/appVersion.ts). This method is retained
    // for backwards-compatibility with any call sites and test stubs.
    void version;
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

  public resetAnomalyRateLimiter(): void {
    this.anomalyRateLimiter = {
      windowStartMs: Date.now(),
      latencyAnomaliesEmitted: 0,
      dropAnomaliesEmitted: 0,
      seekAnomaliesEmitted: 0,
      peakLatencyUs: 0,
      peakSeekLatencyMs: 0,
    };
    this.lastScrubInteractionMs = -Infinity;
  }

  public getThrottledAnomaliesCount(
    previewContext?: TelemetryPreviewContext,
  ): number {
    return this.getRollupAccumulator(
      previewContext,
    ).getThrottledAnomaliesCount();
  }

  public clearQueue(): void {
    this.queue = [];
    // clearOfflineQueue() removed — localStorage batch queue is no longer used.
    this.reportedNativeMeasurementIds.clear();
    this.reportedAudioMeasurementIds.clear();
    this.reportedTextMeasurementIds.clear();
    this.textAccumulators.clear();
    this.resetAnomalyRateLimiter();
  }

  /**
   * Sanitizes video properties into coarse privacy-safe buckets with zero path/title data.
   */
  public sanitizeVideoProfile(
    profile: Partial<TelemetryVideoProfile> = {},
  ): TelemetryVideoProfile {
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
    vendorId: number | null;
    deviceId: number | null;
    driver: string | null;
    driverInfo: string | null;
    isSoftwareAdapter: boolean | null;
  }): void {
    const hw = this.initHardwareContext();
    if (nativeGpu.adapterName) {
      hw.gpuModel = nativeGpu.adapterName;
      hw.gpuVendor = classifyGpuVendor(nativeGpu.adapterName);
      if (hw.gpuVendor === "software") hw.graphicsBackend = "software";
    }

    if (nativeGpu.backend && hw.gpuVendor !== "software") {
      const b = nativeGpu.backend.toLowerCase();
      if (b.includes("metal")) hw.graphicsBackend = "metal";
      else if (b.includes("dx12") || b.includes("d3d12"))
        hw.graphicsBackend = "d3d12";
      else if (b.includes("vulkan")) hw.graphicsBackend = "vulkan";
      else if (b.includes("webgpu")) hw.graphicsBackend = "webgpu";
    }

    // Add new GPU diagnostic fields
    if (nativeGpu.vendorId != null) {
      hw.gpuVendorId = nativeGpu.vendorId;
    }
    if (nativeGpu.deviceId != null) {
      hw.gpuDeviceId = nativeGpu.deviceId;
    }
    if (nativeGpu.driver) {
      hw.gpuDriver = nativeGpu.driver;
    }
    if (nativeGpu.driverInfo) {
      hw.gpuDriverInfo = nativeGpu.driverInfo;
      // Also use as gpuDriverVersion for backward compatibility
      hw.gpuDriverVersion = nativeGpu.driverInfo;
    }
    if (nativeGpu.isSoftwareAdapter != null) {
      hw.isSoftwareAdapter = nativeGpu.isSoftwareAdapter;
      // If software adapter, override vendor and backend
      if (nativeGpu.isSoftwareAdapter) {
        hw.gpuVendor = "software";
        hw.graphicsBackend = "software";
      }
    }
  }

  /**
   * Probes GPU and OS hardware properties safely with zero performance overhead.
   */
  public initHardwareContext(): TelemetryHardwareContext {
    if (this.cachedHardware) return this.cachedHardware;

    const userAgent =
      typeof navigator !== "undefined" ? navigator.userAgent : "";
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
        const gl = (canvas.getContext("webgl") ||
          canvas.getContext(
            "experimental-webgl",
          )) as WebGLRenderingContext | null;
        if (gl && typeof gl.getExtension === "function") {
          const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
          if (debugInfo) {
            const renderer =
              (gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string) ||
              "";
            gpuModel = renderer;
            gpuVendor = classifyGpuVendor(renderer);
            if (gpuVendor === "software") graphicsBackend = "software";
          }
        }
      } catch {
        // Safe fallback
      }
    }

    const cpuArch: TelemetryHardwareContext["cpuArch"] =
      osFamily === "macos" || osFamily === "ios" || osFamily === "android"
        ? "arm64"
        : "x86_64";

    const cpuCores =
      typeof navigator !== "undefined" && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 8;
    const displayDpr =
      typeof window !== "undefined" && window.devicePixelRatio
        ? window.devicePixelRatio
        : 1.0;

    const isHybridGpu =
      osFamily === "windows" &&
      (/Laptop|Mobile/i.test(gpuModel) ||
        (/NVIDIA/i.test(gpuModel) && /Intel|Radeon/i.test(userAgent)));

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
      isHybridGpu,
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
    options: TelemetryRenderOptions = {},
  ): void {
    if (!this.isEnabled) return;

    // Telemetry is occasionally reported from aggregate spans. Preserve the
    // counter relationship at the collection boundary so no emitted event or
    // session rollup can claim an impossible (>100%) drop ratio.
    const normalizedTotalFrames = Math.max(1, Math.floor(totalFrames || 1));
    const normalizedDroppedFrames = Math.min(
      normalizedTotalFrames,
      Math.max(0, Math.floor(droppedFrames || 0)),
    );
    const normalizedStaleFrames = Math.min(
      normalizedTotalFrames,
      Math.max(0, Math.floor(staleFrames || 0)),
    );
    const normalizedCancelledFrames = Math.min(
      normalizedTotalFrames,
      Math.max(0, Math.floor(cancelledFrames || 0)),
    );

    if (options.includeInRollup !== false) {
      const accumulator = this.getRollupAccumulator(options.previewContext);
      accumulator.recordFrame(
        timings,
        normalizedDroppedFrames,
        normalizedTotalFrames,
        videoProfile,
        avDriftMs,
        normalizedStaleFrames,
        normalizedCancelledFrames,
        options.cacheHit ?? true,
        options.capabilityPolicy,
        options.capabilityProbeUs,
        options.readbackMaxDimension,
        options.readbackTier,
        options.readbackCadenceFps,
        options.playbackSpeed,
        options.readbackSourceFrameStride,
        options.deadlineUs ?? 16_667,
      );

      if (accumulator.shouldEmitRollup()) {
        this.flushRollupIfPending();
      }
    }

    const droppedRatio = normalizedDroppedFrames / normalizedTotalFrames;
    const isAnomaly =
      droppedRatio > 0.05 || timings.totalTimeUs > (options.deadlineUs ?? 16_667);

    const hasDroppedFrame =
      normalizedDroppedFrames > 0 ||
      normalizedStaleFrames > 0 ||
      normalizedCancelledFrames > 0 ||
      Boolean(options.dropReason);

    // Adaptive sampling:
    // When forceSample is true (e.g. qualification runs or explicit overrides), bypass throttling.
    // For nominal smooth frames (not an anomaly), sample at 1% NOMINAL_SAMPLE_RATE.
    // For anomalies, apply local windowed rate limiting to prevent thousands of redundant frames
    // from ballooning the session file while preserving percentiles in the rollup.
    if (!options.forceSample) {
      if (!isAnomaly) {
        if (Math.random() > NOMINAL_SAMPLE_RATE) {
          return;
        }
      } else {
        const now = Date.now();
        if (
          now - this.anomalyRateLimiter.windowStartMs >=
          ANOMALY_QUOTA_WINDOW_MS
        ) {
          this.anomalyRateLimiter.windowStartMs = now;
          this.anomalyRateLimiter.latencyAnomaliesEmitted = 0;
          this.anomalyRateLimiter.dropAnomaliesEmitted = 0;
          this.anomalyRateLimiter.seekAnomaliesEmitted = 0;
          this.anomalyRateLimiter.peakLatencyUs = 0;
          this.anomalyRateLimiter.peakSeekLatencyMs = 0;
        }

        let shouldSampleAnomaly = false;

        if (hasDroppedFrame) {
          if (
            this.anomalyRateLimiter.dropAnomaliesEmitted <
            MAX_DROP_ANOMALIES_PER_MINUTE
          ) {
            this.anomalyRateLimiter.dropAnomaliesEmitted++;
            shouldSampleAnomaly = true;
          }
        } else {
          // Latency-only overrun (e.g. 66ms preview frame render time)
          if (
            this.anomalyRateLimiter.latencyAnomaliesEmitted <
            MAX_LATENCY_ANOMALIES_PER_MINUTE
          ) {
            this.anomalyRateLimiter.latencyAnomaliesEmitted++;
            this.anomalyRateLimiter.peakLatencyUs = Math.max(
              this.anomalyRateLimiter.peakLatencyUs,
              timings.totalTimeUs,
            );
            shouldSampleAnomaly = true;
          } else if (
            this.anomalyRateLimiter.peakLatencyUs > 0 &&
            timings.totalTimeUs > this.anomalyRateLimiter.peakLatencyUs * 1.25
          ) {
            // Peak outlier: significantly worse than previous peak in this window
            this.anomalyRateLimiter.peakLatencyUs = timings.totalTimeUs;
            shouldSampleAnomaly = true;
          }
        }

        if (!shouldSampleAnomaly) {
          if (options.includeInRollup !== false) {
            const accumulator = this.getRollupAccumulator(
              options.previewContext,
            );
            accumulator.recordThrottledAnomaly();
          }
          return;
        }
      }
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
      interaction: options.interaction,
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
        renderedFps:
          timings.totalTimeUs > 0
            ? Math.min(
                fullVideoProfile.nominalFps,
                1000000 / timings.totalTimeUs,
              )
            : fullVideoProfile.nominalFps,
        totalFrames: normalizedTotalFrames,
        droppedFrames: normalizedDroppedFrames,
        droppedFramesRatio: droppedRatio,
        staleFrames: normalizedStaleFrames,
        cancelledFrames: normalizedCancelledFrames,
        avDriftMs,
        peakRamMb: perfLogService.getPeakMemoryMb() || 512,
        cacheHitRatio: 0.9,
        stageTimings: timings,
        stageTimingsSource: options.stageTimingsSource ?? "measured",
        renderPath: options.renderPath,
        capabilityPolicy: options.capabilityPolicy,
        capabilityProbeUs: options.capabilityProbeUs,
        // `targetFps` above describes the timeline/source rate. Keep the
        // embedded CPU-readback limit separate so sampled anomalies can be
        // interpreted against the cadence the presentation path actually
        // requested.
        readbackMaxDimension: options.readbackMaxDimension,
        readbackTier: options.readbackTier,
        readbackCadenceFps: options.readbackCadenceFps,
        playbackSpeed: options.playbackSpeed,
        readbackSourceFrameStride: options.readbackSourceFrameStride,
      },
      timestampMs: Date.now(),
    };

    this.enqueueEvent(event);
  }

  private activeScrubSpan: {
    id: string;
    startedAtMs: number;
    initialTime: number;
    source: string;
    coalescedUpdates: number;
    supersededCount: number;
    firstAudioSeekUs?: number;
    firstDemandUs?: number;
    firstProxyFrameUs?: number;
    decodeQueueWaitUs?: number;
    latestAudioSeekUs?: number;
    previewContext?: TelemetryPreviewContext;
  } | null = null;

  public beginScrubSpan(
    initialTime: number,
    source: string = "playhead",
    previewContext?: TelemetryPreviewContext,
  ): string {
    const id = `scrub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.activeScrubSpan = {
      id,
      startedAtMs: performance.now(),
      initialTime,
      source,
      coalescedUpdates: 0,
      supersededCount: 0,
      previewContext,
    };
    return id;
  }

  public recordScrubAudioSeek(scrubId: string, durationUs: number): void {
    if (!this.activeScrubSpan || this.activeScrubSpan.id !== scrubId) return;
    if (this.activeScrubSpan.firstAudioSeekUs === undefined) {
      this.activeScrubSpan.firstAudioSeekUs = durationUs;
    }
    this.activeScrubSpan.latestAudioSeekUs = durationUs;
  }

  public recordScrubDemandDispatched(
    scrubId: string,
    durationUs: number,
  ): void {
    if (!this.activeScrubSpan || this.activeScrubSpan.id !== scrubId) return;
    if (this.activeScrubSpan.firstDemandUs === undefined) {
      this.activeScrubSpan.firstDemandUs = durationUs;
    }
  }

  public recordScrubProxyFramePresented(
    scrubId: string,
    durationUs: number,
  ): void {
    if (!this.activeScrubSpan || this.activeScrubSpan.id !== scrubId) return;
    if (this.activeScrubSpan.firstProxyFrameUs === undefined) {
      this.activeScrubSpan.firstProxyFrameUs = durationUs;
    }
  }

  public recordScrubActorWait(scrubId: string, waitUs: number): void {
    if (!this.activeScrubSpan || this.activeScrubSpan.id !== scrubId) return;
    this.activeScrubSpan.decodeQueueWaitUs = Math.max(
      this.activeScrubSpan.decodeQueueWaitUs ?? 0,
      waitUs,
    );
  }

  public recordScrubUpdate(scrubId: string): void {
    if (!this.activeScrubSpan || this.activeScrubSpan.id !== scrubId) return;
    this.activeScrubSpan.coalescedUpdates += 1;
  }

  public recordScrubSuperseded(scrubId: string): void {
    if (!this.activeScrubSpan || this.activeScrubSpan.id !== scrubId) return;
    this.activeScrubSpan.supersededCount += 1;
  }

  public getActiveScrubSpanId(): string | null {
    return this.activeScrubSpan?.id ?? null;
  }

  public finishScrubSpan(
    scrubId: string,
    details: {
      settledFrameUs?: number;
      correct?: boolean;
      avErrorUs?: number;
      outcome?: TelemetryInteractionOutcome;
    } = {},
  ): void {
    if (!this.activeScrubSpan || this.activeScrubSpan.id !== scrubId) return;
    const span = this.activeScrubSpan;
    this.activeScrubSpan = null;
    const totalTimeUs = Math.max(
      0,
      Math.round((performance.now() - span.startedAtMs) * 1_000),
    );
    const interaction: TelemetryInteraction = {
      id: span.id,
      name: "scrub",
      outcome: details.outcome ?? "completed",
      audioSeekUs: span.latestAudioSeekUs ?? span.firstAudioSeekUs,
      inputToAudioUs: span.firstAudioSeekUs,
      inputToDemandUs: span.firstDemandUs,
      decodeQueueWaitUs: span.decodeQueueWaitUs,
      firstProxyFrameUs: span.firstProxyFrameUs,
      settledFrameUs: details.settledFrameUs,
      coalescedUpdates: span.coalescedUpdates,
      supersededCount: span.supersededCount,
      avErrorUs: details.avErrorUs,
      correct: details.correct,
    };
    this.recordPreviewInteraction({
      interaction,
      totalTimeUs,
      previewContext: span.previewContext,
    });
  }

  /** Records a play, pause, or seek interaction at 100% sampling. */
  public recordPreviewInteraction(input: {
    interaction: TelemetryInteraction;
    totalTimeUs: number;
    previewContext?: TelemetryPreviewContext;
  }): void {
    const isScrub = input.interaction.name === "scrub";
    const isSettledOrFinal =
      input.interaction.outcome === "completed" ||
      input.interaction.outcome === "failed";
    const now = performance.now();

    // Throttle high-frequency continuous intermediate scrub drag updates (max 2/sec)
    if (
      isScrub &&
      !isSettledOrFinal &&
      input.previewContext?.scenario !== "qualification"
    ) {
      if (
        now - this.lastScrubInteractionMs <
        SCRUB_INTERACTION_MIN_INTERVAL_MS
      ) {
        return;
      }
      this.lastScrubInteractionMs = now;
    }

    const mode: TelemetryOperationMode =
      input.interaction.name === "scrub"
        ? "scrub"
        : input.interaction.name === "seek" ||
            input.interaction.name === "timeline-click-seek" ||
            input.interaction.name === "keyboard-seek"
          ? "seek-warm"
          : "playback";
    this.recordRenderSpan(
      {
        schedulerWaitUs: input.interaction.queueWaitUs,
        ipcWaitUs:
          (input.interaction.audioSeekUs ?? 0) +
            (input.interaction.audioTransportUs ?? 0) || undefined,
        actorWaitUs: input.interaction.decodeQueueWaitUs,
        totalTimeUs: Math.max(0, Math.round(input.totalTimeUs)),
      },
      input.interaction.outcome === "failed" ? 1 : 0,
      1,
      {},
      mode,
      undefined,
      0,
      input.interaction.outcome === "superseded" ? 1 : 0,
      {
        measurementId: `interaction:${input.interaction.id}`,
        measurementSource: "frontend-span",
        sampleKind: "interaction",
        forceSample: true,
        includeInRollup: false,
        previewContext: input.previewContext,
        interaction: input.interaction,
      },
    );
  }

  /**
   * Records one bounded audio-health window. This is deliberately sampled
   * outside the Web Audio/CPAL callback and is the only audio API emission
   * primitive; individual callbacks never perform network or JSON work.
   */
  public recordAudioSnapshot(snapshot: TelemetryAudioSnapshotInput): void {
    if (!this.isEnabled || snapshot.windowDurationMs <= 0) return;

    const renderedFrames = Math.max(0, snapshot.renderedFrames ?? 0);
    const underruns = Math.max(0, snapshot.underruns ?? 0);
    const callbackP95Us = Math.max(0, snapshot.callbackP95Us ?? 0);
    const measurementId =
      snapshot.measurementId ??
      `audio:${snapshot.sessionId}:${snapshot.backend}:${snapshot.windowStartMs}`;
    if (this.reportedAudioMeasurementIds.has(measurementId)) return;
    if (this.reportedAudioMeasurementIds.size >= 10000) {
      const oldest = this.reportedAudioMeasurementIds.values().next().value;
      if (oldest) this.reportedAudioMeasurementIds.delete(oldest);
    }
    this.reportedAudioMeasurementIds.add(measurementId);
    const event: TelemetryEvent = {
      eventId: `evt_audio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      measurementId,
      measurementSource: "session-rollup",
      sampleKind: "window-rollup",
      subsystem: "audio",
      sessionId: snapshot.sessionId,
      appVersion: this.appVersion,
      appBuildNumber: import.meta.env.MODE || "prod",
      appEnvironment: import.meta.env.DEV ? "beta" : "production",
      device: this.initHardwareContext(),
      video: this.sanitizeVideoProfile({ nominalFps: 60 }),
      workload: {
        mode: "playback",
        durationMs: Math.round(snapshot.windowDurationMs),
        targetFps: 60,
        renderedFps:
          snapshot.windowDurationMs > 0
            ? renderedFrames / (snapshot.windowDurationMs / 1000)
            : 0,
        totalFrames: renderedFrames,
        droppedFrames: underruns,
        droppedFramesRatio: Number(
          (underruns / Math.max(1, snapshot.callbackCount ?? 0)).toFixed(4),
        ),
        staleFrames: 0,
        cancelledFrames: 0,
        avDriftMs: snapshot.clockDriftP95Ms,
        peakRamMb: 0,
        cacheHitRatio: snapshot.bufferHitRatio ?? 1,
        stageTimings: {
          totalTimeUs: Math.max(
            0,
            Math.round(snapshot.stageTimings.totalTimeUs),
          ),
        },
        isSessionRollup: true,
      },
      audioMetrics: snapshot,
      timestampMs: Date.now(),
    };
    this.enqueueEvent(event);
  }

  /** Records the bounded first-play transaction at 100% sampling. */
  public recordAudioStartup(input: {
    sessionId: string;
    previewContext?: TelemetryPreviewContext;
    metrics: TelemetryAudioStartupMetrics;
  }): void {
    if (!this.isEnabled) return;
    const totalTimeUs = Math.max(
      input.metrics.initializationUs,
      input.metrics.firstAudibleUs ?? input.metrics.playCommandUs ?? 0,
    );
    this.enqueueEvent({
      eventId: `evt_audio_startup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      measurementId: `audio-startup:${input.sessionId}:${Date.now()}`,
      measurementSource: "frontend-span",
      sampleKind: "interaction",
      subsystem: "audio",
      sessionId: input.sessionId,
      appVersion: this.appVersion,
      appBuildNumber: import.meta.env.MODE || "prod",
      appEnvironment: import.meta.env.DEV ? "beta" : "production",
      previewContext: input.previewContext,
      device: this.initHardwareContext(),
      video: this.sanitizeVideoProfile({ nominalFps: 60 }),
      workload: {
        mode: "playback",
        durationMs: Math.max(1, Math.round(totalTimeUs / 1000)),
        targetFps: 60,
        renderedFps: 0,
        totalFrames: 1,
        droppedFrames: input.metrics.outcome === "audible" ? 0 : 1,
        droppedFramesRatio: input.metrics.outcome === "audible" ? 0 : 1,
        staleFrames: 0,
        cancelledFrames: input.metrics.outcome === "superseded" ? 1 : 0,
        peakRamMb: 0,
        cacheHitRatio: 1,
        stageTimings: { totalTimeUs },
      },
      audioMetrics: {
        backend: "native-cpal",
        runtimeEnvironment: import.meta.env.DEV ? "development" : "production",
        windowDurationMs: Math.max(1, Math.round(totalTimeUs / 1000)),
        installedClipCount: input.metrics.installedClipCount,
        activeClipCount: input.metrics.activeClipCount,
        callbackCount: input.metrics.callbackCountDelta,
        nonSilentFrames: input.metrics.nonSilentFramesDelta,
        lastError: input.metrics.failureReason,
        startup: input.metrics,
        stageTimings: { totalTimeUs },
      },
      timestampMs: Date.now(),
    });
  }

  /**
   * Records one text render into a bounded in-memory cohort window. Text
   * rasterization can happen during prewarm, playback, or interaction; none
   * of those hot paths performs network work or emits a console trace.
   */
  public recordTextRender(input: TelemetryTextRenderInput): void {
    if (!this.isEnabled || input.totalTimeUs < 0) return;
    const runtimeEnvironment = import.meta.env.DEV
      ? "development"
      : "production";
    const key = JSON.stringify([
      input.sessionId || "text-runtime",
      input.kind,
      input.rendererPath,
      input.phase,
      input.operation || "render",
      input.property || "none",
      runtimeEnvironment,
    ]);
    let accumulator = this.textAccumulators.get(key);
    if (!accumulator) {
      accumulator = new TextWindowAccumulator();
      this.textAccumulators.set(key, accumulator);
    }
    accumulator.record(input);
    if (accumulator.shouldEmit()) this.flushTextWindowsIfPending();
  }

  public recordTextCacheHit(
    input: Pick<
      TelemetryTextRenderInput,
      "kind" | "rendererPath" | "phase" | "sessionId"
    >,
  ): void {
    if (!this.isEnabled) return;
    const runtimeEnvironment = import.meta.env.DEV
      ? "development"
      : "production";
    const key = JSON.stringify([
      input.sessionId || "text-runtime",
      input.kind,
      input.rendererPath,
      input.phase,
      "render",
      "none",
      runtimeEnvironment,
    ]);
    let accumulator = this.textAccumulators.get(key);
    if (!accumulator) {
      accumulator = new TextWindowAccumulator();
      this.textAccumulators.set(key, accumulator);
    }
    accumulator.recordCacheHit();
  }

  /** Emits only completed text windows; idle sessions create no rows. */
  public flushTextWindowsIfPending(): void {
    for (const [key, accumulator] of this.textAccumulators) {
      if (!accumulator.shouldEmit()) continue;
      const values = JSON.parse(key) as [
        string,
        TelemetryTextKind,
        TelemetryTextRendererPath,
        TelemetryTextPhase,
        TelemetryTextOperation,
        TelemetryTextProperty | "none",
        "development" | "production",
      ];
      const [
        sessionId,
        kind,
        rendererPath,
        phase,
        operation,
        property,
        runtimeEnvironment,
      ] = values;
      const summary = accumulator.extract();
      if (!summary) continue;
      const measurementId = `text:${sessionId}:${kind}:${rendererPath}:${phase}:${operation}:${property}:${summary.windowStartMs}`;
      if (this.reportedTextMeasurementIds.has(measurementId)) continue;
      if (this.reportedTextMeasurementIds.size >= 10000) {
        const oldest = this.reportedTextMeasurementIds.values().next().value;
        if (oldest) this.reportedTextMeasurementIds.delete(oldest);
      }
      this.reportedTextMeasurementIds.add(measurementId);
      const totalTimeUs = summary.renderPercentiles.p95;
      this.enqueueEvent({
        eventId: `evt_text_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        measurementId,
        measurementSource: "session-rollup",
        sampleKind: "window-rollup",
        subsystem: "text",
        sessionId,
        appVersion: this.appVersion,
        appBuildNumber: import.meta.env.MODE || "prod",
        appEnvironment: import.meta.env.DEV ? "beta" : "production",
        device: this.initHardwareContext(),
        video: this.sanitizeVideoProfile({ nominalFps: 60 }),
        workload: {
          mode: phase === "interactive-preview" ? "frame-step" : "playback",
          durationMs: Math.round(summary.windowDurationMs),
          targetFps: 60,
          renderedFps:
            totalTimeUs > 0 ? Math.min(60, 1_000_000 / totalTimeUs) : 60,
          totalFrames: summary.renderCount,
          droppedFrames: 0,
          droppedFramesRatio: 0,
          staleFrames: 0,
          cancelledFrames: 0,
          peakRamMb: 0,
          cacheHitRatio: summary.cacheHitRatio,
          stageTimings: { totalTimeUs },
          renderPercentiles: summary.renderPercentiles,
          isSessionRollup: true,
        },
        textMetrics: {
          kind,
          rendererPath,
          phase,
          operation,
          ...(property !== "none" ? { property } : {}),
          runtimeEnvironment,
          windowDurationMs: summary.windowDurationMs,
          renderCount: summary.renderCount,
          cacheHits: summary.cacheHits,
          cacheMisses: summary.cacheMisses,
          cacheHitRatio: summary.cacheHitRatio,
          layerCount: summary.layerCount,
          outputPixels: summary.outputPixels,
          renderPercentiles: summary.renderPercentiles,
          stagePercentiles: summary.stagePercentiles,
        },
        timestampMs: Date.now(),
      });
    }
  }

  /**
   * Records one sticker render into a bounded in-memory cohort window.
   */
  public recordStickerRender(input: TelemetryStickerRenderInput): void {
    if (!this.isEnabled || input.totalTimeUs < 0) return;
    const runtimeEnvironment = import.meta.env.DEV
      ? "development"
      : "production";
    const key = JSON.stringify([
      input.sessionId || "sticker-runtime",
      input.format,
      input.rendererPath,
      input.phase,
      input.operation || "render",
      runtimeEnvironment,
    ]);
    let accumulator = this.stickerAccumulators.get(key);
    if (!accumulator) {
      accumulator = new StickerWindowAccumulator();
      this.stickerAccumulators.set(key, accumulator);
    }
    accumulator.record(input);
    if (accumulator.shouldEmit()) this.flushStickerWindowsIfPending();
  }

  public recordStickerCacheHit(
    input: Pick<
      TelemetryStickerRenderInput,
      "format" | "rendererPath" | "phase" | "sessionId"
    >,
  ): void {
    if (!this.isEnabled) return;
    const runtimeEnvironment = import.meta.env.DEV
      ? "development"
      : "production";
    const key = JSON.stringify([
      input.sessionId || "sticker-runtime",
      input.format,
      input.rendererPath,
      input.phase,
      "render",
      runtimeEnvironment,
    ]);
    let accumulator = this.stickerAccumulators.get(key);
    if (!accumulator) {
      accumulator = new StickerWindowAccumulator();
      this.stickerAccumulators.set(key, accumulator);
    }
    accumulator.recordCacheHit();
  }

  /**
   * Aggregates evaluated-scene complexity so media and multi-stack latency can
   * be queried alongside the existing text, sticker, and audio rollups.
   * Individual frames never leave the process; one cohort row is emitted per
   * preview context and rollup window.
   */
  public recordCompositionSample(sample: TelemetryCompositionSample): void {
    if (!this.isEnabled) return;
    const context = sample.previewContext;
    const key = JSON.stringify([
      sample.sessionId ?? context?.sessionId ?? "composition-runtime",
      context?.view ?? "webview",
      context?.surface ?? "dom-canvas",
      context?.scenario ?? "playback",
      context?.runtimeEnvironment ??
        (import.meta.env.DEV ? "development" : "production"),
    ]);
    let accumulator = this.compositionAccumulators.get(key);
    if (!accumulator) {
      accumulator = new CompositionWindowAccumulator();
      this.compositionAccumulators.set(key, accumulator);
    }
    accumulator.record(sample);
    if (accumulator.shouldEmit()) this.flushCompositionWindowsIfPending();
  }

  public flushCompositionWindowsIfPending(force = false): void {
    for (const [key, accumulator] of this.compositionAccumulators) {
      if (!force && !accumulator.shouldEmit()) continue;
      const values = JSON.parse(key) as [
        string,
        TelemetryPreviewView,
        TelemetryPreviewSurface,
        TelemetryPreviewScenario,
        TelemetryRuntimeEnvironment,
      ];
      const summary = accumulator.extract();
      if (!summary) continue;
      const [sessionId, view, surface, scenario, runtimeEnvironment] = values;
      const measurementId = `composition:${sessionId}:${view}:${surface}:${scenario}:${summary.windowStartMs}`;
      this.enqueueEvent({
        eventId: `evt_composition_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        measurementId,
        measurementSource: "session-rollup",
        sampleKind: "window-rollup",
        subsystem: "composition",
        sessionId,
        appVersion: this.appVersion,
        appBuildNumber: import.meta.env.MODE || "prod",
        appEnvironment: import.meta.env.DEV ? "beta" : "production",
        previewContext: {
          sessionId,
          view,
          surface,
          scenario,
          runtimeEnvironment,
        },
        device: this.initHardwareContext(),
        video: this.sanitizeVideoProfile({ nominalFps: 60 }),
        workload: {
          mode: "shader-composition",
          durationMs: summary.windowDurationMs,
          targetFps: 60,
          renderedFps:
            summary.observedFrames / (summary.windowDurationMs / 1000),
          totalFrames: summary.observedFrames,
          droppedFrames: 0,
          droppedFramesRatio: 0,
          staleFrames: 0,
          cancelledFrames: 0,
          peakRamMb: 0,
          cacheHitRatio: 1,
          stageTimings: { totalTimeUs: 0 },
          isSessionRollup: true,
        },
        compositionMetrics: summary,
        timestampMs: Date.now(),
      });
    }
  }

  public flushStickerWindowsIfPending(): void {
    for (const [key, accumulator] of this.stickerAccumulators) {
      if (!accumulator.shouldEmit()) continue;
      const values = JSON.parse(key) as [
        string,
        TelemetryStickerFormat,
        TelemetryStickerRendererPath,
        TelemetryStickerPhase,
        TelemetryStickerOperation,
        "development" | "production",
      ];
      const [
        sessionId,
        format,
        rendererPath,
        phase,
        operation,
        runtimeEnvironment,
      ] = values;
      const summary = accumulator.extract();
      if (!summary) continue;
      const measurementId = `sticker:${sessionId}:${format}:${rendererPath}:${phase}:${operation}:${summary.windowStartMs}`;
      if (this.reportedStickerMeasurementIds.has(measurementId)) continue;
      if (this.reportedStickerMeasurementIds.size >= 10000) {
        const oldest = this.reportedStickerMeasurementIds.values().next().value;
        if (oldest) this.reportedStickerMeasurementIds.delete(oldest);
      }
      this.reportedStickerMeasurementIds.add(measurementId);
      const totalTimeUs = summary.renderPercentiles.p95;
      this.enqueueEvent({
        eventId: `evt_sticker_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        measurementId,
        measurementSource: "session-rollup",
        sampleKind: "window-rollup",
        subsystem: "sticker",
        sessionId,
        appVersion: this.appVersion,
        appBuildNumber: import.meta.env.MODE || "prod",
        appEnvironment: import.meta.env.DEV ? "beta" : "production",
        device: this.initHardwareContext(),
        video: this.sanitizeVideoProfile({ nominalFps: 60 }),
        workload: {
          mode: phase === "interactive-preview" ? "frame-step" : "playback",
          durationMs: Math.round(summary.windowDurationMs),
          targetFps: 60,
          renderedFps:
            totalTimeUs > 0 ? Math.min(60, 1_000_000 / totalTimeUs) : 60,
          totalFrames: summary.renderCount,
          droppedFrames: 0,
          droppedFramesRatio: 0,
          staleFrames: 0,
          cancelledFrames: 0,
          peakRamMb: 0,
          cacheHitRatio: summary.cacheHitRatio,
          stageTimings: { totalTimeUs },
          renderPercentiles: summary.renderPercentiles,
          isSessionRollup: true,
        },
        stickerMetrics: {
          format,
          rendererPath,
          phase,
          operation,
          runtimeEnvironment,
          windowDurationMs: summary.windowDurationMs,
          renderCount: summary.renderCount,
          cacheHits: summary.cacheHits,
          cacheMisses: summary.cacheMisses,
          cacheHitRatio: summary.cacheHitRatio,
          layerCount: summary.layerCount,
          outputPixels: summary.outputPixels,
          renderPercentiles: summary.renderPercentiles,
          stagePercentiles: summary.stagePercentiles,
        },
        timestampMs: Date.now(),
      });
    }
  }

  /**
   * Records one completed user interaction as a bounded text event. Pointer
   * movement stays local; only the completed burst is sent to the API.
   */
  public recordTextInteraction(input: TelemetryTextInteractionInput): void {
    if (!this.isEnabled || input.durationUs < 0) return;
    const runtimeEnvironment = import.meta.env.DEV
      ? "development"
      : "production";
    const phase = input.phase ?? "interactive-preview";
    const sessionId = input.sessionId || "text-runtime";
    const now = Date.now();
    const percentile = {
      p50: Math.round(input.durationUs),
      p95: Math.round(input.durationUs),
      p99: Math.round(input.durationUs),
    };
    const interactionStagePercentiles: TelemetryTextStagePercentiles = {};
    for (const [key, value] of Object.entries(input.stageTimings || {})) {
      if (typeof value !== "number") continue;
      interactionStagePercentiles[key as keyof TelemetryTextStagePercentiles] =
        {
          p50: Math.max(0, Math.round(value)),
          p95: Math.max(0, Math.round(value)),
          p99: Math.max(0, Math.round(value)),
        };
    }
    const measurementId = `text-interaction:${sessionId}:${input.interactionId || `${input.operation}-${now}`}`;
    if (this.reportedTextMeasurementIds.has(measurementId)) return;
    if (this.reportedTextMeasurementIds.size >= 10000) {
      const oldest = this.reportedTextMeasurementIds.values().next().value;
      if (oldest) this.reportedTextMeasurementIds.delete(oldest);
    }
    this.reportedTextMeasurementIds.add(measurementId);
    const operation = input.operation;
    this.enqueueEvent({
      eventId: `evt_text_interaction_${now}_${Math.random().toString(36).slice(2, 8)}`,
      measurementId,
      measurementSource: "frontend-span",
      sampleKind: "interaction",
      subsystem: "text",
      sessionId,
      appVersion: this.appVersion,
      appBuildNumber: import.meta.env.MODE || "prod",
      appEnvironment: import.meta.env.DEV ? "beta" : "production",
      device: this.initHardwareContext(),
      video: this.sanitizeVideoProfile({ nominalFps: 60 }),
      workload: {
        mode: "frame-step",
        durationMs: Math.max(1, Math.round(input.durationUs / 1000)),
        targetFps: 60,
        renderedFps: 0,
        totalFrames: 1,
        droppedFrames: 0,
        droppedFramesRatio: 0,
        staleFrames: 0,
        cancelledFrames: 0,
        peakRamMb: 0,
        cacheHitRatio: 1,
        // This event is a transaction boundary, not a frame. Keeping the
        // workload render time empty prevents generic preview analytics from
        // treating editor latency as a rendered frame.
        stageTimings: { totalTimeUs: 0 },
      },
      textMetrics: {
        kind: input.kind ?? "plain",
        rendererPath: input.rendererPath ?? "studio-preview",
        phase,
        operation,
        ...(input.property ? { property: input.property } : {}),
        runtimeEnvironment,
        windowDurationMs: Math.max(1, Math.round(input.durationUs / 1000)),
        renderCount: 0,
        cacheHits: 0,
        cacheMisses: 0,
        cacheHitRatio: 1,
        layerCount: 1,
        outputPixels: Math.max(
          0,
          Math.round((input.layoutWidth || 0) * (input.layoutHeight || 0)),
        ),
        renderPercentiles: { p50: 0, p95: 0, p99: 0 },
        // For interaction events stagePercentiles must mirror interactionStagePercentiles.
        // The render-window stagePercentiles field is meaningless for a transaction
        // boundary (renderCount is 0), but analytics classifiers that read stagePercentiles
        // for bottleneck attribution must find the same data here as in
        // interactionStagePercentiles — otherwise they see all-zeros and fall
        // through to a default label regardless of what stage data was actually collected.
        stagePercentiles: interactionStagePercentiles,
        interactionPercentiles: percentile,
        interactionStagePercentiles,
        interactionRenderCount: input.renderCount ?? 0,
        stageCoverage:
          input.stageCoverage ??
          (Object.keys(interactionStagePercentiles).length > 0
            ? "partial"
            : "unattributed"),
        unattributedTimeUs: Math.max(
          0,
          Math.round(
            input.unattributedTimeUs ??
              (Object.keys(interactionStagePercentiles).length > 0
                ? 0
                : input.durationUs),
          ),
        ),
        interactionDurationUs: Math.round(input.durationUs),
        inputToPreviewUs: input.inputToPreviewUs,
        contentLength: input.contentLength,
        lineCount: input.lineCount,
        layoutWidth: input.layoutWidth,
        layoutHeight: input.layoutHeight,
      },
      timestampMs: now,
    });
  }

  /**
   * Records a seek response span (cold or warm seek).
   */
  public recordSeekSpan(
    seekLatencyMs: number,
    isColdSeek: boolean = true,
    videoProfile: Partial<TelemetryVideoProfile> = {},
  ): void {
    if (!this.isEnabled) return;

    this.getRollupAccumulator().recordSeek(seekLatencyMs);

    const isAnomaly = seekLatencyMs > 100.0;
    if (!isAnomaly) {
      if (Math.random() > NOMINAL_SAMPLE_RATE) {
        return;
      }
    } else {
      const now = Date.now();
      if (
        now - this.anomalyRateLimiter.windowStartMs >=
        ANOMALY_QUOTA_WINDOW_MS
      ) {
        this.anomalyRateLimiter.windowStartMs = now;
        this.anomalyRateLimiter.latencyAnomaliesEmitted = 0;
        this.anomalyRateLimiter.dropAnomaliesEmitted = 0;
        this.anomalyRateLimiter.seekAnomaliesEmitted = 0;
        this.anomalyRateLimiter.peakLatencyUs = 0;
        this.anomalyRateLimiter.peakSeekLatencyMs = 0;
      }

      let shouldSampleSeek = false;
      if (
        this.anomalyRateLimiter.seekAnomaliesEmitted <
        MAX_SEEK_ANOMALIES_PER_MINUTE
      ) {
        this.anomalyRateLimiter.seekAnomaliesEmitted++;
        this.anomalyRateLimiter.peakSeekLatencyMs = Math.max(
          this.anomalyRateLimiter.peakSeekLatencyMs,
          seekLatencyMs,
        );
        shouldSampleSeek = true;
      } else if (
        this.anomalyRateLimiter.peakSeekLatencyMs > 0 &&
        seekLatencyMs > this.anomalyRateLimiter.peakSeekLatencyMs * 1.25
      ) {
        this.anomalyRateLimiter.peakSeekLatencyMs = seekLatencyMs;
        shouldSampleSeek = true;
      }

      if (!shouldSampleSeek) {
        return;
      }
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
        peakRamMb: perfLogService.getPeakMemoryMb() || 512,
        cacheHitRatio: isColdSeek ? 0.0 : 1.0,
        // A seek span measures end-to-end settlement only. Do not invent
        // stage percentages: they would make backend bottleneck analysis lie.
        stageTimings: { totalTimeUs: Math.round(seekLatencyMs * 1000) },
        stageTimingsSource: "unattributed",
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
        sourceEofFallbackFrames: metrics.sourceEofFallbackFrames,
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
    task:
      | "auto-reframe"
      | "whisper-captions"
      | "silence-detector"
      | "body-segmentation"
      | "subject-cutout",
    inferenceDurationMs: number,
    throughputFps?: number,
    realTimeFactor?: number,
    success: boolean = true,
    runtimeUsed?: string,
    target?: string,
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
        peakRamMb: perfLogService.getPeakMemoryMb() || 512,
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
        runtimeUsed,
        target,
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
    stackSnippet?: string,
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
        peakRamMb: perfLogService.getPeakMemoryMb() || 512,
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
   * Records source preview lifecycle & media decode diagnostics.
   * Tracks HTML5 video playback errors, network states, and transcode recovery outcomes.
   */
  public recordSourcePreviewDiagnostic(
    input: TelemetrySourcePreviewDiagnosticInput,
  ): void {
    if (!this.isEnabled) return;

    const hardware = this.initHardwareContext();
    const event: TelemetryEvent = {
      eventId: `evt_preview_diag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sessionId: perfLogService.getSessionId() ?? "preview-runtime",
      timestampMs: Date.now(),
      appVersion: this.appVersion,
      appBuildNumber: import.meta.env.MODE || "prod",
      appEnvironment: import.meta.env.DEV ? "beta" : "production",
      device: hardware,
      video: this.sanitizeVideoProfile({
        width: input.width,
        height: input.height,
      }),
      previewContext: {
        sessionId: perfLogService.getSessionId() ?? "preview-runtime",
        view: "webview",
        surface: "dom-canvas",
        scenario: "playback",
        runtimeEnvironment: import.meta.env.DEV ? "development" : "production",
      },
      workload: {
        mode: "playback",
        durationMs: Math.round(input.duration ? input.duration * 1000 : 0),
        targetFps: 60,
        renderedFps: 60,
        totalFrames: 1,
        droppedFrames:
          input.status === "error" || input.status === "recovery_failed"
            ? 1
            : 0,
        droppedFramesRatio:
          input.status === "error" || input.status === "recovery_failed"
            ? 1
            : 0,
        staleFrames: 0,
        cancelledFrames: 0,
        peakRamMb: perfLogService.getPeakMemoryMb() || 512,
        cacheHitRatio: input.hasPreviewProxy ? 1.0 : 0.0,
        stageTimings: { totalTimeUs: 0 },
      },
      sourcePreviewDiagnostic: input,
    };

    this.enqueueEvent(event);

    if (input.status === "error" || input.status === "recovery_failed") {
      this.recordFallbackEvent(
        "webview-html5-video",
        input.status === "recovery_failed"
          ? "failed-poster"
          : "ffmpeg-proxy-transcode",
        `MEDIA_ERR_${input.errorCode ?? "UNKNOWN"}: ${input.errorMessage || "Source video decode failure"}`,
        `Asset: ${input.assetName || "unknown"}, Path: ${input.assetPath || "unknown"}, URL: ${input.srcUrl || "unknown"}`,
      );
    }
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
        readbackUs?: number;
        mapWaitUs?: number;
        timestampQueryAvailable?: boolean;
        decoderMutexWaitUs?: number;
        actorWaitUs?: number;
        gpuQueueWaitUs?: number;
        surfaceAcquireUs?: number;
        schedulerWaitUs?: number;
        lookaheadWaitUs?: number;
        coldStartInitUs?: number;
        queueResidencyUs?: number;
        ipcWaitUs?: number;
        dropped?: boolean;
        stale?: boolean;
        cancelled?: boolean;
        dropReason?: string;
        capabilityPolicy?: "full" | "reduced" | "proxy" | string;
        capabilityProbeUs?: number;
        demuxWaitUs?: number;
        containerFormat?: string;
        isHardwareAccelerated?: boolean;
        transferPath?: string;
      } | null;
      windowDroppedFrames?: number;
      windowStaleFrames?: number;
      windowCancelledFrames?: number;
    } | null,
    videoProfile: Partial<TelemetryVideoProfile> = {},
    previewContext?: TelemetryPreviewContext,
    measurementId?: string,
    capabilityPolicyOverride?: "full" | "reduced" | "proxy" | string,
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
      actorWaitUs: last.actorWaitUs,
      demuxWaitUs: last.demuxWaitUs,
      conversionUploadUs:
        last.conversionUploadUs ?? last.conversionTimeUs ?? last.uploadTimeUs,
      composeUs: last.composeTimeUs,
      surfaceAcquireUs: last.surfaceAcquireUs,
      gpuQueueWaitUs: last.gpuQueueWaitUs,
      readbackUs: last.readbackUs ?? last.readbackTimeUs,
      mapWaitUs: last.mapWaitUs,
      schedulerWaitUs: last.schedulerWaitUs,
      lookaheadWaitUs: last.lookaheadWaitUs,
      coldStartInitUs: last.coldStartInitUs,
      queueResidencyUs: last.queueResidencyUs,
      ipcWaitUs: last.ipcWaitUs,
      submitPresentUs: last.presentTimeUs,
      totalTimeUs: last.totalTimeUs,
    };

    const dropped = last.dropped === true;
    const stale = last.stale === true;
    const cancelled = last.cancelled === true;
    const avDriftMs = nativeSync?.av_drift
      ? nativeSync.av_drift.p95_abs_micros / 1000
      : 0;

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
              : (last.dropReason ?? "native-present-drop")
          : undefined,
        forceSample: previewContext?.scenario === "qualification",
        cacheHit: last.cacheHit,
        capabilityPolicy: capabilityPolicyOverride ?? last.capabilityPolicy,
        capabilityProbeUs: last.capabilityProbeUs,
        renderPath: last.transferPath,
        // The native session is the authoritative frame stream for the Native
        // path. Frontend spans are used for WebView and compatibility fallback
        // only, so Native samples can feed the session rollup without being
        // double-counted by a second frontend frame stream.
        includeInRollup: previewContext?.view === "native",
      },
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

      const previewContext =
        key === "default"
          ? undefined
          : (JSON.parse(key) as TelemetryPreviewContext);
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
              ? Math.min(
                  fullVideoProfile.nominalFps,
                  1000000 / rollup.stageTimings.totalTimeUs,
                )
              : fullVideoProfile.nominalFps,
          totalFrames: rollup.totalFrames,
          droppedFrames: rollup.droppedFrames,
          droppedFramesRatio: rollup.droppedFramesRatio,
          staleFrames: rollup.staleFrames,
          cancelledFrames: rollup.cancelledFrames,
          avDriftMs: rollup.avDriftP95Ms,
          peakRamMb: perfLogService.getPeakMemoryMb() || 512,
          cacheHitRatio: rollup.cacheHitRatio,
          stageTimings: rollup.stageTimings,
          capabilityPolicy: rollup.capabilityPolicy,
          capabilityProbeUs: rollup.capabilityProbeUs,
          renderPercentiles: rollup.renderPercentiles,
          stagePercentiles: rollup.stagePercentiles,
          firstFrameVisibleMs: rollup.firstFrameVisibleMs,
          isSessionRollup: true,
          jankEventsCount: rollup.jankEventsCount,
          throttledAnomaliesCount: rollup.throttledAnomaliesCount,
          readbackMaxDimension: rollup.readbackMaxDimension,
          readbackTier: rollup.readbackTier,
          readbackCadenceFps: rollup.readbackCadenceFps,
          playbackSpeed: rollup.playbackSpeed,
          readbackSourceFrameStride: rollup.readbackSourceFrameStride,
        },
        timestampMs: Date.now(),
      });
    }
    this.flushTextWindowsIfPending();
    this.flushStickerWindowsIfPending();
    this.flushCompositionWindowsIfPending();
  }

  private getRollupAccumulator(
    previewContext?: TelemetryPreviewContext,
  ): SessionRollupAccumulator {
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

    // Route every event to the file-based session log.
    // perfLogService batches and writes to disk; the completed file is uploaded
    // as a single request at session close instead of per-rollup API calls.
    perfLogService.enqueue({
      kind: resolvePerfLogKind(event),
      sessionId: event.sessionId ?? perfLogService.getSessionId() ?? "unknown",
      timestampEpochMs: event.timestampMs,
      payload: event,
    });

    if (this.queue.length >= 30) {
      this.flush();
    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(() => {
      this.flushRollupIfPending();
      this.flushTextWindowsIfPending();
      this.flushStickerWindowsIfPending();
      this.flushCompositionWindowsIfPending();
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
    // All events are forwarded to perfLogService.enqueue() inside enqueueEvent().
    // The completed session file is uploaded as a single request at session close
    // via perfLogService.closeAndUpload(), keeping the remote DB at one row per
    // session instead of one row per rollup window.
    // The queue is cleared here to stay within the MAX_QUEUE_SIZE memory bound.
    this.queue = [];
    return true;
  }

  /**
   * @deprecated MARKED FOR DELETION
   * saveToOfflineStorage, drainOfflineQueue, and clearOfflineQueue are all
   * dead code. The localStorage offline batch queue was the companion to the
   * now-removed /telemetry/ingest/batch endpoint. Session data is accumulated
   * in the NDJSON file by perfLogService and uploaded once at session close.
   * Remove these three methods when the batch path is fully cleaned up.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private saveToOfflineStorage(_batch: {
    batchId: string;
    sentAtMs: number;
    events: TelemetryEvent[];
  }): void {
    // no-op — offline queue removed
  }

  private async drainOfflineQueue(): Promise<void> {
    // no-op — offline queue removed
  }

  private clearOfflineQueue(): void {
    // no-op — offline queue removed; kept to avoid breaking any call sites
    // that haven't been updated yet.
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
