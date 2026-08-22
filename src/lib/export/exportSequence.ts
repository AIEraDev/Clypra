/**
 * Image Sequence Export
 *
 * Exports a range of frames as an image sequence.
 * Uses the native compositor for desktop scenes. Unsupported scenes fail
 * explicitly instead of changing renderers.
 */

import { evaluateTimelineSceneCached } from "../../core/evaluation/evaluator";
import type { Clip, Track, MediaAsset, Project, TransitionTimelineItem } from "../../types";
import { buildNativeVideoProjectRequest } from "@/components/editor/preview/nativeVideoPreview";
import { isTauriRuntime, renderNativeVideoProjectFrame } from "@/lib/platform/tauri";

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
 * Native rendering is authoritative. Browser exports are rejected because the
 * main editor has no second renderer with independent semantics.
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

  // EX-4 fix: hoist canvas + context outside nativeFrameToBlob so they are created once
  // per export, not once per frame. A 1000-frame export previously allocated 1000 separate
  // GPU-backed canvas objects that were GC'd only after the loop completed.
  const readbackCanvas = document.createElement("canvas");
  readbackCanvas.width = width;
  readbackCanvas.height = height;
  const readbackContext = readbackCanvas.getContext("2d");
  if (!readbackContext) throw new Error("[ExportSequence] Failed to create native readback canvas");

  const nativeFrameToBlob = async (rgba: ArrayBuffer): Promise<Blob> => {
    const image = readbackContext.createImageData(width, height);
    image.data.set(new Uint8ClampedArray(rgba));
    readbackContext.putImageData(image, 0, 0);
    return new Promise<Blob>((resolve, reject) => {
      readbackCanvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("[ExportSequence] Failed to encode native frame")),
        format === "jpeg" ? "image/jpeg" : "image/png",
        quality,
      );
    });
  };

  let completedFrames = 0;
  let cancelled = false;

  if (!isTauriRuntime()) {
    throw new Error("[ExportSequence] Native image-sequence export requires the desktop runtime");
  }

  try {
    for (let i = 0; i < frameTimes.length; i++) {
      if (signal.aborted) {
        throw new Error("Job cancelled");
      }

      const time = frameTimes[i];
      try {
        const scene = evaluateTimelineSceneCached(time, clips, tracks, assets, project, epoch, transitions);
        let blob: Blob;
        const nativeRequest = width === scene.metadata.canvasWidth && height === scene.metadata.canvasHeight
          ? buildNativeVideoProjectRequest(scene)
          : null;
        if (nativeRequest) {
          try {
            blob = await nativeFrameToBlob(await renderNativeVideoProjectFrame(nativeRequest));
          } catch (error) {
            throw new Error(`[ExportSequence] Native frame failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        } else {
          throw new Error("[ExportSequence] Frame is outside the native compositor contract");
        }

        if (onFrame) {
          await onFrame(i, blob);
        }

        completedFrames++;

        if (onProgress) {
          onProgress(completedFrames / totalFrames, completedFrames, totalFrames);
        }
      } catch (err) {
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
