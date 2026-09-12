import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import {
  Upload,
  Home,
  Settings,
  PanelLeft,
  PanelRight,
  Smartphone,
  ChevronDown,
  Image as ImageIcon,
  Video as VideoIcon,
} from "lucide-react";
import { Button } from "../ui/Button";
import { useProjectStore } from "@/store/projectStore";
import { useUIStore } from "@/store/uiStore";
import { useSettingsStore } from "@/store/settingsStore";
import { platform } from "@/core/platform";
import { isMacOSPlatform, WindowControls, WindowDragRegion } from "../ui/WindowControls";
import { LayoutPresetMenu } from "./layout/LayoutPresetMenu";
import { hideNativeSurfaceWhenIdle } from "@/core/runtime/nativeSurfaceLifecycle";
import { useClickOutside } from "@/hooks";

// Lazy load ExportDialog
const ExportDialog = lazy(() => import("../ui/ExportDialog").then((m) => ({ default: m.ExportDialog })));

// Lazy load ThumbnailWorkspace
const ThumbnailWorkspace = lazy(() =>
  import("@/features/creator-thumbnails/ThumbnailWorkspace").then((m) => ({
    default: m.ThumbnailWorkspace,
  })),
);

interface TopBarProps {
  onRequestClose?: () => void;
}

const TopBarComponent: React.FC<TopBarProps> = ({ onRequestClose }) => {
  const projectName = useProjectStore((s) => s.project?.name);
  const closeProject = useProjectStore((s) => s.closeProject);
  const toggleSettingsModal = useUIStore((s) => s.toggleSettingsModal);
  const toggleTransferModal = useUIStore((s) => s.toggleTransferModal);
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const propertiesPanelCollapsed = useSettingsStore((s) => s.propertiesPanelCollapsed);
  const setPropertiesPanelCollapsed = useSettingsStore((s) => s.setPropertiesPanelCollapsed);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showThumbnailWorkspace, setShowThumbnailWorkspace] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useClickOutside(exportMenuRef, () => setShowExportMenu(false), { enabled: showExportMenu });

  useEffect(() => {
    if (showExportDialog || showThumbnailWorkspace || showExportMenu) {
      void hideNativeSurfaceWhenIdle().catch(() => undefined);
    }
  }, [showExportDialog, showThumbnailWorkspace, showExportMenu]);

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

        {/* Right side - Panel Toggles, Layout Switcher, Settings & Export */}
        <div className="flex items-center gap-1 shrink-0" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? "Expand Media Library (⌘B)" : "Collapse Media Library (⌘B)"}
            className={`transition-colors ${!sidebarCollapsed ? "text-accent bg-accent/10" : "text-text-muted hover:text-text-primary"}`}
            style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPropertiesPanelCollapsed(!propertiesPanelCollapsed)}
            title={propertiesPanelCollapsed ? "Expand Properties Panel (⌥P)" : "Collapse Properties Panel (⌥P)"}
            className={`transition-colors ${!propertiesPanelCollapsed ? "text-accent bg-accent/10" : "text-text-muted hover:text-text-primary"}`}
            style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}
          >
            <PanelRight className="w-3.5 h-3.5" />
          </Button>

          <div className="w-px h-3.5 bg-border/60 mx-0.5" />

          <LayoutPresetMenu />

          <Button variant="ghost" size="icon-sm" onClick={toggleTransferModal} title="Phone Transfer (Local WiFi)" style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
            <Smartphone className="w-3.5 h-3.5" />
          </Button>

          <Button variant="ghost" size="icon-sm" onClick={toggleSettingsModal} title="Settings" style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
            <Settings className="w-3.5 h-3.5" />
          </Button>

          {/* Export & Thumbnail Dropdown */}
          <div className="relative inline-flex items-center" ref={exportMenuRef}>
            <div className="flex items-center rounded-md bg-accent text-accent-foreground shadow-sm">
              <Button
                variant="default"
                size="sm"
                onClick={() => setShowExportDialog(true)}
                className="text-xs h-6 px-2 rounded-r-none border-r border-accent-foreground/20"
                style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}
                title="Export Video (MP4, MOV, ProRes)"
              >
                <Upload className="w-3.5 h-3.5 mr-1" />
                Export
              </Button>
              <Button
                variant="default"
                size="icon-sm"
                onClick={() => setShowExportMenu((prev) => !prev)}
                className="h-6 w-5 px-0 rounded-l-none"
                style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}
                title="Export options & thumbnail generator"
              >
                <ChevronDown className="w-3 h-3" />
              </Button>
            </div>

            {showExportMenu && (
              <div
                className="absolute right-0 top-full mt-1.5 w-56 rounded-xl bg-neutral-900/95 border border-neutral-800 shadow-2xl p-1.5 z-50 backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              >
                <button
                  type="button"
                  onClick={() => {
                    setShowExportMenu(false);
                    setShowExportDialog(true);
                  }}
                  className="w-full flex items-start gap-2.5 p-2 rounded-lg text-left text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
                >
                  <VideoIcon className="w-4 h-4 text-sky-400 mt-0.5 flex-shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-neutral-100">Export Video</span>
                    <span className="text-[10px] text-neutral-400 leading-tight mt-0.5">
                      MP4, MOV, ProRes with GPU acceleration
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowExportMenu(false);
                    setShowThumbnailWorkspace(true);
                  }}
                  className="w-full flex items-start gap-2.5 p-2 rounded-lg text-left text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
                >
                  <ImageIcon className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-neutral-100 flex items-center gap-1.5">
                      Create Thumbnail
                      <span className="text-[9px] px-1 py-0.2 rounded bg-amber-400/20 text-amber-300 font-mono font-bold">
                        NEW
                      </span>
                    </span>
                    <span className="text-[10px] text-neutral-400 leading-tight mt-0.5">
                      YouTube, Shorts, TikTok frame compositing
                    </span>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Export Dialog */}
      {showExportDialog && (
        <Suspense fallback={null}>
          <ExportDialog isOpen={showExportDialog} onClose={() => setShowExportDialog(false)} />
        </Suspense>
      )}

      {/* Thumbnail Generator Workspace */}
      {showThumbnailWorkspace && (
        <Suspense fallback={null}>
          <ThumbnailWorkspace
            isOpen={showThumbnailWorkspace}
            onClose={() => setShowThumbnailWorkspace(false)}
          />
        </Suspense>
      )}
    </>
  );
};

export const TopBar = React.memo(TopBarComponent);

