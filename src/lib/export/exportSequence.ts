/**
 * Image Sequence Export
 *
 * Exports a range of frames as an image sequence.
 * Migrated to headless PixiJS WebGL compositor for exact visual parity
 * with preview and correct rendering of all filters and GPU transitions.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { createPixiExportCompositor, destroyPixiExportCompositor, renderFrameWithPixi } from "./pixiExportRenderer";
import { VideoElementPool } from "../../core/resources/VideoElementPool";
import { resolveClipSourceTime } from "../../core/timeline/sourceTime";
import { evaluateTimelineSceneCached } from "../../core/evaluation/evaluator";
import type { Clip, Track, MediaAsset, Project, TransitionTimelineItem } from "../../types";
import { ALL_TRANSITIONS } from "@clypra-studio/engine";
import { resolveTransitionDefinition, mergeTransitionParams } from "../../core/render/utils/transitionResolver";
import { getActiveVideoClipsForTime } from "./exportUtils";

/**
 * Image sequence export options.
 */
export interface ExportSequenceOptions {
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

  /** Frame rate (defaults to project frame rate) */
  frameRate?: number;

  /** Output width (defaults to project canvas width) */
  width?: number;

  /** Output height (defaults to project canvas height) */
  height?: number;

  /** Output format */
  format?: "png" | "jpeg";

  /** JPEG quality (0-1) */
  quality?: number;

  /** Progress callback */
  onProgress?: (progress: number, currentFrame: number, totalFrames: number) => void;

  /** Frame callback (receives each frame as it's rendered) */
  onFrame?: (frameNumber: number, blob: Blob) => Promise<void>;

  /**
   * Called as soon as the AbortController is created, providing a scoped cancel()
   * function tied to this specific export session.
   *
   * FIX (BUG-C3): Replaces the old module-level cancelExport() which could
   * cross-cancel sessions when called during a concurrent or rapid retry.
   */
  onCancelReady?: (cancel: () => void) => void;
}

/**
 * Export result.
 */
