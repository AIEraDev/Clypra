import React, { useState, lazy, Suspense } from "react";
import { Film, Upload, Home, Settings, Undo2, Redo2 } from "lucide-react";
import { Button } from "../ui/Button";
import { useProjectStore } from "@/store/projectStore";
import { useUIStore } from "@/store/uiStore";
import { useHistoryStore } from "@/store/historyStore";
import { useTauriFullscreen } from "@/hooks/useTauriFullscreen";
import { platform } from "@/core/platform";

// Lazy load ExportDialog
const ExportDialog = lazy(() => import("../ui/ExportDialog").then((m) => ({ default: m.ExportDialog })));

interface TopBarProps {
  onRequestClose?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ onRequestClose }) => {
  const { project, closeProject } = useProjectStore();
  const { toggleSettingsModal } = useUIStore();
  const historyState = useHistoryStore((s) => s.state);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  const [showExportDialog, setShowExportDialog] = useState(false);

  const { isFullscreen } = useTauriFullscreen();

  const handleClose = () => {
    if (onRequestClose) {
      onRequestClose();
    } else {
      // Fallback to direct close if no handler provided
      closeProject();
    }
  };

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|Macintosh/.test(navigator.userAgent);

  return (
    <>
      {/* Native title bar area - content positioned in the title bar */}
      <div className="h-[30px] flex items-center justify-between gap-3" data-tauri-drag-region style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
        {/* Left side - starts after traffic lights */}
        <div className={`flex items-center gap-2 ${platform.type === "tauri" && isMac && !isFullscreen ? "pl-[70px]" : "pl-2"}`} data-tauri-drag-region>
          <Button variant="ghost" size="icon-sm" onClick={handleClose} title="Back to Home" style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
            <Home className="w-4 h-4" />
          </Button>
        </div>

        <span className="text-xs font-semibold text-text-primary truncate max-w-[80px] sm:max-w-[200px] text-center" title={project?.name}>
          {project?.name}
        </span>

        {/* Right side - actions */}
        <div className="flex items-center gap-1.5">
          {/* Undo/Redo buttons with action-specific tooltips */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={undo}
            disabled={!historyState.canUndo}
            title={historyState.canUndo ? (historyState.undoLabel ? `Undo ${historyState.undoLabel}` : "Undo (Cmd+Z)") : "Nothing to undo"}
            className={!historyState.canUndo ? "opacity-30 pointer-events-none" : ""}
            style={{ WebkitAppRegion: "no-drag", cursor: historyState.canUndo ? "pointer" : "default" } as React.CSSProperties}
          >
            <Undo2 className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={redo}
            disabled={!historyState.canRedo}
            title={historyState.canRedo ? (historyState.redoLabel ? `Redo ${historyState.redoLabel}` : "Redo (Cmd+Shift+Z)") : "Nothing to redo"}
            className={!historyState.canRedo ? "opacity-30 pointer-events-none" : ""}
            style={{ WebkitAppRegion: "no-drag", cursor: historyState.canRedo ? "pointer" : "default" } as React.CSSProperties}
          >
            <Redo2 className="w-3.5 h-3.5" />
          </Button>

          <Button variant="ghost" size="icon-sm" onClick={toggleSettingsModal} title="Settings" style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
            <Settings className="w-3.5 h-3.5" />
          </Button>
          <Button variant="default" size="sm" onClick={() => setShowExportDialog(true)} className="text-xs h-6 px-2" style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
            <Upload className="w-3.5 h-3.5" />
            Export
          </Button>
        </div>
      </div>

      {/* Export Dialog */}
      {showExportDialog && (
        <Suspense fallback={null}>
          <ExportDialog isOpen={showExportDialog} onClose={() => setShowExportDialog(false)} />
        </Suspense>
      )}
    </>
  );
};
