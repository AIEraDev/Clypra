/**
 * SpeedSliderTrack.tsx
 *
 * Specialized slider track for speed control with visual tick marks
 * at common speed intervals (0.25x, 0.5x, 1x, 2x, 4x, 8x).
 *
 * Visual guide for standard video editing speeds.
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
}

// Common speed tick marks for video editing
const SPEED_TICKS = [0.25, 0.5, 1, 2, 4, 8];

export const SpeedSliderTrack: React.FC<SpeedSliderTrackProps> = ({
  value,
  min,
  max,
  onChange,
  step = 0.01,
  disabled = false,
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

  const handleDrag = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const percent = Math.max(
        0,
        Math.min(1, (clientX - rect.left) / rect.width),
      );
      const newValue = min + percent * range;
      onChange(clamp(newValue));
    },
    [min, range, onChange, clamp],
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
    setIsDragging(false);
  }, []);

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

  // ── Calculate tick positions ──────────────────────────────────────────────
  const getTickPosition = (tickValue: number): number => {
    if (tickValue < min || tickValue > max) return -1;
    return ((tickValue - min) / range) * 100;
  };

  return (
    <div
      ref={trackRef}
      className={`w-full relative cursor-pointer ${disabled ? "opacity-40 pointer-events-none" : ""}`}
      onMouseDown={handleMouseDown}
    >
      {/* Track background with fill gradient */}
      <div className="bg-[#81818157] w-full h-[3px] rounded-2xl relative overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full bg-white transition-all"
          style={{ width: `${fillPercent}%` }}
        />
      </div>

      {/* Speed tick marks */}
      {SPEED_TICKS.map((tickValue) => {
        const position = getTickPosition(tickValue);
        if (position < 0) return null;

        return (
          <div
            key={tickValue}
            className="absolute top-1/2 -translate-y-1/2 w-[1px] h-3 bg-white/40"
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
          transform: `translate(-50%, -50%)`,
        }}
        onMouseDown={handleMouseDown}
      />
    </div>
  );
};
