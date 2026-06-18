import { DEFAULT_STILL_DURATION_SECONDS } from "../../constants/config";
import type { Clip, MediaAsset } from "../../types";
import { generateId } from "../utils/id";
import { DEFAULT_PLACEMENT_POLICY } from "./placementPolicy";

export const resolveClipDuration = (asset: MediaAsset): number => {
  if (asset.type === "image") return DEFAULT_STILL_DURATION_SECONDS;
  if (asset.duration > 0) return asset.duration;
  return DEFAULT_STILL_DURATION_SECONDS;
};

// Centralized timeline timing helpers

export function getClipVisibleDuration(clip: Pick<Clip, "trimIn" | "trimOut">): number {
  const trimIn = typeof clip.trimIn === "number" && !isNaN(clip.trimIn) ? clip.trimIn : 0;
  const trimOut = typeof clip.trimOut === "number" && !isNaN(clip.trimOut) ? clip.trimOut : 0;
  return Math.max(0, trimOut - trimIn);
}

export function normalizeClipTiming(clip: Clip, asset?: MediaAsset): Clip {
  const sourceDuration = asset ? resolveClipDuration(asset) : Infinity;
  const rawTrimIn = typeof clip.trimIn === "number" && !isNaN(clip.trimIn) ? clip.trimIn : 0;
  const rawTrimOut = typeof clip.trimOut === "number" && !isNaN(clip.trimOut) ? clip.trimOut : typeof clip.duration === "number" && !isNaN(clip.duration) ? clip.duration : 0;
  const rawStartTime = typeof clip.startTime === "number" && !isNaN(clip.startTime) ? clip.startTime : 0;

  // Ensure trim bounds are within source duration
  const trimIn = Math.max(0, Math.min(rawTrimIn, sourceDuration));
  const trimOut = Math.max(trimIn, Math.min(rawTrimOut, sourceDuration));

  // Calculate new duration
  const duration = Math.max(0, trimOut - trimIn);

  return {
    ...clip,
    startTime: rawStartTime,
    trimIn,
    trimOut,
    duration,
  };
}

export function getClipEndTime(clip: Pick<Clip, "startTime" | "trimIn" | "trimOut">): number {
  const visibleDuration = getClipVisibleDuration(clip);
  const startTime = typeof clip.startTime === "number" && !isNaN(clip.startTime) ? clip.startTime : 0;
  return startTime + visibleDuration;
}

export function getTimelineContentEnd(clips: Pick<Clip, "startTime" | "trimIn" | "trimOut">[]): number {
  if (!clips || clips.length === 0) return 0;
  const ends = clips.map(getClipEndTime).filter((val) => typeof val === "number" && !isNaN(val));
  return ends.length > 0 ? Math.max(...ends, 0) : 0;
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
  fitMode?: ClipFitModeExtended;
  /** Optional direct audio path for audio library items that bypass mediaAssets */
  audioPath?: string;
}

/**
 * Fit modes for clip placement in sequence space.
 * Mirrors professional NLE behavior (Premiere, Resolve, FCP).
 */
export type ClipFitMode = "contain" | "cover" | "stretch" | "original";
export type ClipFitModeExtended = ClipFitMode | "fill";

function getAssetBoundsForFit(asset: MediaAsset, fitMode: ClipFitModeExtended): { width: number; height: number } {
  const sourceWidth = asset.width ?? 0;
  const sourceHeight = asset.height ?? 0;
  const content = asset.contentBounds;

  // "fill" is perceptual-fit mode: use content bounds when available.
  if (fitMode === "fill" && content && content.width > 0 && content.height > 0) {
    return { width: content.width, height: content.height };
  }

  return { width: sourceWidth, height: sourceHeight };
}

/**
 * Calculate clip dimensions that preserve aspect ratio within canvas bounds.
 *
 * Professional behavior:
 * - "contain": Fit entire media inside canvas (letterbox/pillarbox if needed)
 * - "cover": Fill canvas completely (crop overflow)
 * - "stretch": Force to canvas dimensions (destructive, rarely used)
 * - "original": Use source dimensions 1:1 (may exceed canvas)
 *
 * Default is "cover" - common short-form editor behavior where media fills frame.
 */
export function calculateClipDimensions(asset: MediaAsset, canvasWidth: number, canvasHeight: number, fitMode: ClipFitModeExtended = "contain"): { x: number; y: number; width: number; height: number } {
  const bounds = getAssetBoundsForFit(asset, fitMode);
  const assetWidth = bounds.width || canvasWidth;
  const assetHeight = bounds.height || canvasHeight;

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

    case "cover":
    case "fill": {
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

export const createClipFromAsset = ({ asset, trackId, startTime, width, height, fitMode = DEFAULT_PLACEMENT_POLICY.defaultVisualFitMode, audioPath }: CreateClipFromAssetParams): Clip => {
  const duration = resolveClipDuration(asset);

  // Calculate dimensions that preserve aspect ratio.
  // Default fit mode is centralized in placement policy.
  const { x, y, width: clipWidth, height: clipHeight } = calculateClipDimensions(asset, width, height, fitMode);

  // Calculate source aspect ratio for transform constraints
  const sourceAspectRatio = asset.type !== "audio" && asset.width && asset.height ? asset.width / asset.height : clipWidth / clipHeight;

  const isSticker = asset.id.startsWith("sticker-");
  const kind = (isSticker ? "sticker" : asset.type) as Clip["kind"];

  return {
    id: generateId("clip"),
    kind,
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
    fitMode: fitMode as Clip["fitMode"],
    ...(asset.type !== "audio" && {
      stickerFormat: asset.stickerFormat,
      stickerAnimationPath: asset.stickerAnimationPath,
      stickerSourceId: asset.stickerSourceId,
    }),
    ...(audioPath && asset.type === "audio" && { audioPath }), // Include audioPath for audio clips
  } as any;
};
