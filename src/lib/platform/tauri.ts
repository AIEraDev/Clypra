import { invoke, Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AudioFadeCurve, DensityLevel, ThumbnailTile } from "../../types";
import { toNativePath } from "./pathConversion";
import type {
  NativeFrameRequest,
  NativeFrameServiceStats,
  NativeAudioDiagnostics,
  NativeAudioStatus,
  NativeAudioClipStatus,
  NativeGpuRuntimeStatus,
  NativePlaybackPlan,
  NativePlaybackState,
  NativeFrameTime,
  NativeSurfaceGeometry,
  NativeSurfaceProbe,
  NativeSurfacePresentation,
  NativeRasterLayerSnapshot,
  NativeSyncMetricsSnapshot,
} from "./nativeCore";

export const isTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface NativeMediaStream {
  index: number;
  type: "audio" | "video" | "data" | "subtitle" | "unknown";
  codec: string;
  codecLongName?: string;
  duration?: number;
  timeBaseNum?: number;
  timeBaseDen?: number;
  sampleRate?: number;
  channels?: number;
  channelLayout?: string;
  bitrate?: number;
  language?: string;
  label?: string;
}

export interface AudioExtractionRequest {
  sourceAssetId: string;
  sourcePath: string;
  sourceStreamIndex: number;
  mode?: "auto" | "streamCopy" | "transcode";
  outputCodec?: string;
  outputContainer?: string;
}

export interface MediaJobUpdate {
  jobId: string;
  operation: string;
  state: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress?: number;
  resultingAssetId?: string;
  errorSummary?: string;
}

export interface MediaJobResult {
  jobId: string;
  state: string;
  asset?: {
    id: string;
    name: string;
    path: string;
    mediaType: "audio";
    duration: number;
    size: number;
    streams: NativeMediaStream[];
    sourceAssetId: string;
    sourceStreamIndex: number;
    extractionMethod: "streamCopy" | "transcode";
    operationFingerprint: string;
  };
  errorSummary?: string;
}

export async function probeMediaStreams(path: string): Promise<NativeMediaStream[]> {
  if (!isTauriRuntime()) throw new Error("Media stream probing requires the Tauri runtime");
  return invoke<NativeMediaStream[]>("probe_media_streams", { path: toNativePath(path) });
}

export async function startAudioExtraction(request: AudioExtractionRequest): Promise<string> {
  if (!isTauriRuntime()) throw new Error("Audio extraction requires the Tauri runtime");
  return invoke<string>("start_audio_extraction", {
    request: { ...request, sourcePath: toNativePath(request.sourcePath) },
  });
}

export async function cancelMediaJob(jobId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("cancel_media_job", { jobId });
}

export async function getMediaJobResult(jobId: string): Promise<MediaJobResult | null> {
  if (!isTauriRuntime()) return null;
  return invoke<MediaJobResult | null>("get_media_job_result", { jobId });
}

export function listenForMediaJobUpdates(handler: (update: MediaJobUpdate) => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return Promise.resolve(() => undefined);
  return listen<MediaJobUpdate>("media_job_update", (event) => handler(event.payload));
}

/**
 * Tauri `invoke` / FFmpeg need a native filesystem path.
 * Use centralized path conversion utility.
 * @deprecated Use toNativePath from pathConversion.ts directly
 */
export function normalizePathForTauriInvoke(inputPath: string): string {
  return toNativePath(inputPath);
}

export interface VideoRenderMetadata {
  width: number;
  height: number;
  durationSeconds: number;
  timeBaseNum: number;
  timeBaseDen: number;
  nominalFrameRateNum: number;
  nominalFrameRateDen: number;
  averageFrameRateNum: number;
  averageFrameRateDen: number;
  pixelFormatCode: number;
  bitsPerRawSample: number;
  sampleAspectRatioNum: number;
  sampleAspectRatioDen: number;
  rotation: number;
  color: {
    range: string;
    rangeCode: number;
    matrix: string;
    matrixCode: number;
    primaries: string;
    primariesCode: number;
    transfer: string;
    transferCode: number;
    chromaLocation: string;
    chromaLocationCode: number;
  };
}

