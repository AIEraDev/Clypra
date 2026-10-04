import type { ColdStartReport } from "@/services/telemetryCollector";

export const NATIVE_CORE_CONTRACT_VERSION = 2;
export const NATIVE_CORE_TIME_SCALE = 1_000_000;
/**
 * Clypra's visible program preview is always embedded in the main WebView.
 *
 * A separate Tauri window cannot be reliably constrained to its parent across
 * AppKit, Win32, X11, and Wayland. Native rendering is still available, but
 * its frames are composited into the editor canvas rather than presented by a
 * second OS window. This is deliberately a product invariant, not a
 * platform-specific fallback.
 */
export const EMBEDDED_PREVIEW_ONLY = true;

/**
 * Keep the old native-only switch for browser test harnesses. A Tauri runtime
 * must never implicitly opt into a detached native preview window.
 */
export const NATIVE_PREVIEW_ONLY =
  import.meta.env.DEV &&
  import.meta.env.VITE_CLYPRA_NATIVE_PREVIEW_ONLY === "1";

export type NativeQualityTier = "full" | "half" | "quarter" | "proxy";
export type NativePixelFormat = "rgba8Srgb" | "rgba16Float";
export type NativePlaybackClockStatus =
  | "audio"
  | "monotonicFallback"
  | "buffering"
  | "stopped";
export type NativeSurfaceStatus =
  | "ready"
  | "resizing"
  | "deviceLost"
  | "recovering"
  | "failed";
export type NativeGpuRuntimeState = "initializing" | "ready" | "failed";

export interface NativeAudioStatus {
  available: boolean;
  running: boolean;
  playing: boolean;
  host: string | null;
  deviceName: string | null;
  sampleRate: number | null;
  channels: number | null;
  sampleFormat: string | null;
  audioPositionTicks: number;
  callbackCount: number;
  renderedFrames: number;
  nonSilentFrames: number;
  lastError: string | null;
  speed: number;
  volume: number;
  muted: boolean;
  /** Number of output callbacks that could not acquire the mixer read lock. */
  mixerLockMisses: number;
  /** Accumulated callback execution time, measured off the network path. */
  callbackTimeUs: number;
  callbackMaxTimeUs: number;
  callbackOverBudgetCount: number;
  /** Total seek() calls since the stream was last started. */
  seekCount: number;
  /** Cumulative seek latency in microseconds since the stream was last started. */
  seekLatencyTotalUs: number;
  /**
   * Microseconds since the last CPAL callback advanced the audio clock.
   * Undefined if the stream has never fired a callback.
   */
  clockFreshnessUs?: number;
  /**
   * Median inter-callback spacing in microseconds.
   * Undefined when fewer than 2 callbacks have fired.
   */
  medianCallbackIntervalUs?: number;
  /**
   * Linear 1 ms histogram of output latency (`playback − callback`) in microseconds,
   * with 513 buckets (0..511 ms + overflow). Undefined when the host audio driver does
   * not populate output timestamps.
   */
  outputLatencyUsHistogram?: number[];
  /** Most recent output latency measurement in microseconds. */
  outputLatencyLastUs?: number;
  /** Minimum output latency measurement in microseconds. */
  outputLatencyMinUs?: number;
  /** Maximum output latency measurement in microseconds. */
  outputLatencyMaxUs?: number;
  /** Cumulative sum of output latency measurements in microseconds. */
  outputLatencySumUs?: number;
  /** Total count of output latency measurements. */
  outputLatencyCount?: number;
}

export interface NativeAudioClipStatus {
  id: string;
  sampleRate: number;
  channels: number;
  sampleCount: number;
  durationTicks: number;
  timelineStartTicks: number;
  gain: number;
  pan: number;
  fadeInTicks: number;
  fadeOutTicks: number;
  channelMode: string;
  downmix: string;
  channelMap: number[] | null;
  preservePitch: boolean;
}

/** Derived evidence from the live native audio clock and mixer. */
export interface NativeAudioDiagnostics {
  status: NativeAudioStatus;
  installedClips: NativeAudioClipStatus[];
  activeClipIds: string[];
  mixerPeak: number;
  clipDiagnostics: Array<{ id: string; active: boolean; mixerPeak: number }>;
}

