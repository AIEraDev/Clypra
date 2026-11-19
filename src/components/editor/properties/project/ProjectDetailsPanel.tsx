import React from "react";
import { useProjectStore } from "@/store/projectStore";
import { useI18n } from "@/i18n";

export const ProjectDetailsPanel: React.FC = () => {
  const { project } = useProjectStore();
  const { t } = useI18n();

  if (!project) {
    return (
      <div className="p-4 text-center text-text-muted text-sm">
        {t("properties.project.noProjectLoaded")}
      </div>
    );
  }

  // Helper function to format aspect ratio
  const formatAspectRatio = (aspectRatio: string): string => {
    if (aspectRatio === "original") return t("properties.project.original");
    return aspectRatio; // Returns the ratio string like "16:9", "9:16", etc.
  };

  return (
    <div className="p-4 space-y-6">
      {/* Details Section */}
      <div>
        <div className="space-y-3">
          <div className="flex items-start justify-between py-2 border-b border-border-default/60">
            <span className="text-xs text-text-muted">{t("properties.project.name")}:</span>
            <span className="text-xs text-text-primary text-right font-medium">
              {project.name}
            </span>
          </div>

          <div className="flex items-start justify-between py-2 border-b border-border-default/60">
            <span className="text-xs text-text-muted">{t("properties.project.colorSpace")}:</span>
            <span className="text-xs text-text-primary font-medium">{t("properties.project.colorSpaceValue")}</span>
          </div>

          <div className="flex items-start justify-between py-2 border-b border-border-default/60">
            <span className="text-xs text-text-muted">{t("properties.project.importedMedia")}:</span>
            <span className="text-xs text-text-primary font-medium">
              {t("properties.project.stayInOriginalLocation")}
            </span>
          </div>

          <div className="flex items-start justify-between py-2 border-b border-border-default/60">
            <span className="text-xs text-text-muted">{t("properties.project.arrangeLayers")}:</span>
            <span className="text-xs text-text-primary font-medium">{t("common.status.enabled")}</span>
          </div>

          <div className="flex items-start justify-between py-2 border-b border-border-default/60">
            <span className="text-xs text-text-muted">{t("properties.project.proxy")}:</span>
            <span className="text-xs text-text-primary font-medium">{t("common.status.disabled")}</span>
          </div>
        </div>
      </div>

      {/* Timeline Settings Section */}
      <div>
        <div className="space-y-3">
          <div className="flex items-start justify-between py-2 border-b border-border-default/60">
            <span className="text-xs text-text-muted">{t("properties.project.timelineName")}:</span>
            <span className="text-xs text-text-primary font-medium">Timeline 01</span>
          </div>

          <div className="flex items-start justify-between py-2 border-b border-border-default/60">
            <span className="text-xs text-text-muted">{t("properties.project.aspectRatio")}:</span>
            <span className="text-xs text-text-primary font-medium">
              {formatAspectRatio(project.aspectRatio)}
            </span>
          </div>

          <div className="flex items-start justify-between py-2 border-b border-border-default/60">
            <span className="text-xs text-text-muted">{t("properties.project.resolution")}:</span>
            <span className="text-xs text-text-primary font-medium">
              {project.canvasWidth} × {project.canvasHeight}
            </span>
          </div>

          <div className="flex items-start justify-between py-2 border-b border-border-default/60">
            <span className="text-xs text-text-muted">{t("properties.project.frameRate")}:</span>
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
          {t("common.actions.modify")}
        </button>
      </div>
    </div>
  );
};
