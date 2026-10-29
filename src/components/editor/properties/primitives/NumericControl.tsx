/**
 * NumericControl.tsx
 *
 * Reusable numeric input control with optional prefix label, suffix unit,
 * and integrated increase/decrease buttons.
 *
 * **Usage Examples:**
 *
 * ```tsx
 * // Basic usage (no prefix/suffix)
 * <NumericControl
 *   value={rotation}
 *   onChange={setRotation}
 *   step={1}
 * />
 *
 * // With prefix label (X, Y position)
 * <NumericControl
 *   value={displayX}
 *   onChange={handleDisplayXChange}
 *   prefix="X"
 *   step={1}
 * />
 *
 * // With suffix unit (%, px, deg)
 * <NumericControl
 *   value={scale}
 *   onChange={setScale}
 *   suffix="%"
 *   step={1}
 * />
 *
 * // With decimals and range
 * <NumericControl
 *   value={opacity}
 *   onChange={setOpacity}
 *   min={0}
 *   max={1}
 *   step={0.1}
 *   decimals={2}
 *   suffix="%"
 * />
 * ```
 */

import React, { useCallback, useRef, useState } from "react";
import { IncreaseDecreaseHandler } from "./IncreaseDecreaseHandler";
import {
  propertyEditTelemetry,
  type PropertyCategory,
} from "@/lib/properties/propertyEditTelemetry";

export interface NumericControlProps {
  /** Current numeric value */
  value: number;
  /** Callback when value changes */
  onChange: (value: number) => void;

  // ── Optional Configuration ──────────────────────────────────────────────
  /** Prefix label shown inside the input container (e.g., "X", "Y") */
  prefix?: string;
  /** Suffix/unit displayed inside the input container after the value (e.g., "%", "px", "deg") */
  suffix?: string;
  /** Minimum allowed value */
  min?: number;
  /** Maximum allowed value */
  max?: number;
  /** Step increment for increase/decrease buttons (default: 1) */
  step?: number;
  /** Decimal places for display. Auto-inferred from step if omitted. */
  decimals?: number;

  // ── Styling Options ─────────────────────────────────────────────────────
  /** Input width class (default: "w-12") */
  inputWidth?: string;
  /** Disabled state */
  disabled?: boolean;

  // ── Accessibility & Telemetry ───────────────────────────────────────────
  /** Accessible label for screen readers */
  ariaLabel?: string;
  /** Property identifier for telemetry (e.g., "volume", "scale", "opacity") */
  propertyId?: string;
  /** Property category for telemetry */
  category?: PropertyCategory;

  /** Optional custom formatter for the display value when not editing.
   * Receives the raw numeric value and returns a string. Useful for special
   * cases like -∞ at minimum volume. Does NOT affect editing or stepping. */
  formatDisplay?: (value: number) => string;

  inputPosition?: "text-center" | "text-right";
}

