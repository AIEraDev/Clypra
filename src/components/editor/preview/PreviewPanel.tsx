import React from "react";
import { useUIStore } from "@/store/uiStore";
import { SourcePreview } from "./SourcePreview";
import { ProgramPreview } from "./ProgramPreview";

const PreviewPanelComponent: React.FC = () => {
  const previewMode = useUIStore((s) => s.previewMode);

  // Mount exactly one playback space at a time. Source media and program
  // preview therefore cannot share DOM media elements or render lifecycles.
  if (previewMode === "source") {
    return <SourcePreview key="source-preview-space" />;
  }

  return <ProgramPreview key="program-preview-space" />;
};

// Memoize to prevent re-renders when parent (EditorLayout) re-renders due to window resize
export const PreviewPanel = React.memo(PreviewPanelComponent);