export interface NativeGpuRuntimeStatus {
  contractVersion: number;
  state: NativeGpuRuntimeState;
  available: boolean;
  adapterName: string | null;
  backend: string | null;
  /** Backend requested for a controlled launch; `backend` is actual. */
  requestedBackend: string | null;
  deviceType: string | null;
  vendorId: number | null;
  deviceId: number | null;
  driver: string | null;
  driverInfo: string | null;
  isSoftwareAdapter: boolean | null;
  surfaceAvailable: boolean;
  failureReason: string | null;
}

/** User-initiated local diagnostics snapshot; safe to serialize or copy. */
export interface NativePreviewPerformanceReport {
  reportVersion: number;
  capturedAtMs: number;
  applicationVersion: string;
  /** Cargo profile of the running native binary: debug or release. */
  buildProfile: "debug" | "release" | string;
  operatingSystem: string;
  architecture: string;
  /** Git commit SHA of the binary. Absent when built outside a git repo. */
  gitCommit?: string;
  /** True when the binary was built from a dirty working tree. */
  gitDirty?: boolean;
  gpu: NativeGpuRuntimeStatus | null;
  audio?: NativeAudioStatus | null;
  preview: NativeFrameServiceStats | null;
  session: NativeSessionSnapshot;
  stageDiagnoses: NativePreviewStageDiagnosis[];
  pushBridge: NativePlaybackPushStatus | null;
  playbackCacheInsertSkipped?: boolean;
  coldStart?: ColdStartReport;
}

export interface NativePlaybackPushStatus {
  active: boolean;
  senderStarted: boolean;
  renderWorkerStarted: boolean;
  supersededMailbox: number;
  streamStall: number;
  stallRecovered: number;
  closedChannel: number;
}

export interface NativePreviewStageDiagnosis {
  mode: NativePreviewMode;
  sampleCount: number;
  dominantStage: string;
  dominantP95Us: number;
  recommendedNextStep:
    | "prioritize-decode"
    | "investigate-hardware-download"
    | "investigate-bridge"
    | "investigate-render-upload"
    | "investigate-queue"
    | "warm-up-or-cache"
    | "collect-more-samples"
    | string;
}

export interface NativePerformanceBudget {
  targetFps: number;
  maxFrameRenderTimeUs: number;
  maxSeekLatencyMs: number;
  maxCpuBridgeBytesPerSecond: number;
  maxCacheBytes: number;
}

export interface NativePerformanceSample {
  requestId: string;
  frameIndex: number;
  decodeTimeUs: number;
  composeTimeUs: number;
  readbackTimeUs: number;
  totalTimeUs: number;
  bytesTransferred: number;
  cacheHit: boolean;
  generation?: number;
  mode?: NativePreviewMode;
  quality?: NativeQualityTier;
  strategy?: "HOT" | "WARM" | "COLD";
  /** Actual decoded-frame transfer path, not the scheduling/cache strategy. */
  transferPath?:
    | "dxgi-zero-copy"
    | "cpu-nv12"
    | "cpu-rgba"
    | "mixed"
    | "gpu-raster"
    | string;
  cancelled?: boolean;
  stale?: boolean;
  dropped?: boolean;
  seekTimeUs?: number;
  conversionTimeUs?: number;
  uploadTimeUs?: number;
  presentTimeUs?: number;
  decodeUs?: number;
  conversionUploadUs?: number;
  composeUs?: number;
  readbackUs?: number;
  /** Coarse CPU bracket from readback submission to map_async completion. */
  mapWaitUs?: number;
  /** False means mapWaitUs is a portable CPU bracket, not a GPU query. */
  timestampQueryAvailable?: boolean;
  presentUs?: number;
  schedulerWaitUs?: number;
  lookaheadWaitUs?: number;
  coldStartInitUs?: number;
  /** Time a decoded lookahead frame waited ready to be presented. */
  queueResidencyUs?: number;
  ipcWaitUs?: number;
  decoderMutexWaitUs?: number;
  actorWaitUs?: number;
  gpuQueueWaitUs?: number;
  surfaceAcquireUs?: number;
  submitPresentUs?: number;
  /** Capability policy chosen once at native playback-session startup. */
  capabilityPolicy?: "full" | "reduced" | "proxy" | string;
  /** Duration of the startup capability probe, in microseconds. */
  capabilityProbeUs?: number;
  /** Time spent demuxing packets from container and file I/O (Option 3). */
  demuxWaitUs?: number;
  /** Container format name (e.g. "mp4", "matroska,webm", "mov"). */
  containerFormat?: string;
  /** Whether hardware decoding acceleration is active for the frame stream. */
  isHardwareAccelerated?: boolean;
  /** Container seeks required for this decode; steady playback should be zero after warm-up. */
  decoderSeekCount?: number;
  /** Decoder output frames consumed to resolve one preview request. */
  decoderFramesDecoded?: number;
  /** CPU download time when a hardware frame had to leave GPU memory. */
  hardwareFrameDownloadUs?: number;
  /** CPU scale/colorspace conversion time before GPU upload. */
  scaleColorspaceUs?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  sourceBitsPerRawSample?: number;
  /** Source FPS × 1,000 (e.g. 29.97 FPS is 29970). */
  sourceFrameRateMilli?: number;
  unaccountedUs?: number;
  codecName?: string;
  hardwareFramesDownloaded?: number;
  stageOverlapUs?: number;
  /** How this request was satisfied by the decoder. */
  servedFrom?:
    | "decoded-in-request"
    | "ready-cache"
    | "reused-current"
    | "unchanged-skipped";
  /** Hardware decode device type (e.g. "d3d11va", "videotoolbox", "vaapi", "software"). */
  hwDeviceType?: string;
  /** Time waiting to acquire the NativeFrameService cache lock (consumer path). */
  cacheLockWaitUs?: number;
  /** Time to insert the decoded frame into the NativeFrameService cache. */
  cacheInsertUs?: number;
  dropReason?:
    | "stale"
    | "cancelled"
    | "late-for-audio"
    | "present-failed"
    | string;
}