/**
 * Read the complete native decoder contract used by the future program
 * renderer. The legacy get_media_metadata response intentionally stays small.
 */
export async function getVideoRenderMetadata(videoPath: string): Promise<VideoRenderMetadata> {
  if (!isTauriRuntime()) {
    throw new Error("getVideoRenderMetadata requires the Tauri runtime");
  }

  return invoke<VideoRenderMetadata>("get_video_render_metadata", {
    path: toNativePath(videoPath),
  });
}

/**
 * Decode one frame through the native FFmpeg + wgpu proof path.
 * The returned buffer is tightly packed RGBA8 at the source frame dimensions.
 */
export async function renderNativePreviewFrame(
  videoPath: string,
  timeSecs: number,
  outputWidth?: number,
  outputHeight?: number,
): Promise<ArrayBuffer> {
  if (!isTauriRuntime()) {
    throw new Error("renderNativePreviewFrame requires the Tauri runtime");
  }

  const args: {
    videoPath: string;
    timeSecs: number;
    outputWidth?: number;
    outputHeight?: number;
  } = {
    videoPath: toNativePath(videoPath),
    timeSecs,
  };
  if (outputWidth !== undefined) args.outputWidth = outputWidth;
  if (outputHeight !== undefined) args.outputHeight = outputHeight;

  return invoke<ArrayBuffer>("render_native_preview_frame", args);
}

/** Decode one native still-image frame as alpha-preserving RGBA8 pixels. */
export async function decodeNativeRgbaFrame(
  sourcePath: string,
  width: number,
  height: number,
): Promise<ArrayBuffer> {
  if (!isTauriRuntime()) {
    throw new Error("decodeNativeRgbaFrame requires the Tauri runtime");
  }
  return invoke<ArrayBuffer>("decode_image_rgba", {
    path: toNativePath(sourcePath),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  });
}

/**
 * Decode and upload a still image entirely inside the native compositor.
 *
 * The pixel buffer must not cross the WebView boundary: doing so turns a
 * first-use image into a multi-megabyte JSON/IPC operation and can stall the
 * editor when playback enters the image clip.
 */
export async function registerNativeImageAsset(options: {
  assetId: string;
  sourcePath: string;
  width: number;
  height: number;
}): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("registerNativeImageAsset requires the Tauri runtime");
  }
  await invoke("register_native_image_asset", {
    assetId: options.assetId,
    path: toNativePath(options.sourcePath),
    width: Math.max(1, Math.round(options.width)),
    height: Math.max(1, Math.round(options.height)),
  });
}

export interface NativeProjectSolidLayer {
  color: [number, number, number, number];
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  zIndex?: number;
  blendMode?: string;
}

export interface NativeProjectFrameRequest {
  canvasWidth: number;
  canvasHeight: number;
  clearColor?: [number, number, number, number];
  layers: NativeProjectSolidLayer[];
}

/**
 * Render one project-sized native compositor frame.
 * The returned buffer is tightly packed RGBA8 at the requested canvas size.
 */
export async function renderNativeProjectFrame(
  request: NativeProjectFrameRequest,
): Promise<ArrayBuffer> {
  if (!isTauriRuntime()) {
    throw new Error("renderNativeProjectFrame requires the Tauri runtime");
  }

  return invoke<ArrayBuffer>("render_native_project_frame", { request });
}

export interface NativeProjectVideoLayer {
  layerId?: string;
  videoPath: string;
  timeSecs: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  zIndex?: number;
  blendMode?: string;
  colorGrade?: import("./nativeCore").NativeColorGradeSnapshot;
  bodyEffect?: import("./nativeCore").NativeBodyEffectSnapshot;
}

export interface NativeVideoProjectFrameRequest {
  canvasWidth: number;
  canvasHeight: number;
  clearColor?: [number, number, number, number];
  layers: NativeProjectVideoLayer[];
  rasterLayers?: import("./nativeCore").NativeRasterLayerSnapshot[];
  textLayers?: import("./nativeCore").NativeTextLayerSnapshot[];
  transition?: import("./nativeCore").NativeTransitionSnapshot;
}

