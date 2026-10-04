import { invoke, Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AudioFadeCurve, DensityLevel, ThumbnailTile } from "../../types";
import type { ColdStartReport } from "../../services/telemetryCollector";
import { toNativePath } from "./pathConversion";
import type {
  NativeFrameRequest,
  NativeFrameServiceStats,
  NativePerformanceSampleBatch,
  NativeAudioDiagnostics,
  NativeAudioStatus,
  NativeAudioClipStatus,
  NativeGpuRuntimeStatus,
  NativePreviewPerformanceReport,
  NativePlaybackPlan,
  NativePlaybackFrameDemand,
  NativePlaybackState,
  NativeFrameTime,
  NativeSurfaceGeometry,
  NativeSurfaceProbe,
  NativeSurfacePresentation,
  NativeRasterLayerSnapshot,
  NativeSyncMetricsSnapshot,
  NativeFramesBySource,
  NativeSessionSnapshot,
} from "./nativeCore";
import { recordRasterUpload } from "@/lib/playback/textMetrics";

export type { NativeFramesBySource, NativeSessionSnapshot };


export const isTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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

export async function probeMediaStreams(
  path: string,
): Promise<NativeMediaStream[]> {
  if (!isTauriRuntime())
    throw new Error("Media stream probing requires the Tauri runtime");
  return invoke<NativeMediaStream[]>("probe_media_streams", {
    path: toNativePath(path),
  });
}

export async function startAudioExtraction(
  request: AudioExtractionRequest,
): Promise<string> {
  if (!isTauriRuntime())
    throw new Error("Audio extraction requires the Tauri runtime");
  return invoke<string>("start_audio_extraction", {
    request: { ...request, sourcePath: toNativePath(request.sourcePath) },
  });
}

export async function cancelMediaJob(jobId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("cancel_media_job", { jobId });
}

export async function getMediaJobResult(
  jobId: string,
): Promise<MediaJobResult | null> {
  if (!isTauriRuntime()) return null;
  return invoke<MediaJobResult | null>("get_media_job_result", { jobId });
}