export interface NativePerformanceSampleBatch {
  samples: NativePerformanceSample[];
  firstSequence: number;
  lastSequence: number;
  nextSequence: number;
  oldestSequence: number;
  latestSequence: number;
  truncated: boolean;
}

export type NativePreviewMode =
  | "playback"
  | "playback-lookahead"
  | "seek"
  | "scrub"
  | "frame-step"
  | "prefetch";

export interface NativeStagePercentiles {
  p50: number | null;
  p95: number | null;
  p99: number | null;
  sampleCount: number;
}

export interface NativeModeStats {
  mode: NativePreviewMode;
  decode: NativeStagePercentiles;
  packetDecode: NativeStagePercentiles;
  conversionUpload: NativeStagePercentiles;
  compose: NativeStagePercentiles;
  readback: NativeStagePercentiles;
  mapWait: NativeStagePercentiles;
  present: NativeStagePercentiles;
  schedulerWait: NativeStagePercentiles;
  lookaheadWait: NativeStagePercentiles;
  coldStartInit: NativeStagePercentiles;
  queueResidency: NativeStagePercentiles;
  ipcWait: NativeStagePercentiles;
  decoderMutexWait: NativeStagePercentiles;
  demuxWait: NativeStagePercentiles;
  decoderSeekCount: NativeStagePercentiles;
  decoderFramesDecoded: NativeStagePercentiles;
  hardwareFrameDownload: NativeStagePercentiles;
  scaleColorspace: NativeStagePercentiles;
  gpuQueueWait: NativeStagePercentiles;
  surfaceAcquire: NativeStagePercentiles;
  submitPresent: NativeStagePercentiles;
  stageOverlap: NativeStagePercentiles;
  /** Time within each invoke not attributed to any measured stage (µs). */
  unaccounted: NativeStagePercentiles;
  uniqueFramesDelivered: number;
  repeatedFramesDelivered: number;
  deliveredUniqueFps: number | null;
  windowSource: string;
  sampleSpanMs: number | null;
  droppedCount: number;
  staleCount: number;
  /** Consumer cache lock wait percentiles. */
  cacheLockWait: NativeStagePercentiles;
  /** Cache insert duration percentiles (consumer path). */
  cacheInsert: NativeStagePercentiles;
  /** Frames served directly from the decode path (no cache hit). */
  servedFromDecodedCount: number;
  /** Frames served from the ready (already-decoded) cache. */
  servedFromReadyCacheCount: number;
  /** Frames served by reusing the most recently presented frame. */
  servedFromReusedCurrentCount: number;
  /** Frames short-circuited via the 12-byte UNCH sentinel because the playback head has not advanced. */
  skippedUnchangedCount: number;
  /** Lookahead frames decoded on GPU without host CPU transfer (Arm 2b in production). */
  lookaheadDownloadsSkippedCount: number;
  /** Producer frames decoded+downloaded and then evicted before being presented. */
  downloadsWastedCount: number;
}