/**
 * Decode and composite project video layers entirely in native Rust/wgpu.
 */
export async function renderNativeVideoProjectFrame(
  request: NativeVideoProjectFrameRequest,
): Promise<ArrayBuffer> {
  if (!isTauriRuntime()) {
    throw new Error("renderNativeVideoProjectFrame requires the Tauri runtime");
  }

  const nativeRequest: NativeVideoProjectFrameRequest = {
    ...request,
    layers: request.layers.map((layer) => ({
      ...layer,
      videoPath: toNativePath(layer.videoPath),
    })),
  };
  return invoke<ArrayBuffer>("render_native_video_project_frame", { request: nativeRequest });
}

/**
 * Render through the versioned native-core contract. This is the preferred
 * boundary for new preview, filmstrip, and export callers.
 */
export async function renderNativeFrame(request: NativeFrameRequest): Promise<ArrayBuffer> {
  if (!isTauriRuntime()) {
    throw new Error("renderNativeFrame requires the Tauri runtime");
  }

  const nativeRequest: NativeFrameRequest = {
    ...request,
    project: {
      ...request.project,
      videoLayers: request.project.videoLayers.map((layer) => ({
        ...layer,
        videoPath: toNativePath(layer.videoPath),
      })),
    },
  };
  return invoke<ArrayBuffer>("render_native_frame", { request: nativeRequest });
}

/** Register a bundled/editor font in the strict native font registry. */
export async function registerNativeFont(fontId: string, path: string): Promise<number> {
  if (!isTauriRuntime()) throw new Error("registerNativeFont requires the Tauri runtime");
  return invoke<number>("register_native_font", { fontId, path: toNativePath(path) });
}

export async function listNativeFonts(): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  return invoke<string[]>("list_native_fonts");
}

/**
 * Submit a versioned frame directly to the retained native wgpu surface.
 * Readback via renderNativeFrame remains the fallback when the preview is
 * hosted in a browser canvas or the native surface is unavailable.
 */
export async function presentNativeFrame(
  request: NativeFrameRequest,
): Promise<NativeSurfacePresentation> {
  if (!isTauriRuntime()) {
    throw new Error("presentNativeFrame requires the Tauri runtime");
  }

  const nativeRequest: NativeFrameRequest = {
    ...request,
    project: {
      ...request.project,
      videoLayers: request.project.videoLayers.map((layer) => ({
        ...layer,
        videoPath: toNativePath(layer.videoPath),
      })),
    },
  };
  return invoke<NativeSurfacePresentation>("present_native_frame", { request: nativeRequest });
}

/** Decode a native playback frame ahead of presentation. */
export async function queueNativeFrame(request: NativeFrameRequest): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("queueNativeFrame requires the Tauri runtime");
  }

  const nativeRequest: NativeFrameRequest = {
    ...request,
    project: {
      ...request.project,
      videoLayers: request.project.videoLayers.map((layer) => ({
        ...layer,
        videoPath: toNativePath(layer.videoPath),
      })),
    },
  };
  await invoke("queue_native_frame", { request: nativeRequest });
}

/** Invalidate native preview work from older seek generations. */
export async function cancelNativePreviewRequests(generation: number): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("cancel_native_preview_requests", { generation });
}

/** Upload immutable raster pixels once so frame requests can reference them by id. */
export async function registerNativeRasterAsset(
  asset: NativeRasterLayerSnapshot & { rgba: number[] },
): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("registerNativeRasterAsset requires the Tauri runtime");
  }
  await invoke("register_native_raster_asset", {
    asset: {
      assetId: asset.assetId,
      width: asset.width,
      height: asset.height,
      rgba: asset.rgba,
    },
  });
}

export async function getNativeFrameServiceStats(): Promise<NativeFrameServiceStats> {
  if (!isTauriRuntime()) {
    throw new Error("getNativeFrameServiceStats requires the Tauri runtime");
  }
  return invoke<NativeFrameServiceStats>("get_native_frame_service_stats");
}

