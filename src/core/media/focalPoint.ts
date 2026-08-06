import type { Size } from "./mediaFit";
import type { NormalizedCrop } from "./cropMath";

export interface FocalPoint {
  x: number; // 0..1
  y: number; // 0..1
}

/**
 * Calculates a NormalizedCrop based on a focal point and the target aspect ratio
 * under cover fit mode, ensuring the focal point is centered in the visible area.
 */
export function calculateCropFromFocalPoint(source: Size, target: Size, focalPoint: FocalPoint): NormalizedCrop {
  if (source.width <= 0 || source.height <= 0 || target.width <= 0 || target.height <= 0) {
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }

  const scaleX = target.width / source.width;
  const scaleY = target.height / source.height;
  const scale = Math.max(scaleX, scaleY);

  // The fraction of the source dimensions that are visible in the target frame
  const visibleWidthFraction = Math.min(1, target.width / (source.width * scale));
  const visibleHeightFraction = Math.min(1, target.height / (source.height * scale));

  // Clamp focal point to valid range [0, 1]
  const fx = Math.max(0, Math.min(1, focalPoint.x));
  const fy = Math.max(0, Math.min(1, focalPoint.y));

  // Center the visible window on the focal point
  let left = fx - visibleWidthFraction / 2;
  let top = fy - visibleHeightFraction / 2;

  // Clamp the window to stay within the source bounds [0, 1]
  left = Math.max(0, Math.min(left, 1 - visibleWidthFraction));
  top = Math.max(0, Math.min(top, 1 - visibleHeightFraction));

  const right = Math.max(0, 1 - left - visibleWidthFraction);
  const bottom = Math.max(0, 1 - top - visibleHeightFraction);

  return {
    left,
    top,
    right,
    bottom,
  };
}