export const NumericControl: React.FC<NumericControlProps> = ({
  value,
  onChange,
  prefix,
  suffix,
  min = -Infinity,
  max = Infinity,
  step = 1,
  decimals,
  inputWidth = "w-8",
  disabled = false,
  ariaLabel,
  propertyId,
  category,
  inputPosition = "text-center",
  formatDisplay,
}) => {
  // ── Decimal precision ─────────────────────────────────────────────────────
  const resolvedDecimals =
    decimals ?? (step < 1 ? Math.max(1, -Math.floor(Math.log10(step))) : 0);

  const clamp = useCallback(
    (v: number) => Math.max(min, Math.min(max, +v.toFixed(resolvedDecimals))),
    [min, max, resolvedDecimals],
  );

  // ── Inline editing state ──────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const focusStartRef = useRef<number>(0);

  const displayValue =
    resolvedDecimals > 0
      ? value.toFixed(resolvedDecimals)
      : String(Math.round(value));

  // When a custom formatter is provided, show it while idle (not editing)
  const idleDisplay = formatDisplay ? formatDisplay(value) : displayValue;

  const effectiveLabel = ariaLabel || prefix || suffix || "Numeric input";

  const handleInputFocus = useCallback(() => {
    focusStartRef.current = performance.now();
    setDraft(displayValue); // always seed with raw numeric string for editing
    setEditing(true);
  }, [displayValue]);

  const handleInputBlur = useCallback(() => {
    setEditing(false);
    const parsed = parseFloat(draft);
    if (!isNaN(parsed)) {
      onChange(clamp(parsed));
      const durationMs = performance.now() - focusStartRef.current;
      propertyEditTelemetry.recordNumericCommit({
        property: propertyId || effectiveLabel,
        category,
        durationMs,
      });
    }
  }, [draft, onChange, clamp, propertyId, effectiveLabel, category]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const inputValue = e.target.value;
      setDraft(inputValue);

      // Real-time validation for max value
      const parsed = parseFloat(inputValue);
      if (!isNaN(parsed) && parsed > max) {
        // Immediately clamp to max if user tries to exceed
        setDraft(max.toFixed(resolvedDecimals));
      }
    },
    [max, resolvedDecimals],
  );

  // ── Authoritative value ref to guard against stale props during hold-repeat
  const currentValueRef = useRef(value);
  currentValueRef.current = value;

  const handleInputKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        (e.target as HTMLInputElement).blur();
      }
      if (e.key === "Escape") {
        setEditing(false);
        setDraft(displayValue);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const next = clamp(currentValueRef.current + step);
        currentValueRef.current = next;
        onChange(next);
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = clamp(currentValueRef.current - step);
        currentValueRef.current = next;
        onChange(next);
      }
    },
    [step, onChange, clamp, displayValue],
  );

  // ── Increase/Decrease handlers ────────────────────────────────────────────
  const handleIncrease = useCallback(() => {
    const next = clamp(currentValueRef.current + step);
    currentValueRef.current = next;
    onChange(next);
    propertyEditTelemetry.recordNumericStep({
      property: propertyId || effectiveLabel,
      category,
      direction: "up",
    });
  }, [step, onChange, clamp, propertyId, effectiveLabel, category]);

  const handleDecrease = useCallback(() => {
    const next = clamp(currentValueRef.current - step);
    currentValueRef.current = next;
    onChange(next);
    propertyEditTelemetry.recordNumericStep({
      property: propertyId || effectiveLabel,
      category,
      direction: "down",
    });
  }, [step, onChange, clamp, propertyId, effectiveLabel, category]);

  return (
    <div className="flex items-center gap-1">
      {/* Input Container */}
      <div className="bg-panel rounded-sm overflow-hidden flex items-center">
        {/* Optional Prefix Label */}
        {prefix && (
          <span className="text-[10px] text-text-muted select-none w-6 h-6 flex justify-center items-center pl-2">
            {prefix}
          </span>
        )}

        {/* Numeric Input */}
        <input
          type="number"
          value={editing ? draft : idleDisplay}
          min={min !== -Infinity ? min : undefined}
          max={max !== Infinity ? max : undefined}
          step={step}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          onKeyDown={handleInputKey}
          className={`${inputWidth} ${inputPosition} h-6 text-[11px] text-white outline-none transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
            disabled ? "opacity-50 cursor-not-allowed" : ""
          }`}
          disabled={disabled}
          aria-label={effectiveLabel}
        />

        {/* Optional Suffix Label */}
        {suffix && (
          <span className="text-[10px] font-medium text-white select-none flex items-center pr-1">
            {suffix}
          </span>
        )}
      </div>

      {/* Increase/Decrease Buttons */}
      <IncreaseDecreaseHandler
        onIncrease={handleIncrease}
        onDecrease={handleDecrease}
        label={effectiveLabel}
        disabled={disabled}
      />
    </div>
  );
};
