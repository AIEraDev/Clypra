/**
 * TimeRuler Component for Timeline Engine v1
 * Displays time markers, tick marks, and frame indicators
 */

import { useMemo, memo } from "react";
import { COLORS } from "../../../constants/colors";
import { formatTime } from "../utils/timeFormat";
import { VIDEO_CONFIG } from "../../../constants/config";

interface TimeRulerProps {
  duration: number;
  pxPerSec: number;
  fps?: number;
}

/**
 * TimeRuler component renders the horizontal time scale at the top of the timeline
 * with major ticks, subdivision ticks, and frame indicators based on zoom level
 * Memoized for performance with large timelines
 */
export const TimeRuler = memo(function TimeRuler({ duration, pxPerSec, fps = VIDEO_CONFIG.FPS }: TimeRulerProps) {
  /**
   * Calculate major tick interval based on zoom level
   */
  const majorTickInterval = useMemo(() => {
    if (pxPerSec >= 100) return 1;
    if (pxPerSec >= 48) return 2;
    if (pxPerSec >= 24) return 5;
    return 10;
  }, [pxPerSec]);

  /**
   * Generate major tick times
   */
  const majorTicks = useMemo(() => {
    if (duration <= 0) return [];
    const ticks: number[] = [];
    for (let t = 0; t <= duration + 0.001; t += majorTickInterval) {
      ticks.push(t);
    }
    return ticks;
  }, [duration, majorTickInterval]);

  /**
   * Generate tenth-second subdivision ticks
   * Only visible when zoom >= 26 px/sec
   */
  const tenthSecondTicks = useMemo(() => {
    if (duration <= 0 || pxPerSec < 26) return [];
    const ticks: number[] = [];
    for (let s = 0; s <= Math.floor(duration + 1e-6); s++) {
      for (let i = 1; i <= 9; i++) {
        const t = s + i * 0.1;
        if (t >= duration - 1e-9) break;
        ticks.push(t);
      }
    }
    return ticks;
  }, [duration, pxPerSec]);

  /**
   * Generate frame tick marks with labels
   * Only visible when zoom >= 70 px/sec AND px/frame >= 11
   * Uses 2-frame or 4-frame intervals
   */
  const frameTicks = useMemo(() => {
    if (duration <= 0 || pxPerSec < 70) return [];

    const pxPerFrame = pxPerSec / fps;
    if (pxPerFrame < 11) return [];

    // Use 2-frame interval if px/frame >= 20, otherwise 4-frame
    const frameInterval = pxPerFrame >= 20 ? 2 : 4;

    const ticks: Array<{ time: number; label: string }> = [];
    for (let s = 0; s <= Math.floor(duration); s++) {
      for (let f = frameInterval; f < fps; f += frameInterval) {
        const t = s + f / fps;
        if (t >= duration - 1e-9) break;
        ticks.push({ time: t, label: `${f}f` });
      }
    }
    return ticks;
  }, [duration, pxPerSec, fps]);

  /**
   * Calculate tick height based on zoom level
   * Taller ticks at higher zoom for better visibility
   */
  const tenthTickHeight = useMemo(() => {
    return pxPerSec >= 48 ? 7 : 5;
  }, [pxPerSec]);

  /**
   * Memoize time labels to avoid recalculating formatTime on every render
   */
  const timeLabels = useMemo(() => {
    return majorTicks.map((t) => ({
      time: t,
      label: formatTime(t),
      position: t * pxPerSec,
    }));
  }, [majorTicks, pxPerSec]);

  return (
    <div className="sticky top-0 z-30 h-[26px] shrink-0 border-b" style={{ borderColor: COLORS.BORDER, backgroundColor: COLORS.BG }} role="row" aria-label="Time ruler">
      <div className="relative h-full select-none" role="rowheader">
        {/* Tenth-second subdivision ticks */}
        {tenthSecondTicks.map((t) => (
          <div
            key={`tenth-${t.toFixed(4)}`}
            className="absolute bottom-0 w-px bg-zinc-700/55"
            style={{
              left: t * pxPerSec,
              height: tenthTickHeight,
            }}
            aria-hidden="true"
          />
        ))}

        {/* Major tick marks (vertical lines) */}
        {majorTicks.map((t) => (
          <div key={`major-${t}`} className="absolute bottom-0 top-0 w-px bg-zinc-600/90" style={{ left: t * pxPerSec }} aria-hidden="true" />
        ))}

        {/* Frame tick marks with labels */}
        {frameTicks.map(({ time, label }) => (
          <div key={`frame-${time}`} className="absolute bottom-0 flex flex-col items-center" style={{ left: time * pxPerSec, transform: "translateX(-50%)" }} aria-hidden="true">
            <span className="mb-0.5 font-mono text-[9px] tabular-nums leading-none text-zinc-500">{label}</span>
            <div className="h-2 w-px bg-zinc-600/70" />
          </div>
        ))}

        {/* Time labels at major ticks */}
        {timeLabels.map(({ time, label, position }) => (
          <div key={`label-${time}`} className="absolute top-0.5 flex flex-col justify-start text-[10px] font-medium text-zinc-400" style={{ left: position, transform: "translateX(2px)" }} role="columnheader" aria-label={`Time marker at ${label}`}>
            <span className="font-mono tabular-nums tracking-tight">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
});
