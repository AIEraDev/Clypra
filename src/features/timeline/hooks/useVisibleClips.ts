/**
 * Clip Virtualization Hook for Timeline Engine v1
 * Calculates visible clips based on viewport and scroll position
 */

import { useMemo } from "react";
import type { Clip } from "../types/core";
import { CoordinateSystem } from "../utils/coordinateSystem";

/**
 * Hook to calculate which clips are visible in the current viewport
 * Uses a 2-second buffer for smooth scrolling
 *
 *
 * @param clips - All clips in the timeline
 * @param scrollLeft - Current horizontal scroll position in pixels
 * @param viewportWidth - Width of the visible viewport in pixels
 * @param pxPerSec - Current zoom level (pixels per second)
 * @returns Array of clips that should be rendered
 */
export function useVisibleClips(clips: Clip[], scrollLeft: number, viewportWidth: number, pxPerSec: number): Clip[] {
  return useMemo(() => {
    const coords = new CoordinateSystem(pxPerSec);

    // Calculate visible time range
    const startTime = coords.pixelsToTime(scrollLeft);
    const endTime = coords.pixelsToTime(scrollLeft + viewportWidth);

    const buffer = 2; // seconds

    // Filter clips that intersect with the visible range (plus buffer)
    return clips.filter((clip) => {
      const clipEnd = clip.startTime + clip.duration;
      return clipEnd >= startTime - buffer && clip.startTime <= endTime + buffer;
    });
  }, [clips, scrollLeft, viewportWidth, pxPerSec]);
}
