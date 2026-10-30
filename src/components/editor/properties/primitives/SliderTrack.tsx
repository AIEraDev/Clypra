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
 *
 * // With snap points (e.g. snap to 0 dB on a volume slider)
 * <SliderTrack
 *   value={gainDb}
 *   min={-60}
 *   max={20}
 *   step={0.1}
 *   snapPoints={[{ value: 0, threshold: 0.5 }]}
 *   onSnapChange={setIsSnapping}
 *   onChange={setGainDb}
 * />
 * ```
 */

import React, { useCallback, useRef, useState, useEffect } from "react";
import {
  propertyEditTelemetry,
  type PropertyCategory,
} from "@/lib/properties/propertyEditTelemetry";
import { applySliderSnap, type SliderSnapTarget } from "@/lib/ui/sliderSnap";

/** A single magnetic snap target on the slider track.
 * @deprecated Import SliderSnapTarget from "@/lib/ui/sliderSnap" for new code.
 *             This alias is kept for backward compatibility with existing callers.
 */
export interface SliderSnapPoint {
  /** The value (in the same units as min/max) to snap to. */
  value: number;
  /**
   * How close the raw drag value must come (in the same units) before snapping.
   * The snap zone is a symmetric band: [value - threshold, value + threshold].
   */
  threshold: number;
}

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
  /** Property identifier for telemetry (e.g., "volume", "scale", "opacity") */
  propertyId?: string;
  /** Property category for telemetry */
  category?: PropertyCategory;
  /**
   * Optional magnetic snap targets. When the drag position falls within a snap
   * point's threshold the output value is locked to that snap point's value.
   * Multiple points are evaluated in order; the first match wins.
   */
  snapPoints?: SliderSnapPoint[];
  /**
   * Called during drag whenever the snap state changes — true when the thumb is
   * currently locked to a snap point, false when it releases.
   * Useful for updating a visual indicator (e.g. brightening a tick mark).
   */
  onSnapChange?: (snapped: boolean) => void;

  className?: string;
}

export const SliderTrack: React.FC<SliderTrackProps> = ({
  value,
  min,
  max,
  onChange,
  step = 1,
  disabled = false,
  decimals,
  propertyId,
  category,
  snapPoints,
  onSnapChange,
  className,
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
  const dragStartRef = useRef<number>(0);
  const sampleCountRef = useRef<number>(0);
  /** Tracks whether the thumb is currently locked to a snap point so that
   *  onSnapChange is only called when the state actually transitions. */
  const isSnappedRef = useRef<boolean>(false);

  const handleDrag = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return;
      sampleCountRef.current += 1;
      const rect = trackRef.current.getBoundingClientRect();
      const percent = Math.max(
        0,
        Math.min(1, (clientX - rect.left) / rect.width),
      );
      const raw = min + percent * range;

      // ── Snap-point evaluation via shared utility ────────────────────────
      // Explicit snapPoints are passed through; auto-center snap fires for
      // symmetric sliders (min < 0 && max > 0) with no explicit 0-target.
      const explicitTargets: SliderSnapTarget[] = (snapPoints ?? []).map(
        (sp) => ({ value: sp.value, threshold: sp.threshold }),
      );
      const snappedValue = applySliderSnap({
        raw,
        min,
        max,
        snapTargets: explicitTargets,
        // Auto-center only when no explicit snapPoints suppress it
        autoCenter: !snapPoints?.some((sp) => sp.value === 0),
      });
      const snapped = snappedValue !== raw;

      // Only fire onSnapChange when the snap state transitions
      if (snapped !== isSnappedRef.current) {
        isSnappedRef.current = snapped;
        onSnapChange?.(snapped);
      }

      onChange(clamp(snappedValue));
    },
    [min, max, range, onChange, clamp, snapPoints, onSnapChange],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      dragStartRef.current = performance.now();
      sampleCountRef.current = 1;
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
    if (isDragging) {
      const durationMs = performance.now() - dragStartRef.current;
      propertyEditTelemetry.recordSliderDrag({
        property: propertyId || "slider",
        category,
        durationMs,
        sampleCount: sampleCountRef.current,
      });
      // Clear snap state on release so the tick doesn't stay highlighted
      if (isSnappedRef.current) {
        isSnappedRef.current = false;
        onSnapChange?.(false);
      }
    }
    setIsDragging(false);
  }, [isDragging, propertyId, category, onSnapChange]);

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
