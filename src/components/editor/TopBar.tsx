import React, { useState, lazy, Suspense } from "react";
import { Upload, Home, Settings, Minus, Square, Copy, X } from "lucide-react";
import { Button } from "../ui/Button";
import { useProjectStore } from "@/store/projectStore";
import { useUIStore } from "@/store/uiStore";
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
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  const { isFullscreen } = useTauriFullscreen();

  const handleClose = () => {
    if (onRequestClose) {
      onRequestClose();
    } else {
      closeProject();
    }
  };

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|Macintosh/.test(navigator.userAgent);
  const isTauriDesktop = platform.type === "tauri";

  const handleMinimize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch (e) {
      console.warn("[TopBar] Minimize window failed:", e);
    }
  };

  const handleToggleMaximize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWin = getCurrentWindow();
      await appWin.toggleMaximize();
      const maxState = await appWin.isMaximized();
      setIsMaximized(maxState);
    } catch (e) {
      console.warn("[TopBar] Toggle maximize failed:", e);
    }
  };

  const handleCloseWindow = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (e) {
      console.warn("[TopBar] Close window failed:", e);
      handleClose();
    }
  };

  return (
    <>
      {/* Single integrated header row - content shares the top line */}
      <div className="h-[30px] flex items-center justify-between gap-3 px-1" data-tauri-drag-region style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
        {/* Left side - starts after macOS traffic lights on Mac, or at edge on Windows */}
        <div className={`flex items-center gap-2 ${isTauriDesktop && isMac && !isFullscreen ? "pl-[70px]" : "pl-1"}`} data-tauri-drag-region>
          <Button variant="ghost" size="icon-sm" onClick={handleClose} title="Back to Home" style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
            <Home className="w-4 h-4" />
          </Button>
        </div>

        {/* Project Name (Center) */}
        <span className="text-xs font-semibold text-text-primary truncate max-w-[120px] sm:max-w-[240px] text-center" title={project?.name}>
          {project?.name}
        </span>

        {/* Right side - Settings, Export, and Windows Controls */}
        <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <Button variant="ghost" size="icon-sm" onClick={toggleSettingsModal} title="Settings" style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
            <Settings className="w-3.5 h-3.5" />
          </Button>

          <Button variant="default" size="sm" onClick={() => setShowExportDialog(true)} className="text-xs h-6 px-2.5" style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
            <Upload className="w-3.5 h-3.5 mr-1" />
            Export
          </Button>

          {/* Windows Window Controls (Minimize, Maximize/Restore, Close) */}
          {isTauriDesktop && !isMac && !isFullscreen && (
            <div className="flex items-center ml-1 border-l border-white/10 pl-1">
              <button
                type="button"
                onClick={handleMinimize}
                title="Minimize"
                className="w-6 h-6 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/10 rounded transition-colors"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              >
                <Minus className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={handleToggleMaximize}
                title={isMaximized ? "Restore" : "Maximize"}
                className="w-6 h-6 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/10 rounded transition-colors"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              >
                {isMaximized ? <Copy className="w-3 h-3 rotate-180" /> : <Square className="w-3 h-3" />}
              </button>
              <button
                type="button"
                onClick={handleCloseWindow}
                title="Close"
                className="w-6 h-6 flex items-center justify-center text-text-secondary hover:text-white hover:bg-red-600 rounded transition-colors"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
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