export async function getNativeSyncMetricsSnapshot(): Promise<NativeSyncMetricsSnapshot> {
  if (!isTauriRuntime()) {
    throw new Error("getNativeSyncMetricsSnapshot requires the Tauri runtime");
  }
  return invoke<NativeSyncMetricsSnapshot>("get_sync_metrics_snapshot");
}

export async function getNativeGpuStatus(): Promise<NativeGpuRuntimeStatus> {
  if (!isTauriRuntime()) {
    throw new Error("getNativeGpuStatus requires the Tauri runtime");
  }

  return invoke<NativeGpuRuntimeStatus>("get_native_gpu_status");
}

export async function probeNativeSurface(geometry: NativeSurfaceGeometry): Promise<NativeSurfaceProbe> {
  if (!isTauriRuntime()) {
    throw new Error("probeNativeSurface requires the Tauri runtime");
  }
  return invoke<NativeSurfaceProbe>("probe_native_surface", { geometry });
}

/** Convert a DOM preview rectangle into physical screen coordinates for the
 * native child surface. The native host is deliberately sized in physical
 * pixels so DPI changes cannot introduce a one-frame scaling mismatch. */
export async function getNativePreviewSurfaceGeometry(
  element: HTMLElement,
): Promise<NativeSurfaceGeometry> {
  if (!isTauriRuntime()) {
    throw new Error("getNativePreviewSurfaceGeometry requires the Tauri runtime");
  }

  const rect = element.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const windowPosition = await getCurrentWindow().innerPosition();
  return {
    xPhysical: windowPosition.x + Math.round(rect.left * dpr),
    yPhysical: windowPosition.y + Math.round(rect.top * dpr),
    widthPhysical: Math.max(1, Math.round(rect.width * dpr)),
    heightPhysical: Math.max(1, Math.round(rect.height * dpr)),
    devicePixelRatio: dpr,
  };
}

/** Notify native preview geometry when the host window moves. */
export async function onNativePreviewWindowMoved(handler: () => void): Promise<() => void> {
  if (!isTauriRuntime()) {
    throw new Error("onNativePreviewWindowMoved requires the Tauri runtime");
  }
  return getCurrentWindow().onMoved(() => handler());
}

export async function resizeNativeSurface(geometry: NativeSurfaceGeometry): Promise<NativeSurfaceProbe> {
  if (!isTauriRuntime()) {
    throw new Error("resizeNativeSurface requires the Tauri runtime");
  }

  return invoke<NativeSurfaceProbe>("resize_native_surface", { geometry });
}

export async function hideNativeSurface(): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("hideNativeSurface requires the Tauri runtime");
  }
  await invoke("hide_native_surface");
}

export async function getNativeSurfaceStatus(): Promise<NativeSurfaceProbe | null> {
  if (!isTauriRuntime()) {
    throw new Error("getNativeSurfaceStatus requires the Tauri runtime");
  }

  return invoke<NativeSurfaceProbe | null>("get_native_surface_status");
}

export async function configureNativePlayback(plan: NativePlaybackPlan): Promise<NativePlaybackState> {
  if (!isTauriRuntime()) throw new Error("configureNativePlayback requires the Tauri runtime");
  return invoke<NativePlaybackState>("configure_native_playback", { plan });
}

export async function getNativePlaybackState(): Promise<NativePlaybackState> {
  if (!isTauriRuntime()) throw new Error("getNativePlaybackState requires the Tauri runtime");
  return invoke<NativePlaybackState>("get_native_playback_state");
}

export async function nativePlay(clock: NativeFrameTime): Promise<NativePlaybackState> {
  if (!isTauriRuntime()) throw new Error("nativePlay requires the Tauri runtime");
  return invoke<NativePlaybackState>("native_play", { clock });
}

export async function nativePause(clock: NativeFrameTime): Promise<NativePlaybackState> {
  if (!isTauriRuntime()) throw new Error("nativePause requires the Tauri runtime");
  return invoke<NativePlaybackState>("native_pause", { clock });
}

export async function nativeSeek(frameIndex: number): Promise<NativePlaybackState> {
  if (!isTauriRuntime()) throw new Error("nativeSeek requires the Tauri runtime");
  return invoke<NativePlaybackState>("native_seek", { frameIndex });
}

