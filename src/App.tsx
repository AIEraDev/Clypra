import { useState, useEffect } from "react";
import { LaunchScreen } from "@/components/screens/LaunchScreen";
import { EditorScreen } from "@/components/screens/EditorScreen";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { useProjectStore } from "@/store/projectStore";
import { useUIStore } from "@/store/uiStore";
import type { Project, AspectRatio } from "@/types";
import { fromRustProject, fromRustTrack, fromRustClip, type RustProject } from "@/types/serialization";
import { platform } from "@/core/platform";
import { SettingsModal } from "./components/ui/SettingsModal";
import { ClosingProjectModal } from "./components/ui/ClosingProjectModal";
import { CrashRecoveryDialog } from "./components/ui/CrashRecoveryDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary"; // Add root error boundary
import { initializePerformanceAdapter, shutdownPerformanceAdapter } from "@/lib/platform/performanceAdapter";
import { hasSnapshot, getSnapshot, clearSnapshot, type RecoverySnapshot } from "@/core/runtime/CrashRecoveryService";
import { lifecycleMonitor } from "@/lib/monitoring/LifecycleMonitor";
import { useRecordingStore } from "@/store/recordingStore";
import { FloatingWidget } from "@/components/ui/FloatingWidget";
import { ScreenRecordingPreviewModal } from "@/components/ui/ScreenRecordingPreviewModal";
import { useAutoUpdater } from "@/hooks/useAutoUpdater";
import { UpdateBanner } from "@/components/ui/UpdateBanner";
import { t, useLanguage } from "@/i18n";

// const isExternalOrDataUrl = (value: string) => value.startsWith("data:") || value.startsWith("http") || value.startsWith("asset://");

