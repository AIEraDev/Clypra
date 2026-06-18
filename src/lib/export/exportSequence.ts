/**
 * Image Sequence Export
 *
 * Exports a range of frames as an image sequence.
 * Uses the frame scheduler for proper temporal orchestration.
 *
 * Architecture:
 *   Timeline Range → Frame Scheduler → Image Sequence
 *
 * Key principles:
 * - Proper cancellation propagation
 * - Progress tracking
 * - Resource pre-loading
 * - Priority scheduling
 */

import { getFrameScheduler } from "../../core/scheduler/FrameScheduler";
import type { Clip, Track, MediaAsset, Project } from "../../types";

/**
 * Image sequence export options.
 */
export interface ExportSequenceOptions {
  /** Timeline clips */
  clips: Clip[];

  /** Timeline tracks */
  tracks: Track[];

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
 * This uses the frame scheduler for proper temporal orchestration:
 * - Priority-based scheduling (export priority)
 * - Resource pre-loading
 * - Cancellation propagation
 * - Progress tracking
 *
 * @param options - Export options
 * @returns Export result
 */
export async function exportSequence(options: ExportSequenceOptions): Promise<ExportSequenceResult> {
  const { clips, tracks, assets, project, epoch, startTime, endTime, frameRate = project?.frameRate || 30, width = project?.canvasWidth || 1920, height = project?.canvasHeight || 1080, format = "png", quality = 0.92, onProgress, onFrame } = options;

  const startTimeMs = Date.now();

  // Calculate frame times using integer frame arithmetic (prevents float accumulation)
  // This matches the approach in videoExport.ts for consistency
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

  // Get scheduler and update timeline state
  const scheduler = getFrameScheduler();
  scheduler.updateTimeline(clips, tracks, assets, project, epoch);

  // Schedule all frames
  const jobIds: string[] = [];
  for (let i = 0; i < frameTimes.length; i++) {
    const time = frameTimes[i];

    const jobId = scheduler.schedule({
      time,
      resolution: {
        width,
        height,
      },
      pixelRatio: 1,
      outputFormat: "blob",
      quality,
      priority: "export",
    });

    jobIds.push(jobId);
  }

  // Wait for all frames to complete
  let completedFrames = 0;
  let cancelled = false;

  try {
    for (let i = 0; i < jobIds.length; i++) {
      const jobId = jobIds[i];

      // Wait for frame
      const result = await scheduler.wait(jobId);

      if (!(result.data instanceof Blob)) {
        throw new Error("Expected Blob output from scheduler");
      }

      // Call frame callback
      if (onFrame) {
        await onFrame(i, result.data);
      }

      completedFrames++;

      // Report progress
      if (onProgress) {
        const progress = completedFrames / totalFrames;
        onProgress(progress, completedFrames, totalFrames);
      }
    }
  } catch (error) {
    // Check if cancelled
    if (error instanceof Error && error.message === "Job cancelled") {
      cancelled = true;
    } else {
      throw error;
    }
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
 * Cancel an ongoing export.
 * Cancels all pending frame jobs.
 */
export function cancelExport(): void {
  const scheduler = getFrameScheduler();
  scheduler.cancelAll();
}

/**
 * Export sequence and download as ZIP.
 * (Requires additional ZIP library - placeholder for now)
 *
 * @param options - Export options
 * @param filename - Output filename
 */
export async function exportSequenceAndDownload(options: ExportSequenceOptions, filename?: string): Promise<void> {
  const frames: { frameNumber: number; blob: Blob }[] = [];

  await exportSequence({
    ...options,
    onFrame: async (frameNumber, blob) => {
      frames.push({ frameNumber, blob });
    },
  });

  // TODO: Create ZIP file with all frames
  // For now, just download the first frame
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