export interface NativeFrameServiceStats {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  cachedEntries: number;
  cachedBytes: number;
  cacheBudgetBytes: number;
  cacheEvictionCount: number;
  cacheRejectedEntryCount: number;
  lastSample: NativePerformanceSample | null;
  lastSampleSequence?: number;
  windowStartedAtMs?: number;
  windowRequestCount?: number;
  windowDroppedFrames?: number;
  windowStaleFrames?: number;
  windowCancelledFrames?: number;
  windowSeekP50Ms?: number;
  windowSeekP95Ms?: number;
  windowSeekP99Ms?: number;
  windowCacheHitRate?: number;
  modeStats?: NativeModeStats[];
  /** PR4: total times schedule_lookahead_predecode was called. */
  lookaheadTriggerCount?: number;
  /** PR4: times a trigger was dropped by the in-flight guard. */
  lookaheadTriggerDropped?: number;
  /** PR4: cumulative producer idle time in ms between prime calls. */
  producerIdleTotalMs?: number;
  /** PR4: latest ahead-of-audio-clock measurement in ms (positive = ahead). */
  producerAheadOfClockMs?: number;
  /** Lifetime hits on the VRAM SDF text layer cache since process start. Expected 0 for Canvas 2D / worker paths. */
  textLayerCacheHits?: number;
  /** Lifetime hits on the native SDF glyph cache since process start. */
  glyphCacheHits?: number;
  /** Lifetime misses on the native SDF glyph cache since process start. */
  glyphCacheMisses?: number;
}

export const NATIVE_PLAYBACK_POLICY = {
  maxAvDriftMs: 16,
  videoDropThresholdMs: 20,
  minAudioBufferMs: 100,
  maxVideoLookaheadMs: 200,
} as const;

export const NATIVE_PERFORMANCE_BUDGET: NativePerformanceBudget = {
  targetFps: 60,
  maxFrameRenderTimeUs: 16_667,
  maxSeekLatencyMs: 100,
  maxCpuBridgeBytesPerSecond: 500_000_000,
  maxCacheBytes: 1_073_741_824,
};

export interface NativeSurfaceGeometry {
  xPhysical: number;
  yPhysical: number;
  widthPhysical: number;
  heightPhysical: number;
  devicePixelRatio: number;
}

export interface NativeSurfaceProbe {
  contractVersion: number;
  status: NativeSurfaceStatus;
  geometry: NativeSurfaceGeometry;
  windowWidthPhysical: number;
  windowHeightPhysical: number;
  adapterName: string;
  backend: string;
  format: string;
  presentMode: string;
  alphaMode: string;
  supportedFormats: string[];
}

export interface NativeSurfacePresentation {
  contractVersion: number;
  requestId: string;
  frameIndex: number;
  presented: boolean;
  dropped: boolean;
  audioPositionTicks: number;
  frameAgeTicks: number;
  surface: NativeSurfaceProbe;
  generation?: number;
  mode?: "playback" | "scrub" | "seek" | "frameStep";
  stale?: boolean;
  cancelled?: boolean;
  dropReason?:
    | "stale"
    | "cancelled"
    | "late-for-audio"
    | "present-failed"
    | "lookahead-miss";
  timings?: {
    totalUs: number;
    decodeUs: number;
    decoderMutexWaitUs: number;
    actorWaitUs?: number;
    demuxWaitUs?: number;
    conversionUploadUs: number;
    composeUs: number;
    surfaceAcquireUs: number;
    gpuQueueWaitUs?: number;
    submitPresentUs: number;
    lookaheadWaitUs?: number;
    coldStartInitUs?: number;
    queueResidencyUs?: number;
    queueHit: boolean;
  };
}

export interface NativeSyncDriftSnapshot {
  n: number;
  avg_micros: number;
  max_abs_micros: number;
  p95_abs_micros: number;
}

export interface NativeSyncFramePacingSnapshot {
  n: number;
  target_interval_micros: number;
  stddev_micros: number;
  jank_events: number;
}

export interface NativeSyncSeekSnapshot {
  n: number;
  avg_latency_micros: number;
  max_latency_micros: number;
  correct: number;
  events: Array<{
    requested_ticks: number;
    presented_ticks: number;
    latency_micros: number;
    correct: boolean;
  }>;
}

