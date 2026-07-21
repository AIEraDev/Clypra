import React, { useState, lazy, Suspense } from "react";
import { Upload, Home, Settings, Undo2, Redo2 } from "lucide-react";
import { Button } from "../ui/Button";
import { t } from "@/i18n";
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
  const { state: historyState, undo, redo } = useHistoryStore();
  const [showExportDialog, setShowExportDialog] = useState(false);
  const undoTitle = historyState.undoLabel ? t("editor.topBar.undoAction", { action: historyState.undoLabel }) : t("editor.topBar.undo");
  const redoTitle = historyState.redoLabel ? t("editor.topBar.redoAction", { action: historyState.redoLabel }) : t("editor.topBar.redo");

  const { isFullscreen } = useTauriFullscreen();

  const handleClose = () => {
    if (onRequestClose) {
      onRequestClose();
    } else {
      // Fallback to direct close if no handler provided
      closeProject();
    }
  };

  return (
    <>
      {/* Native title bar area - content positioned in the title bar */}
      <div className="h-[30px] flex items-center justify-between gap-3" data-tauri-drag-region style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
        {/* Left side - starts after traffic lights */}
        <div className={`flex items-center gap-2 ${platform.type === "tauri" && !isFullscreen ? "pl-[70px]" : ""}`} data-tauri-drag-region>
          <Button variant="ghost" size="icon-sm" onClick={handleClose} title={t("editor.topBar.backHome")} aria-label={t("editor.topBar.backHome")} style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
            <Home className="w-4 h-4" />
          </Button>
        </div>

        <span className="text-xs font-semibold text-text-primary truncate max-w-[80px] sm:max-w-[200px] text-center" title={project?.name}>
          {project?.name}
        </span>

        {/* Right side - actions */}
        <div className="flex items-center gap-1.5">
          {/* Undo/Redo buttons with action-specific tooltips */}
          {historyState.canUndo && (
            <Button variant="ghost" size="icon-sm" onClick={undo} title={undoTitle} aria-label={undoTitle} style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
              <Undo2 className="w-3.5 h-3.5" />
            </Button>
          )}
          {historyState.canRedo && (
            <Button variant="ghost" size="icon-sm" onClick={redo} title={redoTitle} aria-label={redoTitle} style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
              <Redo2 className="w-3.5 h-3.5" />
            </Button>
          )}

          <Button variant="ghost" size="icon-sm" onClick={toggleSettingsModal} title={t("common.settings")} aria-label={t("common.settings")} style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
            <Settings className="w-3.5 h-3.5" />
          </Button>
          <Button variant="default" size="sm" onClick={() => setShowExportDialog(true)} title={t("system.export.action.export")} aria-label={t("system.export.action.export")} className="text-xs h-6 px-2" style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
            <Upload className="w-3.5 h-3.5" />
            {t("system.export.action.export")}
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
