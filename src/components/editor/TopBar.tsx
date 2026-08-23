import React, { useState, lazy, Suspense } from "react";
import { Upload, Home, Settings } from "lucide-react";
import { Button } from "../ui/Button";
import { useProjectStore } from "@/store/projectStore";
import { useUIStore } from "@/store/uiStore";
import { platform } from "@/core/platform";
import { isMacOSPlatform, WindowControls, WindowDragRegion } from "../ui/WindowControls";
import { LayoutPresetMenu } from "./layout/LayoutPresetMenu";

// Lazy load ExportDialog
const ExportDialog = lazy(() => import("../ui/ExportDialog").then((m) => ({ default: m.ExportDialog })));

interface TopBarProps {
  onRequestClose?: () => void;
}

const TopBarComponent: React.FC<TopBarProps> = ({ onRequestClose }) => {
  const projectName = useProjectStore((s) => s.project?.name);
  const closeProject = useProjectStore((s) => s.closeProject);
  const toggleSettingsModal = useUIStore((s) => s.toggleSettingsModal);
  const [showExportDialog, setShowExportDialog] = useState(false);

  const handleClose = () => {
    if (onRequestClose) {
      onRequestClose();
    } else {
      closeProject();
    }
  };

  const isMacNativeWindow = platform.type === "tauri" && isMacOSPlatform();

  return (
    <>
      {/* The drag region is intentionally separate from every interactive control. */}
      <div className="h-8 shrink-0 flex items-center gap-2 px-1 select-none">
        {platform.type === "tauri" && !isMacNativeWindow && <WindowControls className="mr-1" />}

        <div className={`flex items-center gap-2 shrink-0 ${isMacNativeWindow ? "pl-[76px]" : "pl-1"}`} style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <Button variant="ghost" size="icon-sm" onClick={handleClose} title="Back to Home" style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
            <Home className="w-4 h-4" />
          </Button>
        </div>

        {/* Project Name (Center) */}
        <span className="text-xs font-semibold text-text-primary truncate max-w-[120px] sm:max-w-[240px] text-center shrink-0" title={projectName}>
          {projectName}
        </span>

        <WindowDragRegion />

        {/* Right side - Layout Switcher, Settings & Export */}
        <div className="flex items-center gap-1.5 shrink-0" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <LayoutPresetMenu />

          <Button variant="ghost" size="icon-sm" onClick={toggleSettingsModal} title="Settings" style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
            <Settings className="w-3.5 h-3.5" />
          </Button>

          <Button variant="default" size="sm" onClick={() => setShowExportDialog(true)} className="text-xs h-6 px-2.5" style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
            <Upload className="w-3.5 h-3.5 mr-1" />
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

export const TopBar = React.memo(TopBarComponent);