/** Snapshot returned by the native A/V synchronization metrics command. */
export interface NativeSyncMetricsSnapshot {
  av_drift: NativeSyncDriftSnapshot;
  frame_pacing: NativeSyncFramePacingSnapshot;
  dropped_frames: number;
  seeks: NativeSyncSeekSnapshot;
  timestamp_epoch_ms: number;
}

/** Source breakdown of rendered frames in the session. */
export interface NativeFramesBySource {
  dxgiNv12: number;
  cpuNv12: number;
  cpuRgba: number;
  unknown: number;
}

/** Complete session performance snapshot from the Phase 5 PerformanceManager / SessionTelemetryCollector. */
export interface NativeSessionSnapshot {
  sessionDurationSecs: number;
  framesProduced: number;
  framesDropped: number;
  deadlineMisses: number;
  dropRatePct?: number | null;
  missRatePct?: number | null;
  avgDecodeUs?: number | null;
  peakDecodeUs?: number | null;
  avgQueueWaitUs?: number | null;
  peakQueueWaitUs?: number | null;
  avgIpcWaitUs?: number | null;
  peakIpcWaitUs?: number | null;
  avgGpuRenderUs?: number | null;
  peakGpuRenderUs?: number | null;
  framesBySource: NativeFramesBySource;
  policyBackgroundPauses: number;
  policyInteractiveThrottles: number;
}

export interface NativeFrameTime {
  frameIndex: number;
  ticks: number;
  timescale: number;
}

export interface NativeColorPolicy {
  version: number;
  workingSpace: "linear-rec709";
  outputFormat: NativePixelFormat;
  toneMapHdrToSdr: boolean;
  displayProfile: "srgb-reference";
}

export interface NativeVideoLayerSnapshot {
  layerId?: string;
  assetId: string;
  videoPath: string;
  sourceTime: NativeFrameTime;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  blendMode: string;
  colorGrade?: NativeColorGradeSnapshot;
  bodyEffect?: NativeBodyEffectSnapshot;
}

export interface NativeTransitionSnapshot {
  outgoingLayer: string;
  incomingLayer: string;
  transitionType: string;
  progress: number;
  feather?: number;
  intensity?: number;
  /** Optional color used by fade-through-color transitions. */
  fadeColor?: [number, number, number, number];
}

export interface NativeBodyEffectSnapshot {
  maskAssetId: string;
  renderer:
    | "body_outline"
    | "body_glow"
    | "body_segmentation_glow"
    | "body_particles"
    | "body_cutout"
    | "subject_cutout";
  colorR: number;
  colorG: number;
  colorB: number;
  strength: number;
  radius: number;
  time: number;
}

export interface NativeColorGradeSnapshot {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  brightness: number;
  sepia: number;
  grayscale: number;
  hueRotate: number;
  vignette: number;
  invert: number;
  grainIntensity: number;
  grainSize: number;
  lutId?: string;
  lutIntensity: number;
  lutSize: number;
  blurStrength: number;
  blurRadius: number;
  pixelateSize: number;
  scanlineCount: number;
  scanlineIntensity: number;
  rgbSplitX: number;
  rgbSplitY: number;
  chromaticAmount?: number;
  chromaticAngle?: number;
  chromaticEdgeFeather?: number;
  vibranceAmount: number;
  vibranceProtectedHueR: number;
  vibranceProtectedHueG: number;
  vibranceProtectedHueB: number;
  lift: number;
  crossProcessAmount: number;
  channelMixR: number;
  channelMixG: number;
  channelMixB: number;
  channelMixEnabled: number;
  duotoneDarkR: number;
  duotoneDarkG: number;
  duotoneDarkB: number;
  duotoneLightR: number;
  duotoneLightG: number;
  duotoneLightB: number;
  duotoneEnabled: number;
  shadowTintR: number;
  shadowTintG: number;
  shadowTintB: number;
  shadowTintStrength: number;
  highlightTintR: number;
  highlightTintG: number;
  highlightTintB: number;
  highlightTintStrength: number;
  splitBalance: number;
  glowColorR: number;
  glowColorG: number;
  glowColorB: number;
  glowStrength: number;
  glowRadius: number;
  flashColorR: number;
  flashColorG: number;
  flashColorB: number;
  flashStrength: number;
  flickerStrength: number;
  strobeFrequency: number;
  strobeTime: number;
  strobeStrength: number;
  lightLeakColorR: number;
  lightLeakColorG: number;
  lightLeakColorB: number;
  lightLeakStrength: number;
  lightLeakAngle: number;
  lightLeakTime: number;
  glitchIntensity?: number;
  glitchTime?: number;
  glitchSliceCount?: number;
  glitchColorShift?: number;
  distortionType?: number;
  distortionStrength?: number;
  distortionTime?: number;
  distortionFrequency?: number;
  /** Procedural fire overlay: height, particle count, intensity, time. */
  fireParams?: [number, number, number, number];
  fireColor1?: [number, number, number, number];
  fireColor2?: [number, number, number, number];
  fireColor3?: [number, number, number, number];
  /** Procedural particles: count, size, drift speed, intensity. */
  particleParams?: [number, number, number, number];
  /** RGB plus mode (1 particles, 2 dust; fractional .5 means edge fade). */
  particleColor?: [number, number, number, number];
  particleTime?: number;
}

