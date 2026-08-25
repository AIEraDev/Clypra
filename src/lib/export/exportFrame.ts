/**
 * Frame Export Utilities
 *
 * High-level API for exporting single frames.
 * Uses the native compositor for representable desktop scenes. Unsupported
 * scenes fail with an actionable contract error rather than changing renderers.
 */

import { evaluateTimelineSceneCached } from "../../core/evaluation/evaluator";
import type { Clip, Track, MediaAsset, Project, TransitionTimelineItem } from "../../types";
import { buildNativeVideoProjectRequest } from "@/components/editor/preview/nativeVideoPreview";
import { isTauriRuntime, renderNativeVideoProjectFrame } from "@/lib/platform/tauri";
import { NativeRasterBridge } from "@/core/render/nativeRasterBridge";
import type { SmartOverlayClip } from "@/types/smartOverlay";

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
 * Native rendering is authoritative for Tauri-compatible frames. Browser export
 * backends are intentionally not supported.
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

  const scene = evaluateTimelineSceneCached(time, clips, tracks, assets, project, epoch, transitions);

  // Native Tauri export is authoritative for a project-sized scene that the
  // native graph can represent. Only explicit native errors are returned to
  // the caller.
  if (!isTauriRuntime()) {
    throw new Error("[ExportFrame] Native frame export requires the desktop runtime");
  }

  if (width !== scene.metadata.canvasWidth || height !== scene.metadata.canvasHeight) {
    throw new Error("[ExportFrame] Native export requires project-sized output dimensions");
  }
  const nativeRasterBridge = new NativeRasterBridge();
  try {
    const frameKey = Math.round(time * (project?.frameRate || 30));
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
    const nativeRequest = buildNativeVideoProjectRequest(scene, [...rasterLayers, ...smartOverlayRasters]);
    if (!nativeRequest) {
      throw new Error("[ExportFrame] Frame is outside the native compositor contract");
    }
    let rgba: ArrayBuffer;
    try {
      rgba = await renderNativeVideoProjectFrame(nativeRequest);
    } catch (error) {
      throw new Error(`[ExportFrame] Native frame export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("[ExportFrame] Failed to create native export canvas");
    const image = context.createImageData(width, height);
    image.data.set(new Uint8ClampedArray(rgba));
    context.putImageData(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("[ExportFrame] Failed to encode native frame")),
        format === "jpeg" ? "image/jpeg" : "image/png",
        quality,
      );
    });
  } finally {
    nativeRasterBridge.dispose();
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