export function listenForMediaJobUpdates(
  handler: (update: MediaJobUpdate) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return Promise.resolve(() => undefined);
  return listen<MediaJobUpdate>("media_job_update", (event) =>
    handler(event.payload),
  );
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
export async function getVideoRenderMetadata(
  videoPath: string,
): Promise<VideoRenderMetadata> {
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

/**
 * Evict and purge a raster/image asset from the native GPU texture cache.
 */
export async function unregisterNativeRasterAsset(assetId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("unregister_native_raster_asset", {
    assetId,
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
  return invoke<ArrayBuffer>("render_native_video_project_frame", {
    request: nativeRequest,
  });
}

/**
 * Render through the versioned native-core contract. This is the preferred
 * boundary for new preview, filmstrip, and export callers.
 */
export async function renderNativeFrame(
  request: NativeFrameRequest,
): Promise<ArrayBuffer> {
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

/**
 * Measure the raw Tauri binary response bridge without decode or GPU work.
 * Diagnostics callers should run this only on demand; production preview must
 * never use it.
 */
export async function renderNativePreviewTransportProbe(
  byteLength = 518 * 1024,
): Promise<ArrayBuffer> {
  if (!isTauriRuntime()) {
    throw new Error("renderNativePreviewTransportProbe requires the Tauri runtime");
  }
  return invoke<ArrayBuffer>("render_native_preview_transport_probe", {
    byteLength: Math.max(1, Math.min(4 * 1024 * 1024, Math.floor(byteLength))),
  });
}

/**
 * Phase 2a only: exercise the candidate one-way playback Channel with the
 * same approximately-518 KiB RGBA payload used by the bridge probe. The
 * packet begins with a versioned binary header; production playback is not
 * switched to this transport until its t8 → t9 gate passes.
 */
export async function streamNativePlaybackFrames(
  generation: bigint,
  onFrame: (packet: ArrayBuffer) => void,
  options: {
    frameCount?: number;
    payloadBytes?: number;
    paceMs?: number;
  } = {},
): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("streamNativePlaybackFrames requires the Tauri runtime");
  }
  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = onFrame;
  return invoke("stream_native_playback_frames", {
    // Tauri's serde boundary expects a JSON number for Rust `u64`. The Phase
    // 2a diagnostic generation is deliberately tiny; production code will
    // keep its own checked u64-to-wire conversion with the stream state.
    generation: Number(generation),
    frameCount: Math.max(1, Math.min(120, Math.floor(options.frameCount ?? 20))),
    payloadBytes: Math.max(1024, Math.min(4 * 1024 * 1024, Math.floor(options.payloadBytes ?? 480 * 270 * 4))),
    paceMs: Math.max(0, Math.min(1000, Math.floor(options.paceMs ?? 0))),
    onFrame: channel,
  });
}

/**
 * Phase 2b benchmark transport. It is opt-in per session: callers retain the
 * invoke-response bridge unless they explicitly open this stream.
 */
export async function openNativePlaybackPushStream(
  generation: bigint,
  onFrame: (packet: ArrayBuffer) => void,
): Promise<void> {
  if (!isTauriRuntime()) throw new Error("openNativePlaybackPushStream requires the Tauri runtime");
  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = onFrame;
  await invoke("open_native_playback_push_stream", { generation: Number(generation), onFrame: channel });
}

export async function submitNativePlaybackPushFrame(request: NativeFrameRequest): Promise<void> {
  if (!isTauriRuntime()) return;
  const nativeRequest: NativeFrameRequest = {
    ...request,
    project: {
      ...request.project,
      videoLayers: request.project.videoLayers.map((layer) => ({ ...layer, videoPath: toNativePath(layer.videoPath) })),
    },
  };
  await invoke("submit_native_playback_push_frame", { request: nativeRequest });
}

export async function acknowledgeNativePlaybackPushFrame(
  generation: bigint,
  consumedDeliverySeq: bigint,
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return invoke<boolean>("acknowledge_native_playback_push_frame", {
    generation: Number(generation),
    consumedDeliverySeq: Number(consumedDeliverySeq),
  });
}

export async function closeNativePlaybackPushStream(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("close_native_playback_push_stream");
}

export interface NativePushTransportCapabilities {
  channel: boolean;
  customProtocolLongPoll: boolean;
  webview2SharedBuffer: boolean;
  webviewRuntime?: string | null;
}

/** Candidate discovery for the measured Phase 2 transport selector. */
export async function getNativePushTransportCapabilities(): Promise<NativePushTransportCapabilities> {
  if (!isTauriRuntime()) {
    return { channel: false, customProtocolLongPoll: false, webview2SharedBuffer: false };
  }
  return invoke<NativePushTransportCapabilities>("get_native_push_transport_capabilities");
}

/** Register a bundled/editor font in the strict native font registry. */
export async function registerNativeFont(
  fontId: string,
  path: string,
): Promise<number> {
  if (!isTauriRuntime())
    throw new Error("registerNativeFont requires the Tauri runtime");
  return invoke<number>("register_native_font", {
    fontId,
    path: toNativePath(path),
  });
}

/** Register a bundled font asset directly from the WebView bundle. */
export async function registerNativeFontBytes(
  fontId: string,
  bytes: ArrayBuffer | Uint8Array,
): Promise<number> {
  if (!isTauriRuntime())
    throw new Error("registerNativeFontBytes requires the Tauri runtime");
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return invoke<number>("register_native_font_bytes", {
    fontId,
    bytes: Array.from(data),
  });
}

export async function listNativeFonts(): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  return invoke<string[]>("list_native_fonts");
}

export async function getNativeFontWarnings(): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  return invoke<string[]>("get_native_font_warnings");
}

export async function clearNativeFontWarnings(): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke<void>("clear_native_font_warnings");
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
  return invoke<NativeSurfacePresentation>("present_native_frame", {
    request: nativeRequest,
  });
}

/** Configure the persistent Rust-owned Native playback render graph. */
export async function configureNativePlaybackRender(
  request: NativeFrameRequest,
): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("configureNativePlaybackRender requires the Tauri runtime");
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
  await invoke("configure_native_playback_render", { snapshot: nativeRequest });
}

/** Dynamically update the persistent Rust-owned Native playback render graph without tearing down the worker or purging lookahead. */
export async function updateNativePlaybackRender(
  request: NativeFrameRequest,
): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("updateNativePlaybackRender requires the Tauri runtime");
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
  await invoke("update_native_playback_render", { snapshot: nativeRequest });
}

/** Submit a compact latest-value Native playback demand without awaiting render. */
export async function submitNativePlaybackDemand(
  demand: NativePlaybackFrameDemand,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("submit_native_playback_demand", { demand });
}

