import { useState, useEffect, useCallback, useRef } from "react";
import { LaunchScreen } from "@/components/screens/LaunchScreen";
import { EditorScreen } from "@/components/screens/EditorScreen";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { useProjectStore } from "@/store/projectStore";
import { useUIStore } from "@/store/uiStore";
import type { Project, AspectRatio } from "@/types";
import { validateAndMigrateProjectPayload } from "@/types/serialization";
import type { RecentProjectEntry } from "@/core/platform/platform";
import { generateId } from "@/lib/utils/id";
import { platform } from "@/core/platform";
import { SettingsModal } from "./components/ui/SettingsModal";
import { ClosingProjectModal } from "./components/ui/ClosingProjectModal";
import { CrashRecoveryDialog } from "./components/ui/CrashRecoveryDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary"; // Add root error boundary
import { hasSnapshot, getSnapshot, clearSnapshot, type RecoverySnapshot } from "@/core/runtime/CrashRecoveryService";
import { lifecycleMonitor } from "@/core/monitoring/LifecycleMonitor";
import { useRecordingStore } from "@/store/recordingStore";
import { FloatingWidget } from "@/components/ui/FloatingWidget";
import { ScreenRecordingPreviewModal } from "@/components/ui/ScreenRecordingPreviewModal";
import { useAutoUpdater } from "@/hooks/useAutoUpdater";
import { UpdateBanner } from "@/components/ui/UpdateBanner";
import { Toaster } from "sonner";

// const isExternalOrDataUrl = (value: string) => value.startsWith("data:") || value.startsWith("http") || value.startsWith("asset://");

