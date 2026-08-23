import React, { useEffect } from "react";
// @ts-ignore - react-dnd types issue
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { EditorLayout } from "@/components/editor/EditorLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { usePlaybackControls } from "@/hooks/usePlaybackClock";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useProjectStore } from "@/store/projectStore";

interface EditorScreenProps {
  onRequestClose?: () => void;
}

export const EditorScreen: React.FC<EditorScreenProps> = ({ onRequestClose }) => {
  useKeyboardShortcuts();
  const { setDuration } = usePlaybackControls();
  const projectDuration = useProjectStore((s) => s.project?.duration ?? 0);

  useEffect(() => {
    setDuration(projectDuration);
  }, [projectDuration, setDuration]);

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
