import React from "react";
import { useUIStore } from "@/store/uiStore";
import { PreviewPanel } from "./PreviewPanel";
import { SourcePreview } from "./SourcePreview";

export type PreviewMonitorOrientation = "row" | "column";

interface PreviewMonitorWorkspaceProps {
  orientation: PreviewMonitorOrientation;
}

/**
 * Owns the physical monitor split for layouts that can show a source asset
 * and the program output at the same time. PreviewPanel remains a single
 * monitor; this component is the only place that composes both monitors.
 */
export const PreviewMonitorWorkspace: React.FC<PreviewMonitorWorkspaceProps> = ({
  orientation,
}) => {
  const sourceAsset = useUIStore((state) => state.sourceAsset);
  const sourceTextPreset = useUIStore((state) => state.sourceTextPreset);
  const hasSourcePreview = Boolean(sourceAsset || sourceTextPreset);

  if (!hasSourcePreview) {
    return <PreviewPanel mode="program" />;
  }

  const directionClass = orientation === "row" ? "flex-row" : "flex-col";

  return (
    <div
      data-preview-workspace="source-program"
      className={`flex ${directionClass} flex-1 min-h-0 min-w-0 overflow-hidden gap-1 bg-bg`}
    >
      <div
        data-preview-monitor="source"
        className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden panel-shell"
      >
        <SourcePreview claimTransportOnMount={false} />
      </div>
      <div
        data-preview-monitor="program"
        className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden panel-shell"
      >
        <PreviewPanel mode="program" />
      </div>
    </div>
  );
};
