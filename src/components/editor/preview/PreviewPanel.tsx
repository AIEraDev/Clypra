import React, { useEffect } from "react";
import { useUIStore } from "@/store/uiStore";
import { hideNativeSurfaceWhenIdle } from "@/core/runtime/nativeSurfaceLifecycle";
import { SourcePreview } from "./SourcePreview";
import { ProgramPreview } from "./ProgramPreview";

interface PreviewPanelProps {
  /** Override the monitor role for layouts that render both monitors together. */
  mode?: "program" | "source";
}

const PreviewPanelComponent: React.FC<PreviewPanelProps> = ({ mode }) => {
  const selectedPreviewMode = useUIStore((s) => s.previewMode);
  const previewMode = mode ?? selectedPreviewMode;

  useEffect(() => {
    if (previewMode === "source") {
      void hideNativeSurfaceWhenIdle().catch(() => undefined);
    }
  }, [previewMode]);

  // Mount exactly one playback space at a time. Source media and program
  // preview therefore cannot share DOM media elements or render lifecycles.
  if (previewMode === "source") {
    return <SourcePreview key="source-preview-space" />;
  }

  return <ProgramPreview key="program-preview-space" />;
};

// Memoize to prevent re-renders when parent (EditorLayout) re-renders due to window resize
export const PreviewPanel = React.memo(PreviewPanelComponent);
