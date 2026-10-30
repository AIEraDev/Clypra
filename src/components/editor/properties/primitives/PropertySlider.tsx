import React, { useCallback } from "react";
import { KeyframeNavControls } from "./KeyframeNavControls";
import { SliderTrack } from "./SliderTrack";

interface PropertySliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
  /** Optional icon element to render before the label */
  icon?: React.ReactNode;
  /** Show the numeric input alongside the slider */
  showInput?: boolean;
  /** Decimal places for display (default: auto based on step) */
  decimals?: number;
  /** Compact mode: single row with no wrapping */
  compact?: boolean;
  disabled?: boolean;
  /** Keyframe state & toggle callback */
  keyframeActive?: boolean;
  onToggleKeyframe?: () => void;
  hasKeyframes?: boolean;
  onPrevKeyframe?: () => void;
  onNextKeyframe?: () => void;
  hasPrevKeyframe?: boolean;
  hasNextKeyframe?: boolean;
  onOpenCurveEditor?: () => void;
}

export const PropertySlider: React.FC<PropertySliderProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onChange,
  icon,
  showInput = true,
  decimals,
  compact = false,
  disabled = false,
  keyframeActive = false,
  onToggleKeyframe,
  hasKeyframes,
  onPrevKeyframe,
  onNextKeyframe,
  hasPrevKeyframe = false,
  hasNextKeyframe = false,
  onOpenCurveEditor,
}) => {
  const resolvedDecimals = decimals ?? (step < 1 ? Math.max(1, -Math.floor(Math.log10(step))) : 0);
  const displayValue = resolvedDecimals > 0 ? value.toFixed(resolvedDecimals) : Math.round(value);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value);
      if (!isNaN(v)) {
        onChange(Math.max(min, Math.min(max, v)));
      }
    },
    [onChange, min, max],
  );

  if (compact) {
    return (
      <div className={`flex items-center gap-2.5 group ${disabled ? "opacity-40 pointer-events-none" : ""}`}>
        {icon && <span className="text-text-muted shrink-0">{icon}</span>}
        <span className="text-[10px] text-text-muted select-none shrink-0 min-w-[52px]">{label}</span>
        <div className="flex-1">
          <SliderTrack
            value={value}
            min={min}
            max={max}
            step={step}
            decimals={resolvedDecimals}
            onChange={onChange}
            disabled={disabled}
          />
        </div>
        {showInput ? (
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={displayValue}
            onChange={handleInputChange}
            disabled={disabled}
            className="w-14 px-1.5 py-0.5 text-[10px] text-center bg-surface-raised border border-border/60 rounded text-text-primary outline-none focus:border-accent tabular-nums selectable"
          />
        ) : (
          <span className="text-[10px] text-text-primary tabular-nums min-w-[32px] text-right select-none">
            {displayValue}
            {suffix}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-1.5 group ${disabled ? "opacity-40 pointer-events-none" : ""}`}>
      {/* Label row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {icon && <span className="text-text-muted">{icon}</span>}
          <span className="text-[10px] font-medium text-text-muted select-none">{label}</span>
          {onToggleKeyframe && (
            <KeyframeNavControls
              hasKeyframes={hasKeyframes ?? keyframeActive}
              isAtKeyframe={keyframeActive}
              onToggleKeyframe={onToggleKeyframe}
              onPrevKeyframe={onPrevKeyframe}
              onNextKeyframe={onNextKeyframe}
              hasPrev={hasPrevKeyframe}
              hasNext={hasNextKeyframe}
              onOpenCurveEditor={onOpenCurveEditor}
              label={label}
            />
          )}
        </div>
        <span className="text-[10px] text-text-primary tabular-nums select-none">
          {displayValue}
          {suffix}
        </span>
      </div>

      {/* Slider + optional number input row */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <SliderTrack
            value={value}
            min={min}
            max={max}
            step={step}
            decimals={resolvedDecimals}
            onChange={onChange}
            disabled={disabled}
          />
        </div>
        {showInput && (
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={displayValue}
            onChange={handleInputChange}
            disabled={disabled}
            className="w-14 px-1.5 py-0.5 text-[10px] text-center bg-surface-raised border border-border/60 rounded text-text-primary outline-none focus:border-accent tabular-nums selectable"
          />
        )}
      </div>
    </div>
  );
};