const App = () => {
  const { project, createProject, loadProject, setRecentProjects } = useProjectStore();
  const [isLoading, setIsLoading] = useState(true);
  const { showSettingsModal, toggleSettingsModal } = useUIStore();
  const [pendingRecovery, setPendingRecovery] = useState<RecoverySnapshot | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isClosingProject, setIsClosingProject] = useState(false);
  const [projectNameBeforeClose, setProjectNameBeforeClose] = useState<string>("");
  const closingWindowRef = useRef(false);
  const { isRecording, previewRecording, setPreviewRecording } = useRecordingStore();
  const autoUpdater = useAutoUpdater();

  useEffect(() => {
    const initializeApp = async () => {
      try {
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
    return () => {};
  }, [setRecentProjects]);

  // ─── DEV MODE: Automated Resource Leak Detection ───────────────────────────
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    // Periodic leak check every 30 seconds in dev mode
    const leakCheckInterval = setInterval(() => {
      // Dynamically import to avoid bundling in production
      import("@/core/monitoring/ResourceTracker")
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

  const handleCreateProject = (
    name: string,
    aspectRatio: AspectRatio,
    frameRate: 24 | 30 | 60,
    initialClipPaths?: string[],
    recordingMetadata?: { cameraOffsetSeconds?: number }
  ) => {
    // Reset UI state from any previous session
    useUIStore.getState().exitSourceMode();
    createProject(name, aspectRatio, frameRate);

    if (initialClipPaths && initialClipPaths.length > 0) {
      setTimeout(async () => {
        try {
          const { generateId } = await import("@/lib/utils/id");
          const { useTimelineStore } = await import("@/store/timelineStore");

          const loadedAssets: any[] = [];

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
              let validDuration = metadata?.duration;

              // If metadata duration is non-finite or non-positive (common with WebM MediaRecorder headers), probe via HTMLVideoElement
              if (!Number.isFinite(validDuration) || validDuration <= 0) {
                try {
                  validDuration = await new Promise<number>((resolve) => {
                    const vid = document.createElement("video");
                    vid.preload = "metadata";
                    let resolved = false;
                    const finish = (d: number) => {
                      if (!resolved) {
                        resolved = true;
                        vid.removeAttribute("src");
                        vid.load();
                        resolve(Number.isFinite(d) && d > 0 ? d : 5.0);
                      }
                    };
                    const timeout = setTimeout(() => finish(5.0), 1000);
                    vid.onloadedmetadata = () => {
                      if (vid.duration && vid.duration !== Infinity && !isNaN(vid.duration) && vid.duration > 0) {
                        clearTimeout(timeout);
                        finish(vid.duration);
                      } else {
                        vid.currentTime = 1e101;
                        vid.ontimeupdate = () => {
                          clearTimeout(timeout);
                          finish(vid.duration);
                        };
                      }
                    };
                    vid.onerror = () => {
                      clearTimeout(timeout);
                      finish(5.0);
                    };
                    vid.src = displayPath;
                  });
                } catch {
                  validDuration = 5.0;
                }
              }

              const safeDuration = Math.max(0.5, validDuration || 5.0);
              const posterFrame = await platform.extractPosterFrame(path, safeDuration, window.devicePixelRatio || 1.0).catch(() => undefined);

              const asset = {
                id: generateId("asset"),
                name: filename,
                path: displayPath,
                type: "video" as const,
                duration: safeDuration,
                width: metadata.width || 1920,
                height: metadata.height || 1080,
                posterFrame,
                size: 0,
              };

              useProjectStore.getState().addMediaAsset(asset);
              loadedAssets.push(asset);
            } catch (innerErr) {
              console.error("[App] Failed to import path:", path, innerErr);
            }
          }

          // Auto-insert recordings onto timeline tracks with Picture-in-Picture placement
          if (loadedAssets.length > 0) {
            const currentProject = useProjectStore.getState().project;
            const canvasW = currentProject?.canvasWidth || 1920;
            const canvasH = currentProject?.canvasHeight || 1080;

            const screenAsset = loadedAssets.find((a) => a.name.toLowerCase().includes("screen")) || loadedAssets[0];
            const cameraAsset = loadedAssets.find((a) => a.name.toLowerCase().includes("camera") && a.id !== screenAsset.id);

            const timelineStore = useTimelineStore.getState();

            timelineStore.withBatch(() => {
              // Ensure main video track exists
              let tracks = useTimelineStore.getState().tracks;
              let mainVideoTrack = tracks.find((t) => t.type === "video");

              if (!mainVideoTrack) {
                useTimelineStore.getState().addTrack("video");
                tracks = useTimelineStore.getState().tracks;
                mainVideoTrack = tracks.find((t) => t.type === "video");
              }

              const mainTrackId = mainVideoTrack!.id;

              // 1. Add Main Screen Clip on Track 1 (Bottom/Main Track)
              const screenClip = {
                id: generateId("clip"),
                name: screenAsset.name,
                trackId: mainTrackId,
                mediaId: screenAsset.id,
                startTime: 0,
                duration: screenAsset.duration,
                trimIn: 0,
                trimOut: screenAsset.duration,
                x: 0,
                y: 0,
                width: canvasW,
                height: canvasH,
                opacity: 1,
                rotation: 0,
                fitMode: "contain" as const,
                aspectRatioLocked: true,
                kind: "video" as const,
              };
              useTimelineStore.getState().addClip(screenClip);

              // 2. Add Camera Overlay Clip on Top Track (Track 0 / PiP Placement) if dual recording
              if (cameraAsset) {
                // Insert top track above main track so camera renders on top (lower trackIndex = top z-index)
                const overlayTrackId = useTimelineStore.getState().insertTrackAt("video", 0);

                const pipW = Math.round(canvasW * 0.28);
                const pipH = Math.round(canvasH * 0.28);
                const margin = 40;
                const pipX = canvasW - pipW - margin;
                const pipY = canvasH - pipH - margin;

                const cameraStartTime = recordingMetadata?.cameraOffsetSeconds || 0;

                const cameraClip = {
                  id: generateId("clip"),
                  name: cameraAsset.name,
                  trackId: overlayTrackId,
                  mediaId: cameraAsset.id,
                  startTime: cameraStartTime,
                  duration: cameraAsset.duration,
                  trimIn: 0,
                  trimOut: cameraAsset.duration,
                  x: pipX,
                  y: pipY,
                  width: pipW,
                  height: pipH,
                  opacity: 1,
                  rotation: 0,
                  fitMode: "cover" as const,
                  aspectRatioLocked: true,
                  kind: "video" as const,
                };
                useTimelineStore.getState().addClip(cameraClip);
              }
            });
          }
        } catch (err) {
          console.error("[App] Failed to auto-import initial recordings:", err);
        }
      }, 500);
    }
  };

  const handleOpenProject = async (entry: RecentProjectEntry) => {
    try {
      useUIStore.getState().exitSourceMode();

      const projectJson = await platform.loadProject(entry.kind === "unreadable" ? entry.backupPath : entry.path);
      const normalized = validateAndMigrateProjectPayload(projectJson);
      const isRecoveryCopy = entry.kind === "unreadable";
      const project = isRecoveryCopy
        ? { ...normalized.project, id: generateId("project"), name: `${entry.name || normalized.project.name} (Recovered)`, createdAt: Date.now(), updatedAt: Date.now() }
        : normalized.project;

      await loadProject(project, {
        mediaAssets: normalized.mediaAssets,
        tracks: normalized.tracks,
        clips: normalized.clips,
        transitions: normalized.transitions,
        gaps: normalized.gaps,
        markers: normalized.markers,
        mainVideoTrackId: normalized.mainVideoTrackId,
      });

      if (isRecoveryCopy) {
        const receipt = await useProjectStore.getState().saveCurrentProject();
        if (!receipt?.verified) throw new Error("Recovered project could not be verified after saving");
        useProjectStore.getState().showToast("Recovered copy opened and saved safely", "success");
      } else if (normalized.migrated) {
        try {
          const receipt = await useProjectStore.getState().saveCurrentProject();
          if (!receipt?.verified) throw new Error("Migration save was not verified");
        } catch (migrationError) {
          useProjectStore.getState().showToast(`Project opened, but migration could not be saved: ${migrationError instanceof Error ? migrationError.message : String(migrationError)}`, "warning", 7000);
        }
      }

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
      useProjectStore.getState().showToast(error instanceof Error ? error.message : "Failed to open project", "error", 7000);
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
      const { tracks, clips, transitions, gaps, markers, mediaAssets, project } = pendingRecovery;

      // Hydrate project store (sets active project)
      await loadProject(project, { tracks, clips, transitions, gaps: gaps ?? [], markers: markers ?? [], mediaAssets });

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
      useProjectStore.getState().showToast("Failed to restore session", "error");
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
  const handleCloseProject = useCallback(async () => {
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
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      const updateStep = (window as any).__updateClosingStep;
      updateStep?.("save", "error", errorMessage);

      // Allow force close on error (modal will show force close button)
    }
  }, []);

  // Borderless windows do not have an OS-owned close button. Keep native
  // close requests on the same save/cleanup path as the custom title bar,
  // and ensure the entire app process exits completely.
  useEffect(() => {
    if (!platform.isTauri()) return;

    let unlisten: (() => void) | undefined;
    let disposed = false;

    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        if (disposed) return;
        const win = getCurrentWindow();
        unlisten = await win.onCloseRequested(async (event) => {
          if (closingWindowRef.current) return;

          event.preventDefault();
          closingWindowRef.current = true;
          try {
            if (useProjectStore.getState().project) {
              await handleCloseProject();
            }
            try {
              const { exit } = await import("@tauri-apps/plugin-process");
              await exit(0);
            } catch {
              await win.destroy();
            }
          } catch (err) {
            console.error("[App] Failed to cleanly exit app:", err);
            await win.destroy();
          } finally {
            closingWindowRef.current = false;
          }
        });
      })
      .catch((error) => console.warn("[App] Failed to install native close handler:", error));

    return () => {
      disposed = true;
      if (unlisten) {
        void Promise.resolve(unlisten()).catch(() => {});
      }
    };
  }, [handleCloseProject]);

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-bg">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-accent mx-auto mb-4" />
          <p className="text-text-primary">Loading...</p>
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
            <h1 className="text-2xl font-bold text-text-primary mb-4">Application Error</h1>
            <p className="text-text-muted mb-6">Something went wrong. The application encountered an unexpected error.</p>
            <button onClick={() => window.location.reload()} className="px-6 py-3 bg-accent text-white rounded-lg hover:bg-accent-soft transition-colors font-semibold">
              Restart Application
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

      {/* ── Global Toast Notifications ─────────────────────────────────── */}
      <Toaster
        position="bottom-right"
        theme="dark"
        richColors
        closeButton
        toastOptions={{
          className: "bg-surface-elevated/95 text-text-primary border border-white/10 backdrop-blur-md shadow-2xl font-sans rounded-xl text-xs",
          duration: 3000,
        }}
      />
    </ErrorBoundary>
  );
};

export default App;
