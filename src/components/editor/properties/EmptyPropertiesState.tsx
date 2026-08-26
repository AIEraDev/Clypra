import React from "react";
import { Palette, ChevronRight, ChevronLeft } from "lucide-react";
import { BackgroundInspectorPanel } from "./BackgroundInspectorPanel";

export interface EmptyPropertiesStateProps {
  width?: number;
  fillWidth?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  className?: string;
}

export const EmptyPropertiesState: React.FC<EmptyPropertiesStateProps> = ({
  width,
  fillWidth = false,
  collapsed = false,
  onToggleCollapse,
  className = "",
}) => {
  return (
    <div
      className={`min-h-0 panel-shell flex flex-col overflow-hidden select-none transition-[width] duration-150 ${
        fillWidth && !collapsed ? "w-full flex-1" : "shrink-0"
      } ${className}`}
      style={{
        width: collapsed ? 44 : fillWidth ? "100%" : (width ?? 400),
      }}
    >
      {/* Header */}
      <div className="panel-head border-b border-border relative flex items-center justify-between px-2.5 py-2.5">
        {collapsed ? (
          <div className="w-full flex items-center justify-center">
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-white/5 transition-colors cursor-pointer"
                title="Expand properties panel"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 pl-1.5">
              <div className="w-5 h-5 rounded bg-accent/10 flex items-center justify-center">
                <Palette className="w-3 h-3 text-accent" />
              </div>
              <span className="text-xs font-semibold text-text-primary">Canvas & Background</span>
            </div>
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-white/5 transition-colors cursor-pointer"
                title="Collapse properties panel"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Background Inspector Panel or Collapsed Rail */}
      {collapsed ? (
        <div className="flex flex-col items-center gap-2 py-3 flex-1 overflow-y-auto scrollbar-none">
          <button
            onClick={onToggleCollapse}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-accent bg-accent/10 hover:bg-accent/20 border border-accent/20 transition-colors cursor-pointer"
            title="Expand Canvas & Background Settings"
          >
            <Palette className="w-4 h-4" />
          </button>
          <span className="text-[9px] font-semibold text-text-muted/60 uppercase tracking-widest [writing-mode:vertical-lr] select-none mt-2">
            Properties
          </span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <BackgroundInspectorPanel />
        </div>
      )}
    </div>
  );
};