export interface NativeRasterLayerSnapshot {
  layerId?: string;
  assetId: string;
  /** RGBA8 bytes, omitted after native asset registration. */
  rgba?: Uint8ClampedArray | number[];
  /** Dimensions of the immutable uploaded texture. */
  width: number;
  height: number;
  /** Placement dimensions. Defaults to the texture dimensions for legacy callers. */
  displayWidth?: number;
  displayHeight?: number;
  x: number;
  y: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  blendMode: string;
  /** Mask-only assets are uploaded but omitted from visible compositing. */
  isMask?: boolean;
  /** Text bridge assets are tracked separately from other native overlays. */
  isText?: boolean;
}

export interface NativeTextLayerSnapshot {
  layerId?: string;
  text: string;
  fontId: string;
  fontSize: number;
  /** CSS weight normalized to a stable native string (normal, bold, or 100–900). */
  fontWeight?: string;
  fontStyle?: "normal" | "italic";
  letterSpacing?: number;
  lineHeight?: number;
  color?: [number, number, number, number];
  textAlign?: string;
  verticalAlign?: string;
  x: number;
  y: number;
  boxWidth?: number;
  boxHeight?: number;
  rotation?: number;
  opacity?: number;
  zIndex?: number;
  blendMode?: string;
  strokeColor?: [number, number, number, number];
  strokeWidth?: number;
  shadowColor?: [number, number, number, number];
  shadowOffset?: [number, number];
  shadowBlur?: number;
  background?: {
    color: [number, number, number, number];
    padding: number;
    borderRadius: number;
  };
  runs?: Array<{
    text: string;
    color?: [number, number, number, number];
    highlighted?: boolean;
  }>;
  /** Template identity and already-resolved customization payload. */
  templateId?: string;
  templateData?: Record<string, unknown>;
  effect?: {
    effectId: string;
    effectVersion: number;
    parameterOverrides?: Record<string, any>;
    definition?: {
      displayName?: string;
      params?: Record<string, any>;
      passes: Array<{
        primitive: string;
        tier?: string;
        params?: Record<string, any>;
      }>;
    };
  };
}

export interface NativeProjectSnapshot {
  schemaVersion: number;
  projectRevision: string;
  /** Authoritative project frame rate used by native pacing telemetry. */
  frameRate?: number;
  canvasWidth: number;
  canvasHeight: number;
  clearColor: [number, number, number, number];
  videoLayers: NativeVideoLayerSnapshot[];
  rasterLayers?: NativeRasterLayerSnapshot[];
  textLayers?: NativeTextLayerSnapshot[];
  transition?: NativeTransitionSnapshot;
}

export interface NativeFrameRequest {
  contractVersion: number;
  requestId: string;
  frameTime: NativeFrameTime;
  project: NativeProjectSnapshot;
  outputWidth: number;
  outputHeight: number;
  quality: NativeQualityTier;
  colorPolicy: NativeColorPolicy;
  renderGraphVersion: number;
  /** Optional asynchronous seek identity; omitted by legacy callers. */
  generation?: number;
  mode?:
    | "playback"
    | "playback-lookahead"
    | "scrub"
    | "seek"
    | "frameStep"
    | "prefetch";
  scrubVelocityPxPerSecond?: number;
  requestedAtMs?: number;
  isScrubbing?: boolean;
  allowKeyframeApprox?: boolean;
}

export type NativeFrameRequestInput = Omit<
  NativeFrameRequest,
  "contractVersion"
>;