export interface NativePlaybackStatsPayload {
  framesRendered: number;
  fps: number;
  hitRatePercent: number;
  avgTotalMs: number;
  avgDecodeMs: number;
  maxFrameMs: number;
  dropped: number;
  stackedStreams: number;
}

/** Listen for rolling real-time playback telemetry from Rust. */
export function listenForNativePlaybackStats(
  onStats: (stats: NativePlaybackStatsPayload) => void,
): Promise<UnlistenFn> {
  return listen<NativePlaybackStatsPayload>("native-playback-stats", (event) => {
    onStats(event.payload);
  });
}

/** Listen for real-time QoS decisions emitted by the native media engine. */
export function listenForEngineQoSDecision(
  onDecision: (decision: unknown) => void,
): Promise<UnlistenFn> {
  return listen<unknown>("clypra://engine-qos-decision", (event) => {
    onDecision(event.payload);
  });
}

/** Listen for out-of-band mask texture eviction notifications from Rust compositor. */
export function listenForNativeMaskEviction(
  onEvicted: (assetIds: string[]) => void,
): Promise<UnlistenFn> {
  return listen<string[]>("native-mask-evicted", (event) => {
    onEvicted(event.payload);
  });
}

/** Listen for out-of-band raster (text, sticker, image) texture eviction notifications from Rust compositor. */
export function listenForNativeRasterEviction(
  onEvicted: (assetIds: string[]) => void,
): Promise<UnlistenFn> {
  return listen<string[]>("native-raster-evicted", (event) => {
    onEvicted(event.payload);
  });
}

/**
 * Subscribe to the one-shot GPU-ready event emitted by the Rust backend once
 * wgpu adapter selection and device creation complete. This fires earlier and
 * more reliably than polling get_native_gpu_status because it is emitted
 * immediately after app.manage(gpu_ctx) rather than on a timer.
 */
export function listenForGpuReady(
  onReady: () => void,
): Promise<UnlistenFn> {
  return listen<void>("clypra://gpu-ready", () => {
    onReady();
  });
}

/**
 * Subscribe to the GPU-failed event emitted when wgpu initialization fails.
 * The payload is the error message string.
 */
export function listenForGpuFailed(
  onFailed: (error: string) => void,
): Promise<UnlistenFn> {
  return listen<string>("clypra://gpu-failed", (event) => {
    onFailed(event.payload);
  });
}

/** Decode a native playback frame ahead of presentation. */
export async function queueNativeFrame(
  request: NativeFrameRequest,
): Promise<void> {
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
export async function cancelNativePreviewRequests(
  generation: number,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("cancel_native_preview_requests", { generation });
}

/**
 * Reset all per-project Rust native preview state on project close.
 * Resets the frame queue generation counter, frame cache, surface presentation
 * sequence, native audio clock, and native playback session so the next project
 * starts completely clean.
 */
export async function resetNativeRuntime(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("reset_native_preview_runtime");
}

function uint8ArrayToBase64(bytes: Uint8Array | Uint8ClampedArray): string {
  let binary = "";
  const len = bytes.byteLength;
  const chunkSize = 0x8000; // 32KB chunks prevent argument stack limits
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/** Upload immutable raster pixels once so frame requests can reference them by id. */
export async function registerNativeRasterAsset(
  asset: NativeRasterLayerSnapshot & { rgba: Uint8ClampedArray | number[] },
): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("registerNativeRasterAsset requires the Tauri runtime");
  }
  const startTime =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    // Zero-copy binary IPC transfer: send raw buffer directly to avoid
    // base64 inflation (+37% heap) and JSON array stringification.
    if (asset.rgba instanceof Uint8ClampedArray || asset.rgba instanceof Uint8Array) {
      const typed = asset.rgba as Uint8ClampedArray | Uint8Array;
      const rawBuffer =
        typed.buffer.byteLength === typed.byteLength
          ? typed.buffer
          : typed.slice().buffer;
      try {
        await invoke("register_native_raster_asset_raw", rawBuffer, {
          headers: {
            "asset-id": asset.assetId,
            width: String(asset.width),
            height: String(asset.height),
          },
        });
        return;
      } catch (err) {
        console.warn(
          "[Tauri] register_native_raster_asset_raw failed, falling back to base64:",
          err,
        );
        const rgbaBase64 = uint8ArrayToBase64(asset.rgba);
        await invoke("register_native_raster_asset", {
          asset: {
            assetId: asset.assetId,
            width: asset.width,
            height: asset.height,
            rgbaBase64,
          },
        });
        return;
      }
    }

    await invoke("register_native_raster_asset", {
      asset: {
        assetId: asset.assetId,
        width: asset.width,
        height: asset.height,
        rgba: asset.rgba,
      },
    });
  } finally {
    const elapsedMs =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) -
      startTime;
    const outputPixels = asset.width * asset.height;
    const bytes = outputPixels * 4;
    recordRasterUpload(outputPixels, bytes, elapsedMs);
  }
}