export async function nativeSeekFromAudio(frameIndex: number): Promise<NativePlaybackState> {
  if (!isTauriRuntime()) throw new Error("nativeSeekFromAudio requires the Tauri runtime");
  return invoke<NativePlaybackState>("native_seek_from_audio", { frameIndex });
}

export async function nativeTick(clock: NativeFrameTime): Promise<NativePlaybackState> {
  if (!isTauriRuntime()) throw new Error("nativeTick requires the Tauri runtime");
  return invoke<NativePlaybackState>("native_tick", { clock });
}

export async function nativePlayFromAudio(): Promise<NativePlaybackState> {
  if (!isTauriRuntime()) throw new Error("nativePlayFromAudio requires the Tauri runtime");
  return invoke<NativePlaybackState>("native_play_from_audio");
}

export async function nativePauseFromAudio(): Promise<NativePlaybackState> {
  if (!isTauriRuntime()) throw new Error("nativePauseFromAudio requires the Tauri runtime");
  return invoke<NativePlaybackState>("native_pause_from_audio");
}

export async function nativeTickFromAudio(): Promise<NativePlaybackState> {
  if (!isTauriRuntime()) throw new Error("nativeTickFromAudio requires the Tauri runtime");
  return invoke<NativePlaybackState>("native_tick_from_audio");
}

export async function startNativeAudio(): Promise<NativeAudioStatus> {
  if (!isTauriRuntime()) throw new Error("startNativeAudio requires the Tauri runtime");
  return invoke<NativeAudioStatus>("start_native_audio");
}

export async function stopNativeAudio(): Promise<void> {
  if (!isTauriRuntime()) throw new Error("stopNativeAudio requires the Tauri runtime");
  await invoke("stop_native_audio");
}

export async function getNativeAudioStatus(): Promise<NativeAudioStatus> {
  if (!isTauriRuntime()) throw new Error("getNativeAudioStatus requires the Tauri runtime");
  return invoke<NativeAudioStatus>("get_native_audio_status");
}

export async function getNativeAudioDiagnostics(): Promise<NativeAudioDiagnostics> {
  if (!isTauriRuntime()) throw new Error("getNativeAudioDiagnostics requires the Tauri runtime");
  return invoke<NativeAudioDiagnostics>("get_native_audio_diagnostics");
}

export async function pauseNativeAudio(): Promise<void> {
  if (!isTauriRuntime()) throw new Error("pauseNativeAudio requires the Tauri runtime");
  await invoke("pause_native_audio");
}

export async function resumeNativeAudio(): Promise<void> {
  if (!isTauriRuntime()) throw new Error("resumeNativeAudio requires the Tauri runtime");
  await invoke("resume_native_audio");
}

export async function setNativeAudioSpeed(speed: number): Promise<void> {
  if (!isTauriRuntime()) throw new Error("setNativeAudioSpeed requires the Tauri runtime");
  await invoke("set_native_audio_speed", { speed });
}

export async function setNativeAudioOutput(volume: number, muted: boolean): Promise<void> {
  if (!isTauriRuntime()) throw new Error("setNativeAudioOutput requires the Tauri runtime");
  await invoke("set_native_audio_output", { volume, muted });
}

export async function seekNativeAudio(positionTicks: number): Promise<void> {
  if (!isTauriRuntime()) throw new Error("seekNativeAudio requires the Tauri runtime");
  await invoke("seek_native_audio", { positionTicks });
}

