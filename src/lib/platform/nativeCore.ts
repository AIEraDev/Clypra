export const NATIVE_CORE_CONTRACT_VERSION = 1;
export const NATIVE_CORE_TIME_SCALE = 1_000_000;
/**
 * Tauri is the production editor runtime, so native preview is enforced there.
 * The explicit dev flag remains useful for browser harnesses that emulate the
 * desktop contract without exposing Tauri internals.
 */
export const NATIVE_PREVIEW_ONLY =
  (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) ||
  (import.meta.env.DEV && import.meta.env.VITE_CLYPRA_NATIVE_PREVIEW_ONLY === "1");

export type NativeQualityTier = "full" | "half" | "quarter" | "proxy";
export type NativePixelFormat = "rgba8Srgb" | "rgba16Float";
export type NativePlaybackClockStatus = "audio" | "monotonicFallback" | "buffering" | "stopped";
export type NativeSurfaceStatus = "ready" | "resizing" | "deviceLost" | "recovering" | "failed";
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
  generation?: number;
  mode?: "playback" | "scrub" | "seek" | "frameStep";
  quality?: NativeQualityTier;
  strategy?: "HOT" | "WARM" | "COLD";
  cancelled?: boolean;
  stale?: boolean;
  dropped?: boolean;
  seekTimeUs?: number;
  conversionTimeUs?: number;
  uploadTimeUs?: number;
  presentTimeUs?: number;
}

export interface NativeFrameServiceStats {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  cachedEntries: number;
  cachedBytes: number;
  lastSample: NativePerformanceSample | null;
  windowStartedAtMs?: number;
  windowRequestCount?: number;
  windowDroppedFrames?: number;
  windowStaleFrames?: number;
  windowCancelledFrames?: number;
  windowSeekP50Ms?: number;
  windowSeekP95Ms?: number;
  windowSeekP99Ms?: number;
  windowCacheHitRate?: number;
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
  renderer: "body_outline" | "body_glow" | "body_segmentation_glow" | "body_particles";
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
  /** Mask-only assets are uploaded but omitted from visible compositing. */
  isMask?: boolean;
  /** Text bridge assets are tracked separately from other native overlays. */
  isText?: boolean;
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
  mode?: "playback" | "scrub" | "seek" | "frameStep";
  scrubVelocityPxPerSecond?: number;
  requestedAtMs?: number;
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
