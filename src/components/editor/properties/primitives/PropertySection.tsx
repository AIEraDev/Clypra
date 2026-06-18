import React, { useState } from "react";
import { ChevronDown } from "lucide-react";

interface PropertySectionProps {
  title: string;
  icon?: React.ReactNode;
  /** Start collapsed (default: false — sections start open) */
  defaultCollapsed?: boolean;
  children: React.ReactNode;
  /** Optional action element rendered on the right side of the header */
  action?: React.ReactNode;
}

export const PropertySection: React.FC<PropertySectionProps> = ({ title, icon, defaultCollapsed = false, children, action }) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div className="rounded-xl border border-border/40 bg-surface-raised/20 overflow-hidden transition-all">
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-white/[0.02] transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-2">
          {icon && <span className="text-accent/80">{icon}</span>}
          <span className="text-[11px] font-semibold text-text-primary tracking-wide">{title}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {action && <span onClick={(e) => e.stopPropagation()}>{action}</span>}
          <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`} />
        </div>
      </button>

      {/* Collapsible Content */}
      <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}>
        <div className="min-h-0 overflow-hidden">
          <div className="px-3 pb-3 space-y-3">{children}</div>
        </div>
      </div>
    </div>
  );
};
