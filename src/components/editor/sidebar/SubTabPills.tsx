import React from "react";

export interface SubTabPillItem<T extends string> {
  value: T;
  label: string;
  count?: number;
  disabled?: boolean;
}

interface SubTabPillsProps<T extends string> {
  items: readonly SubTabPillItem<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}

export function SubTabPills<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: SubTabPillsProps<T>): React.ReactElement {
  return (
    <div
      className="grow overflow-x-auto flex items-center gap-2 pb-0.5 whitespace-nowrap"
      style={{ scrollbarWidth: "none" }}
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-disabled={item.disabled || undefined}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={`shrink-0 px-2 py-0.5 rounded-sm text-xs font-semibold transition-all cursor-pointer ${
              selected
                ? "bg-accent text-white"
                : "text-text-muted hover:text-text-primary hover:bg-surface-hover"
            } ${item.disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {item.label}
            {item.count !== undefined ? ` (${item.count})` : ""}
          </button>
        );
      })}
    </div>
  );
}