const App = () => {
  useLanguage();
  const { project, createProject, loadProject, setRecentProjects } = useProjectStore();
  const [isLoading, setIsLoading] = useState(true);
  const { showSettingsModal, toggleSettingsModal } = useUIStore();
  const [pendingRecovery, setPendingRecovery] = useState<RecoverySnapshot | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isClosingProject, setIsClosingProject] = useState(false);
  const [projectNameBeforeClose, setProjectNameBeforeClose] = useState<string>("");
  const { isRecording, previewRecording, setPreviewRecording } = useRecordingStore();
  const autoUpdater = useAutoUpdater();

  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Initialize performance adapter for mobile optimizations
        await initializePerformanceAdapter();

        const projects = await platform.getRecentProjects();
        setRecentProjects(projects);

        // ── Crash recovery check ─────────────────────────────────────────
        // If the previous session was not closed cleanly (crash / browser refresh),
        // an IndexedDB snapshot will exist. Prompt the user to restore it.
        const recovered = await hasSnapshot();
        if (recovered) {
          const snapshot = await getSnapshot();
          if (snapshot) {
            lifecycleMonitor.record("CRASH_RECOVERY_FOUND", {
              projectId: snapshot.project.id,
              detail: { savedAt: snapshot.savedAt },
            });
            setPendingRecovery(snapshot);
          }
        }
      } catch (error) {
        console.error("Failed to initialize app:", error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeApp();

    // Cleanup on unmount
    return () => {
      shutdownPerformanceAdapter();
    };
  }, [setRecentProjects]);

  // ─── DEV MODE: Automated Resource Leak Detection ───────────────────────────
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    // Periodic leak check every 30 seconds in dev mode
    const leakCheckInterval = setInterval(() => {
      // Dynamically import to avoid bundling in production
      import("@/lib/monitoring/ResourceTracker")
        .then(({ resourceTracker }) => {
          const report = resourceTracker.findLeaks();

          if (report.totalLeaked > 0) {
            console.warn(`⚠️ [DEV] RESOURCE LEAKS DETECTED: ${report.totalLeaked} resource(s) from old project still alive`, {
              activeProject: report.activeProjectId,
              leaks: report.leaks.map((r) => ({
                id: r.id,
                kind: r.kind,
                projectId: r.projectId,
                aliveForMs: Date.now() - r.createdAt,
              })),
            });

            // Also log individual leaks for easier debugging
            report.leaks.forEach((leak) => {
              console.warn(`  🔴 Leaked ${leak.kind}: ${leak.id} (project: ${leak.projectId}, alive: ${Math.round((Date.now() - leak.createdAt) / 1000)}s)`, leak.stack ? `\n${leak.stack}` : "");
            });
          }
        })
        .catch((err) => {
          console.error("[DEV] Leak detection error:", err);
        });
    }, 30000); // Check every 30 seconds

    return () => clearInterval(leakCheckInterval);
  }, []);
  // ───────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (import.meta.env.DEV || !platform.isTauri()) return;

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isMetaOrCtrl = event.metaKey || event.ctrlKey;
      const isDevtoolsCombo = isMetaOrCtrl && event.shiftKey && (key === "i" || key === "j" || key === "c");
      const isInspectorKey = key === "f12";

      if (isDevtoolsCombo || isInspectorKey) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  const handleCreateProject = (name: string, aspectRatio: AspectRatio, frameRate: 24 | 30 | 60, initialClipPaths?: string[]) => {
    // Reset UI state from any previous session
    useUIStore.getState().exitSourceMode();
    createProject(name, aspectRatio, frameRate);

    if (initialClipPaths && initialClipPaths.length > 0) {
      setTimeout(async () => {
        try {
          const { generateId } = await import("@/lib/utils/id");

          for (const path of initialClipPaths) {
            try {
              const filename = path.split(/[/\\]/).pop() || "recording.webm";

              // Convert native FS path to a webview-renderable asset:// URL so the
              // video element can actually load the file in the Tauri WKWebView sandbox.
              let displayPath = path;
              try {
                displayPath = platform.convertFileSrc(path);
              } catch {
                // Not running inside Tauri — keep the raw path (dev/web fallback)
              }

              const metadata = await platform.getMediaMetadata(path);
              const posterFrame = await platform.extractPosterFrame(path, metadata.duration, window.devicePixelRatio || 1.0).catch(() => undefined);

              const asset = {
                id: generateId("asset"),
                name: filename,
                // Store the webview-safe URL so <video src> can render it
                path: displayPath,
                type: "video" as const,
                duration: metadata.duration,
                width: metadata.width,
                height: metadata.height,
                posterFrame,
                size: 0,
              };

              // Add to media panel only — do NOT add to timeline
              useProjectStore.getState().addMediaAsset(asset);
            } catch (innerErr) {
              console.error("[App] Failed to import path:", path, innerErr);
            }
          }
        } catch (err) {
          console.error("[App] Failed to auto-import initial recordings:", err);
        }
      }, 500);
    }
  };

  const handleOpenProject = async (proj: Project) => {
    try {
      useUIStore.getState().exitSourceMode();

      const appData = await platform.appDataDir();
      const projectPath = await platform.joinPaths(appData, "projects", `${proj.id}.json`);

      const projectJson = await platform.loadProject(projectPath);
      const rustProject: RustProject = JSON.parse(projectJson);

      const project = fromRustProject(rustProject);

      const mediaAssetsPayload = project.mediaAssets ?? [];
      const tracksPayload = rustProject.tracks?.map(fromRustTrack) ?? [];
      const clipsPayload = rustProject.clips?.map(fromRustClip) ?? [];
      const transitionsPayload = rustProject.transitions ?? [];

      // Resolve kind for legacy projects
      const assetMap = new Map(mediaAssetsPayload.map((a) => [a.id, a]));
      for (const clip of clipsPayload) {
        if (!clip.kind) {
          if ("text" in clip || clip.id.startsWith("text-clip-")) {
            clip.kind = "text";
          } else if (clip.mediaId.startsWith("sticker-")) {
            clip.kind = "sticker";
          } else if (clip.id.startsWith("filter-clip-")) {
            clip.kind = "filter";
          } else {
            const asset = assetMap.get(clip.mediaId);
            if (asset) {
              clip.kind = asset.type; // "video" | "audio" | "image"
            }
          }
        }
      }

      await loadProject(project, { mediaAssets: mediaAssetsPayload, tracks: tracksPayload, clips: clipsPayload, transitions: transitionsPayload });

      setTimeout(async () => {
        const { useTimelineStore } = await import("./store/timelineStore");
        const timelineState = useTimelineStore.getState();

        // NOTE: swatch property has been removed from Clip type
        // Heal any legacy/bugged filter clips on the timeline that are missing their swatch
        /*
        const filterClips = timelineState.clips.filter((c) => c.kind === "filter");
        if (filterClips.length > 0) {
          try {
            const { filterCacheManager } = await import("./features/filters/cache/filterCache");
            await filterCacheManager.initialize();

            for (const clip of filterClips) {
              if (!clip.swatch) {
                const cached = filterCacheManager.getCached(clip.mediaId);
                if (cached?.filter?.swatch) {
                  console.log(`[App] Healing empty swatch for filter clip: ${clip.id}`);
                  timelineState.updateClip(clip.id, { swatch: cached.filter.swatch });
                } else {
                  // Fallback: try loading or downloading the filter from disk/API
                  const details = await filterCacheManager.loadCachedFilter(clip.mediaId);
                  if (details?.swatch) {
                    console.log(`[App] Healed swatch for filter clip from cache file: ${clip.id}`);
                    timelineState.updateClip(clip.id, { swatch: details.swatch });
                  }
                }
              }
            }
          } catch (err) {
            console.warn("[App] Failed to heal timeline filters on project load:", err);
          }
        }
        */
      }, 200);
    } catch (error) {
      console.error("[OpenProject] Failed to open project:", error);
      useProjectStore.getState().showToast(t("project.openFailed"), "error");
    }
  };

  /**
   * Restore the project state from a crash-recovery IndexedDB snapshot.
   * Hydrates projectStore and timelineStore directly from the saved data.
   */
  const handleRestoreSession = async () => {
    if (!pendingRecovery) return;
    setIsRestoring(true);
    try {
      // BUG-008 fix: useTimelineStore import removed — loadProject() handles hydration.
      const { tracks, clips, transitions, mediaAssets, project } = pendingRecovery;

      // Hydrate project store (sets active project)
      await loadProject(project, { tracks, clips, transitions, mediaAssets });

      // BUG-008 fix: Removed redundant hydrateFromProject() call.
      // loadProject() already hydrates the timeline with proper normalization.

      lifecycleMonitor.record("CRASH_RECOVERY_RESTORED", {
        projectId: project.id,
        detail: { savedAt: pendingRecovery.savedAt },
      });

      // Clear the snapshot now that we've restored it
      await clearSnapshot();
      setPendingRecovery(null);
    } catch (error) {
      console.error("[CrashRecovery] Restore failed:", error);
      useProjectStore.getState().showToast(t("project.restoreFailed"), "error");
    } finally {
      setIsRestoring(false);
    }
  };

  /**
   * Discard the crash-recovery snapshot and start fresh.
   */
  const handleDiscardRecovery = async () => {
    if (!pendingRecovery) return;
    lifecycleMonitor.record("CRASH_RECOVERY_DISCARDED", {
      projectId: pendingRecovery.project.id,
    });
    await clearSnapshot();
    setPendingRecovery(null);
  };

  /**
   * Handle closing the project with visual feedback modal.
   * Coordinates all cleanup steps and ensures everything is saved/stopped.
   */
  const handleCloseProject = async () => {
    const currentProject = useProjectStore.getState().project;
    if (!currentProject) return;

    setProjectNameBeforeClose(currentProject.name);
    setIsClosingProject(true);

    try {
      // Wait for next tick to ensure modal is rendered and __updateClosingStep is registered
      await new Promise((resolve) => setTimeout(resolve, 50));

      const updateStep = (window as any).__updateClosingStep;
      if (!updateStep) {
        console.error("[App] Modal step updater not available");
        setIsClosingProject(false);
        return;
      }

      // Step 1: Save project and cleanup
      updateStep("save", "in-progress");
      updateStep("session", "in-progress");

      const { closeProject } = useProjectStore.getState();
      await closeProject(); // closeProject handles saving internally

      updateStep("save", "completed");
      updateStep("session", "completed");

      // Step 2: Cleanup and reset
      updateStep("cleanup", "in-progress");
      updateStep("cleanup", "completed");

      updateStep("reset", "in-progress");
      updateStep("reset", "completed");

      // Wait a moment for visual feedback, then close modal
      await new Promise((resolve) => setTimeout(resolve, 500));
      setIsClosingProject(false);
      setProjectNameBeforeClose("");
    } catch (error) {
      console.error("[App] Error closing project:", error);
      const errorMessage = error instanceof Error ? error.message : t("app.unknownError");

      const updateStep = (window as any).__updateClosingStep;
      updateStep?.("save", "error", errorMessage);

      // Allow force close on error (modal will show force close button)
    }
  };

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-bg">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-accent mx-auto mb-4" />
          <p className="text-text-primary">{t("app.loading")}</p>
        </div>
      </div>
    );
  }

  // Wrap entire app in root-level ErrorBoundary for crash recovery
  return (
    <ErrorBoundary
      fallback={
        <div className="w-full h-full flex items-center justify-center bg-bg">
          <div className="text-center max-w-md p-8">
            <div className="text-red-500 text-6xl mb-4">⚠️</div>
            <h1 className="text-2xl font-bold text-text-primary mb-4">{t("app.applicationError")}</h1>
            <p className="text-text-muted mb-6">{t("app.applicationUnexpectedError")}</p>
            <button onClick={() => window.location.reload()} className="px-6 py-3 bg-accent text-white rounded-lg hover:bg-accent-soft transition-colors font-semibold">
              {t("app.restartApplication")}
            </button>
          </div>
        </div>
      }
    >
      {isRecording ? <FloatingWidget onProjectCreate={handleCreateProject} /> : <TooltipProvider delayDuration={0}>{project ? <EditorScreen onRequestClose={handleCloseProject} /> : <LaunchScreen onProjectCreate={handleCreateProject} onProjectOpen={handleOpenProject} />}</TooltipProvider>}
      <SettingsModal isOpen={showSettingsModal} onClose={toggleSettingsModal} />
      <ScreenRecordingPreviewModal isOpen={!!previewRecording} onClose={() => setPreviewRecording(null)} onProjectCreate={handleCreateProject} />

      {/* ── Closing Project Modal ────────────────────────────────────────── */}
      <ClosingProjectModal
        isOpen={isClosingProject}
        projectName={projectNameBeforeClose}
        onComplete={() => {
          setIsClosingProject(false);
          setProjectNameBeforeClose("");
        }}
      />

      {/* ── Crash Recovery Dialog ────────────────────────────────────────── */}
      <CrashRecoveryDialog isOpen={!!pendingRecovery && !project} snapshot={pendingRecovery} isRestoring={isRestoring} onRestore={handleRestoreSession} onDiscard={handleDiscardRecovery} />

      {/* ── Auto-Update Banner ───────────────────────────────────────────── */}
      <UpdateBanner updater={autoUpdater} />
    </ErrorBoundary>
  );
};

export default App;