export async function getNativeFrameServiceStats(): Promise<NativeFrameServiceStats> {
  if (!isTauriRuntime()) {
    throw new Error("getNativeFrameServiceStats requires the Tauri runtime");
  }
  return invoke<NativeFrameServiceStats>("get_native_frame_service_stats");
}

export async function getNativeFrameServiceSamples(
  afterSequence: number,
  limit = 256,
): Promise<NativePerformanceSampleBatch> {
  if (!isTauriRuntime()) {
    throw new Error("getNativeFrameServiceSamples requires the Tauri runtime");
  }
  return invoke<NativePerformanceSampleBatch>(
    "get_native_frame_service_samples",
    {
      afterSequence,
      limit,
    },
  );
}

/**
 * Gets the explicit, local-only native-preview diagnostic report. Callers can
 * copy `JSON.stringify(report, null, 2)` only after user action.
 */
export async function getNativePreviewPerformanceReport(): Promise<NativePreviewPerformanceReport> {
  if (!isTauriRuntime()) {
    throw new Error("getNativePreviewPerformanceReport requires the Tauri runtime");
  }
  return invoke<NativePreviewPerformanceReport>("get_native_preview_performance_report");
}

export async function getNativeSyncMetricsSnapshot(): Promise<NativeSyncMetricsSnapshot> {
  if (!isTauriRuntime()) {
    throw new Error("getNativeSyncMetricsSnapshot requires the Tauri runtime");
  }
  return invoke<NativeSyncMetricsSnapshot>("get_sync_metrics_snapshot");
}

export async function getNativeSessionTelemetry(): Promise<NativeSessionSnapshot> {
  if (!isTauriRuntime()) {
    throw new Error("getNativeSessionTelemetry requires the Tauri runtime");
  }
  return invoke<NativeSessionSnapshot>("get_session_telemetry");
}

export async function resetNativeSessionTelemetry(): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("resetNativeSessionTelemetry requires the Tauri runtime");
  }
  return invoke<void>("reset_session_telemetry");
}


export async function getNativeGpuStatus(): Promise<NativeGpuRuntimeStatus> {
  if (!isTauriRuntime()) {
    throw new Error("getNativeGpuStatus requires the Tauri runtime");
  }

  return invoke<NativeGpuRuntimeStatus>("get_native_gpu_status");
}

/** Retrieve the cold-start span report collected by the native process since launch. */
export async function getColdStartReport(): Promise<ColdStartReport> {
  if (!isTauriRuntime()) {
    return {
      processEpochMs: 0,
      milestones: {},
      audioMetrics: { pcmBytes: 0, capTruncations: 0, cliFallbacks: 0 },
      aggregates: {},
      droppedSpans: 0,
      spans: [],
    };
  }
  return invoke<ColdStartReport>("get_cold_start_report");
}

/** Mark the instant the interactive frontend starts awaiting GPU ready. */
export async function markGpuAwaited(): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke("mark_gpu_awaited");
}

/** Record frontend launch and presentation milestones to native cold-start telemetry. */
export async function recordFrontendLaunchMilestones(milestones: {
  domContentLoadedMs?: number;
  appMountedMs?: number;
  shellPaintedMs?: number;
  interactiveUs?: number;
  firstFramePaintedMs?: number;
  smoothPlaybackAtUs?: number;
  smoothPlaybackTargetFps?: number;
}): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke("record_frontend_launch_milestones", {
    domContentLoadedMs: milestones.domContentLoadedMs,
    appMountedMs: milestones.appMountedMs,
    shellPaintedMs: milestones.shellPaintedMs,
    interactiveUs: milestones.interactiveUs,
    firstFramePaintedMs: milestones.firstFramePaintedMs,
    smoothPlaybackAtUs: milestones.smoothPlaybackAtUs,
    smoothPlaybackTargetFps: milestones.smoothPlaybackTargetFps,
  });
}

