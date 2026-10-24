/**
 * GradientSliderTrack.tsx
 *
 * Draggable slider track with customizable gradient backgrounds.
 * Same shape and interaction as SliderTrack but with color gradient support.
 */

import React, { useCallback, useRef, useState, useEffect } from "react";

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
}) => {
  const resolvedDecimals =
    decimals ?? (step < 1 ? Math.max(1, -Math.floor(Math.log10(step))) : 0);

  const clamp = useCallback(
    (v: number) => Math.max(min, Math.min(max, +v.toFixed(resolvedDecimals))),
    [min, max, resolvedDecimals],
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

      {/* Slider Thumbnail */}
      <div
        role="button"
        aria-label="Slider Button Handler"
        className="h-3 w-2 bg-white absolute top-1/2 -translate-y-1/2 rounded-t-lg rounded-b-3xl transition-all cursor-grab active:cursor-grabbing"
        style={{
          left: `${fillPercent}%`,
          transform: `translate(-50%)`,
        }}
        onMouseDown={handleMouseDown}
      />
    </div>
  );
};
