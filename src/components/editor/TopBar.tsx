import React, { useState, lazy, Suspense } from "react";
import { Upload, Home, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/Button";
import { useProjectStore } from "@/store/projectStore";
import { useUIStore } from "@/store/uiStore";
import { useHistoryStore } from "@/store/historyStore";
import { useTauriFullscreen } from "@/hooks/useTauriFullscreen";
import { platform } from "@/core/platform";

// Lazy load ExportDialog
const ExportDialog = lazy(() => import("../ui/ExportDialog").then((m) => ({ default: m.ExportDialog })));

export const TopBar: React.FC = () => {
  const { t } = useTranslation();
  const { project, closeProject } = useProjectStore();
  const { toggleSettingsModal } = useUIStore();
  const { state: historyState } = useHistoryStore();
  const [showExportDialog, setShowExportDialog] = useState(false);

  const { isFullscreen } = useTauriFullscreen();

  return (
    <>
      {/* Native title bar area - content positioned in the title bar */}
      <div className="h-[30px] flex items-center justify-between gap-3" data-tauri-drag-region style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
        {/* Left side - starts after traffic lights */}
        <div className={`flex items-center gap-2 ${platform.type === "tauri" && !isFullscreen ? "pl-[70px]" : ""}`} data-tauri-drag-region>
          <Button variant="ghost" size="icon-sm" onClick={closeProject} title={t("topbar.backToHome")} style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
            <Home className="w-4 h-4" />
          </Button>
        </div>

        <span className="text-xs font-semibold text-text-primary truncate max-w-[80px] sm:max-w-[200px] text-center" title={project?.name}>
          {project?.name}
        </span>

        {/* Right side - actions */}
        <div className="flex items-center gap-1.5">
          {/* Undo/Redo indicator */}
          {(historyState.canUndo || historyState.canRedo) && (
            <div className="hidden sm:flex items-center gap-1 text-[10px] text-text-muted mr-1">
              <span title={t("topbar.undoAvailable", { n: historyState.position + 1 })}>{t("topbar.undoCount", { n: historyState.position + 1 })}</span>
              {historyState.canRedo && (
                <>
                  <span>•</span>
                  <span title={t("topbar.redoAvailable", { n: historyState.size - historyState.position - 1 })}>{t("topbar.redoCount", { n: historyState.size - historyState.position - 1 })}</span>
                </>
              )}
            </div>
          )}

          <Button variant="ghost" size="icon-sm" onClick={toggleSettingsModal} title={t("topbar.settings")} style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
            <Settings className="w-3.5 h-3.5" />
          </Button>
          <Button variant="default" size="sm" onClick={() => setShowExportDialog(true)} className="text-xs h-6 px-2" style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
            <Upload className="w-3.5 h-3.5" />
            {t("topbar.export")}
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
