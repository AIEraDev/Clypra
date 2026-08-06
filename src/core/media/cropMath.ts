import type { Size } from "./mediaFit";

export interface NormalizedCrop {
  left: number; // 0..1
  top: number; // 0..1
  right: number; // 0..1
  bottom: number; // 0..1
}

/**
 * Calculates the default normalized crop bounds for cover fit mode.
 * Cover mode scales the media to fully cover the target, cropping the overflow.
 * By default, this overflow is cropped equally from both sides (centered).
 */
export function calculateDefaultCoverCrop(source: Size, target: Size): NormalizedCrop {
  if (source.width <= 0 || source.height <= 0 || target.width <= 0 || target.height <= 0) {
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }

  const scaleX = target.width / source.width;
  const scaleY = target.height / source.height;
  const scale = Math.max(scaleX, scaleY);

  // The fraction of the source dimensions that are visible in the target frame
  const visibleWidthFraction = Math.min(1, target.width / (source.width * scale));
  const visibleHeightFraction = Math.min(1, target.height / (source.height * scale));

  // The cropped (invisible) fraction of source dimensions
  const cropX = 1 - visibleWidthFraction;
  const cropY = 1 - visibleHeightFraction;

  return {
    left: cropX / 2,
    top: cropY / 2,
    right: cropX / 2,
    bottom: cropY / 2,
  };
}

/**
 * Converts normalized crop coordinates (0..1) to absolute source pixel coordinates.
 */
export function getSourceCropRect(source: Size, crop?: NormalizedCrop): { x: number; y: number; width: number; height: number } {
  if (!crop) {
    return { x: 0, y: 0, width: source.width, height: source.height };
  }

  const left = Math.max(0, Math.min(1, crop.left));
  const top = Math.max(0, Math.min(1, crop.top));
  const right = Math.max(0, Math.min(1, crop.right));
  const bottom = Math.max(0, Math.min(1, crop.bottom));

  // Guard against over-cropping (where remaining dimensions become negative or zero)
  if (left + right >= 1 || top + bottom >= 1) {
    return { x: 0, y: 0, width: source.width, height: source.height };
  }

  const x = left * source.width;
  const y = top * source.height;
  const width = (1 - left - right) * source.width;
  const height = (1 - top - bottom) * source.height;

  return { x, y, width, height };
}

/**
 * Rotates normalized crop coordinates to match the raw source orientation
 * based on container metadata rotation (90, 180, 270 degrees).
 */
export function rotateCrop(crop: NormalizedCrop, rotation?: number): NormalizedCrop {
  if (!rotation || rotation === 0) return crop;
  const rot = (rotation + 360) % 360;
  if (rot === 90) {
    return {
      left: crop.bottom,
      top: crop.left,
      right: crop.top,
      bottom: crop.right,
    };
  }
  if (rot === 180) {
    return {
      left: crop.right,
      top: crop.bottom,
      right: crop.left,
      bottom: crop.top,
    };
  }
  if (rot === 270) {
    return {
      left: crop.top,
      top: crop.right,
      right: crop.bottom,
      bottom: crop.left,
    };
  }
  return crop;
}
