import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { usePlaybackClock } from "@/hooks/usePlaybackClock";

interface TimelineRulerProps {
  pixelsPerSecond: number;
  scrollLeft: number;
}

/**
 * CapCut-style timeline ruler.
 *
 * Design principles:
 *   1. Labels never overlap — minimum ~80px between major labels
 *   2. Clean hierarchy: major ticks (tall + label) → minor ticks (short, no label)
 *   3. Labels use 00:00 format (zero-padded MM:SS)
 *   4. Ticks hang from the top of the ruler
 *   5. Smooth zoom transitions via a "nice number" interval table
 *
 * Zoom range follows SRP: 25–400 px/s
 */

// ── Interval table ──────────────────────────────────────────────────────
// [majorInterval in seconds, number of minor divisions between majors]
// The ruler picks the first entry where majorInterval × pps ≥ MIN_LABEL_GAP_PX.
const INTERVAL_TABLE: [number, number][] = [
  [60, 6], // 1min major, 10s minor
  [30, 6], // 30s major,  5s minor
  [15, 5], // 15s major,  3s minor
  [10, 5], // 10s major,  2s minor
  [5, 5], // 5s major,   1s minor
  [3, 3], // 3s major,   1s minor   ← CapCut uses this at ~27-50 pps
  [2, 4], // 2s major,   0.5s minor ← CapCut uses this at ~50-80 pps
  [1, 5], // 1s major,   0.2s minor (smallest — labels always whole seconds)
];

/** Minimum pixel gap between major (labelled) ticks */
const MIN_LABEL_GAP_PX = 80;

export const TimelineRuler: React.FC<TimelineRulerProps> = ({ pixelsPerSecond, scrollLeft }) => {
  const clockState = usePlaybackClock();
  const frameRate = clockState.frameRate;
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(1200);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setViewportWidth(el.clientWidth || 1200);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Format label (CapCut style: always 00:SS) ──────────────────────────────
  const formatLabel = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }, []);

  // ── Memoized tick generation ─────────────────────────────────────────────────
  const ticks = useMemo(() => {
    const validPPS = typeof pixelsPerSecond === "number" && !isNaN(pixelsPerSecond) && pixelsPerSecond > 0 ? pixelsPerSecond : 50;
    const validScrollLeft = typeof scrollLeft === "number" && !isNaN(scrollLeft) ? scrollLeft : 0;
    const validViewportWidth = typeof viewportWidth === "number" && !isNaN(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1200;

    // Pick best interval
    let majorInterval = INTERVAL_TABLE[INTERVAL_TABLE.length - 1][0];
    let minorDivisions = INTERVAL_TABLE[INTERVAL_TABLE.length - 1][1];

    // Iterate smallest → largest: pick the smallest interval that still
    // guarantees ≥ MIN_LABEL_GAP_PX between labels (no overlap).
    for (let i = INTERVAL_TABLE.length - 1; i >= 0; i--) {
      const [interval, divisions] = INTERVAL_TABLE[i];
      if (interval * validPPS >= MIN_LABEL_GAP_PX) {
        majorInterval = interval;
        minorDivisions = divisions;
        break;
      }
    }

    const minorInterval = majorInterval / minorDivisions;

    // Visible time range
    const padPx = 60;
    const startTime = Math.max(0, (validScrollLeft - padPx) / validPPS);
    const endTime = (validScrollLeft + validViewportWidth + padPx) / validPPS;

    // Generate ticks
    const result: { time: number; isMajor: boolean }[] = [];
    const firstTick = Math.floor(startTime / minorInterval) * minorInterval;

    if (minorInterval > 0 && !isNaN(minorInterval) && isFinite(startTime) && isFinite(endTime)) {
      let count = 0;
      for (let t = firstTick; t <= endTime && count < 2000; t += minorInterval) {
        const time = Math.round(t * 10000) / 10000;
        if (time < 0) continue;

        const isMajor = Math.abs(time % majorInterval) < minorInterval * 0.01 || Math.abs((time % majorInterval) - majorInterval) < minorInterval * 0.01;

        result.push({ time, isMajor });
        count++;
      }
    }

    return result;
  }, [pixelsPerSecond, scrollLeft, viewportWidth]);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="relative h-6 select-none overflow-hidden" style={{ background: "var(--color-timeline-ruler-bg)" }}>
      {ticks.map(({ time, isMajor }) => {
        const x = Math.round(time * pixelsPerSecond);
        return (
          <div
            key={time}
            style={{
              position: "absolute",
              left: x,
              top: 0,
            }}
          >
            {/* Tick line — hangs from top */}
            <div
              style={{
                width: 1,
                height: isMajor ? 10 : 5,
                backgroundColor: isMajor ? "var(--color-timeline-ruler-tick-major)" : "var(--color-timeline-ruler-tick-minor)",
              }}
            />
            {/* Label — CapCut places it right after the tick */}
            {isMajor && (
              <span
                style={{
                  position: "absolute",
                  top: 3,
                  left: 3,
                  fontSize: 10,
                  lineHeight: 1,
                  color: "var(--color-timeline-ruler-text)",
                  whiteSpace: "nowrap",
                  pointerEvents: "none",
                  userSelect: "none",
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: "0.02em",
                }}
              >
                {formatLabel(time)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};
