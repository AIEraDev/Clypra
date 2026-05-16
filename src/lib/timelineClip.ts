import { DEFAULT_STILL_DURATION_SECONDS } from "../constants/config";
import type { Clip, MediaAsset } from "../types";
import { generateId } from "./id";

export const resolveClipDuration = (asset: MediaAsset): number => {
  if (asset.type === "image") return DEFAULT_STILL_DURATION_SECONDS;
  if (asset.duration > 0) return asset.duration;
  return DEFAULT_STILL_DURATION_SECONDS;
};

// Centralized timeline timing helpers

export function getClipVisibleDuration(clip: Pick<Clip, "trimIn" | "trimOut">): number {
  return Math.max(0, clip.trimOut - clip.trimIn);
}

export function normalizeClipTiming(clip: Clip, asset?: MediaAsset): Clip {
  const sourceDuration = asset ? resolveClipDuration(asset) : Infinity;
  // Ensure trim bounds are within source duration
  const trimIn = Math.max(0, Math.min(clip.trimIn, sourceDuration));
  const trimOut = Math.max(trimIn, Math.min(clip.trimOut, sourceDuration));

  // Calculate new duration
  const duration = Math.max(0, trimOut - trimIn);

  return {
    ...clip,
    trimIn,
    trimOut,
    duration,
  };
}

export function getClipEndTime(clip: Pick<Clip, "startTime" | "trimIn" | "trimOut">): number {
  return clip.startTime + getClipVisibleDuration(clip);
}

export function getTimelineContentEnd(clips: Pick<Clip, "startTime" | "trimIn" | "trimOut">[]): number {
  if (!clips || clips.length === 0) return 0;
  return Math.max(...clips.map(getClipEndTime), 0);
}

export function getTimelineViewportEnd(contentEnd: number): number {
  return Math.max(contentEnd, 10);
}

interface CreateClipFromAssetParams {
  asset: MediaAsset;
  trackId: string;
  startTime: number;
  width: number;
  height: number;
}

/**
 * Fit modes for clip placement in sequence space.
 * Mirrors professional NLE behavior (Premiere, Resolve, FCP).
 */
export type ClipFitMode = "contain" | "cover" | "stretch" | "original";

/**
 * Calculate clip dimensions that preserve aspect ratio within canvas bounds.
 *
 * Professional behavior:
 * - "contain": Fit entire media inside canvas (letterbox/pillarbox if needed)
 * - "cover": Fill canvas completely (crop overflow)
 * - "stretch": Force to canvas dimensions (destructive, rarely used)
 * - "original": Use source dimensions 1:1 (may exceed canvas)
 *
 * Default is "contain" - the professional standard for non-destructive editing.
 */
function calculateClipDimensions(asset: MediaAsset, canvasWidth: number, canvasHeight: number, fitMode: ClipFitMode = "contain"): { x: number; y: number; width: number; height: number } {
  const assetWidth = asset.width ?? canvasWidth;
  const assetHeight = asset.height ?? canvasHeight;

  // Fallback for assets without dimensions
  if (assetWidth <= 0 || assetHeight <= 0) {
    return { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
  }

  const assetAspect = assetWidth / assetHeight;
  const canvasAspect = canvasWidth / canvasHeight;

  let width: number;
  let height: number;

  switch (fitMode) {
    case "contain": {
      // Fit inside canvas, preserve aspect ratio (professional default)
      if (assetAspect > canvasAspect) {
        // Asset is wider - fit to width
        width = canvasWidth;
        height = canvasWidth / assetAspect;
      } else {
        // Asset is taller - fit to height
        height = canvasHeight;
        width = canvasHeight * assetAspect;
      }
      break;
    }

    case "cover": {
      // Fill canvas completely, preserve aspect ratio, crop overflow
      if (assetAspect > canvasAspect) {
        // Asset is wider - fit to height, crop width
        height = canvasHeight;
        width = canvasHeight * assetAspect;
      } else {
        // Asset is taller - fit to width, crop height
        width = canvasWidth;
        height = canvasWidth / assetAspect;
      }
      break;
    }

    case "stretch": {
      // Force to canvas dimensions (destructive)
      width = canvasWidth;
      height = canvasHeight;
      break;
    }

    case "original": {
      // Use source dimensions 1:1
      width = assetWidth;
      height = assetHeight;
      break;
    }
  }

  // Center in canvas
  const x = (canvasWidth - width) / 2;
  const y = (canvasHeight - height) / 2;

  return { x, y, width, height };
}

export const createClipFromAsset = ({ asset, trackId, startTime, width, height }: CreateClipFromAssetParams): Clip => {
  const duration = resolveClipDuration(asset);

  // Calculate dimensions that preserve aspect ratio (professional behavior)
  // Default to "cover" - media fills the project frame, user adjusts transform if needed
  const {
    x,
    y,
    width: clipWidth,
    height: clipHeight,
  } = calculateClipDimensions(
    asset,
    width,
    height,
    "contain", // Professional default: fill canvas, crop overflow
  );

  // Calculate source aspect ratio for transform constraints
  const sourceAspectRatio = asset.width && asset.height ? asset.width / asset.height : clipWidth / clipHeight;

  return {
    id: generateId("clip"),
    trackId,
    mediaId: asset.id,
    startTime,
    duration,
    trimIn: 0,
    trimOut: duration,
    x,
    y,
    width: clipWidth,
    height: clipHeight,
    opacity: 1,
    rotation: 0,
    aspectRatioLocked: true, // Lock aspect ratio by default for video/images
    sourceAspectRatio,
  };
};
