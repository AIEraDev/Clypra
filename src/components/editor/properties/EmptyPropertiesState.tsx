import React from "react";
import { Palette, ChevronRight } from "lucide-react";
import { BackgroundInspectorPanel } from "./BackgroundInspectorPanel";

export interface EmptyPropertiesStateProps {
  width?: number;
  fillWidth?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const EmptyPropertiesState: React.FC<EmptyPropertiesStateProps> = ({
  width,
  fillWidth = false,
  collapsed = false,
  onToggleCollapse,
}) => {
  return (
    <div
      className={`min-h-0 panel-shell flex flex-col overflow-hidden select-none transition-[width] duration-150 ${
        fillWidth ? "w-full flex-1" : "shrink-0"
      }`}
      style={{
        width: collapsed ? 0 : fillWidth ? "100%" : (width ?? 400),
        overflow: collapsed ? "hidden" : undefined,
      }}
      aria-hidden={collapsed}
    >
      {/* Header */}
      <div className="panel-head flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2">
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
      </div>

      {/* Background Inspector Panel */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <BackgroundInspectorPanel />
      </div>
    </div>
  );
};
