/**
 * Hook for memoizing clip position calculations
 *
 * Memoizes expensive clip position calculations to avoid recalculating
 * on every render when zoom level or clip data hasn't changed.
 */

import { useMemo } from "react";
import type { Clip } from "../types/core";
import { CoordinateSystem } from "../utils/coordinateSystem";

export interface ClipPosition {
  x: number;
  width: number;
}

/**
 * Memoizes clip position calculations based on zoom level
 *
 * @param clips - Array of clips to calculate positions for
 * @param pxPerSec - Current zoom level (pixels per second)
 * @returns Map of clip IDs to their calculated positions
 */
export function useClipPositions(clips: Clip[], pxPerSec: number): Map<string, ClipPosition> {
  return useMemo(() => {
    const coords = new CoordinateSystem(pxPerSec);
    const positions = new Map<string, ClipPosition>();

    for (const clip of clips) {
      positions.set(clip.id, {
        x: coords.timeToPixels(clip.startTime),
        width: Math.max(8, coords.timeToPixels(clip.duration)), // Minimum 8 pixels
      });
    }

    return positions;
  }, [clips, pxPerSec]);
}
