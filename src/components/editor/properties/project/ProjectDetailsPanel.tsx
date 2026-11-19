import React from "react";
import { useProjectStore } from "@/store/projectStore";
import { useI18n } from "@/i18n";

export const ProjectDetailsPanel: React.FC = () => {
  const { project } = useProjectStore();
  const { t } = useI18n();

  if (!project) {
    return (
      <div className="p-4 text-center text-text-muted text-sm">
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
          <div className="flex items-start justify-between py-2 border-b border-border-default/60">
            <span className="text-xs text-text-muted">Name:</span>
            <span className="text-xs text-text-primary text-right font-medium">
              {project.name}
            </span>
          </div>

          <div className="flex items-start justify-between py-2 border-b border-border-default/60">
            <span className="text-xs text-text-muted">Color space:</span>
            <span className="text-xs text-text-primary font-medium">Rec. 709 SDR</span>
          </div>

          <div className="flex items-start justify-between py-2 border-b border-border-default/60">
            <span className="text-xs text-text-muted">Imported media:</span>
            <span className="text-xs text-text-primary font-medium">
              Stay in original location
            </span>
          </div>

          <div className="flex items-start justify-between py-2 border-b border-border-default/60">
            <span className="text-xs text-text-muted">Arrange layers:</span>
            <span className="text-xs text-text-primary font-medium">Turned on</span>
          </div>

          <div className="flex items-start justify-between py-2 border-b border-border-default/60">
            <span className="text-xs text-text-muted">Proxy:</span>
            <span className="text-xs text-text-primary font-medium">Turned off</span>
          </div>
        </div>
      </div>

      {/* Timeline Settings Section */}
      <div>
        <div className="space-y-3">
          <div className="flex items-start justify-between py-2 border-b border-border-default/60">
            <span className="text-xs text-text-muted">Timeline name:</span>
            <span className="text-xs text-text-primary font-medium">Timeline 01</span>
          </div>

          <div className="flex items-start justify-between py-2 border-b border-border-default/60">
            <span className="text-xs text-text-muted">Aspect ratio:</span>
            <span className="text-xs text-text-primary font-medium">
              {formatAspectRatio(project.aspectRatio)}
            </span>
          </div>

          <div className="flex items-start justify-between py-2 border-b border-border-default/60">
            <span className="text-xs text-text-muted">Resolution:</span>
            <span className="text-xs text-text-primary font-medium">
              {project.canvasWidth} × {project.canvasHeight}
            </span>
          </div>

          <div className="flex items-start justify-between py-2 border-b border-border-default/60">
            <span className="text-xs text-text-muted">Frame rate:</span>
            <span className="text-xs text-text-primary font-medium">{project.frameRate}fps</span>
          </div>
        </div>
      </div>

      {/* Modify Button */}
      <div className="flex justify-end pt-2">
        <button
          className="px-4 py-2 text-xs font-medium text-text-primary bg-surface-elevated hover:bg-surface-hover border border-border-default rounded-md shadow-xs transition-colors cursor-pointer"
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