export async function loadNativeAudioClip(options: {
  path: string;
  clipId: string;
  timelineStartTicks: number;
  sourceStartTicks?: number;
  durationTicks?: number;
  gain?: number;
  pan?: number;
  fadeInTicks?: number;
  fadeOutTicks?: number;
  fadeInCurve?: AudioFadeCurve;
  fadeOutCurve?: AudioFadeCurve;
  /** Relative clip ticks, matching the native audio contract. */
  volumeKeyframes?: Array<{ id: string; time: number; gain: number; easing?: "linear" | "exponential" | "bezier" }>;
  channelMode?: "auto" | "mono" | "stereo" | "multichannel";
  downmix?: "auto" | "mono" | "stereo";
  channelMap?: number[];
  preservePitch?: boolean;
}): Promise<NativeAudioClipStatus> {
  if (!isTauriRuntime()) throw new Error("loadNativeAudioClip requires the Tauri runtime");
  return invoke<NativeAudioClipStatus>("load_native_audio_clip", {
    path: toNativePath(options.path),
    clipId: options.clipId,
    timelineStartTicks: options.timelineStartTicks,
    sourceStartTicks: options.sourceStartTicks ?? 0,
    durationTicks: options.durationTicks ?? 0,
    gain: options.gain ?? 1,
    pan: options.pan ?? 0,
    fadeInTicks: options.fadeInTicks ?? 0,
    fadeOutTicks: options.fadeOutTicks ?? 0,
    fadeInCurve: options.fadeInCurve ?? "linear",
    fadeOutCurve: options.fadeOutCurve ?? "linear",
    volumeKeyframes: options.volumeKeyframes ?? [],
    channelMode: options.channelMode ?? "auto",
    downmix: options.downmix ?? "auto",
    channelMap: options.channelMap ?? null,
    preservePitch: options.preservePitch ?? false,
  });
}

export async function replaceNativeAudioClips(options: Array<Parameters<typeof loadNativeAudioClip>[0]>): Promise<NativeAudioClipStatus[]> {
  if (!isTauriRuntime()) throw new Error("replaceNativeAudioClips requires the Tauri runtime");
  return invoke<NativeAudioClipStatus[]>("replace_native_audio_clips", {
    clips: options.map((clip) => ({
      path: toNativePath(clip.path),
      clipId: clip.clipId,
      timelineStartTicks: clip.timelineStartTicks,
      sourceStartTicks: clip.sourceStartTicks ?? 0,
      durationTicks: clip.durationTicks ?? 0,
      gain: clip.gain ?? 1,
      pan: clip.pan ?? 0,
      fadeInTicks: clip.fadeInTicks ?? 0,
      fadeOutTicks: clip.fadeOutTicks ?? 0,
      fadeInCurve: clip.fadeInCurve ?? "linear",
      fadeOutCurve: clip.fadeOutCurve ?? "linear",
      volumeKeyframes: clip.volumeKeyframes ?? [],
      channelMode: clip.channelMode ?? "auto",
      downmix: clip.downmix ?? "auto",
      channelMap: clip.channelMap ?? null,
      preservePitch: clip.preservePitch ?? false,
    })),
  });
}

export async function updateNativeAudioClipParameters(options: {
  clipId: string;
  gain: number;
  pan: number;
  fadeInTicks: number;
  fadeOutTicks: number;
  fadeInCurve: AudioFadeCurve;
  fadeOutCurve: AudioFadeCurve;
  volumeKeyframes: Array<{ id: string; time: number; gain: number; easing?: "linear" | "exponential" | "bezier" }>;
}): Promise<NativeAudioClipStatus> {
  if (!isTauriRuntime()) throw new Error("updateNativeAudioClipParameters requires the Tauri runtime");
  return invoke<NativeAudioClipStatus>("update_native_audio_clip_parameters", options);
}

export async function clearNativeAudioClip(): Promise<void> {
  if (!isTauriRuntime()) throw new Error("clearNativeAudioClip requires the Tauri runtime");
  await invoke("clear_native_audio_clip");
}

export async function getNativeAudioClip(): Promise<NativeAudioClipStatus | null> {
  if (!isTauriRuntime()) throw new Error("getNativeAudioClip requires the Tauri runtime");
  return invoke<NativeAudioClipStatus | null>("get_native_audio_clip");
}

export async function getNativeAudioClips(): Promise<NativeAudioClipStatus[]> {
  if (!isTauriRuntime()) throw new Error("getNativeAudioClips requires the Tauri runtime");
  return invoke<NativeAudioClipStatus[]>("get_native_audio_clips");
}

// ─── Native FFmpeg Decoder Commands ───────────────────────────────────────
// All video operations use the native ffmpeg-next decoder

