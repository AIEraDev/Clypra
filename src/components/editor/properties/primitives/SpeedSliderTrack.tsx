/**
 * SpeedSliderTrack.tsx
 *
 * Specialized slider track for speed control with visual tick marks
 * at six semantic speed landmarks: 0.10x, 1.00x, 2.00x, 5.00x, 10.00x, 100.00x.
 *
 * Each tick is a magnetic snap target. Per-tick thresholds are tighter for the
 * closely-spaced low-end values (1x / 2x are only 1 unit apart) and wider
 * toward the high-speed end where the track has more pixel room.
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

/**
 * Fixed semantic speed tick marks with per-tick snap thresholds.
 *
 * Thresholds are tight for closely-spaced low-end values and progressively
 * wider toward the high-speed end where the track has more pixel room.
 */
const SPEED_TICKS: Array<{ value: number; threshold: number }> = [
  { value: 0.1, threshold: 0.3 }, // lowest — first ~0.9% of track
  { value: 1.0, threshold: 0.4 }, // 1× default
  { value: 2.0, threshold: 0.4 }, // 2×
  { value: 5.0, threshold: 1.0 }, // 5×
  { value: 10.0, threshold: 2.0 }, // 10×
  { value: 100.0, threshold: 4.0 }, // highest
];

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

  // ── Track fill ────────────────────────────────────────────────────────────
  const range = max - min;
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

      // ── Snap-point evaluation (per-tick threshold) ─────────────────────
      let snappedIdx = -1;
      for (let i = 0; i < SPEED_TICKS.length; i++) {
        const tick = SPEED_TICKS[i];
        if (tick.value < min || tick.value > max) continue;
        if (Math.abs(newValue - tick.value) <= tick.threshold) {
          newValue = tick.value;
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
    [min, max, range, onChange, clamp, onSnapChange],
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
      {SPEED_TICKS.filter((t) => t.value >= min && t.value <= max).map(
        ({ value: tickValue }, i) => {
          const position = ((tickValue - min) / range) * 100;
          const isSnapped = snappedTickIndex === i;
          return (
            <div
              key={tickValue}
              className={`absolute top-1/2 -translate-y-1/2 pointer-events-none bg-white transition-all duration-75 ${
                isSnapped ? "w-[2px] h-3 opacity-90" : "w-px h-2.5 opacity-40"
              }`}
              style={{ left: `${position}%` }}
            />
          );
        },
      )}

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