export interface ExportSequenceResult {
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
 * Export an image sequence.
 *
 * Headless PixiJS rendering ensures preview and export use the same pipeline.
 *
 * @param options - Export options
 * @returns Export result
 */
export async function exportSequence(options: ExportSequenceOptions): Promise<ExportSequenceResult> {
  const {
    clips,
    tracks,
    transitions = [],
    assets,
    project,
    epoch,
    startTime,
    endTime,
    frameRate = project?.frameRate || 30,
    width = project?.canvasWidth || 1920,
    height = project?.canvasHeight || 1080,
    format = "png",
    quality = 0.92,
    onProgress,
    onFrame,
    onCancelReady,
  } = options;

  const startTimeMs = Date.now();

  const totalFrames = Math.round((endTime - startTime) * frameRate);
  const frameTimes: number[] = [];
  const startFrameIndex = Math.round(startTime * frameRate);

  for (let i = 0; i < totalFrames; i++) {
    const frameIndex = startFrameIndex + i;
    frameTimes.push(frameIndex / frameRate);
  }

  if (totalFrames === 0) {
    return {
      totalFrames: 0,
      totalTimeMs: 0,
      avgTimePerFrameMs: 0,
      cancelled: false,
    };
  }

  // FIX (BUG-C3): AbortController is now scoped to this function call, not module-level.
  // The old module-level singleton caused cross-session contamination: if exportSequence
  // was called a second time before the first finished, the second controller overwrote
  // the first, and cancelExport() would cancel the wrong session.
  const abortController = new AbortController();
  const signal = abortController.signal;

  // Provide a typed cancel function to the caller for session-scoped cancellation.
  onCancelReady?.(() => abortController.abort());

  const pixiHandle = createPixiExportCompositor(width, height);

  // FIX (BUG-C1): Wait for WebGL context to be fully initialized before rendering.
  // Without this, composeFrame() returns early (isReady=false) producing blank frames.
  await pixiHandle.compositor.waitForReady();

  // Pre-warm transition shaders before the render loop starts.
  // This avoids compile-time hiccups/stalls during sequence export.
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

  const videoPool = new VideoElementPool({
    maxConcurrent: 10,
    debug: false,
    isExport: true,
  });

  let completedFrames = 0;
  let cancelled = false;

  try {
    for (let i = 0; i < frameTimes.length; i++) {
      if (signal.aborted) {
        throw new Error("Job cancelled");
      }

      const time = frameTimes[i];
      const frameVideoElements: HTMLVideoElement[] = [];

      try {
        const videoElements = new Map<string, HTMLVideoElement>();

        const activeVideoClips = getActiveVideoClipsForTime(time, clips, assets, transitions);
        for (const clip of activeVideoClips) {
          const asset = assets.find((a) => a.id === clip.mediaId)!;

          const { sourceTime } = resolveClipSourceTime(clip, time, {
            clampToRange: true,
            frameRate,
          });

          const resolvedPath = asset.path.startsWith("asset://") ? asset.path : convertFileSrc(asset.path);
          const key = `${clip.id}-${clip.mediaId}`;
          const video = await videoPool.acquire(resolvedPath, sourceTime);
          videoElements.set(key, video);
          frameVideoElements.push(video);
        }

        if (signal.aborted) {
          throw new Error("Job cancelled");
        }

        const scene = evaluateTimelineSceneCached(time, clips, tracks, assets, project, epoch, transitions);
        await renderFrameWithPixi(pixiHandle, scene, videoElements);

        const blob = await new Promise<Blob>((resolve, reject) => {
          pixiHandle.readbackCanvas.toBlob(
            (b) => {
              if (b) resolve(b);
              else reject(new Error("[ExportSequence] Failed to create blob"));
            },
            format === "jpeg" ? "image/jpeg" : "image/png",
            quality,
          );
        });

        for (const vid of frameVideoElements) {
          videoPool.releaseElement(vid);
        }

        if (onFrame) {
          await onFrame(i, blob);
        }

        completedFrames++;

        if (onProgress) {
          onProgress(completedFrames / totalFrames, completedFrames, totalFrames);
        }
      } catch (err) {
        for (const vid of frameVideoElements) {
          videoPool.releaseElement(vid);
        }
        throw err;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Job cancelled") {
      cancelled = true;
    } else {
      throw error;
    }
  } finally {
    videoPool.clear();
    destroyPixiExportCompositor(pixiHandle);
  }

  const totalTimeMs = Date.now() - startTimeMs;
  const avgTimePerFrameMs = completedFrames > 0 ? totalTimeMs / completedFrames : 0;

  return {
    totalFrames: completedFrames,
    totalTimeMs,
    avgTimePerFrameMs,
    cancelled,
  };
}

/**
 * @deprecated Use the onCancelReady callback in exportSequence options instead.
 * This function is kept for backwards compatibility but has no effect if no
 * session is currently active via the onCancelReady pattern.
 */
export function cancelExport(): void {
  // This is a no-op in the new API. Pass onCancelReady to exportSequence instead.
  console.warn(
    "[ExportSequence] cancelExport() is deprecated. Use the cancel() function provided " +
    "via the onCancelReady callback in exportSequence options.",
  );
}

/**
 * Export sequence and download as ZIP.
 * (Placeholder download behavior)
 */
export async function exportSequenceAndDownload(options: ExportSequenceOptions, filename?: string): Promise<void> {
  const frames: { frameNumber: number; blob: Blob }[] = [];

  await exportSequence({
    ...options,
    onFrame: async (frameNumber, blob) => {
      frames.push({ frameNumber, blob });
    },
  });

  if (frames.length > 0) {
    const ext = options.format === "jpeg" ? "jpg" : "png";
    const name = filename || `sequence-frame-0000.${ext}`;

    const url = URL.createObjectURL(frames[0].blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();

    URL.revokeObjectURL(url);
  }
}