export interface PlaybackPolicySnapshot {
  mediaVariant: "Original" | { Proxy: number };
  renderQuality: "Full" | "Half" | "Quarter";
  effectsPolicy: "Full" | "Reduced" | "Minimal" | "BypassOptional";
  reason: any;
  isDecodeStarved: boolean;
}

export async function getPlaybackPolicy(): Promise<PlaybackPolicySnapshot> {
  if (!isTauriRuntime()) {
    return {
      mediaVariant: "Original",
      renderQuality: "Full",
      effectsPolicy: "Full",
      reason: "Healthy",
      isDecodeStarved: false,
    };
  }

  return invoke<PlaybackPolicySnapshot>("get_playback_policy");
}

export async function probeNativeSurface(
  geometry: NativeSurfaceGeometry,
): Promise<NativeSurfaceProbe> {
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
    throw new Error(
      "getNativePreviewSurfaceGeometry requires the Tauri runtime",
    );
  }

  const rect = element.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const currentWindow = getCurrentWindow();
  // `innerPosition()` returns the screen coordinates of the webview viewport's top-left
  // (client area). `rect` is measured relative to that same viewport origin.
  // The child surface window is undecorated, so its physical position corresponds
  // directly to client-area screen coordinates. Using `innerPosition()` ensures exact
  // alignment with the DOM canvas on all platforms (including macOS with titleBarStyle: "Overlay").
  const windowPosition = await currentWindow.innerPosition();
  const widthPhysical = Math.max(2, Math.round(rect.width * dpr));
  const heightPhysical = Math.max(2, Math.round(rect.height * dpr));
  const xPhysical = Math.round(windowPosition.x + rect.left * dpr);
  const yPhysical = Math.round(windowPosition.y + rect.top * dpr);

  const geometry = {
    xPhysical,
    yPhysical,
    widthPhysical,
    heightPhysical,
    devicePixelRatio: dpr,
  };

  return geometry;
}

/** Notify native preview geometry when the host window moves, resizes, or changes scale. */
export async function onNativePreviewWindowMoved(
  handler: () => void,
): Promise<() => void> {
  if (!isTauriRuntime()) {
    throw new Error("onNativePreviewWindowMoved requires the Tauri runtime");
  }
  const win = getCurrentWindow();
  const unlistenMoved = await win.onMoved(() => handler());
  const unlistenResized = await win.onResized(() => handler());
  const unlistenScale = await win.onScaleChanged(() => handler());
  return () => {
    unlistenMoved();
    unlistenResized();
    unlistenScale();
  };
}

