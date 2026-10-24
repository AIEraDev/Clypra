/**
 * SliderTrack.tsx
 *
 * Reusable draggable slider track with visual fill indicator.
 * A pure visual control for selecting values by dragging or clicking.
 *
 * **Usage Examples:**
 *
 * ```tsx
 * // Basic usage
 * <SliderTrack
 *   value={50}
 *   min={0}
 *   max={100}
 *   onChange={setValue}
 * />
 *
 * // With custom styling
 * <SliderTrack
 *   value={opacity}
 *   min={0}
 *   max={1}
 *   step={0.01}
 *   onChange={setOpacity}
 *   disabled={false}
 * />
 * ```
 */

import React, { useCallback, useRef, useState, useEffect } from "react";

export interface SliderTrackProps {
  /** Current value */
  value: number;
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
  /** Callback when value changes */
  onChange: (value: number) => void;
  /** Step increment (default: 1) */
  step?: number;
  /** Disabled state */
  disabled?: boolean;
  /** Decimal places for clamping (default: inferred from step) */
  decimals?: number;
}

export const SliderTrack: React.FC<SliderTrackProps> = ({
  value,
  min,
  max,
  onChange,
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
      {/* Track background with fill gradient */}
      <div className="bg-[#81818157] w-full h-[3px] rounded-2xl relative overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full bg-white transition-all"
          style={{ width: `${fillPercent}%` }}
        />
      </div>

      {/* Slider Thumbnail */}
      <div
        role="button"
        aria-label="Slider Button Handler"
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
