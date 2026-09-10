import React, { useCallback, useId, useState } from "react";

export type SliderSize = "sm" | "md" | "lg";

export interface SliderProps {
  /** Numeric value of the slider */
  value: number;
  /** Minimum selectable value */
  min: number;
  /** Maximum selectable value */
  max: number;
  /** Step increment (default 1) */
  step?: number;
  /** Suffix/unit shown beside the numeric display (e.g. "px", "%", "dB") */
  suffix?: string;
  /** Callback fired when value changes */
  onChange: (value: number) => void;
  /** Callback fired when dragging finishes */
  onChangeEnd?: (value: number) => void;
  /** Default value to reset to on double click */
  defaultValue?: number;
  /** Label shown above or to the left of the slider */
  label?: React.ReactNode;
  /** Optional icon before label */
  icon?: React.ReactNode;
  /** Whether to show the numeric readout or editable input */
  showValue?: boolean;
  /** If true, the value readout is an interactive number input */
  editable?: boolean;
  /** Visual thickness size */
  size?: SliderSize;
  /** Decimal places for display (auto-derived from step if omitted) */
  decimals?: number;
  /** Compact inline row mode (e.g. for tight sidebars) */
  compact?: boolean;
  /** Disabled interaction state */
  disabled?: boolean;
  /** Additional container classes */
  className?: string;
  /** Optional action/accessory element rendered on the right of the header */
  headerAction?: React.ReactNode;
}

const TRACK_HEIGHTS: Record<SliderSize, string> = {
  sm: "h-1",
  md: "h-1.5",
  lg: "h-2",
};

const THUMB_CLASSES: Record<SliderSize, string> = {
  sm: "[&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:-mt-1 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3",
  md: "[&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:-mt-1 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5",
  lg: "[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:-mt-1 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4",
};

export const Slider: React.FC<SliderProps> = ({
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onChange,
  onChangeEnd,
  defaultValue,
  label,
  icon,
  showValue = true,
  editable = false,
  size = "md",
  decimals,
  compact = false,
  disabled = false,
  className = "",
  headerAction,
}) => {
  const inputId = useId();
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const resolvedDecimals =
    decimals ?? (step < 1 ? Math.max(1, -Math.floor(Math.log10(step))) : 0);
  const displayValue =
    resolvedDecimals > 0 ? value.toFixed(resolvedDecimals) : Math.round(value);

  const range = max - min;
  const fillPercent =
    range > 0 ? Math.min(100, Math.max(0, ((value - min) / range) * 100)) : 0;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(Number(e.target.value));
    },
    [onChange],
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
    onChangeEnd?.(value);
  }, [onChangeEnd, value]);

  const handlePointerDown = useCallback(() => {
    setIsDragging(true);
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (defaultValue !== undefined && !disabled) {
      onChange(defaultValue);
      onChangeEnd?.(defaultValue);
    }
  }, [defaultValue, disabled, onChange, onChangeEnd]);

  const handleNumberInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value);
      if (!isNaN(v)) {
        const clamped = Math.max(min, Math.min(max, v));
        onChange(clamped);
        onChangeEnd?.(clamped);
      }
    },
    [max, min, onChange, onChangeEnd],
  );

  const sliderTrackStyle: React.CSSProperties = {
    background: `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${fillPercent}%, var(--color-border) ${fillPercent}%, var(--color-border) 100%)`,
  };

  const sliderInputElement = (
    <div className="relative flex-1 flex items-center">
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        disabled={disabled}
        className={`w-full ${TRACK_HEIGHTS[size]} rounded-full appearance-none outline-none cursor-pointer select-none transition-all
          ${THUMB_CLASSES[size]}
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-white
          [&::-webkit-slider-thumb]:border-2
          [&::-webkit-slider-thumb]:border-accent
          [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.5),0_0_8px_rgba(var(--color-accent-raw,90,184,212),0.4)]
          [&::-webkit-slider-thumb]:cursor-pointer
          [&::-webkit-slider-thumb]:transition-transform
          [&::-webkit-slider-thumb]:hover:scale-125
          [&::-webkit-slider-thumb]:active:scale-135
          [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:bg-white
          [&::-moz-range-thumb]:border-2
          [&::-moz-range-thumb]:border-accent
          [&::-moz-range-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.5)]
          [&::-moz-range-thumb]:cursor-pointer
          focus-visible:ring-1 focus-visible:ring-accent/50
        `}
        style={sliderTrackStyle}
        title={defaultValue !== undefined ? `Double-click to reset (${defaultValue}${suffix})` : undefined}
      />
    </div>
  );

  if (compact) {
    return (
      <div
        className={`flex items-center gap-2 group ${disabled ? "opacity-40 pointer-events-none" : ""} ${className}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {icon && <span className="text-text-muted shrink-0">{icon}</span>}
        {label && (
          <label
            htmlFor={inputId}
            className="text-[10px] text-text-muted select-none shrink-0 min-w-[48px] truncate cursor-pointer"
          >
            {label}
          </label>
        )}
        {sliderInputElement}
        {showValue && (
          editable ? (
            <input
              type="number"
              min={min}
              max={max}
              step={step}
              value={displayValue}
              onChange={handleNumberInputChange}
              disabled={disabled}
              className="w-12 px-1 py-0.5 text-[10px] text-center bg-surface-raised border border-border/60 rounded text-text-primary outline-none focus:border-accent tabular-nums"
            />
          ) : (
            <span className="text-[10px] text-text-secondary tabular-nums min-w-[28px] text-right select-none font-medium">
              {displayValue}
              {suffix}
            </span>
          )
        )}
      </div>
    );
  }

  return (
    <div
      className={`space-y-1 group ${disabled ? "opacity-40 pointer-events-none" : ""} ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {(label || showValue || headerAction) && (
        <div className="flex items-center justify-between text-[10px] select-none">
          <div className="flex items-center gap-1.5 min-w-0">
            {icon && <span className="text-text-muted shrink-0">{icon}</span>}
            {label && (
              <label htmlFor={inputId} className="font-medium text-text-muted truncate cursor-pointer">
                {label}
              </label>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {headerAction}
            {showValue && (
              editable ? (
                <input
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={displayValue}
                  onChange={handleNumberInputChange}
                  disabled={disabled}
                  className="w-14 px-1.5 py-0.5 text-[10px] text-center bg-surface-raised border border-border/60 rounded text-text-primary outline-none focus:border-accent tabular-nums"
                />
              ) : (
                <span className="text-text-primary tabular-nums font-semibold">
                  {displayValue}
                  {suffix}
                </span>
              )
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        {sliderInputElement}
      </div>
    </div>
  );
};

export const ClypraSlider = Slider;
