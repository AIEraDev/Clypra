/**
 * GradientSliderTrack.tsx
 *
 * Draggable slider track with customizable gradient backgrounds.
 * Same shape and interaction as SliderTrack but with color gradient support.
 *
 * Features:
 * - Optional center-tick marker (the thin `|` line at value=0) for symmetric sliders
 * - Snap-to-zero: when the drag passes within `snapRadius` value-units of 0,
 *   the thumb is held at 0 so the user feels a clear "neutral" detent.
 */

import React, { useCallback, useRef, useState, useEffect } from "react";
import { applySliderSnap } from "@/lib/ui/sliderSnap";

type GradientType = "temp" | "tint" | "saturation" | "none";

const GRADIENTS: Record<GradientType, string> = {
  temp: "linear-gradient(to right, #0066ff, #ffcc00)", // blue to yellow
  tint: "linear-gradient(to right, #00ff66, #ff00ff)", // green to magenta
  saturation: "linear-gradient(to right, #808080, #ff0000)", // gray to red
  none: "linear-gradient(to right, #81818157, #ffffff)", // default gray
};

export interface GradientSliderTrackProps {
  /** Current value */
  value: number;
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
  /** Callback when value changes */
  onChange: (value: number) => void;
  /** Gradient type */
  gradient?: GradientType;
  /** Step increment (default: 1) */
  step?: number;
  /** Disabled state */
  disabled?: boolean;
  /** Decimal places for clamping (default: inferred from step) */
  decimals?: number;
  /**
   * When true, renders a thin tick mark at the center (value = 0) of the track
   * and snaps the thumb to 0 when dragging within SNAP_RADIUS of it.
   * Automatically enabled when min < 0 && max > 0 — pass explicitly to override.
   */
  showCenterTick?: boolean;
}

export const GradientSliderTrack: React.FC<GradientSliderTrackProps> = ({
  value,
  min,
  max,
  onChange,
  gradient = "none",
  step = 1,
  disabled = false,
  decimals,
  showCenterTick,
}) => {
  const resolvedDecimals =
    decimals ?? (step < 1 ? Math.max(1, -Math.floor(Math.log10(step))) : 0);

  // Auto-detect symmetric range when the prop is not provided explicitly
  const hasCenterTick = showCenterTick ?? (min < 0 && max > 0);

  const clamp = useCallback(
    (v: number) => Math.max(min, Math.min(max, +v.toFixed(resolvedDecimals))),
    [min, max, resolvedDecimals],
  );

  /** Apply center-snap then clamp+round to step. */
  const snapAndClamp = useCallback(
    (raw: number): number => {
      const snapped = applySliderSnap({ raw, min, max });
      return clamp(Math.round(snapped / step) * step);
    },
    [min, max, clamp, step],
  );

  // ── Track fill ────────────────────────────────────────────────────────────
  const range = max - min;
  const fillPercent =
    range > 0 ? Math.min(100, Math.max(0, ((value - min) / range) * 100)) : 0;

  // Center tick position as a percentage of track width
  const centerPercent = range > 0 ? (-min / range) * 100 : 50;

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
      const rawValue = min + percent * range;
      onChange(snapAndClamp(rawValue));
    },
    [min, range, onChange, snapAndClamp],
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

  return (
    <div
      ref={trackRef}
      className={`w-full relative cursor-pointer ${disabled ? "opacity-40 pointer-events-none" : ""}`}
      onMouseDown={handleMouseDown}
    >
      {/* Track background with gradient */}
      <div
        className="w-full h-[3px] rounded-2xl relative overflow-hidden"
        style={{ background: GRADIENTS[gradient] }}
      />

      {/*
       * Center-zero tick mark — the thin | line CapCut shows at the neutral point.
       * Positioned at the exact percentage that maps to value=0 on the track.
       * Uses overflow-visible on the parent so the 6px tall tick protrudes above
       * and below the 3px track without clipping.
       */}
      {hasCenterTick && (
        <div
          aria-hidden="true"
          className="absolute top-1/2 -translate-x-px pointer-events-none"
          style={{
            left: `${centerPercent}%`,
            // Tick is 1px wide, 7px tall — centered vertically on the track
            width: "1px",
            height: "7px",
            transform: "translateX(-50%) translateY(-50%)",
            backgroundColor: "rgba(255,255,255)",
            borderRadius: "1px",
          }}
        />
      )}

      {/* Slider Thumbnail */}
      <div
        role="button"
        aria-label="Slider Button Handler"
        className="h-3 w-2 bg-white absolute top-1/2 -translate-y-1/2 rounded-t-lg rounded-b-3xl cursor-grab active:cursor-grabbing"
        style={{
          left: `${fillPercent}%`,
          transform: `translateX(-50%)`,
        }}
        onMouseDown={handleMouseDown}
      />
    </div>
  );
};
