import { getTimelineViewportEnd, getTimelineCanvasDuration, TIMELINE_MIN_CANVAS_DURATION_SECONDS, TIMELINE_CANVAS_PADDING_SECONDS } from "./timelineClip";
import { TIMELINE_PPS_PER_ZOOM, clampTimelinePixelsPerSecond, clampTimelineZoom } from "./timelineZoom";

export { getTimelineCanvasDuration, TIMELINE_MIN_CANVAS_DURATION_SECONDS, TIMELINE_CANVAS_PADDING_SECONDS };

export const TIMELINE_TRACK_LABEL_WIDTH_PX = 160;

export function getTimelineLabelColumnWidth(hasClips: boolean): number {
  return hasClips ? TIMELINE_TRACK_LABEL_WIDTH_PX : 0;
}

export function getTimelineLaneWidth(containerWidth: number, hasClips: boolean): number {
  return Math.max(1, containerWidth - getTimelineLabelColumnWidth(hasClips));
}

export function getTimelineLaneClientX(clientX: number, containerLeft: number, hasClips: boolean): number {
  return Math.max(0, clientX - containerLeft - getTimelineLabelColumnWidth(hasClips));
}

export function getTimelineScrollContentWidth(viewportEndSeconds: number, pixelsPerSecond: number, hasClips: boolean): number {
  return getTimelineLabelColumnWidth(hasClips) + Math.round(viewportEndSeconds * pixelsPerSecond);
}

export function getTimelineMaxScrollLeft(containerWidth: number, viewportEndSeconds: number, pixelsPerSecond: number, hasClips: boolean): number {
  return Math.max(0, getTimelineScrollContentWidth(viewportEndSeconds, pixelsPerSecond, hasClips) - containerWidth);
}

export function clampTimelineScrollLeft(scrollLeft: number, containerWidth: number, viewportEndSeconds: number, pixelsPerSecond: number, hasClips: boolean): number {
  const maxScrollLeft = getTimelineMaxScrollLeft(containerWidth, viewportEndSeconds, pixelsPerSecond, hasClips);
  return Math.max(0, Math.min(scrollLeft, maxScrollLeft));
}

export function zoomToPixelsPerSecond(zoomLevel: number): number {
  return clampTimelinePixelsPerSecond(TIMELINE_PPS_PER_ZOOM * clampTimelineZoom(zoomLevel));
}

export function getAnchoredZoomScrollLeft(input: {
  anchorTime: number;
  localTimelineX: number;
  containerWidth: number;
  viewportEndSeconds: number;
  nextPixelsPerSecond: number;
  hasClips: boolean;
}): number {
  // Use timeToPixel so the anchor pixel is consistent with clip/playhead rendering.
  const nextScrollLeft = timeToPixel(input.anchorTime, input.nextPixelsPerSecond) - input.localTimelineX;
  return clampTimelineScrollLeft(nextScrollLeft, input.containerWidth, input.viewportEndSeconds, input.nextPixelsPerSecond, input.hasClips);
}

export function getTimelineViewportEndForDuration(contentEndSeconds: number): number {
  return getTimelineViewportEnd(contentEndSeconds);
}

/**
 * Canonical helper for converting time in seconds to timeline pixel offset.
 * Ensures consistent pixel rounding across Ruler, Clips, Playhead, and Gaps.
 */
export function timeToPixel(timeInSeconds: number, pixelsPerSecond: number): number {
  const validPPS = typeof pixelsPerSecond === "number" && !isNaN(pixelsPerSecond) && pixelsPerSecond > 0 ? pixelsPerSecond : 50;
  const validTime = typeof timeInSeconds === "number" && !isNaN(timeInSeconds) ? timeInSeconds : 0;
  return Math.round(validTime * validPPS);
}

/**
 * Canonical inverse of timeToPixel. Converts a pixel offset back to seconds.
 * All pixel→time conversions in the timeline must go through this function
 * so that the reverse path is consistently defined alongside the forward path.
 */
export function pixelToTime(pixelOffset: number, pixelsPerSecond: number): number {
  const validPPS = typeof pixelsPerSecond === "number" && !isNaN(pixelsPerSecond) && pixelsPerSecond > 0 ? pixelsPerSecond : 50;
  const validPixel = typeof pixelOffset === "number" && !isNaN(pixelOffset) ? pixelOffset : 0;
  return validPixel / validPPS;
}

/** Compute the density needed to show the entire sequence in the usable lane. */
export function getFitSequencePixelsPerSecond(containerWidth: number, duration: number, hasClips: boolean): number {
  if (duration <= 0) return zoomToPixelsPerSecond(1);
  return clampTimelinePixelsPerSecond(getTimelineLaneWidth(containerWidth, hasClips) / duration);
}

/** Return the smallest scroll adjustment that reveals an edit point with context. */
export function getScrollLeftToRevealTime(input: {
  time: number;
  currentScrollLeft: number;
  containerWidth: number;
  pixelsPerSecond: number;
  viewportEndSeconds: number;
  hasClips: boolean;
  insetRatio?: number;
}): number {
  const laneWidth = getTimelineLaneWidth(input.containerWidth, input.hasClips);
  const inset = laneWidth * (input.insetRatio ?? 0.15);
  // Use timeToPixel so the edit-point pixel is consistent with how clips are rendered.
  const editPointPixels = timeToPixel(input.time, input.pixelsPerSecond);
  const visibleLeft = input.currentScrollLeft + inset;
  const visibleRight = input.currentScrollLeft + laneWidth - inset;
  let next = input.currentScrollLeft;
  if (editPointPixels < visibleLeft) next = editPointPixels - inset;
  if (editPointPixels > visibleRight) next = editPointPixels - laneWidth + inset;
  return clampTimelineScrollLeft(next, input.containerWidth, input.viewportEndSeconds, input.pixelsPerSecond, input.hasClips);
}

