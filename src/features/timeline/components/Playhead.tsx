/**
 * Playhead Component for Timeline Engine v1
 */

import { useCallback, useRef } from "react";
import { useTimelineStore } from "../store/timelineStore";
import { CoordinateSystem } from "../utils/coordinateSystem";

interface PlayheadProps {
  /** Coordinate system for time-to-pixel conversion */
  coords: CoordinateSystem;
  /** Current horizontal scroll position */
  scrollLeft: number;
  /** Timeline duration in seconds */
  duration: number;
  /** Container ref for calculating click positions */
  containerRef: React.RefObject<HTMLDivElement>;
}

/**
 * Playhead component - renders vertical line with triangular handle
 * Positioned absolutely relative to viewport (not affected by scroll)
 */
export function Playhead({ coords, scrollLeft, duration, containerRef }: PlayheadProps) {
  const playhead = useTimelineStore((state) => state.playhead);
  const setPlayhead = useTimelineStore((state) => state.setPlayhead);
  const isDraggingRef = useRef(false);

  /**
   * Handle click on timeline to move playhead
   */
  const handleTimelineClick = useCallback(
    (clientX: number) => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      const time = coords.pixelsToTime(x);

      // Clamp to timeline boundaries
      const clampedTime = Math.max(0, Math.min(time, duration));
      setPlayhead(clampedTime);
    },
    [coords, duration, setPlayhead, containerRef],
  );

  /**
   * Handle drag on timeline to scrub playhead
   */
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return; // Only left click

      isDraggingRef.current = true;
      handleTimelineClick(e.clientX);

      const handleMove = (ev: PointerEvent) => {
        if (!isDraggingRef.current) return;
        handleTimelineClick(ev.clientX);
      };

      const handleUp = () => {
        isDraggingRef.current = false;
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [handleTimelineClick],
  );

  // Calculate playhead position in viewport coordinates
  const playheadPixels = coords.timeToPixels(playhead);
  const playheadViewportX = playheadPixels - scrollLeft;

  return (
    <>
      {/* Invisible click/drag area covering entire timeline */}
      <div className="absolute inset-0 z-30 cursor-crosshair" onPointerDown={handlePointerDown} aria-label="Timeline scrubber" />

      {/* Playhead visual - positioned absolutely relative to viewport */}
      <div
        className="pointer-events-none absolute bottom-0 top-0 z-40 flex -translate-x-1/2 justify-center overflow-visible"
        style={{
          left: playheadViewportX,
          filter: "drop-shadow(0 0 6px rgba(255,255,255,0.35))",
        }}
        aria-hidden
      >
        <div className="relative flex h-full w-[13px] shrink-0 flex-col items-center overflow-visible">
          <svg width="13" height="11" viewBox="0 0 13 11" className="shrink-0 text-white" aria-hidden>
            <path d="M6.5 0 L13 10.5 H0 Z" fill="currentColor" stroke="rgba(0,0,0,0.25)" strokeWidth="0.5" />
          </svg>

          <div
            className="mt-0 min-h-0 w-[2px] flex-1 rounded-full"
            style={{
              background: "linear-gradient(180deg, #ffffff 0%, rgba(255,255,255,0.82) 55%, rgba(255,255,255,0.55) 100%)",
              boxShadow: "0 0 8px rgba(255,255,255,0.25)",
            }}
          />
        </div>
      </div>
    </>
  );
}