export async function resizeNativeSurface(
  geometry: NativeSurfaceGeometry,
): Promise<NativeSurfaceProbe> {
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

export async function configureNativePlayback(
  plan: NativePlaybackPlan,
): Promise<NativePlaybackState> {
  if (!isTauriRuntime())
    throw new Error("configureNativePlayback requires the Tauri runtime");
  return invoke<NativePlaybackState>("configure_native_playback", { plan });
}

export async function getNativePlaybackState(): Promise<NativePlaybackState> {
  if (!isTauriRuntime())
    throw new Error("getNativePlaybackState requires the Tauri runtime");
  return invoke<NativePlaybackState>("get_native_playback_state");
}

export async function nativePlay(
  clock: NativeFrameTime,
): Promise<NativePlaybackState> {
  if (!isTauriRuntime())
    throw new Error("nativePlay requires the Tauri runtime");
  return invoke<NativePlaybackState>("native_play", { clock });
}

export async function nativePause(
  clock: NativeFrameTime,
): Promise<NativePlaybackState> {
  if (!isTauriRuntime())
    throw new Error("nativePause requires the Tauri runtime");
  return invoke<NativePlaybackState>("native_pause", { clock });
}

export async function nativeSeek(
  frameIndex: number,
): Promise<NativePlaybackState> {
  if (!isTauriRuntime())
    throw new Error("nativeSeek requires the Tauri runtime");
  return invoke<NativePlaybackState>("native_seek", { frameIndex });
}

export async function nativeSeekFromAudio(
  frameIndex: number,
): Promise<NativePlaybackState> {
  if (!isTauriRuntime())
    throw new Error("nativeSeekFromAudio requires the Tauri runtime");
  return invoke<NativePlaybackState>("native_seek_from_audio", { frameIndex });
}

export async function nativeTick(
  clock: NativeFrameTime,
): Promise<NativePlaybackState> {
  if (!isTauriRuntime())
    throw new Error("nativeTick requires the Tauri runtime");
  return invoke<NativePlaybackState>("native_tick", { clock });
}

export async function nativePlayFromAudio(): Promise<NativePlaybackState> {
  if (!isTauriRuntime())
    throw new Error("nativePlayFromAudio requires the Tauri runtime");
  return invoke<NativePlaybackState>("native_play_from_audio");
}

export async function nativePauseFromAudio(): Promise<NativePlaybackState> {
  if (!isTauriRuntime())
    throw new Error("nativePauseFromAudio requires the Tauri runtime");
  return invoke<NativePlaybackState>("native_pause_from_audio");
}

export async function nativeTickFromAudio(): Promise<
  NativePlaybackState & { pollRttMs?: number }
> {
  if (!isTauriRuntime())
    throw new Error("nativeTickFromAudio requires the Tauri runtime");
  const t0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const state = await invoke<NativePlaybackState>("native_tick_from_audio");
  const t1 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  return { ...state, pollRttMs: t1 - t0 };
}

export async function startNativeAudio(): Promise<NativeAudioStatus> {
  if (!isTauriRuntime())
    throw new Error("startNativeAudio requires the Tauri runtime");
  return invoke<NativeAudioStatus>("start_native_audio");
}

export async function stopNativeAudio(): Promise<void> {
  if (!isTauriRuntime())
    throw new Error("stopNativeAudio requires the Tauri runtime");
  await invoke("stop_native_audio");
}

export async function getNativeAudioStatus(): Promise<NativeAudioStatus> {
  if (!isTauriRuntime())
    throw new Error("getNativeAudioStatus requires the Tauri runtime");
  return invoke<NativeAudioStatus>("get_native_audio_status");
}

export async function getNativeAudioDiagnostics(): Promise<NativeAudioDiagnostics> {
  if (!isTauriRuntime())
    throw new Error("getNativeAudioDiagnostics requires the Tauri runtime");
  return invoke<NativeAudioDiagnostics>("get_native_audio_diagnostics");
}

export async function pauseNativeAudio(): Promise<void> {
  if (!isTauriRuntime())
    throw new Error("pauseNativeAudio requires the Tauri runtime");
  await invoke("pause_native_audio");
}

export async function resumeNativeAudio(): Promise<void> {
  if (!isTauriRuntime())
    throw new Error("resumeNativeAudio requires the Tauri runtime");
  await invoke("resume_native_audio");
}

export async function setNativeAudioSpeed(speed: number): Promise<void> {
  if (!isTauriRuntime())
    throw new Error("setNativeAudioSpeed requires the Tauri runtime");
  await invoke("set_native_audio_speed", { speed });
}

export async function setNativeAudioOutput(
  volume: number,
  muted: boolean,
): Promise<void> {
  if (!isTauriRuntime())
    throw new Error("setNativeAudioOutput requires the Tauri runtime");
  await invoke("set_native_audio_output", { volume, muted });
}

export async function seekNativeAudio(positionTicks: number): Promise<void> {
  if (!isTauriRuntime())
    throw new Error("seekNativeAudio requires the Tauri runtime");
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
  volumeKeyframes?: Array<{
    id: string;
    time: number;
    gain: number;
    easing?: "linear" | "exponential" | "bezier";
  }>;
  channelMode?: "auto" | "mono" | "stereo" | "multichannel";
  downmix?: "auto" | "mono" | "stereo";
  channelMap?: number[];
  preservePitch?: boolean;
}): Promise<NativeAudioClipStatus> {
  if (!isTauriRuntime())
    throw new Error("loadNativeAudioClip requires the Tauri runtime");
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

export async function replaceNativeAudioClips(
  options: Array<Parameters<typeof loadNativeAudioClip>[0]>,
): Promise<NativeAudioClipStatus[]> {
  if (!isTauriRuntime())
    throw new Error("replaceNativeAudioClips requires the Tauri runtime");
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
  volumeKeyframes: Array<{
    id: string;
    time: number;
    gain: number;
    easing?: "linear" | "exponential" | "bezier";
  }>;
}): Promise<NativeAudioClipStatus> {
  if (!isTauriRuntime())
    throw new Error(
      "updateNativeAudioClipParameters requires the Tauri runtime",
    );
  return invoke<NativeAudioClipStatus>(
    "update_native_audio_clip_parameters",
    options,
  );
}

