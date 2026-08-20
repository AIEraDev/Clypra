/**
 * Aspect Ratio Utility
 *
 * Shared aspect ratio calculation logic for the native preview viewport.
 * This is the proven implementation from Transition Lab Console that handles
 * all video dimensions perfectly (16:9, 9:16, 4:3, 1:1, etc.)
 *
 * Preserves the editor's established media-fit behavior.
 */

export type FitMode = "stretch" | "fit" | "cover";

export interface AspectRatioLayout {
  width: number;
  height: number;
  x: number;
  y: number;
  scale: number;
}

/**
 * Calculate sprite dimensions and position for aspect ratio handling
 *
 * This is the established logic that makes Transition Lab Console
 * work perfectly with any video dimension.
 *
 * @param containerWidth - Canvas/container width (logical pixels)
 * @param containerHeight - Canvas/container height (logical pixels)
 * @param sourceWidth - Video/image width (actual pixels)
 * @param sourceHeight - Video/image height (actual pixels)
 * @param mode - Fit mode: "stretch" | "fit" | "cover"
 *
 * @returns Layout with width, height, x, y, and scale factor
 *
 * @example
 * // 9:16 vertical video in 16:9 canvas (should pillarbox)
 * const layout = calculateAspectRatio(1920, 1080, 1080, 1920, "fit");
 * // Result: { width: 607.5, height: 1080, x: 656.25, y: 0, scale: 0.5625 }
 *
 * @example
 * // 16:9 horizontal video in 9:16 canvas (should letterbox)
 * const layout = calculateAspectRatio(1080, 1920, 1920, 1080, "fit");
 * // Result: { width: 1080, height: 607.5, x: 0, y: 656.25, scale: 0.5625 }
 */
export function calculateAspectRatio(containerWidth: number, containerHeight: number, sourceWidth: number, sourceHeight: number, mode: FitMode = "fit"): AspectRatioLayout {
  // Handle edge cases
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return {
      width: containerWidth,
      height: containerHeight,
      x: 0,
      y: 0,
      scale: 1,
    };
  }

  // Stretch mode: fill container completely, allow distortion
  if (mode === "stretch") {
    return {
      width: containerWidth,
      height: containerHeight,
      x: 0,
      y: 0,
      scale: Math.min(containerWidth / sourceWidth, containerHeight / sourceHeight),
    };
  }

  // Calculate scale factors for both dimensions
  const scaleX = containerWidth / sourceWidth;
  const scaleY = containerHeight / sourceHeight;

  // "fit" = show full content (letterbox/pillarbox if needed)
  // "cover" = fill canvas completely (crop edges if needed)
  const scale = mode === "fit" ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);

  // Calculate scaled dimensions
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  // Center the content in the container
  const x = (containerWidth - width) / 2;
  const y = (containerHeight - height) / 2;

  return { width, height, x, y, scale };
}

/**
 * Get element dimensions from video/image/canvas element
 *
 * Computes source element dimensions for native layout.
 * Handles all media element types and falls back gracefully
 */
export function getElementDimensions(element: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageBitmap): {
  width: number;
  height: number;
} {
  // ImageBitmap
  if (element instanceof ImageBitmap) {
    return { width: element.width, height: element.height };
  }

  const el = element as any;

  // Video element
  if (el.videoWidth !== undefined && el.videoWidth > 0) {
    return { width: el.videoWidth, height: el.videoHeight };
  }

  // Image element
  if (el.naturalWidth !== undefined && el.naturalWidth > 0) {
    return { width: el.naturalWidth, height: el.naturalHeight };
  }

  // Canvas element
  if (el.width !== undefined && el.width > 0) {
    return { width: el.width, height: el.height };
  }

  // Fallback to 16:9 HD
  console.warn("[aspectRatio] Could not determine element dimensions, using fallback");
  return { width: 1920, height: 1080 };
}
