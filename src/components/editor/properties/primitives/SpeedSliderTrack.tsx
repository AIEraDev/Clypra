/**
 * SpeedSliderTrack.tsx
 *
 * Specialized slider track for speed control with visual tick marks at six
 * semantic speed landmarks: 0.10x, 1.00x, 2.00x, 5.00x, 10.00x, 100.00x.
 *
 * Value mapping uses a LOGARITHMIC scale so dragging feels perceptually linear
 * (the jump 0.1x→1x covers the same distance as 1x→10x→100x).
 *
 * Tick VISUAL POSITIONS are index-based (0%, 20%, 40%, 60%, 80%, 100%) so
 * they appear equally/evenly spaced across the track width regardless of the
 * log-scale value differences between adjacent ticks.
 *
 * Snap detection operates in log-space so every tick has the same visual snap
 * zone width. The `onSnapChange` callback mirrors the pattern used by SliderTrack.
 */

import React, { useCallback, useRef, useState, useEffect } from "react";

export interface SpeedSliderTrackProps {
  /** Current speed value */
  value: number;
  /** Minimum speed (must be > 0) */
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

/** Semantic speed landmarks the ticks snap to. */
const SPEED_TICKS = [0.1, 1, 2, 5, 10, 100];

/**
 * Snap zone half-width in log-space.
 * log(100/0.1) = log(1000) ≈ 6.908; 0.08 × 6.908 ≈ 0.55 log-units per side.
 * Adjacent ticks (e.g. log(1)=0, log(2)=0.693) are ~1 log-unit apart so
 * zones don't overlap.
 */
const LOG_SNAP_HALF = 0.08;

// ── Log-scale helpers ────────────────────────────────────────────────────────

/** Map a speed value to a 0–1 screen fraction using log interpolation. */
function valueToPercent(
  value: number,
  logMin: number,
  logRange: number,
): number {
  return Math.max(0, Math.min(1, (Math.log(value) - logMin) / logRange));
}

/** Map a 0–1 screen fraction to a speed value using log interpolation. */
function percentToValue(
  percent: number,
  logMin: number,
  logRange: number,
  decimals: number,
): number {
  const raw = Math.exp(logMin + percent * logRange);
  return +raw.toFixed(decimals);
}

// ─────────────────────────────────────────────────────────────────────────────

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

  // Pre-compute log bounds (min/max never change during a session)
  const logMin = Math.log(Math.max(min, 1e-6));
  const logMax = Math.log(Math.max(max, 1e-6));
  const logRange = logMax - logMin;

  // ── Track fill — log-scale so thumb position matches perceived speed ──────
  const safeValue = Math.max(min, Math.min(max, value));
  const fillPercent = valueToPercent(safeValue, logMin, logRange) * 100;

  // ── Drag handling ─────────────────────────────────────────────────────────
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [snappedTickIndex, setSnappedTickIndex] = useState<number>(-1);
  const snappedTickRef = useRef<number>(-1);
  const isSnappedRef = useRef<boolean>(false);

  const handleDrag = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const percent = Math.max(
        0,
        Math.min(1, (clientX - rect.left) / rect.width),
      );
      let newValue = percentToValue(percent, logMin, logRange, decimals);

      // ── Log-space snap: equal visual grab zone width for every tick ──────
      let snappedIdx = -1;
      const logNewValue = Math.log(Math.max(newValue, 1e-6));
      for (let i = 0; i < SPEED_TICKS.length; i++) {
        const tickVal = SPEED_TICKS[i];
        if (tickVal < min || tickVal > max) continue;
        if (
          Math.abs(logNewValue - Math.log(tickVal)) <=
          LOG_SNAP_HALF * logRange
        ) {
          newValue = tickVal;
          snappedIdx = i;
          break;
        }
      }

      if (snappedIdx !== snappedTickRef.current) {
        snappedTickRef.current = snappedIdx;
        setSnappedTickIndex(snappedIdx);
      }

      const snapped = snappedIdx >= 0;
      if (snapped !== isSnappedRef.current) {
        isSnappedRef.current = snapped;
        onSnapChange?.(snapped);
      }

      onChange(clamp(newValue));
    },
    [logMin, logRange, decimals, min, max, onChange, clamp, onSnapChange],
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
      if (isDragging) handleDrag(e.clientX);
    },
    [isDragging, handleDrag],
  );

  const handleMouseUp = useCallback(() => {
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

  // Pre-filter ticks once for rendering
  const visibleTicks = SPEED_TICKS.filter((t) => t >= min && t <= max);
  const tickCount = visibleTicks.length;

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

      {/* Tick marks — equally spaced visually (justify-between).
          Position = i / (n-1) so first tick is at 0% and last at 100%.
          Values and snap still use the log-scale speed landmarks. */}
      {visibleTicks.map((tickValue, i) => {
        const position = tickCount > 1 ? (i / (tickCount - 1)) * 100 : 0;
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
