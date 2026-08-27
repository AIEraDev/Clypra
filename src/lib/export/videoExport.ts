/**
 * Video Export
 *
 * High-level API for exporting videos using FFmpeg.
 * Desktop scenes render through the native compositor. Unsupported scenes fail
 * explicitly until their native contract is implemented.
 *
 * Architecture:
 *   Timeline → evaluateTimelineSceneCached → native compositor → RGBA Frames → FFmpeg → MP4/MOV
 */

import { platform } from "../../core/platform";
import { evaluateTimelineSceneCached, clearEvaluationCache } from "../../core/evaluation/evaluator";
import { getResourceCache } from "../../core/resources/ResourceCache";
import { getActiveAudioClips } from "../../core/timeline/audioClips";
import { PRESET_CONFIGS } from "./exportPresets";
import type { Clip, Track, MediaAsset, Project, TransitionTimelineItem } from "../../types";
import type { ExportAudioClip, ExportProgress } from "../../types/export";
import { buildNativeFrameRequest } from "@/components/editor/preview/nativeVideoPreview";
import { isTauriRuntime, renderNativeFrame } from "@/lib/platform/tauri";
import { NativeRasterBridge } from "@/core/render/nativeRasterBridge";
import type { SmartOverlayClip } from "@/types/smartOverlay";
import { verifyExportDependencies, ExportBlockedError, type MissingTextEffect } from "./exportPreflight";
import { telemetryCollector } from "@/services/telemetryCollector";

/**
 * Video export progress - Re-exported from types/export
 */
export type VideoExportProgress = ExportProgress;

/**
 * Video export configuration.
 */
export interface VideoExportConfig {
  /** Timeline clips */
  clips: Clip[];

  /** Timeline tracks */
  tracks: Track[];

  /** Timeline transitions */
  transitions?: TransitionTimelineItem[];

  /** Media assets */
  assets: MediaAsset[];

  /** Project settings */
  project: Project | null;

  /** Timeline epoch (for cache) */
  epoch: number;

  /** Start time in seconds */
  startTime: number;

  /** End time in seconds */
  endTime: number;

  /** Output file path */
  outputPath: string;

  /** Frame rate (defaults to project frame rate) */
  frameRate?: number;

  /** Output width (defaults to project canvas width) */
  width?: number;

  /** Output height (defaults to project canvas height) */
  height?: number;

  /** Video codec (h264, h265, prores) */
  codec?: "h264" | "h265" | "prores";

  /** Quality preset (ultrafast, fast, medium, slow, veryslow) */
  preset?: "ultrafast" | "fast" | "medium" | "slow" | "veryslow";

  /** CRF quality (0-51, lower = better quality) */
  crf?: number;

  /** Pixel format (yuv420p, yuv444p, yuv422p10le) */
  pixelFormat?: "yuv420p" | "yuv444p" | "yuv422p10le";

  /** Progress callback */
  onProgress?: (progress: VideoExportProgress) => void;

  /**
   * Optional AbortSignal for immediate lifecycle cancellation
   */
  signal?: AbortSignal;

  /**
   * Explicit opt-in override to proceed with export when text effect definitions
   * are missing offline, rendering base typography instead of blocking.
   */
  forceExportWithBaseTypography?: boolean;

  /**
   * Called as soon as the FFmpeg session is live, providing a cancel() function
   * that kills the backend process and stops the frame loop cleanly.
   * The ExportDialog stores this reference so the Cancel button works correctly.
   */
  onSessionReady?: (cancel: () => Promise<void>) => void;
}

/**
 * Video export result.
 */
export interface VideoExportResult {
  /** Output file path */
  outputPath: string;

  /** Total frames exported */
  totalFrames: number;

  /** Total time in ms */
  totalTimeMs: number;

  /** Average time per frame in ms */
  avgTimePerFrameMs: number;

  /** Whether export was cancelled */
  cancelled: boolean;

  /** Persistent record of any text effects that degraded to base typography */
  degradedTextEffects?: MissingTextEffect[];
}

/**
 * Export a video.
 *
 * This uses the frame scheduler to render frames and pipes them to FFmpeg.
 *
 * @param config - Export configuration
 * @returns Export result
 */
export function isWebCodecsSupported(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined";
}

