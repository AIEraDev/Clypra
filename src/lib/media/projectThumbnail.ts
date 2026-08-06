import type { Project } from "@/types";

/**
 * Resolve the best available thumbnail URL or Data URL for a project.
 *
 * Fallback Hierarchy:
 * 1. Live Program Preview Canvas Snapshot (`project.thumbnail`)
 * 2. Primary Visual Media Asset (`posterFrame`, `coverArt`, or `path` for image)
 * 3. undefined (falls back to generative project graphic pattern)
 */
export function getProjectThumbnail(project: Partial<Project>): string | undefined {
  if (project.thumbnail && typeof project.thumbnail === "string" && project.thumbnail.trim().length > 0) {
    return project.thumbnail;
  }

  const mediaAssets = project.mediaAssets ?? [];
  const firstVisualAsset = mediaAssets.find((asset) => asset.type === "video" || asset.type === "image") ?? mediaAssets[0];

  if (!firstVisualAsset) return undefined;
  if (firstVisualAsset.posterFrame) return firstVisualAsset.posterFrame;
  if (firstVisualAsset.coverArt) return firstVisualAsset.coverArt;
  if (firstVisualAsset.type === "image") return firstVisualAsset.path;

  return undefined;
}

/**
 * Capture a downscaled JPEG snapshot from an HTML Canvas element.
 *
 * Safe for WebGL/2D canvases with automatic boundary bounds checks and failure protection.
 */
export function captureCanvasThumbnail(
  canvas: HTMLCanvasElement | null,
  maxWidth = 640,
  quality = 0.85,
): string | undefined {
  try {
    if (!canvas || canvas.width === 0 || canvas.height === 0) return undefined;

    const scale = Math.min(1, maxWidth / canvas.width);
    const targetWidth = Math.max(1, Math.round(canvas.width * scale));
    const targetHeight = Math.max(1, Math.round(canvas.height * scale));

    const offscreen = document.createElement("canvas");
    offscreen.width = targetWidth;
    offscreen.height = targetHeight;

    const ctx = offscreen.getContext("2d");
    if (!ctx) return undefined;

    ctx.drawImage(canvas, 0, 0, targetWidth, targetHeight);
    return offscreen.toDataURL("image/jpeg", quality);
  } catch (_err) {
    return undefined;
  }
}

/**
 * Format duration seconds into professional editor timecode string.
 * Example: 45 -> "00:45", 125 -> "02:05", 3665 -> "01:01:05"
 */
export function formatEditorTimecode(durationSeconds?: number): string {
  if (durationSeconds === undefined || durationSeconds === null || isNaN(durationSeconds) || durationSeconds <= 0) {
    return "00:00";
  }

  const totalSecs = Math.floor(durationSeconds);
  const hours = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const seconds = totalSecs % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}
