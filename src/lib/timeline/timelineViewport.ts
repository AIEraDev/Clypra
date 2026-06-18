import { getTimelineViewportEnd } from "./timelineClip";
import { TIMELINE_PPS_PER_ZOOM, clampTimelinePixelsPerSecond, clampTimelineZoom } from "./timelineZoom";

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
  const nextScrollLeft = input.anchorTime * input.nextPixelsPerSecond - input.localTimelineX;
  return clampTimelineScrollLeft(nextScrollLeft, input.containerWidth, input.viewportEndSeconds, input.nextPixelsPerSecond, input.hasClips);
}

export function getTimelineViewportEndForDuration(contentEndSeconds: number): number {
  return getTimelineViewportEnd(contentEndSeconds);
}
