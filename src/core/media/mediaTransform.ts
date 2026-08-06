import { calculateMediaFit, type Size, type MediaFitMode } from "./mediaFit";
import { getSourceCropRect, calculateDefaultCoverCrop, type NormalizedCrop } from "./cropMath";
import { calculateCropFromFocalPoint, type FocalPoint } from "./focalPoint";

export interface MediaLayout {
  fit: MediaFitMode;
  focalPoint: FocalPoint;
  transform: {
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
  };
  crop?: NormalizedCrop;
}

export interface ResolvedMediaLayout {
  fit: MediaFitMode;
  focalPoint: FocalPoint;
  sourceRect: { x: number; y: number; width: number; height: number };
  width: number; // base fit width in project coordinates
  height: number; // base fit height in project coordinates
  x: number; // center X in project coordinates
  y: number; // center Y in project coordinates
  scaleX: number; // composite scale X (fit scale * manual scale)
  scaleY: number; // composite scale Y (fit scale * manual scale)
  rotation: number; // composite rotation in degrees
}

/**
 * Resolves the visual placement layout parameters for a media clip
 * within a project frame coordinate system.
 */
export function resolveMediaLayout(params: { sourceSize: Size; projectFrame: Size; layout?: MediaLayout }): ResolvedMediaLayout {
  const { sourceSize, projectFrame, layout } = params;

  // 1. Fallback / Default Layout Configuration
  const fit = layout?.fit ?? "cover";
  const focalPoint = layout?.focalPoint ?? { x: 0.5, y: 0.5 };
  const transform = layout?.transform ?? {
    x: projectFrame.width / 2,
    y: projectFrame.height / 2,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };

  // 2. Resolve Crop. If cover fit mode is active and no crop is provided,
  // we calculate a default crop centered on the focal point.
  let crop = layout?.crop;
  if (!crop && fit === "cover") {
    crop = calculateCropFromFocalPoint(sourceSize, projectFrame, focalPoint);
  }

  // 3. Resolve the cropped source dimensions (absolute pixels)
  const sourceRect = getSourceCropRect(sourceSize, crop);

  // 4. Calculate how the cropped source fits into the project frame target
  const fitResult = calculateMediaFit({ width: sourceRect.width, height: sourceRect.height }, projectFrame, fit);

  // 5. Compose the final layout transformation
  const scaleX = fitResult.scaleX * transform.scaleX;
  const scaleY = fitResult.scaleY * transform.scaleY;
  const rotation = transform.rotation;

  return {
    fit,
    focalPoint,
    sourceRect,
    width: sourceRect.width * fitResult.scaleX,
    height: sourceRect.height * fitResult.scaleY,
    x: transform.x,
    y: transform.y,
    scaleX,
    scaleY,
    rotation,
  };
}

/**
 * Derives a MediaLayout representation dynamically from a clip's current
 * positioning, rotation, and legacy fitMode values.
 */
export function getClipLayout(
  clip: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    fitMode?: any;
    layout?: any;
  },
  sourceSize: Size,
  projectFrame: Size,
): MediaLayout {
  const fitMode = clip.fitMode ?? "cover";
  const fitModeClean = fitMode === "fill" ? "cover" : fitMode;

  const fitResult = calculateMediaFit(
    sourceSize,
    projectFrame,
    fitModeClean
  );

  const fitW = fitResult.width || projectFrame.width || 1;
  const fitH = fitResult.height || projectFrame.height || 1;

  return {
    fit: fitModeClean,
    focalPoint: clip.layout?.focalPoint ?? { x: 0.5, y: 0.5 },
    transform: {
      x: clip.x + clip.width / 2,
      y: clip.y + clip.height / 2,
      scaleX: clip.width / fitW,
      scaleY: clip.height / fitH,
      rotation: clip.rotation,
    },
    crop: clip.layout?.crop,
  };
}