export async function clearNativeAudioClip(): Promise<void> {
  if (!isTauriRuntime())
    throw new Error("clearNativeAudioClip requires the Tauri runtime");
  await invoke("clear_native_audio_clip");
}

export async function getNativeAudioClip(): Promise<NativeAudioClipStatus | null> {
  if (!isTauriRuntime())
    throw new Error("getNativeAudioClip requires the Tauri runtime");
  return invoke<NativeAudioClipStatus | null>("get_native_audio_clip");
}

export async function getNativeAudioClips(): Promise<NativeAudioClipStatus[]> {
  if (!isTauriRuntime())
    throw new Error("getNativeAudioClips requires the Tauri runtime");
  return invoke<NativeAudioClipStatus[]>("get_native_audio_clips");
}

// ─── Native FFmpeg Decoder Commands ───────────────────────────────────────
// All video operations use the native ffmpeg-next decoder

/**
 * Extract a single frame using the native decoder (fast path).
 * ~20-50ms first frame, ~3-15ms subsequent frames.
 *
 * Returns raw RGBA bytes from Rust as an ArrayBuffer (binary IPC, no base64
 * on the Rust side). Converts to a data URL here so callers are unchanged.
 */
export async function decodeFrame(
  videoPath: string,
  timeSecs: number,
  width: number,
  height: number,
): Promise<string> {
  if (!isTauriRuntime()) {
    console.warn("[Tauri] decodeFrame bypassed: Non-Tauri environment.");
    return "data:image/png;base64,mockedDataURL";
  }
  // Binary IPC — Rust returns raw RGBA bytes or data URL string
  const buf = await invoke<ArrayBuffer | Uint8Array | number[] | string>("decode_frame", {
    videoPath: toNativePath(videoPath),
    timeSecs,
    width,
    height,
  });
  if (typeof buf === "string") {
    return buf;
  }
  // Convert ArrayBuffer / typed array → data URL on JS side (single pass, no extra copy)
  const bytes =
    buf instanceof Uint8Array
      ? buf
      : Array.isArray(buf)
        ? new Uint8Array(buf)
        : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:image/rgba;base64,${btoa(binary)}`;
}


/**
 * Extract multiple frames using the native decoder with streaming, instead of sidecar FFmpeg. Much faster for batch extractions.
 */
export async function decodeFramesStreaming(
  videoPath: string,
  timestamps: number[],
  density: DensityLevel,
  width: number,
  height: number,
  duration: number,
  onTile: (tile: ThumbnailTile) => void,
): Promise<void> {
  if (!isTauriRuntime()) {
    console.warn(
      "[Tauri] decodeFramesStreaming bypassed: Non-Tauri environment.",
    );
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
    console.warn(
      "[Tauri] releaseVideoDecoder bypassed: Non-Tauri environment.",
    );
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
  onFrame: (buffer: ArrayBuffer) => void,
): Promise<void> {
  if (!isTauriRuntime()) {
    console.warn(
      "[Tauri] streamTimelineFramesBinary bypassed: Non-Tauri environment.",
    );
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

export interface ExportCreatorThumbnailPayload {
  dataUrl?: string;
  rgbaBytes?: number[] | Uint8Array;
  width?: number;
  height?: number;
  outputPath: string;
  format?: "png" | "jpeg" | "webp";
  quality?: number;
}

export interface ExportCreatorThumbnailResult {
  outputPath: string;
  bytesWritten: number;
  width: number;
  height: number;
  format: string;
}

/**
 * Save a creator thumbnail to the filesystem using native disk IO and format encoding.
 */
export async function exportCreatorThumbnail(
  payload: ExportCreatorThumbnailPayload,
): Promise<ExportCreatorThumbnailResult> {
  if (!isTauriRuntime()) {
    throw new Error("exportCreatorThumbnail requires the Tauri runtime");
  }
  return invoke<ExportCreatorThumbnailResult>("export_creator_thumbnail", {
    payload,
  });
}
