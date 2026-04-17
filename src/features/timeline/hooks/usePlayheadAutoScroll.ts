/**
 * Auto-scroll hook for playhead
 */

import { useEffect } from "react";
import { CoordinateSystem } from "../utils/coordinateSystem";

interface UsePlayheadAutoScrollOptions {
  /** Current playhead time in seconds */
  playhead: number;
  /** Coordinate system for time-to-pixel conversion */
  coords: CoordinateSystem;
  /** Scroll container ref */
  scrollRef: React.RefObject<HTMLDivElement>;
  /** Timeline duration in seconds */
  duration: number;
  /** Margin percentage from viewport edges (default: 0.15 for 15%) */
  marginPercent?: number;
}

/**
 * Auto-scroll viewport when playhead moves outside visible area
 * Maintains 15% margin from viewport edges
 */
export function usePlayheadAutoScroll({ playhead, coords, scrollRef, duration, marginPercent = 0.15 }: UsePlayheadAutoScrollOptions): void {
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || duration <= 0) return;

    // Calculate playhead position in pixels
    const playheadX = coords.timeToPixels(playhead);

    // Get viewport dimensions
    const viewportWidth = el.clientWidth;
    const currentScrollLeft = el.scrollLeft;

    // Calculate margin in pixels
    const margin = viewportWidth * marginPercent;

    // Check if playhead is outside visible area with margin
    const leftBoundary = currentScrollLeft + margin;
    const rightBoundary = currentScrollLeft + viewportWidth - margin;

    if (playheadX < leftBoundary || playheadX > rightBoundary) {
      // Center playhead in viewport
      const targetScrollLeft = playheadX - viewportWidth / 2;

      // Clamp to valid scroll range
      const maxScroll = Math.max(0, el.scrollWidth - viewportWidth);
      const clampedScrollLeft = Math.max(0, Math.min(targetScrollLeft, maxScroll));

      el.scrollLeft = clampedScrollLeft;
    }
  }, [playhead, coords, scrollRef, duration, marginPercent]);
}
