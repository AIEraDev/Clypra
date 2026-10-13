import React, { useEffect } from "react";
// @ts-ignore - react-dnd types issue
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { EditorLayout } from "@/components/editor/EditorLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { usePlaybackControls } from "@/hooks/usePlaybackClock";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useGlobalSelectionDeselect } from "@/hooks/useGlobalSelectionDeselect";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";

interface EditorScreenProps {
  onRequestClose?: () => void;
}

export const EditorScreen: React.FC<EditorScreenProps> = ({
  onRequestClose,
}) => {
  useKeyboardShortcuts();
  useGlobalSelectionDeselect();
  const { setDuration } = usePlaybackControls();
  const projectDuration = useProjectStore((s) => s.project?.duration ?? 0);
  const timelineDuration = useTimelineStore((s) => s.getTimelineEndTime());

  useEffect(() => {
    const effectiveDuration =
      timelineDuration > 0
        ? timelineDuration
        : projectDuration > 0
          ? projectDuration
          : 10;
    setDuration(effectiveDuration);
  }, [projectDuration, timelineDuration, setDuration]);

  // Force page/preview rendering when the editor screen mounts
  useEffect(() => {
    import("@/components/editor/preview/NativeProgramPreview")
      .then(({ forceRepaintNativeProgramPreview }) => {
        forceRepaintNativeProgramPreview();
      })
      .catch(() => {});
  }, []);

  return (
    <ErrorBoundary>
      <DndProvider backend={HTML5Backend}>
        <div className="w-full h-full overflow-hidden">
          <EditorLayout onRequestClose={onRequestClose} />
        </div>
      </DndProvider>
    </ErrorBoundary>
  );
};
