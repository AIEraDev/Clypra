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
import { isMacOSPlatform } from "@/lib/platform/windowPlatform";
import { LayoutPresetMenu } from "./layout/LayoutPresetMenu";
import { hideNativeSurfaceWhenIdle } from "@/core/runtime/nativeSurfaceLifecycle";
import { forceRepaintNativeProgramPreview } from "@/core/preview/previewRepaintCoordinator";
import { useClickOutside } from "@/hooks";
import { useI18n } from "@/i18n";

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
  const { t } = useI18n();
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
  const showSettingsModal = useUIStore((s) => s.showSettingsModal);
  const showTransferModal = useUIStore((s) => s.showTransferModal);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useClickOutside(exportMenuRef, () => setShowExportMenu(false), { enabled: showExportMenu });

  const hasOpenTopBarOverlay = Boolean(
    showExportDialog ||
    showThumbnailWorkspace ||
    showExportMenu ||
    showSettingsModal ||
    showTransferModal,
  );

  useEffect(() => {
    if (hasOpenTopBarOverlay) {
      void hideNativeSurfaceWhenIdle().catch(() => undefined);
    } else {
      forceRepaintNativeProgramPreview();
    }
  }, [hasOpenTopBarOverlay]);

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
      {/* The native menu/title bar owns window controls. This is the editor's
          document-command row: identity stays left, commands stay right, and
          neither competes with native chrome for horizontal space. */}
      <div className="h-9 shrink-0 flex items-center gap-2 border-b border-border-default/80 bg-surface-panel/95 backdrop-blur-md px-2 shadow-xs select-none">
        <div
          className={`flex min-w-0 items-center gap-2 shrink-0 ${isMacNativeWindow ? "pl-[76px]" : "pl-0"}`}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleClose}
            title={t("project.backHome")}
            aria-label={t("project.backHome")}
            className="text-text-muted hover:text-text-primary hover:bg-surface-hover"
            style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}
          >
            <Home className="w-4 h-4" />
          </Button>
          <div className="h-4 w-px bg-border-default/70" aria-hidden="true" />
          <span
            className="max-w-[180px] truncate text-xs font-semibold text-text-primary sm:max-w-[320px]"
            title={projectName || t("common.labels.untitledProject")}
          >
            {projectName || t("common.labels.untitledProject")}
          </span>
        </div>

        <div
          className="min-w-0 flex-1 self-stretch"
          aria-hidden="true"
          data-tauri-drag-region
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />

        {/* Fixed command cluster: its own row and shrink-0 keep action buttons
            aligned regardless of title length or native window state. */}
        <div className="flex items-center gap-1 shrink-0" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? t("topbar.expandMedia") : t("topbar.collapseMedia")}
            aria-label={sidebarCollapsed ? t("topbar.expandMedia") : t("topbar.collapseMedia")}
            className={`transition-colors ${!sidebarCollapsed ? "text-accent-primary bg-accent-primary/10" : "text-text-muted hover:text-text-primary hover:bg-surface-hover"}`}
            style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPropertiesPanelCollapsed(!propertiesPanelCollapsed)}
            title={propertiesPanelCollapsed ? t("topbar.expandProperties") : t("topbar.collapseProperties")}
            aria-label={propertiesPanelCollapsed ? t("topbar.expandProperties") : t("topbar.collapseProperties")}
            className={`transition-colors ${!propertiesPanelCollapsed ? "text-accent-primary bg-accent-primary/10" : "text-text-muted hover:text-text-primary hover:bg-surface-hover"}`}
            style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}
          >
            <PanelRight className="w-3.5 h-3.5" />
          </Button>

          <div className="w-px h-3.5 bg-border-default/60 mx-0.5" />

          <LayoutPresetMenu />

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleTransferModal}
            title={t("topbar.phoneTransfer")}
            aria-label={t("topbar.phoneTransfer")}
            className="text-text-muted hover:text-text-primary hover:bg-surface-hover"
            style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}
          >
            <Smartphone className="w-3.5 h-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleSettingsModal}
            title={t("settings.modal.title")}
            aria-label={t("settings.modal.title")}
            className="text-text-muted hover:text-text-primary hover:bg-surface-hover"
            style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}
          >
            <Settings className="w-3.5 h-3.5" />
          </Button>

          {/* Export & Thumbnail Dropdown */}
          <div className="relative inline-flex items-center" ref={exportMenuRef}>
            <div className="flex items-center rounded-lg bg-accent-primary text-white shadow-xs overflow-hidden">
              <Button
                variant="default"
                size="sm"
                onClick={() => setShowExportDialog(true)}
                className="text-xs h-6 px-2.5 rounded-none bg-accent-primary hover:bg-accent-primary/90 text-white font-medium"
                style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}
                title={t("export.video")}
                aria-label={t("export.video")}
              >
                <Upload className="w-3.5 h-3.5 mr-1" />
                {t("common.actions.export")}
              </Button>
              <Button
                variant="default"
                size="icon-sm"
                onClick={() => setShowExportMenu((prev) => !prev)}
                className="h-6 w-5 px-0 rounded-none bg-accent-primary hover:bg-accent-primary/90 text-white border-l border-white/20"
                style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}
                title={t("common.actions.moreOptions")}
                aria-label={t("common.actions.moreOptions")}
              >
                <ChevronDown className="w-3 h-3" />
              </Button>
            </div>

            {showExportMenu && (
              <div
                className="absolute right-0 top-full mt-1.5 w-60 rounded-xl bg-surface-floating border border-border-default shadow-2xl p-1.5 z-50 backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              >
                <button
                  type="button"
                  onClick={() => {
                    setShowExportMenu(false);
                    setShowExportDialog(true);
                  }}
                  className="w-full flex items-start gap-2.5 p-2 rounded-lg text-left text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors cursor-pointer"
                >
                  <VideoIcon className="w-4 h-4 text-accent-primary mt-0.5 flex-shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-text-primary">{t("export.menu.videoTitle")}</span>
                    <span className="text-[10px] text-text-muted leading-tight mt-0.5">
                      {t("export.menu.videoDesc")}
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowExportMenu(false);
                    setShowThumbnailWorkspace(true);
                  }}
                  className="w-full flex items-start gap-2.5 p-2 rounded-lg text-left text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors cursor-pointer"
                >
                  <ImageIcon className="w-4 h-4 text-status-warning mt-0.5 flex-shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-text-primary flex items-center gap-1.5">
                      {t("export.menu.thumbTitle")}
                      <span className="text-[9px] px-1 py-0.2 rounded bg-status-warning/15 text-status-warning font-mono font-bold">
                        {t("common.labels.new")}
                      </span>
                    </span>
                    <span className="text-[10px] text-text-muted leading-tight mt-0.5">
                      {t("export.menu.thumbDesc")}
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