/** Single construction point for preview, filmstrip, and export requests. */
export function createNativeFrameRequest(
  input: NativeFrameRequestInput,
): NativeFrameRequest {
  return {
    contractVersion: NATIVE_CORE_CONTRACT_VERSION,
    ...input,
  };
}

export interface NativePlaybackPlan {
  contractVersion: number;
  projectRevision: string;
  frameRate: number;
  durationFrames: number;
  audioTrackCount: number;
}

export interface NativePlaybackFrameDemand {
  contractVersion: number;
  requestId: string;
  frameTime: NativeFrameTime;
  generation?: number;
  mode?: NativeFrameRequest["mode"];
  videoLayers: Array<{
    layerId?: string;
    sourceTime: NativeFrameTime;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    opacity: number;
    zIndex: number;
    colorGrade?: NativeColorGradeSnapshot;
    bodyEffect?: NativeBodyEffectSnapshot;
  }>;
  rasterLayers: Array<{
    layerId?: string;
    assetId: string;
    width: number;
    height: number;
    displayWidth?: number;
    displayHeight?: number;
    x: number;
    y: number;
    rotation: number;
    opacity: number;
    zIndex: number;
    blendMode?: string;
    isMask?: boolean;
  }>;
  textLayers: Array<{
    layerId?: string;
    x: number;
    y: number;
    rotation: number;
    opacity: number;
    zIndex: number;
  }>;
  transitionProgress?: number;
}

/** Build the compact per-frame update for the persistent Rust Native session. */
export function createNativePlaybackFrameDemand(
  request: NativeFrameRequest,
): NativePlaybackFrameDemand {
  return {
    contractVersion: request.contractVersion,
    requestId: request.requestId,
    frameTime: request.frameTime,
    generation: request.generation,
    mode: request.mode,
    videoLayers: request.project.videoLayers.map((layer) => ({
      layerId: layer.layerId,
      sourceTime: layer.sourceTime,
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height,
      rotation: layer.rotation,
      opacity: layer.opacity,
      zIndex: layer.zIndex,
      colorGrade: layer.colorGrade,
      bodyEffect: layer.bodyEffect,
    })),
    rasterLayers: (request.project.rasterLayers ?? []).map((layer) => ({
      layerId: layer.layerId,
      assetId: layer.assetId,
      width: layer.width,
      height: layer.height,
      displayWidth: layer.displayWidth,
      displayHeight: layer.displayHeight,
      x: layer.x,
      y: layer.y,
      rotation: layer.rotation ?? 0,
      opacity: layer.opacity ?? 1,
      zIndex: layer.zIndex ?? 0,
      blendMode: layer.blendMode,
      isMask: layer.isMask ?? false,
    })),
    textLayers: (request.project.textLayers ?? []).map((layer) => ({
      layerId: layer.layerId,
      x: layer.x,
      y: layer.y,
      rotation: layer.rotation ?? 0,
      opacity: layer.opacity ?? 1,
      zIndex: layer.zIndex ?? 0,
    })),
    transitionProgress: request.project.transition?.progress,
  };
}

export interface NativePlaybackState {
  contractVersion: number;
  projectRevision: string;
  audioPositionTicks: number;
  presentedFrame: number | null;
  droppedFrames: number;
  buffering: boolean;
  clockStatus: NativePlaybackClockStatus;
  /** Native monotonic timestamp in nanoseconds captured when audio position was sampled. */
  sampledAtNs?: number;
}

export function secondsToNativeTime(
  seconds: number,
  frameIndex = 0,
): NativeFrameTime {
  return {
    frameIndex,
    ticks: Math.max(0, Math.round(seconds * NATIVE_CORE_TIME_SCALE)),
    timescale: NATIVE_CORE_TIME_SCALE,
  };
}

export function frameIndexToNativeTime(
  frameIndex: number,
  frameRate: number,
): NativeFrameTime {
  const safeRate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  return secondsToNativeTime(frameIndex / safeRate, frameIndex);
}

export const DEFAULT_NATIVE_COLOR_POLICY: NativeColorPolicy = {
  version: 1,
  workingSpace: "linear-rec709",
  outputFormat: "rgba8Srgb",
  toneMapHdrToSdr: true,
  displayProfile: "srgb-reference",
};

export { getColdStartReport, recordFrontendLaunchMilestones, markGpuAwaited } from "./tauri";
export type { ColdStartReport, ColdSpan } from "../../services/telemetryCollector";
