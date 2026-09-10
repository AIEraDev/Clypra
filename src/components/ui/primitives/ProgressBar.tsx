import React from "react";

export type ProgressBarSize = "xs" | "sm" | "md" | "lg" | "xl";
export type ProgressBarVariant = "accent" | "gradient" | "success" | "warning" | "danger";

export interface ProgressBarProps {
  /**
   * Current progress value (between 0 and max).
   * Pass null or undefined for an indeterminate loading animation.
   */
  value?: number | null;
  /** Maximum value (default 100) */
  max?: number;
  /** Visual height/thickness of the progress bar */
  size?: ProgressBarSize;
  /** Color theme variant */
  variant?: ProgressBarVariant;
  /** Whether to show a bright glowing pulse at the leading edge */
  showGlow?: boolean;
  /** Whether to animate the bar (e.g. shimmer or indeterminate wave) */
  animated?: boolean;
  /** Optional label displayed above the bar */
  label?: React.ReactNode;
  /** Whether to display the percentage/value readout on the right */
  showValue?: boolean | ((val: number) => React.ReactNode);
  /** Optional subtitle or status description below the bar */
  subtext?: React.ReactNode;
  /** Optional icon to display before label */
  icon?: React.ReactNode;
  /** Extra CSS classes on the outer wrapper */
  className?: string;
  /** Extra CSS classes on the track container */
  trackClassName?: string;
  /** Extra CSS classes on the filled bar */
  barClassName?: string;
}

const SIZE_CLASSES: Record<ProgressBarSize, string> = {
  xs: "h-1",
  sm: "h-1.5",
  md: "h-2",
  lg: "h-2.5",
  xl: "h-3.5",
};

const GLOW_SIZES: Record<ProgressBarSize, string> = {
  xs: "w-2 h-2 -top-0.5 -right-1",
  sm: "w-3 h-3 -top-0.5 -right-1.5",
  md: "w-4 h-4 -top-1 -right-2",
  lg: "w-5 h-5 -top-1 -right-2.5",
  xl: "w-6 h-6 -top-1.5 -right-3",
};

const VARIANT_BAR_STYLES: Record<ProgressBarVariant, string> = {
  accent: "bg-accent shadow-[0_0_12px_rgba(var(--color-accent-raw,90,184,212),0.4)]",
  gradient: "bg-gradient-to-r from-accent via-accent-soft to-accent shadow-[0_0_12px_rgba(var(--color-accent-raw,90,184,212),0.5)]",
  success: "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)]",
  warning: "bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.4)]",
  danger: "bg-rose-500 shadow-[0_0_12px_rgba(226,96,97,0.4)]",
};

const GLOW_COLORS: Record<ProgressBarVariant, string> = {
  accent: "bg-accent shadow-[0_0_8px_var(--color-accent)]",
  gradient: "bg-accent-soft shadow-[0_0_10px_var(--color-accent-soft)]",
  success: "bg-emerald-400 shadow-[0_0_8px_#34d399]",
  warning: "bg-amber-400 shadow-[0_0_8px_#fbbf24]",
  danger: "bg-rose-400 shadow-[0_0_8px_#f87171]",
};

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  size = "md",
  variant = "accent",
  showGlow = true,
  animated = true,
  label,
  showValue = false,
  subtext,
  icon,
  className = "",
  trackClassName = "",
  barClassName = "",
}) => {
  const isIndeterminate = value === null || value === undefined;
  const clampedValue = isIndeterminate ? 0 : Math.min(max, Math.max(0, value));
  const percent = max > 0 ? (clampedValue / max) * 100 : 0;

  const valueDisplay = React.useMemo(() => {
    if (!showValue || isIndeterminate) return null;
    if (typeof showValue === "function") return showValue(clampedValue);
    return `${Math.round(percent)}%`;
  }, [showValue, isIndeterminate, clampedValue, percent]);

  return (
    <div className={`w-full space-y-1.5 ${className}`}>
      {/* Optional Top Label & Value Readout */}
      {(label || valueDisplay) && (
        <div className="flex items-center justify-between text-[11px] font-medium select-none">
          <div className="flex items-center gap-1.5 text-text-secondary truncate">
            {icon && <span className="shrink-0 text-text-muted">{icon}</span>}
            {label && <span className="truncate">{label}</span>}
          </div>
          {valueDisplay && (
            <span className="text-text-primary font-semibold tabular-nums ml-2 shrink-0">
              {valueDisplay}
            </span>
          )}
        </div>
      )}

      {/* Progress Track */}
      <div
        role="progressbar"
        aria-valuenow={isIndeterminate ? undefined : Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={max}
        className={`relative w-full rounded-full overflow-hidden bg-surface-raised border border-white/6 ${SIZE_CLASSES[size]} ${trackClassName}`}
      >
        {isIndeterminate ? (
          /* Indeterminate Animated Wave */
          <div
            className={`absolute inset-0 rounded-full ${VARIANT_BAR_STYLES[variant]} ${barClassName} animate-[indeterminate_1.8s_cubic-bezier(0.65,0.815,0.735,0.395)_infinite]`}
            style={{
              width: "40%",
              backgroundImage: "linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)",
            }}
          />
        ) : (
          /* Determinate Fill Bar */
          <div
            className={`relative h-full rounded-full transition-all duration-200 ease-out ${VARIANT_BAR_STYLES[variant]} ${barClassName}`}
            style={{ width: `${percent}%` }}
          >
            {/* Shimmer overlay when animated */}
            {animated && (
              <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_2s_infinite]" />
            )}

            {/* Glowing Leading Edge Dot */}
            {showGlow && percent > 2 && percent < 99 && (
              <span
                className={`absolute rounded-full pointer-events-none opacity-80 ${GLOW_SIZES[size]} ${GLOW_COLORS[variant]}`}
              />
            )}
          </div>
        )}
      </div>

      {/* Optional Subtext Description */}
      {subtext && (
        <p className="text-[10px] text-text-muted select-none leading-tight">{subtext}</p>
      )}
    </div>
  );
};

export const ClypraProgressBar = ProgressBar;
