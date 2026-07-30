import React from "react";
import { Palette } from "lucide-react";
import { BackgroundInspectorPanel } from "./BackgroundInspectorPanel";

export const EmptyPropertiesState: React.FC = () => {
  return (
    <div className="w-full md:w-92 min-h-0 panel-shell flex flex-col overflow-y-auto scrollbar-thin shrink-0 select-none">
      {/* Header */}
      <div className="panel-head flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-accent/10 flex items-center justify-center">
            <Palette className="w-3 h-3 text-accent" />
          </div>
          <span className="text-sm font-semibold text-text-primary">Canvas & Background</span>
        </div>
      </div>

      {/* Background Inspector Panel */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <BackgroundInspectorPanel />
      </div>
    </div>
  );
};
