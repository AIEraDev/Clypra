export const NATIVE_CORE_CONTRACT_VERSION = 1;
export const NATIVE_CORE_TIME_SCALE = 1_000_000;
/** Opt-in diagnostics for native preview timing and surface composition. */
export const NATIVE_PREVIEW_TRACE_ENABLED =
  import.meta.env.DEV && import.meta.env.VITE_CLYPRA_NATIVE_PREVIEW_TRACE === "1";

export type NativeQualityTier = "full" | "half" | "quarter" | "proxy";
export type NativePixelFormat = "rgba8Srgb" | "rgba16Float";
export type NativePlaybackClockStatus = "audio" | "monotonicFallback" | "buffering" | "stopped";
export type NativeSurfaceStatus = "ready" | "resizing" | "deviceLost" | "recovering" | "failed";
export type NativeGpuRuntimeState = "initializing" | "ready" | "failed";

export interface NativeAudioStatus {
  available: boolean;
  running: boolean;
  host: string | null;
  deviceName: string | null;
  sampleRate: number | null;
  channels: number | null;
  sampleFormat: string | null;
  audioPositionTicks: number;
  lastError: string | null;
  speed: number;
  volume: number;
  muted: boolean;
}

export interface NativeAudioClipStatus {
  id: string;
  sampleRate: number;
  channels: number;
  sampleCount: number;
  durationTicks: number;
  timelineStartTicks: number;
  gain: number;
  fadeInTicks: number;
  fadeOutTicks: number;
}

export interface NativeGpuRuntimeStatus {
  contractVersion: number;
  state: NativeGpuRuntimeState;
  available: boolean;
  adapterName: string | null;
  backend: string | null;
  deviceType: string | null;
  surfaceAvailable: boolean;
  failureReason: string | null;
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
}

export interface NativeFrameServiceStats {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  cachedEntries: number;
  cachedBytes: number;
  lastSample: NativePerformanceSample | null;
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
}

export interface NativeRasterLayerSnapshot {
  assetId: string;
  /** RGBA8 bytes, omitted after native asset registration. */
  rgba?: number[];
  width: number;
  height: number;
  x: number;
  y: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  blendMode: string;
}

export interface NativeProjectSnapshot {
  schemaVersion: number;
  projectRevision: string;
  canvasWidth: number;
  canvasHeight: number;
  clearColor: [number, number, number, number];
  videoLayers: NativeVideoLayerSnapshot[];
  rasterLayers?: NativeRasterLayerSnapshot[];
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
}

export type NativeFrameRequestInput = Omit<NativeFrameRequest, "contractVersion">;

/** Single construction point for preview, filmstrip, and export requests. */
export function createNativeFrameRequest(input: NativeFrameRequestInput): NativeFrameRequest {
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

export interface NativePlaybackState {
  contractVersion: number;
  projectRevision: string;
  audioPositionTicks: number;
  presentedFrame: number | null;
  droppedFrames: number;
  buffering: boolean;
  clockStatus: NativePlaybackClockStatus;
}

export function secondsToNativeTime(seconds: number, frameIndex = 0): NativeFrameTime {
  return {
    frameIndex,
    ticks: Math.max(0, Math.round(seconds * NATIVE_CORE_TIME_SCALE)),
    timescale: NATIVE_CORE_TIME_SCALE,
  };
}

export function frameIndexToNativeTime(frameIndex: number, frameRate: number): NativeFrameTime {
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
