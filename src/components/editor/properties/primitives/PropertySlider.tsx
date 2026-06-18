import React, { useCallback } from "react";

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
}) => {
  const resolvedDecimals = decimals ?? (step < 1 ? Math.max(1, -Math.floor(Math.log10(step))) : 0);
  const displayValue = resolvedDecimals > 0 ? value.toFixed(resolvedDecimals) : Math.round(value);

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(Number(e.target.value));
    },
    [onChange],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value);
      if (!isNaN(v)) {
        onChange(Math.max(min, Math.min(max, v)));
      }
    },
    [onChange, min, max],
  );

  // Calculate fill percentage defensively; collapsed trim ranges can make min/max equal.
  const range = max - min;
  const fillPercent = range > 0 ? Math.min(100, Math.max(0, ((value - min) / range) * 100)) : 0;

  if (compact) {
    return (
      <div className={`flex items-center gap-2.5 group ${disabled ? "opacity-40 pointer-events-none" : ""}`}>
        {icon && <span className="text-text-muted shrink-0">{icon}</span>}
        <span className="text-[10px] text-text-muted select-none shrink-0 min-w-[52px]">{label}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleSliderChange}
          disabled={disabled}
          className="flex-1 h-1 rounded-full appearance-none outline-none cursor-pointer bg-border/60 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(var(--color-accent-raw),0.4)] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-125 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
          style={{
            background: `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${fillPercent}%, var(--color-border) ${fillPercent}%, var(--color-border) 100%)`,
          }}
        />
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
        </div>
        <span className="text-[10px] text-text-primary tabular-nums select-none">
          {displayValue}
          {suffix}
        </span>
      </div>

      {/* Slider + Input row */}
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleSliderChange}
          disabled={disabled}
          className="flex-1 h-1.5 rounded-full appearance-none outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(var(--color-accent-raw),0.35)] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
          style={{
            background: `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${fillPercent}%, var(--color-border) ${fillPercent}%, var(--color-border) 100%)`,
          }}
        />
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
