import React from "react";

interface ToggleSwitchProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
  title?: string;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  disabled,
  "aria-label": ariaLabel,
  title,
}) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`w-10 h-5.5 rounded-full relative shrink-0 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/50 ${
        disabled
          ? "opacity-40 cursor-not-allowed"
          : "cursor-pointer"
      } ${
        checked
          ? "bg-accent-primary shadow-xs"
          : "bg-surface-elevated border border-border-default hover:border-border-hover"
      }`}
    >
      <div
        className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full transition-transform duration-200 shadow-sm ${
          checked
            ? "bg-white translate-x-[20px]"
            : "bg-text-muted translate-x-[3px]"
        }`}
      />
    </button>
  );
};
