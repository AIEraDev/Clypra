/**
 * SpeedSliderTrack.tsx
 *
 * Specialized slider track for speed control with visual tick marks
 * spanning the full 0.10x–100.00x range.
 *
 * Six ticks are rendered: one at each end and four equally spaced between
 * them (step = (max − min) / 5). Each tick is also a magnetic snap target so
 * dragging the thumb near one locks to it exactly.
 *
 * Snap state is surfaced via the optional `onSnapChange` callback, mirroring
 * the same pattern used by SliderTrack.
 */

import React, { useCallback, useRef, useState, useEffect } from "react";

export interface SpeedSliderTrackProps {
  /** Current speed value */
  value: number;
  /** Minimum speed */
  min: number;
  /** Maximum speed */
  max: number;
  /** Callback when speed changes */
  onChange: (value: number) => void;
  /** Step increment (default: 0.01) */
  step?: number;
  /** Disabled state */
  disabled?: boolean;
  /**
   * Called during drag whenever the snap state transitions — true when the
   * thumb is locked to a tick, false when it releases.
   */
  onSnapChange?: (snapped: boolean) => void;

  className?: string;
}

/** Snap threshold in speed units — symmetric band around each tick value. */
const SNAP_THRESHOLD = 0.5;

/**
 * Build the six tick values for a given [min, max] range:
 *   tick[i] = min + i * (max - min) / 5   for i = 0 … 5
 * The first tick lands on min and the last on max.
 */
function buildTicks(min: number, max: number): number[] {
  const step = (max - min) / 5;
  return Array.from({ length: 6 }, (_, i) =>
    parseFloat((min + i * step).toFixed(2)),
  );
}

export const SpeedSliderTrack: React.FC<SpeedSliderTrackProps> = ({
  value,
  min,
  max,
  onChange,
  step = 0.01,
  disabled = false,
  onSnapChange,
  className,
}) => {
  const decimals = step < 1 ? Math.max(1, -Math.floor(Math.log10(step))) : 0;

  const clamp = useCallback(
    (v: number) => Math.max(min, Math.min(max, +v.toFixed(decimals))),
    [min, max, decimals],
  );

  // ── Tick positions ────────────────────────────────────────────────────────
  const range = max - min;
  const ticks = buildTicks(min, max);

  // ── Track fill ────────────────────────────────────────────────────────────
  const fillPercent =
    range > 0 ? Math.min(100, Math.max(0, ((value - min) / range) * 100)) : 0;

  // ── Drag handling ─────────────────────────────────────────────────────────
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  /** Index of the currently-snapped tick, or -1 when not snapping. */
  const [snappedTickIndex, setSnappedTickIndex] = useState<number>(-1);
  /** Ref mirror so handleDrag closure can compare without a stale value. */
  const snappedTickRef = useRef<number>(-1);
  /** Tracks overall snap state for onSnapChange transitions. */
  const isSnappedRef = useRef<boolean>(false);

  const handleDrag = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const percent = Math.max(
        0,
        Math.min(1, (clientX - rect.left) / rect.width),
      );
      let newValue = min + percent * range;

      // ── Snap-point evaluation ───────────────────────────────────────────
      let snappedIdx = -1;
      for (let i = 0; i < ticks.length; i++) {
        if (Math.abs(newValue - ticks[i]) <= SNAP_THRESHOLD) {
          newValue = ticks[i];
          snappedIdx = i;
          break;
        }
      }

      // Update visual highlight only when the snapped tick changes
      if (snappedIdx !== snappedTickRef.current) {
        snappedTickRef.current = snappedIdx;
        setSnappedTickIndex(snappedIdx);
      }

      // Fire onSnapChange only on boolean transition
      const snapped = snappedIdx >= 0;
      if (snapped !== isSnappedRef.current) {
        isSnappedRef.current = snapped;
        onSnapChange?.(snapped);
      }

      onChange(clamp(newValue));
    },
    [min, range, onChange, clamp, ticks, onSnapChange],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      setIsDragging(true);
      handleDrag(e.clientX);
    },
    [disabled, handleDrag],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isDragging) {
        handleDrag(e.clientX);
      }
    },
    [isDragging, handleDrag],
  );

  const handleMouseUp = useCallback(() => {
    // Clear snap highlight on release
    if (isSnappedRef.current) {
      isSnappedRef.current = false;
      snappedTickRef.current = -1;
      setSnappedTickIndex(-1);
      onSnapChange?.(false);
    }
    setIsDragging(false);
  }, [onSnapChange]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      ref={trackRef}
      className={`w-full relative cursor-pointer ${disabled ? "opacity-40 pointer-events-none" : ""} ${className}`}
      onMouseDown={handleMouseDown}
    >
      {/* Track background with fill */}
      <div className="bg-[#81818157] w-full h-[3px] rounded-2xl relative overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full bg-white transition-all"
          style={{ width: `${fillPercent}%` }}
        />
      </div>

      {/* Tick marks — brighten while the thumb is snapped to them */}
      {ticks.map((tickValue, i) => {
        const position = ((tickValue - min) / range) * 100;
        const isSnapped = snappedTickIndex === i;
        return (
          <div
            key={tickValue}
            className={`absolute top-1/2 -translate-y-1/2 pointer-events-none bg-white transition-all duration-75 ${
              isSnapped ? "w-[2px] h-3" : "w-px h-2.5"
            }`}
            style={{ left: `${position}%` }}
          />
        );
      })}

      {/* Slider Thumbnail */}
      <div
        role="button"
        aria-label="Speed Slider"
        className="h-3 w-2 bg-white absolute top-1/2 -translate-y-1/2 rounded-t-lg rounded-b-3xl transition-all cursor-grab active:cursor-grabbing"
        style={{
          left: `${fillPercent}%`,
          transform: `translateX(-50%)`,
        }}
        onMouseDown={handleMouseDown}
      />
    </div>
  );
};
