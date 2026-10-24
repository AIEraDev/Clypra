import React from "react";

interface PropertySelectProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  /** Optional icon element to render before the label */
  icon?: React.ReactNode;
  disabled?: boolean;
  /** Group options by category */
  groups?: { label: string; options: { value: string; label: string }[] }[];
  className?: string;
}

export const PropertySelect: React.FC<PropertySelectProps> = ({
  label,
  value,
  options,
  onChange,
  icon,
  disabled = false,
  groups,
  className = "",
}) => {
  console.log(className);
  return (
    <div
      className={`space-y-1.5 ${className} ${disabled ? "opacity-40 pointer-events-none" : ""}`}
    >
      <div className="flex items-center gap-1.5">
        {icon && <span className="text-text-muted">{icon}</span>}
        <span className="text-[12px] font-medium text-white select-none">
          {label}
        </span>
      </div>

      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full bg-surface-raised border border-border/60 rounded-sm px-2 py-1 text-xs text-text-primary outline-none transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_8px_center] pr-7"
      >
        {groups
          ? groups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </optgroup>
            ))
          : options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
      </select>
    </div>
  );
};
