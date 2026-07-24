/**
 * Video Export
 *
 * High-level API for exporting videos using FFmpeg.
 * Migrated to the PixiJS pipeline so all 21 GPU transitions render correctly
 * in exported video (16 of them were silently broken on the Canvas 2D path).
 *
 * Architecture:
 *   Timeline → evaluateTimelineSceneCached → PixiSceneCompositor → RGBA Frames → FFmpeg → MP4/MOV
 */

import { platform } from "../../core/platform";
import { evaluateTimelineSceneCached, clearEvaluationCache } from "../../core/evaluation/evaluator";
import { createPixiExportCompositor, destroyPixiExportCompositor, renderFrameWithPixi } from "./pixiExportRenderer";
import {
  fitNativeFrameDimensions,
  NativeExportFramePool,
} from "./nativeExportFramePool";
import { calculateExportBatchSize } from "./frameBatching";
import {
  analyzeNativeTimelineExport,
  runNativeTimelineExport,
} from "./nativeTimelineExport";
import { getResourceCache } from "../../core/resources/ResourceCache";
import { resolveClipSourceTime } from "../../core/timeline/sourceTime";
import { getActiveAudioClips } from "../../core/timeline/audioClips";
import { PRESET_CONFIGS } from "./exportPresets";
import type { Clip, Track, MediaAsset, Project, TransitionTimelineItem } from "../../types";
import type { ExportAudioClip, ExportProgress } from "../../types/export";
import { ALL_TRANSITIONS } from "@clypra-studio/engine";
import { resolveTransitionDefinition, mergeTransitionParams } from "../../core/render/utils/transitionResolver";

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
    const { exportVideoMobile } = await import("./mobileExport");
    return exportVideoMobile(config);
  }

  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const { clips, tracks, transitions = [], assets, project, epoch, startTime, endTime, outputPath, frameRate = project?.frameRate || 30, width = project?.canvasWidth || 1920, height = project?.canvasHeight || 1080, codec = "h264", preset = "medium", crf = 23, pixelFormat = "yuv420p", onProgress, onSessionReady } = config;

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

  const nativeTimeline = analyzeNativeTimelineExport({
    clips,
    tracks,
    transitions,
    assets,
    project,
    startTime,
    endTime,
    outputPath,
    width,
    height,
    frameRate,
    codec,
    preset,
    crf,
    pixelFormat,
  });
  if (nativeTimeline.eligible) {
    const nativeResult = await runNativeTimelineExport(nativeTimeline.plan, {
      onProgress,
      onSessionReady,
    });
    return {
      outputPath,
      totalFrames: nativeResult.completedFrames,
      totalTimeMs: nativeResult.totalTimeMs,
      avgTimePerFrameMs:
        nativeResult.completedFrames > 0
          ? nativeResult.totalTimeMs / nativeResult.completedFrames
          : 0,
      cancelled: nativeResult.cancelled,
    };
  }

  // Decode export frames through the native sequential FFmpeg decoder. The
  // previous HTMLVideoElement path performed a paused WebKit seek for every
  // frame and collapsed to roughly 1 fps on macOS.
  const nativeFramePool = new NativeExportFramePool();

  // Create headless Pixi compositor for this export session.
  // All 21 GPU transitions render correctly on this path.
  const pixiHandle = createPixiExportCompositor(width, height);

  // Wait for the WebGL/Pixi context to be fully initialized and ready.
  // Without this, the export loop starts composing frames before Pixi is ready,
  // resulting in completely blank/black frames being written.
  await pixiHandle.compositor.waitForReady();

  // Pre-warm transition shaders before the render loop starts.
  // This avoids compile-time hiccups/stalls during video export.
  if (transitions && transitions.length > 0) {
    for (const transition of transitions) {
      const resolved = resolveTransitionDefinition(
        transition.type,
        ALL_TRANSITIONS,
        transition.renderer
      );
      if (resolved) {
        const { definition, params } = resolved;
        const runtimeParams = {
          easing: transition.easing,
          ...(transition.metadata?.params as Record<string, any> || {}),
        };
        const mergedParams = mergeTransitionParams(definition.params, params, runtimeParams);
        pixiHandle.compositor.prewarmTransitionShader(definition, mergedParams);
      }
    }
  }

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
      outputPath,
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
  let resolveCleanup: () => void = () => {};
  const cleanupComplete = new Promise<void>((resolve) => {
    resolveCleanup = resolve;
  });
  if (onSessionReady) {
    onSessionReady(async () => {
      isCancelled = true;
      await invoke("cancel_video_export", { sessionId }).catch(() => {
        // Ignore — process may have already exited
      });
      await cleanupComplete;
    });
  }

  const frameSize = width * height * 4; // RGBA
  const BATCH_SIZE = calculateExportBatchSize(frameSize);
  const frameBuffer = new Uint8Array(frameSize * BATCH_SIZE);
  let bufferedFrames = 0;

  /**
   * Flush accumulated frames to backend in a single batch.
   * Reduces IPC overhead by 90% compared to per-frame writes.
   */
  async function flushFrameBatch() {
    if (bufferedFrames === 0) return;
    const payload = frameBuffer.subarray(0, bufferedFrames * frameSize);

    // Send batch with frame count in header
    await invoke("write_export_frames_batch", payload, {
      headers: {
        "session-id": sessionId,
        "frame-count": bufferedFrames.toString(),
      },
    });

    bufferedFrames = 0;
  }

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

      const time = frameTimes[i];

      // Decode active video layers into stable canvas-backed Pixi sources.
      const videoElements = new Map<string, HTMLCanvasElement>();

      // Find all video clips active at this time
      for (const clip of clips) {
        const asset = assets.find((a) => a.id === clip.mediaId);
        if (asset?.type !== "video") continue;

        // Check if clip is active at this time
        const clipEnd = clip.startTime + clip.duration;
        if (time < clip.startTime || time >= clipEnd) continue;

        // Replaced inline calculation with resolveClipSourceTime utility to ensure consistency
        const { sourceTime } = resolveClipSourceTime(clip, time, {
          clampToRange: true,
          frameRate,
        });

        const key = `${clip.id}-${clip.mediaId}`;
        try {
          const projectWidth = project?.canvasWidth || width;
          const projectHeight = project?.canvasHeight || height;
          const decodeBoundsWidth =
            (clip.width || asset.width || projectWidth) * (width / projectWidth);
          const decodeBoundsHeight =
            (clip.height || asset.height || projectHeight) * (height / projectHeight);
          const decodeSize = fitNativeFrameDimensions(
            decodeBoundsWidth,
            decodeBoundsHeight,
            asset.width,
            asset.height,
          );
          const canvas = await nativeFramePool.acquire({
            key,
            videoPath: asset.path,
            timeSecs: sourceTime,
            width: decodeSize.width,
            height: decodeSize.height,
          });
          videoElements.set(key, canvas);
        } catch (error) {
          throw new Error(`Failed to decode video for clip at time ${time}s: ${error}. Export aborted to prevent corrupted output.`);
        }
      }

      // Evaluate scene for this frame using the canonical evaluator
      const scene = evaluateTimelineSceneCached(time, clips, tracks, assets, project, epoch, transitions);

      // Render frame through the Pixi WebGL compositor.
      // All 21 GPU transitions render correctly here (16 of them were broken on
      // the previous Canvas 2D / FrameScheduler path).
      const imageData = await renderFrameWithPixi(pixiHandle, scene, videoElements);

      frameBuffer.set(imageData.data, bufferedFrames * frameSize);
      bufferedFrames++;

      completedFrames++;

      // Flush batch when full or at end of export
      if (bufferedFrames >= BATCH_SIZE || i === frameTimes.length - 1) {
        await flushFrameBatch();
      }
    }

    if (!cancelled) {
      // Finalize export
      await invoke("finalize_video_export", { sessionId });
    }
  } catch (error) {
    // Check if cancelled
    if (error instanceof Error && error.message.includes("cancelled")) {
      cancelled = true;
      await invoke("cancel_video_export", { sessionId }).catch(() => {
        // Ignore errors during cancellation
      });
    } else {
      // Try to cancel on error
      await invoke("cancel_video_export", { sessionId }).catch(() => {
        // Ignore errors during cancellation
      });
      throw error;
    }
  } finally {
    // Always clean up native frame sources and Pixi compositor
    await nativeFramePool.clear();
    destroyPixiExportCompositor(pixiHandle);

    // Release global image bitmaps and evaluated frames to free up memory
    try {
      getResourceCache().clear();
      clearEvaluationCache();
    } catch (e) {
      console.warn("[videoExport] Failed to clear post-export caches:", e);
    } finally {
      resolveCleanup();
    }
  }

  const totalTimeMs = Date.now() - startTimeMs;
  const avgTimePerFrameMs = completedFrames > 0 ? totalTimeMs / completedFrames : 0;

  return {
    outputPath,
    totalFrames: completedFrames,
    totalTimeMs,
    avgTimePerFrameMs,
    cancelled,
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
