import React from "react";
import { useUIStore } from "@/store/uiStore";
import { SourcePreview } from "./SourcePreview";
import { ProgramPreview } from "./ProgramPreview";
import { useLanguage } from "@/i18n";

const PreviewPanelComponent: React.FC = () => {
  useLanguage();
  const { previewMode } = useUIStore();

  console.info("[PreviewLifecycle] PreviewPanel rendering, mode:", previewMode);

  // If in source mode, show SourcePreview
  if (previewMode === "source") {
    return <SourcePreview />;
  }

  return <ProgramPreview />;
};

// Memoize to prevent re-renders when parent (EditorLayout) re-renders due to window resize
export const PreviewPanel = React.memo(PreviewPanelComponent);
