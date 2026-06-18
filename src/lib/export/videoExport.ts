/**
 * Video Export
 *
 * High-level API for exporting videos using FFmpeg.
 * Integrates with the frame scheduler for frame rendering.
 *
 * Architecture:
 *   Timeline → Frame Scheduler → RGBA Frames → FFmpeg → MP4/MOV
 */

import { invoke, Channel, convertFileSrc } from "@tauri-apps/api/core";
import { toNativePath } from "../platform/pathConversion";
import { getFrameScheduler } from "../../core/scheduler/FrameScheduler";
import { VideoElementPool } from "../../core/resources/VideoElementPool";
import type { Clip, Track, MediaAsset, Project, TransitionTimelineItem } from "../../types";
import type { ExportAudioClip, ExportProgress } from "../../types/export";

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
export async function exportVideo(config: VideoExportConfig): Promise<VideoExportResult> {
  const { clips, tracks, transitions = [], assets, project, epoch, startTime, endTime, outputPath, frameRate = project?.frameRate || 30, width = project?.canvasWidth || 1920, height = project?.canvasHeight || 1080, codec = "h264", preset = "medium", crf = 23, pixelFormat = "yuv420p", onProgress } = config;

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

  // Get scheduler and update timeline state
  const scheduler = getFrameScheduler();
  scheduler.updateTimeline(clips, tracks, assets, project, epoch, transitions);

  // Create headless video element pool for export
  const videoPool = new VideoElementPool({
    maxConcurrent: 10,
    debug: false,
  });

  // Create progress channel
  const progressChannel = new Channel<VideoExportProgress>();
  progressChannel.onmessage = (progress) => {
    if (onProgress) {
      onProgress(progress);
    }
  };

  // Collect audio/video clips with audio streams for export mixing
  const activeTracks = new Set(tracks.filter((t) => !t.muted).map((t) => t.id));
  const audioClips: ExportAudioClip[] = clips
    .filter((clip) => {
      if (!activeTracks.has(clip.trackId)) return false;
      const asset = assets.find((a) => a.id === clip.mediaId);
      if (!asset || (asset.type !== "audio" && asset.type !== "video")) return false;
      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + clip.duration;
      return clipStart < endTime && clipEnd > startTime;
    })
    .map((clip) => {
      const asset = assets.find((a) => a.id === clip.mediaId)!;
      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + clip.duration;
      const overlapStart = Math.max(clipStart, startTime);
      const overlapEnd = Math.min(clipEnd, endTime);
      const relativeStartTime = overlapStart - startTime;
      const relativeDuration = overlapEnd - overlapStart;
      const relativeTrimIn = (clip.trimIn || 0) + (overlapStart - clipStart);
      return {
        // Normalize to native FS path — asset.path may be an asset:// or file:// URL
        path: toNativePath(asset.path),
        startTime: relativeStartTime,
        duration: relativeDuration,
        trimIn: relativeTrimIn,
        volume: Math.max(0, Math.min(1, clip.volume ?? 1.0)),
        fadeIn: Math.max(0, Math.min(relativeDuration, (clip as any).fadeIn ?? 0)),
        fadeOut: Math.max(0, Math.min(relativeDuration, (clip as any).fadeOut ?? 0)),
      };
    });

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

  try {
    // Render and write frames
    for (let i = 0; i < frameTimes.length; i++) {
      const time = frameTimes[i];

      // Track ALL acquired video elements for this frame (base + overlays)
      const frameVideoElements: HTMLVideoElement[] = [];

      // Pre-load and seek all video elements for this frame
      const videoElements = new Map<string, HTMLVideoElement>();

      // Find all video clips active at this time
      for (const clip of clips) {
        const asset = assets.find((a) => a.id === clip.mediaId);
        if (asset?.type !== "video") continue;

        // Check if clip is active at this time
        const clipEnd = clip.startTime + clip.duration;
        if (time < clip.startTime || time >= clipEnd) continue;

        // Calculate source time (accounting for trim)
        const clipLocalTime = time - clip.startTime;
        const trimIn = clip.trimIn || 0;
        const trimOut = clip.trimOut ?? trimIn + clip.duration;
        const rawSourceTime = trimIn + clipLocalTime;

        // ✅ CLAMP: never seek past the clip's valid range
        const frameTime = 1 / frameRate;
        const sourceTime = Math.min(rawSourceTime, trimOut - frameTime);

        // Resolve path for Tauri webview context
        const resolvedPath = asset.path.startsWith("asset://") ? asset.path : convertFileSrc(asset.path);

        // Acquire video element at exact frame time
        const key = `${clip.id}-${clip.mediaId}`;
        try {
          const video = await videoPool.acquire(resolvedPath, sourceTime);
          videoElements.set(key, video);
          frameVideoElements.push(video);
        } catch (error) {
          console.warn(`Failed to acquire video for ${key}:`, error);
          // Continue without this video - rasterizer will use fallback
        }
      }

      // Schedule frame render with video elements
      const jobId = scheduler.schedule({
        time,
        resolution: { width, height },
        pixelRatio: 1,
        outputFormat: "imagedata",
        priority: "export",
        videoElements,
      });

      // Wait for frame
      const result = await scheduler.wait(jobId);

      if (!(result.data instanceof ImageData)) {
        throw new Error("Expected ImageData output from scheduler");
      }

      const imageData = result.data;

      // Write frame to FFmpeg using raw request payload and session-id header
      await invoke("write_export_frame", new Uint8Array(imageData.data.buffer), {
        headers: {
          "session-id": sessionId,
        },
      });

      // ✅ CRITICAL: Release ALL video elements acquired for this frame
      // This includes both base clips and overlay clips
      for (const video of frameVideoElements) {
        videoPool.releaseElement(video);
      }

      completedFrames++;
    }

    // Finalize export
    await invoke("finalize_video_export", { sessionId });
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
    // Always clean up video pool
    videoPool.clear();
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
  return await invoke<string>("get_ffmpeg_version");
}

/**
 * Get recommended export presets.
 */
export function getExportPresets() {
  return {
    "1080p-fast": {
      width: 1920,
      height: 1080,
      codec: "h264" as const,
      preset: "fast" as const,
      crf: 23,
      pixelFormat: "yuv420p" as const,
    },
    "1080p-quality": {
      width: 1920,
      height: 1080,
      codec: "h264" as const,
      preset: "slow" as const,
      crf: 18,
      pixelFormat: "yuv420p" as const,
    },
    "720p-fast": {
      width: 1280,
      height: 720,
      codec: "h264" as const,
      preset: "fast" as const,
      crf: 23,
      pixelFormat: "yuv420p" as const,
    },
    "4k-quality": {
      width: 3840,
      height: 2160,
      codec: "h265" as const,
      preset: "medium" as const,
      crf: 20,
      pixelFormat: "yuv420p" as const,
    },
    "prores-422hq": {
      width: 1920,
      height: 1080,
      codec: "prores" as const,
      preset: "medium" as const,
      crf: 0,
      pixelFormat: "yuv422p10le" as const,
    },
  };
}
