import React from "react";
import { useProjectStore } from "@/store/projectStore";
import { useI18n } from "@/i18n";

export const ProjectDetailsPanel: React.FC = () => {
  const { project } = useProjectStore();
  const { t } = useI18n();

  if (!project) {
    return (
      <div className="p-4 text-center text-white/40 text-sm">
        No project loaded
      </div>
    );
  }

  // Helper function to format aspect ratio
  const formatAspectRatio = (aspectRatio: string): string => {
    if (aspectRatio === "original") return "Original";
    return aspectRatio; // Returns the ratio string like "16:9", "9:16", etc.
  };

  return (
    <div className="p-4 space-y-6">
      {/* Details Section */}
      <div>
        <div className="space-y-3">
          <div className="flex items-start justify-between py-2 border-b border-white/5">
            <span className="text-xs text-white/60">Name:</span>
            <span className="text-xs text-white text-right">
              {project.name}
            </span>
          </div>

          <div className="flex items-start justify-between py-2 border-b border-white/5">
            <span className="text-xs text-white/60">Color space:</span>
            <span className="text-xs text-white">Rec. 709 SDR</span>
          </div>

          <div className="flex items-start justify-between py-2 border-b border-white/5">
            <span className="text-xs text-white/60">Imported media:</span>
            <span className="text-xs text-white">
              Stay in original location
            </span>
          </div>

          <div className="flex items-start justify-between py-2 border-b border-white/5">
            <span className="text-xs text-white/60">Arrange layers:</span>
            <span className="text-xs text-white">Turned on</span>
          </div>

          <div className="flex items-start justify-between py-2 border-b border-white/5">
            <span className="text-xs text-white/60">Proxy:</span>
            <span className="text-xs text-white">Turned off</span>
          </div>
        </div>
      </div>

      {/* Timeline Settings Section */}
      <div>
        <div className="space-y-3">
          <div className="flex items-start justify-between py-2 border-b border-white/5">
            <span className="text-xs text-white/60">Timeline name:</span>
            <span className="text-xs text-white">Timeline 01</span>
          </div>

          <div className="flex items-start justify-between py-2 border-b border-white/5">
            <span className="text-xs text-white/60">Aspect ratio:</span>
            <span className="text-xs text-white">
              {formatAspectRatio(project.aspectRatio)}
            </span>
          </div>

          <div className="flex items-start justify-between py-2 border-b border-white/5">
            <span className="text-xs text-white/60">Resolution:</span>
            <span className="text-xs text-white">
              {project.canvasWidth} × {project.canvasHeight}
            </span>
          </div>

          <div className="flex items-start justify-between py-2 border-b border-white/5">
            <span className="text-xs text-white/60">Frame rate:</span>
            <span className="text-xs text-white">{project.frameRate}fps</span>
          </div>
        </div>
      </div>

      {/* Modify Button */}
      <div className="flex justify-end pt-2">
        <button
          className="px-4 py-2 text-xs font-medium text-white bg-[#2a2a2e] hover:bg-[#3a3a3e] border border-white/10 rounded transition-colors"
          onClick={() => {
            // TODO: Open project settings dialog
            console.log("Open project settings");
          }}
        >
          Modify
        </button>
      </div>
    </div>
  );
};
