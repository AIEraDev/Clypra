import React from "react";

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export const SettingRow: React.FC<SettingRowProps> = ({
  label,
  description,
  children,
  className = "",
}) => {
  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2.5 transition-colors ${className}`}
    >
      <div className="flex-1 pr-2 min-w-0">
        <div className="text-xs sm:text-sm font-medium text-text-primary leading-tight">
          {label}
        </div>
        {description && (
          <div className="text-[11px] sm:text-xs text-text-muted mt-0.5 leading-normal">
            {description}
          </div>
        )}
      </div>
      <div className="shrink-0 flex items-center">{children}</div>
    </div>
  );
};