/**
 * Extract a single frame using the native decoder (fast path).
 * ~20-50ms first frame, ~3-15ms subsequent frames.
 * Returns base64-encoded WebP data URL.
 */
export async function decodeFrame(videoPath: string, timeSecs: number, width: number, height: number): Promise<string> {
  if (!isTauriRuntime()) {
    console.warn("[Tauri] decodeFrame bypassed: Non-Tauri environment.");
    return "data:image/png;base64,mockedDataURL";
  }
  return invoke<string>("decode_frame", {
    videoPath: toNativePath(videoPath),
    timeSecs,
    width,
    height,
  });
}

/**
 * Extract multiple frames using the native decoder with streaming, instead of sidecar FFmpeg. Much faster for batch extractions.
 */
export async function decodeFramesStreaming(videoPath: string, timestamps: number[], density: DensityLevel, width: number, height: number, duration: number, onTile: (tile: ThumbnailTile) => void): Promise<void> {
  if (!isTauriRuntime()) {
    console.warn("[Tauri] decodeFramesStreaming bypassed: Non-Tauri environment.");
    return;
  }
  const channel = new Channel<ThumbnailTile>();
  channel.onmessage = onTile;

  return invoke("decode_frames_streaming", {
    videoPath: toNativePath(videoPath),
    timestamps,
    density,
    width,
    height,
    duration,
    onTile: channel,
  });
}

/**
 * Release the native decoder for a video to free memory. Call this when a clip is removed from the project.
 */
export function releaseVideoDecoder(videoPath: string): void {
  if (!isTauriRuntime()) {
    console.warn("[Tauri] releaseVideoDecoder bypassed: Non-Tauri environment.");
    return;
  }
  invoke("release_video_decoder", {
    videoPath: toNativePath(videoPath),
  });
}

/**
 * Prewarm video decoders to eliminate first-frame latency.
 *
 * Creates decoders in the pool before they're needed (50-100ms → 5-10ms).
 * Call this when:
 * - Project loads (prewarm all timeline videos)
 * - Clips added to timeline (prewarm new videos)
 * - Switching sequences
 *
 * Non-blocking, runs in background. Never fails (graceful degradation).
 *
 * @param videoPaths - Array of video file paths to prewarm
 * @returns Promise<number> - Count of successfully prewarmed decoders
 */
export async function prewarmDecoders(videoPaths: string[]): Promise<number> {
  if (!isTauriRuntime()) {
    console.warn("[Tauri] prewarmDecoders bypassed: Non-Tauri environment.");
    return 0;
  }

  if (videoPaths.length === 0) {
    return 0;
  }

  const normalizedPaths = videoPaths.map((p) => toNativePath(p));

  try {
    const count = await invoke<number>("prewarm_decoders", {
      videoPaths: normalizedPaths,
    });
    return count;
  } catch (error) {
    // Graceful degradation - log but don't fail
    console.warn("[Tauri] prewarmDecoders failed:", error);
    return 0;
  }
}

/**
 * Stream timeline frames as raw binary ArrayBuffer over a Tauri Channel.
 * Zero string/Base64 serialization overhead.
 */
export async function streamTimelineFramesBinary(
  videoPath: string,
  timestamps: number[],
  width: number,
  height: number,
  onFrame: (buffer: ArrayBuffer) => void
): Promise<void> {
  if (!isTauriRuntime()) {
    console.warn("[Tauri] streamTimelineFramesBinary bypassed: Non-Tauri environment.");
    return;
  }
  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = onFrame;

  return invoke("stream_timeline_frames_binary", {
    videoPath: toNativePath(videoPath),
    timestamps,
    width,
    height,
    onFrame: channel,
  });
}

/**
 * Get render cache statistics (atlas hits, tier cache hits, decodes).
 * Useful for monitoring cache effectiveness.
 */
export async function getRenderCacheStats(): Promise<{
  atlas_hits: number;
  tier_cache_hits: number;
  decodes: number;
  total_requests: number;
}> {
  if (!isTauriRuntime()) {
    return {
      atlas_hits: 0,
      tier_cache_hits: 0,
      decodes: 0,
      total_requests: 0,
    };
  }
  return invoke("get_render_cache_stats");
}
