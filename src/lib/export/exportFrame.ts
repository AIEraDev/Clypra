/**
 * Frame Export Utilities
 *
 * High-level API for exporting single frames.
 * Migrated to PixiJS WebGL pipeline for exact visual parity with preview
 * and correct rendering of filters and GPU transitions.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { createPixiExportCompositor, destroyPixiExportCompositor, renderFrameWithPixi } from "./pixiExportRenderer";
import { VideoElementPool } from "../../core/resources/VideoElementPool";
import { resolveClipSourceTime } from "../../core/timeline/sourceTime";
import { evaluateTimelineSceneCached } from "../../core/evaluation/evaluator";
import type { Clip, Track, MediaAsset, Project, TransitionTimelineItem } from "../../types";
import { getActiveVideoClipsForTime } from "./exportUtils";

export interface ExportFrameOptions {
  /** Timeline time to export */
  time: number;

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

  /** Output width (defaults to project canvas width) */
  width?: number;

  /** Output height (defaults to project canvas height) */
  height?: number;

  /** Output format */
  format?: "png" | "jpeg";

  /** JPEG quality (0-1) */
  quality?: number;
}

/**
 * Export a single frame as PNG or JPEG.
 *
 * Headless PixiJS rendering ensures preview and export use the same pipeline.
 *
 * @param options - Export options
 * @returns Blob containing the exported frame
 */
export async function exportFrame(options: ExportFrameOptions): Promise<Blob> {
  const {
    time,
    clips,
    tracks,
    transitions = [],
    assets,
    project,
    epoch,
    width = project?.canvasWidth || 1920,
    height = project?.canvasHeight || 1080,
    format = "png",
    quality = 0.92,
  } = options;

  // Create headless Pixi compositor for single frame
  const pixiHandle = createPixiExportCompositor(width, height);

  // FIX (BUG-C1): Wait for WebGL context to be fully initialized before rendering.
  // Without this, composeFrame() returns early (isReady=false) producing a blank PNG.
  await pixiHandle.compositor.waitForReady();

  const videoPool = new VideoElementPool({
    maxConcurrent: 10,
    debug: false,
    isExport: true,
  });

  const frameVideoElements: HTMLVideoElement[] = [];

  try {
    const videoElements = new Map<string, HTMLVideoElement>();

    // Find all video clips active at this time (including transition windows) and acquire them
    const activeVideoClips = getActiveVideoClipsForTime(time, clips, assets, transitions);
    for (const clip of activeVideoClips) {
      const asset = assets.find((a) => a.id === clip.mediaId)!;

      const { sourceTime } = resolveClipSourceTime(clip, time, {
        clampToRange: true,
        frameRate: project?.frameRate || 30,
      });

      const resolvedPath = asset.path.startsWith("asset://") ? asset.path : convertFileSrc(asset.path);
      const key = `${clip.id}-${clip.mediaId}`;
      const video = await videoPool.acquire(resolvedPath, sourceTime);
      videoElements.set(key, video);
      frameVideoElements.push(video);
    }

    const scene = evaluateTimelineSceneCached(time, clips, tracks, assets, project, epoch, transitions);
    await renderFrameWithPixi(pixiHandle, scene, videoElements);

    // Convert canvas to Blob
    return await new Promise<Blob>((resolve, reject) => {
      pixiHandle.readbackCanvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error("[ExportFrame] Failed to create blob from readback canvas"));
        },
        format === "jpeg" ? "image/jpeg" : "image/png",
        quality,
      );
    });
  } finally {
    // FIX (BUG-H5): Release all video elements in finally only — prevents double-release
    // that occurred when release was duplicated in try (success path) and catch (error path).
    for (const vid of frameVideoElements) {
      videoPool.releaseElement(vid);
    }
    videoPool.clear();
    destroyPixiExportCompositor(pixiHandle);
  }
}

/**
 * Export frame and download it.
 *
 * @param options - Export options
 * @param filename - Output filename
 */
export async function exportFrameAndDownload(options: ExportFrameOptions, filename?: string): Promise<void> {
  const blob = await exportFrame(options);

  // Generate filename if not provided
  const ext = options.format === "jpeg" ? "jpg" : "png";
  const name = filename || `frame-${options.time.toFixed(2)}s.${ext}`;

  // Create download link
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();

  // Cleanup
  URL.revokeObjectURL(url);
}

/**
 * Export frame via Tauri (save to disk).
 *
 * @param options - Export options
 * @param savePath - Path to save the file
 */
export async function exportFrameToFile(options: ExportFrameOptions, savePath: string): Promise<void> {
  const blob = await exportFrame(options);

  // FIX (BUG-M3): Convert blob to Uint8Array and write via Tauri's binary IPC.
  // The previous Array.from(uint8Array) pattern serialized the entire buffer as a
  // JSON number array over IPC — catastrophically slow and OOM-prone for large frames
  // (a 4K PNG can be 50–80 MB). Passing the ArrayBuffer directly uses binary IPC,
  // avoiding any intermediate JSON allocation.
  const arrayBuffer = await blob.arrayBuffer();

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_file", {
      path: savePath,
      contents: new Uint8Array(arrayBuffer),
    });
  } catch (err) {
    console.error("[ExportFrame] Failed to write file:", err);
    throw err;
  }
}