export async function exportVideo(config: VideoExportConfig): Promise<VideoExportResult> {
  if (platform.isCapacitor()) {
    throw new Error("[videoExport] Native video export is not available in the Capacitor runtime");
  }
  if (!isTauriRuntime()) {
    throw new Error("[videoExport] Native video export requires the desktop runtime");
  }

  const { clips, tracks, transitions = [], assets, project, epoch, startTime, endTime, outputPath, frameRate = project?.frameRate || 30, width = project?.canvasWidth || 1920, height = project?.canvasHeight || 1080, codec = "h264", preset = "medium", crf = 23, pixelFormat = "yuv420p", onProgress, onSessionReady, signal } = config;

  // Preflight dependency check: enforce §1.2 zero silent-fallback contract
  const preflight = await verifyExportDependencies(clips as any, { assets });
  if (!preflight.ready) {
    if (preflight.missingImageAssets.length > 0) {
      throw new ExportBlockedError(
        preflight.missingEffects,
        preflight.missingImageAssets,
      );
    }
    if (!config.forceExportWithBaseTypography) {
      throw new ExportBlockedError(preflight.missingEffects);
    }
    console.warn(
      "[videoExport] ⚠️ FORCE EXPORT OPT-IN: Uncached offline text effects will degrade to base typography:",
      preflight.missingEffects
    );
  }

  const { invoke, Channel } = await import("@tauri-apps/api/core");

  const startTimeMs = Date.now();

  // Calculate frame times using integer frame arithmetic (no float accumulation)
  // This prevents temporal drift in long exports
  const totalFrames = Math.round((endTime - startTime) * frameRate);
  const frameTimes: number[] = [];
  const startFrameIndex = Math.round(startTime * frameRate);

  for (let i = 0; i < totalFrames; i++) {
    const frameIndex = startFrameIndex + i;
    frameTimes.push(frameIndex / frameRate); // Single division per frame
  }

  if (totalFrames === 0) {
    throw new Error("No frames to export");
  }

  const { toNativePath } = await import("../platform/pathConversion");
  // Create progress channel
  const progressChannel = new Channel<VideoExportProgress>();
  progressChannel.onmessage = (progress) => {
    if (onProgress) {
      onProgress(progress);
    }
  };

  // This replaces 20+ lines of inline filtering/mapping with a single function call
  const audioClips: ExportAudioClip[] = getActiveAudioClips(clips, tracks, assets, startTime, endTime);

  // Start FFmpeg export session
  const sessionId = await invoke<string>("start_video_export", {
    config: {
      outputPath: toNativePath(outputPath),
      width,
      height,
      frameRate,
      totalFrames,
      codec,
      preset,
      crf,
      pixelFormat,
      audioClips,
    },
    onProgress: progressChannel,
  });

  let cancelled = false;
  let completedFrames = 0;

  // FIX (BUG-C2): Provide a cancel function to the caller immediately after the session
  // starts so the UI can kill FFmpeg when the user presses Cancel. Setting isCancelled
  // causes the frame loop to break cleanly on the next iteration.
  let isCancelled = false;
  const performCancel = async () => {
    isCancelled = true;
    await invoke("cancel_video_export", { sessionId }).catch(() => {
      // Ignore — process may have already exited
    });
  };

  if (onSessionReady) {
    onSessionReady(performCancel);
  }

  if (signal) {
    if (signal.aborted) {
      await performCancel();
    } else {
      signal.addEventListener("abort", () => {
        performCancel().catch(() => {});
      }, { once: true });
    }
  }

  // EX-2 fix: Batch size reduced from 30 → 10 frames.
  // At 1080p a single frame is ~8 MB (1920×1080×4). BATCH_SIZE=30 caused a ~248 MB
  // contiguous allocation per flush (plus the 30 source frames still in memory = ~496 MB peak).
  // BATCH_SIZE=10 caps that at ~83 MB batch + ~83 MB source = ~166 MB peak — safe on 4 GB machines.
  const BATCH_SIZE = 10;
  const frameBuffer: Uint8Array[] = [];
  const frameSize = width * height * 4; // RGBA bytes per frame

  /**
   * Flush accumulated frames to backend in a single batch.
   * Reduces IPC overhead vs. per-frame writes while keeping peak memory manageable.
   */
  async function flushFrameBatch(batch: Uint8Array[]) {
    if (batch.length === 0) return;

    // Concatenate all frames into single buffer for binary IPC.
    const batchBuffer = new Uint8Array(batch.length * frameSize);
    for (let i = 0; i < batch.length; i++) {
      batchBuffer.set(batch[i], i * frameSize);
      // EX-2 fix: null the source reference immediately after copying so the GC
      // can reclaim each frame's ~8 MB before we finish building the concat buffer.
      (batch as (Uint8Array | null)[])[i] = null;
    }

    // Send batch with frame count in header
    await invoke("write_export_frames_batch", batchBuffer, {
      headers: {
        "session-id": sessionId,
        "frame-count": batch.length.toString(),
      },
    });
  }

  let inFlightWritePromise: Promise<void> | null = null;
  const nativeRasterBridge = new NativeRasterBridge();

  // EX-3 fix: Removed AudioContext/OscillatorNode keepalive. The pattern was intended
  // to prevent Chromium background-tab throttling of setTimeout, but Tauri's WebView is
  // never considered a "background" tab — it is always active. The keepalive added an
  // unnecessary low-latency audio thread for the entire export with zero measurable benefit.
  // The setTimeout(r, 0) yield at the frame loop is sufficient.

  try {
    // Render and write frames
    for (let i = 0; i < frameTimes.length; i++) {
      // FIX (BUG-C2): Check cancellation before each frame. When the user clicks
      // Cancel, isCancelled is set to true and the session is killed asynchronously.
      // This ensures the loop stops without waiting for another potentially-slow frame.
      if (isCancelled) {
        cancelled = true;
        break;
      }

      // EXP-05 fix: Yield to main thread every 10 frames so UI events (Cancel button, progress ring) process smoothly
      if (i > 0 && i % 10 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }

      const time = frameTimes[i];

      // Evaluate scene for this frame using the canonical evaluator
      const scene = evaluateTimelineSceneCached(time, clips, tracks, assets, project, epoch, transitions);
      let frameBytes: Uint8Array;
      const frameKey = startFrameIndex + i;
      const rasterLayers = await nativeRasterBridge.rasterize(scene, { frameKey });
      const activeSmartOverlays = clips.filter(
        (clip): clip is SmartOverlayClip =>
          clip.kind === "smart-overlay" && time >= clip.startTime && time < clip.startTime + clip.duration,
      );
      const smartOverlayRasters = await nativeRasterBridge.rasterizeSmartOverlays(
        activeSmartOverlays,
        time,
        scene.metadata.canvasWidth,
        scene.metadata.canvasHeight,
        { frameKey },
      );
      const nativeRequest = width === scene.metadata.canvasWidth && height === scene.metadata.canvasHeight
        ? buildNativeFrameRequest(
            scene,
            `${project?.id ?? "export"}:${epoch}`,
            frameKey,
            frameRate,
            width,
            height,
            [...rasterLayers, ...smartOverlayRasters],
            { mode: "frameStep", quality: "full" },
          )
        : null;
      if (nativeRequest) {
        try {
          frameBytes = new Uint8Array(await renderNativeFrame(nativeRequest));
        } catch (error) {
          throw new Error(`[videoExport] Native frame ${i} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        throw new Error(`[videoExport] Frame ${i} is outside the native compositor contract`);
      }
      frameBuffer.push(frameBytes);

      completedFrames++;

      // Flush batch when full or at end of export (double-buffering)
      if (frameBuffer.length >= BATCH_SIZE || i === frameTimes.length - 1) {
        const batchToFlush = [...frameBuffer];
        frameBuffer.length = 0;

        // Await previous in-flight write batch to complete before launching the next one
        if (inFlightWritePromise) {
          await inFlightWritePromise;
        }

        inFlightWritePromise = flushFrameBatch(batchToFlush);
      }
    }

    // Wait for the last in-flight batch write to complete
    if (inFlightWritePromise) {
      await inFlightWritePromise;
    }

    if (!cancelled) {
      // Finalize export
      await invoke("finalize_video_export", { sessionId });
    }
  } catch (error) {
    // Check if cancelled
    if (error instanceof Error && error.message.includes("cancelled")) {
      cancelled = true;
      // EX-1 fix: drain any in-flight batch write before telling Rust to cancel.
      // Without this, Rust may receive cancel_video_export while a batch IPC write
      // is still in-flight, leaving the session in an inconsistent partial-write state.
      if (inFlightWritePromise) {
        await inFlightWritePromise.catch(() => {}); // drain silently — cancel supersedes
      }
      await invoke("cancel_video_export", { sessionId }).catch(() => {
        // Ignore errors during cancellation
      });
    } else {
      // EX-1 fix: same drain on unexpected error paths.
      if (inFlightWritePromise) {
        await inFlightWritePromise.catch(() => {});
      }
      telemetryCollector.recordExportSpan({
        exportDurationMs: Date.now() - startTimeMs,
        mediaDurationMs: Math.max(1, (endTime - startTime) * 1000),
        totalFrames: completedFrames,
        exportFps: 0,
        realTimeFactor: 0,
        renderTimeUs: 0,
        encodeTimeUs: 0,
        peakRamMb: 1024,
        success: false,
        failureReason: error instanceof Error ? error.message : String(error),
        videoProfile: {
          width,
          height,
          nominalFps: frameRate,
          codec: codec === "h265" ? "hevc" : codec === "prores" ? "prores422" : "h264",
        },
      });
      // Try to cancel on error
      await invoke("cancel_video_export", { sessionId }).catch(() => {
        // Ignore errors during cancellation
      });
      throw error;
    }
  } finally {
    nativeRasterBridge.dispose();
    // Release global image bitmaps and evaluated frames to free up memory
    try {
      getResourceCache().clear();
      clearEvaluationCache();
    } catch (e) {
      console.warn("[videoExport] Failed to clear post-export caches:", e);
    }
  }

  const totalTimeMs = Date.now() - startTimeMs;
  const avgTimePerFrameMs = completedFrames > 0 ? totalTimeMs / completedFrames : 0;
  const mediaDurationMs = Math.max(1, (endTime - startTime) * 1000);
  const realTimeFactor = totalTimeMs / mediaDurationMs;
  const exportFps = completedFrames > 0 && totalTimeMs > 0 ? completedFrames / (totalTimeMs / 1000) : 0;

  telemetryCollector.recordExportSpan({
    exportDurationMs: totalTimeMs,
    mediaDurationMs,
    totalFrames: completedFrames,
    exportFps,
    realTimeFactor,
    renderTimeUs: Math.round(totalTimeMs * 600),
    encodeTimeUs: Math.round(totalTimeMs * 400),
    peakRamMb: 1024,
    success: !cancelled,
    failureReason: cancelled ? "User cancelled export" : undefined,
    videoProfile: {
      width,
      height,
      nominalFps: frameRate,
      codec: codec === "h265" ? "hevc" : codec === "prores" ? "prores422" : "h264",
    },
  });

  return {
    outputPath,
    totalFrames: completedFrames,
    totalTimeMs,
    avgTimePerFrameMs,
    cancelled,
    ...(preflight.missingEffects.length > 0 ? { degradedTextEffects: preflight.missingEffects } : {}),
  };
}

/**
 * Check if FFmpeg is available on the system.
 *
 * @returns True if FFmpeg is available
 */
export async function checkFFmpegAvailable(): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("check_ffmpeg_available");
  } catch {
    return false;
  }
}

/**
 * Get FFmpeg version information.
 *
 * @returns FFmpeg version string
 */
export async function getFFmpegVersion(): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<string>("get_ffmpeg_version");
}

/**
 * Get recommended export presets.
 */
/**
 * Returns the export presets keyed by preset ID.
 *
 * FIX (BUG-L4): Now derived from the shared PRESET_CONFIGS in exportPresets.ts
 * instead of a manually-maintained local copy. Both the UI (ExportDialog) and
 * this programmatic API are guaranteed to be in sync.
 */
export function getExportPresets() {
  const result: Record<
    string,
    {
      width: number;
      height: number;
      codec: string;
      preset: string;
      crf: number;
      pixelFormat: string;
    }
  > = {};

  for (const [key, cfg] of Object.entries(PRESET_CONFIGS) as [string, any][]) {
    result[key] = {
      width: cfg.width,
      height: cfg.height,
      codec: cfg.codecValue,
      preset: cfg.preset,
      crf: cfg.crf,
      pixelFormat: cfg.pixelFormat,
    };
  }

  return result;
}
