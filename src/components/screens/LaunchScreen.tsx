import React, { useEffect, useState, useRef } from "react";
import { Film, Image as ImageIcon, Plus, Trash2, Pencil, MoreHorizontal, Clock, ChevronRight, Sparkles, Settings, Activity, Video } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useProjectStore } from "@/store/projectStore";
import { useSettingsStore } from "@/store/settingsStore";
import type { AspectRatio, MediaAsset, Project } from "@/types";
import { MAX_PROJECT_NAME_LENGTH } from "@/types";
import { useUIStore } from "@/store/uiStore";
import { platform } from "@/core/platform";
import { DualRecordService } from "@/services/dualRecordService";
import { useRecordingStore } from "@/store/recordingStore";
import { t } from "@/i18n";

interface LaunchScreenProps {
  onProjectCreate: (name: string, aspectRatio: AspectRatio, frameRate: 24 | 30 | 60, initialClipPaths?: string[]) => void;
  onProjectOpen: (project: Project) => void;
}

// const isExternalOrDataUrl = (value: string) => value.startsWith("data:") || value.startsWith("http") || value.startsWith("asset://");

const toPreviewSrc = (value?: string) => {
  if (!value) return undefined;
  return value;
};


const graphemeSegmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });
const countGraphemes = (str: string): number => Array.from(graphemeSegmenter.segment(str)).length;

const getProjectThumbnail = (project: Project) => {
  const mediaAssets = project.mediaAssets ?? [];
  const firstVisualAsset = mediaAssets.find((asset) => asset.type === "video" || asset.type === "image") ?? mediaAssets[0];
  if (!firstVisualAsset) return undefined;
  if (firstVisualAsset.posterFrame) return toPreviewSrc(firstVisualAsset.posterFrame);
  if (firstVisualAsset.coverArt) return toPreviewSrc(firstVisualAsset.coverArt);
  if (firstVisualAsset.type === "image") return toPreviewSrc(firstVisualAsset.path);
  return undefined;
};

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const LaunchScreen: React.FC<LaunchScreenProps> = ({ onProjectCreate, onProjectOpen }) => {
  const { recentProjects, setRecentProjects, deleteProject, renameProject } = useProjectStore();
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [projectToRename, setProjectToRename] = useState<Project | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const [isRecordOpen, setIsRecordOpen] = useState(false);
  const [recordOptions, setRecordOptions] = useState({
    audio: true,
    webcam: true,
    screen: true,
    screenType: "any" as "any" | "entire" | "window",
  });
  // Recording active state lives in the global store so App.tsx can render the
  // floating widget overlay even after navigating away from LaunchScreen.
  const { isRecording, setIsRecording, seconds, setSeconds, setHasWebcam, setRecordingError, reset: resetRecording } = useRecordingStore();
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const previewScreenVideoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [audioDevices, setAudioDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState<string>("");
  const [micLevel, setMicLevel] = useState<number>(0);
  const [hasCameraHardware, setHasCameraHardware] = useState<boolean>(true);
  const [cameraNotice, setCameraNotice] = useState<string | null>(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (!DualRecordService.getInstance().isRecording()) {
        DualRecordService.getInstance().cleanup();
      }
    };
  }, []);

  // Clean up timer when recording stops externally (screen track ended / recorder error)
  useEffect(() => {
    if (!isRecording && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [isRecording]);

  // Enumerate audio and video input devices when recording modal is opened
  useEffect(() => {
    if (!isRecordOpen) return;

    const updateDevices = async () => {
      try {
        const audioDevs = await DualRecordService.getInstance().enumerateAudioDevices();
        const videoDevs = await DualRecordService.getInstance().enumerateVideoDevices();
        setAudioDevices(audioDevs);

        const hasCam = videoDevs.length > 0;
        setHasCameraHardware(hasCam);

        if (audioDevs.length > 0) {
          setSelectedAudioDeviceId((prev) => {
            if (prev && audioDevs.some((d) => d.deviceId === prev)) return prev;
            return audioDevs[0].deviceId;
          });
        } else {
          setSelectedAudioDeviceId("");
        }
      } catch (err) {
        console.error("[LaunchScreen] Enumerate devices failed:", err);
      }
    };

    updateDevices();
    navigator.mediaDevices.addEventListener("devicechange", updateDevices);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", updateDevices);
    };
  }, [isRecordOpen]);

  // Coordinated camera, audio, and mic preview initialization
  useEffect(() => {
    if (!isRecordOpen || isRecording) return;

    if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
    if (previewScreenVideoRef.current) previewScreenVideoRef.current.srcObject = null;
    
    // Stop any existing sessions/previews to prevent multi-access conflicts
    DualRecordService.getInstance().stopPreview();
    DualRecordService.getInstance().stopScreenPreview();
    DualRecordService.getInstance().stopMicTest();
    setPreviewError(null);
    setCameraNotice(null);
    setMicLevel(0);

    let animationFrameId: number;
    let active = true;

    const setupPreviews = async () => {
      try {
        // 1. Initialize camera/microphone preview stream
        const { stream, cameraError } = await DualRecordService.getInstance().startPreview(
          { webcam: recordOptions.webcam, audio: recordOptions.audio },
          selectedAudioDeviceId || undefined
        );

        if (!active) return;

        if (cameraError) {
          setCameraNotice(cameraError);
          setRecordOptions((prev) => ({ ...prev, webcam: false }));
        }

        if (previewVideoRef.current && stream) {
          previewVideoRef.current.srcObject = stream;
        }

        // 2. Coordinated mic testing using the preview stream
        if (recordOptions.audio && stream) {
          await DualRecordService.getInstance().startMicTest(selectedAudioDeviceId);
          if (!active) return;

          const pollLevel = () => {
            const level = DualRecordService.getInstance().getMicLevel();
            setMicLevel(level);
            animationFrameId = requestAnimationFrame(pollLevel);
          };
          pollLevel();
        }
      } catch (err: any) {
        console.error("[LaunchScreen] Camera/microphone setup failed:", err);
        setPreviewError(err?.message || t("recording.permissionDenied"));
      }
    };

    setupPreviews();

    return () => {
      active = false;
      cancelAnimationFrame(animationFrameId);
      if (!DualRecordService.getInstance().isRecording()) {
        if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
        if (previewScreenVideoRef.current) previewScreenVideoRef.current.srcObject = null;
        DualRecordService.getInstance().stopPreview();
        DualRecordService.getInstance().stopScreenPreview();
        DualRecordService.getInstance().stopMicTest();
      }
    };
  }, [
    isRecordOpen,
    recordOptions.webcam,
    recordOptions.audio,
    selectedAudioDeviceId,
    isRecording,
  ]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const openRecordModal = () => {
    resetRecording();
    setIsRecordOpen(true);
  };

  const closeRecordModal = () => {
    if (isRecording) return;
    if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
    DualRecordService.getInstance().stopPreview();
    DualRecordService.getInstance().stopMicTest();
    setIsRecordOpen(false);
    setPreviewError(null);
  };

  const startCapture = async () => {
    try {
      setSeconds(0);
      setHasWebcam(recordOptions.webcam);

      // 1. Start recording streams first (must be called within the user gesture callback stack)
      await DualRecordService.getInstance().startRecording(
        {
          ...recordOptions,
          screenType: recordOptions.screenType === "any" ? undefined : recordOptions.screenType,
          audioDeviceId: selectedAudioDeviceId || undefined,
        },
        // Callback when recording is stopped externally (OS "Stop Sharing", recorder error)
        (reason, error) => {
          console.warn(`[LaunchScreen] Recording stopped externally: ${reason}`, error);
          if (reason === "track_ended") {
            setRecordingError(t("recording.screenSharingStopped"));
          } else if (error?.toLowerCase().includes("camera")) {
            setRecordingError(t("recording.cameraRecorderError"));
          } else {
            setRecordingError(t("recording.screenRecorderError"));
          }
        }
      );

      // Detach preview stream from modal video element — App-level widget will re-attach it
      if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
      setIsRecording(true);
      setIsRecordOpen(false);
      timerRef.current = setInterval(() => setSeconds((p) => p + 1), 1000);

      // 2. Resize window to float layout after capture has been successfully initiated
      if (isTauri) {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const { LogicalSize } = await import("@tauri-apps/api/dpi");
          const win = getCurrentWindow();
          await win.setMinSize(null);
          await win.setSize(new LogicalSize(320, 420));
          await win.setMinSize(new LogicalSize(320, 420));
          await win.setAlwaysOnTop(true);
        } catch (winErr) {
          console.error("[LaunchScreen] Failed to set window size:", winErr);
        }
      }
    } catch (err: any) {
      console.error("[LaunchScreen] Start recording failed:", err);
      const rawError = err?.message || err;
      const detail =
        rawError === "Recording already in progress"
          ? t("recording.alreadyInProgress")
          : rawError === "At least one recording source must be enabled (screen, webcam, or audio)"
            ? t("recording.sourceRequired")
            : rawError || t("recording.checkPermissions");
      setPreviewError(t("recording.startFailed", { error: String(detail) }));
    }
  };

  // stopCapture is handled by FloatingWidget (App.tsx renders FloatingWidget
  // when isRecording is true, replacing LaunchScreen entirely).
  // See FloatingWidget.handleStop for the actual stop logic.



  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false);
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState({
    performance: false,
    projectLoad: false,
    textRender: false,
    timelinePerf: false,
    textTemplate: false,
  });
  const menuRef = React.useRef<HTMLDivElement>(null);
  const { toggleSettingsModal } = useUIStore();

  // Check current diagnostics status
  useEffect(() => {
    if (typeof window !== "undefined") {
      setDiagnosticsEnabled({
        performance: localStorage.getItem("clypra.debug.performance") === "1",
        projectLoad: localStorage.getItem("clypra.debug.projectLoad") === "1",
        textRender: localStorage.getItem("clypra.debug.textRender") === "1",
        timelinePerf: localStorage.getItem("debug:timeline-perf") === "true",
        textTemplate: localStorage.getItem("debug:text-template") === "true",
      });
    }
  }, [showDiagnosticsModal]);

  useEffect(() => {
    const loadRecentProjects = async () => {
      try {
        const projects = await platform.getRecentProjects();
        setRecentProjects(projects);
      } catch (error) {
        console.error("Failed to load recent projects:", error);
      }
    };
    loadRecentProjects();
  }, [setRecentProjects]);

  const handleStartNewProject = () => {
    const { defaultFrameRate } = useSettingsStore.getState();
    onProjectCreate(t("launch.untitledProject"), "16:9", defaultFrameRate);
  };

  const handleDeleteClick = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    setMenuOpen(null);
    setProjectToDelete(project);
  };

  const handleRenameClick = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    setMenuOpen(null);
    setProjectToRename(project);
    setRenameValue(project.name);
  };

  const handleConfirmRename = async () => {
    if (!projectToRename || !renameValue.trim()) return;
    setIsRenaming(true);
    try {
      await renameProject(projectToRename.id, renameValue.trim());
      setProjectToRename(null);
    } catch (error) {
      console.error("Failed to rename project:", error);
    } finally {
      setIsRenaming(false);
    }
  };

  const handleToggleMenu = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    setMenuOpen((prev) => (prev === projectId ? null : projectId));
  };

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return;
    setIsDeleting(true);
    try {
      await deleteProject(projectToDelete.id);
      setProjectToDelete(null);
    } catch (error) {
      console.error("Failed to delete project:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleDiagnostic = (key: "performance" | "projectLoad" | "textRender" | "timelinePerf" | "textTemplate") => {
    const storageKey = key === "performance" ? "clypra.debug.performance" : key === "projectLoad" ? "clypra.debug.projectLoad" : key === "textRender" ? "clypra.debug.textRender" : key === "timelinePerf" ? "debug:timeline-perf" : "debug:text-template";

    const newValue = !diagnosticsEnabled[key];

    if (newValue) {
      localStorage.setItem(storageKey, key === "timelinePerf" || key === "textTemplate" ? "true" : "1");
    } else {
      localStorage.removeItem(storageKey);
    }

    setDiagnosticsEnabled((prev) => ({ ...prev, [key]: newValue }));
  };

  const formatDate = (dateStr: string | number) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return t("launch.today");
    if (diffDays === 1) return t("launch.yesterday");
    if (diffDays < 7) return t("launch.daysAgo", { count: diffDays });
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  };


  return (
    <div className="w-full h-full bg-bg flex flex-col overflow-hidden">
      {/* Native title bar area */}
      <div className="h-[37px] select-none flex items-center justify-center bg-transparent" data-tauri-drag-region style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
        <span className="text-xs font-semibold text-text-muted/60">Clypra</span>
      </div>

      {/* ── Background gradient ─────────────────────────────────── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse 80% 50% at 50% -10%, var(--color-accent, #6c63ff) 0%, transparent 60%)",
          opacity: 0.06,
        }}
      />

      {/* ── Content ────────────────────────────────────────────── */}
      <div className="relative z-10 flex-1 flex flex-col w-full px-6 md:px-10 py-8 overflow-y-auto scrollbar-thin">
        {/* Header / Brand */}
        <header className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center relative">
              <div className="absolute inset-0 bg-accent/20 blur-lg rounded-full"></div>
              <img src="/clypra.svg" alt={t("launch.logoAlt")} className="w-10 h-10 object-contain relative z-10 drop-shadow-[0_0_8px_rgba(108,99,255,0.5)]" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-text-primary tracking-tight leading-tight">Clypra</h1>
              <p className="text-[11px] text-text-muted font-medium tracking-wide">{t("launch.videoEditor")}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" onClick={() => setShowDiagnosticsModal(true)} title={t("launch.performanceDiagnostics")} aria-label={t("launch.performanceDiagnostics")} style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties} className={diagnosticsEnabled.performance || diagnosticsEnabled.projectLoad || diagnosticsEnabled.textRender || diagnosticsEnabled.timelinePerf || diagnosticsEnabled.textTemplate ? "text-accent" : ""}>
              <Activity className="w-3.5 h-3.5" />
            </Button>

            <Button variant="ghost" size="icon-sm" onClick={toggleSettingsModal} title={t("common.settings")} aria-label={t("common.settings")} style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
              <Settings className="w-3.5 h-3.5" />
            </Button>
          </div>
        </header>

        {/* ── Hero / New Project ────────────────────────────────── */}
        <section className="mb-12">
          <div
            className="relative rounded-2xl overflow-hidden border border-white/4 p-8 md:p-10 flex flex-col items-center text-center"
            style={{
              background: "linear-gradient(135deg, var(--color-surface, #1a1a1a) 0%, var(--color-bg, #0f0f0f) 100%)",
            }}
          >
            {/* Subtle glow */}
            <div
              className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[120px] rounded-full pointer-events-none"
              style={{
                background: "var(--color-accent, #6c63ff)",
                opacity: 0.07,
                filter: "blur(60px)",
              }}
            />

            <div className="relative z-10">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 text-accent text-[11px] font-semibold mb-4">
                <Sparkles className="w-3 h-3" />
                {t("launch.createSomethingAmazing")}
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-text-primary mb-2 tracking-tight">{t("launch.startNewProject")}</h2>
              <p className="text-sm text-text-muted mb-6 max-w-md">{t("launch.startDescription")}</p>
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <Button variant="default" size="lg" onClick={handleStartNewProject} className="py-2 px-4 text-base font-semibold rounded-xl transition-all cursor-pointer">
                  <Plus className="mr-1" />
                  {t("launch.createProject")}
                </Button>
                {!platform.isCapacitor() && (
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={openRecordModal}
                    className="py-2 px-4 text-base font-semibold rounded-xl transition-all cursor-pointer border border-red-500/40 text-red-400 hover:bg-red-500/10 hover:border-red-500/70 hover:text-red-300"
                  >
                    <Video className="mr-1.5 w-4 h-4" />
                    {t("launch.recordScreenAndCamera")}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ── Recent Projects ──────────────────────────────────── */}
        <section className="flex-1">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-text-muted" />
            <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider">{t("launch.recentProjects")}</h3>
          </div>

          {recentProjects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/6 p-10 flex flex-col items-center justify-center text-center">
              <Film className="w-10 h-10 text-text-muted/30 mb-3" />
              <p className="text-sm text-text-muted">{t("launch.noRecentProjects")}</p>
              <p className="text-xs text-text-muted/60 mt-1">{t("launch.noRecentProjectsDescription")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {recentProjects.map((project) => {
                const thumbnail = getProjectThumbnail(project);
                return (
                  <div
                    key={project.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onProjectOpen(project)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onProjectOpen(project);
                      }
                    }}
                    className="group relative text-left rounded-xl border border-white/4 bg-surface hover:bg-surface-raised transition-all duration-200 hover:-translate-y-0.5 hover:border-white/8 hover:shadow-lg hover:shadow-black/20 overflow-hidden cursor-pointer"
                  >
                    {/* Thumbnail area */}
                    <div className="h-[170px] bg-bg flex items-center justify-center relative overflow-hidden">
                      {thumbnail ? (
                        <>
                          <img src={thumbnail} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-xl transition-transform duration-300 group-hover:scale-[1.14]" draggable={false} />
                          <div className="absolute inset-3 flex items-center justify-center overflow-hidden rounded-lg">
                            <img src={thumbnail} alt="" className="max-h-full max-w-full object-contain opacity-95 shadow-[0_12px_28px_rgba(0,0,0,0.28)] transition-transform duration-300 group-hover:scale-[1.02]" draggable={false} />
                          </div>
                        </>
                      ) : (
                        <ImageIcon className="w-7 h-7 text-text-muted/25 group-hover:text-accent/40 transition-colors" />
                      )}
                      <div className="absolute inset-0 bg-linear-to-t from-bg/55 via-transparent to-bg/10" />
                      {/* Accent glow on hover */}
                      <div className="absolute inset-0 bg-accent/3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      {/* Aspect ratio badge */}
                      <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-bg/75 backdrop-blur-sm text-text-muted border border-white/6">{project.aspectRatio}</span>
                    </div>

                    {/* Info */}
                    <div className="px-3.5 py-4">
                      <h4 className="text-sm font-semibold text-text-primary truncate group-hover:text-accent-soft transition-colors">{project.name}</h4>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-text-muted">{formatDate(project.createdAt)}</span>
                        <ChevronRight className="w-3.5 h-3.5 text-text-muted/30 group-hover:text-accent/60 transition-colors" />
                      </div>
                    </div>

                    {/* More options button */}
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div onClick={(e) => handleToggleMenu(e, project.id)} className="p-1.5 rounded-lg bg-bg/80 backdrop-blur-sm border border-white/4 hover:bg-surface-raised hover:border-white/8 cursor-pointer transition-colors" title={t("launch.moreOptions")}>
                        <MoreHorizontal className="w-3.5 h-3.5 text-text-muted" />
                      </div>

                      {/* Dropdown menu */}
                      {menuOpen === project.id && (
                        <div ref={menuRef} className="absolute top-full right-0 mt-1 z-50 min-w-[140px] rounded-lg border border-border bg-surface py-1 shadow-xl overflow-hidden">
                          <button onClick={(e) => handleRenameClick(e, project)} className="w-full px-3 py-2 text-left flex items-center gap-2 text-sm text-text-primary hover:bg-surface-raised transition-colors cursor-pointer">
                            <Pencil className="w-3.5 h-3.5" />
                            {t("launch.rename")}
                          </button>
                          <button onClick={(e) => handleDeleteClick(e, project)} className="w-full px-3 py-2 text-left flex items-center gap-2 text-sm text-danger hover:bg-surface-raised transition-colors cursor-pointer">
                            <Trash2 className="w-3.5 h-3.5" />
                            {t("common.delete")}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Rename Modal */}
      <Modal isOpen={!!projectToRename} onClose={() => setProjectToRename(null)} title={t("launch.renameProject")}>
        <div className="p-5 space-y-4">
          <div>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirmRename();
              }}
              autoFocus
              className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
              placeholder={t("launch.projectName")}
            />
            <div className="flex justify-end mt-1">
              <span className={`text-[10px] font-medium ${countGraphemes(renameValue) > MAX_PROJECT_NAME_LENGTH ? "text-danger" : "text-text-muted/60"}`}>
                {countGraphemes(renameValue)}/{MAX_PROJECT_NAME_LENGTH}
              </span>
            </div>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => setProjectToRename(null)} disabled={isRenaming}>
              {t("common.cancel")}
            </Button>
            <Button variant="default" onClick={handleConfirmRename} disabled={isRenaming || !renameValue.trim() || countGraphemes(renameValue) > MAX_PROJECT_NAME_LENGTH}>
              {isRenaming ? t("launch.renaming") : t("launch.rename")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={!!projectToDelete} onClose={() => setProjectToDelete(null)} title={t("launch.deleteProject")}>
        <div className="p-5 space-y-4">
          <p className="text-sm text-text-primary">
            {t("launch.confirmDeleteProject", { project: projectToDelete?.name ?? "" })}
          </p>
          <p className="text-xs text-text-muted">{t("launch.deleteProjectWarning")}</p>

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" className="cursor-pointer" onClick={() => setProjectToDelete(null)} disabled={isDeleting}>
              {t("common.cancel")}
            </Button>
            <Button variant="default" onClick={handleConfirmDelete} disabled={isDeleting} className="bg-danger hover:bg-danger/80 cursor-pointer">
              {isDeleting ? t("launch.deleting") : t("common.delete")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Performance Diagnostics Modal */}
      <Modal isOpen={showDiagnosticsModal} onClose={() => setShowDiagnosticsModal(false)} title={t("launch.performanceDiagnostics")}>
        <div className="p-5 space-y-5">
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-surface border border-border">
              <input type="checkbox" id="diag-performance" checked={diagnosticsEnabled.performance} onChange={() => toggleDiagnostic("performance")} className="mt-0.5 cursor-pointer" />
              <div className="flex-1">
                <label htmlFor="diag-performance" className="text-sm font-semibold text-text-primary cursor-pointer block">
                  {t("launch.diagnostics.performanceMonitoring")}
                </label>
                <p className="text-xs text-text-muted mt-1">
                  {t("launch.diagnostics.performanceDescription", {
                    command: "__performanceMonitor.getSummary()",
                  })}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-surface border border-border">
              <input type="checkbox" id="diag-projectload" checked={diagnosticsEnabled.projectLoad} onChange={() => toggleDiagnostic("projectLoad")} className="mt-0.5 cursor-pointer" />
              <div className="flex-1">
                <label htmlFor="diag-projectload" className="text-sm font-semibold text-text-primary cursor-pointer block">
                  {t("launch.diagnostics.projectLoad")}
                </label>
                <p className="text-xs text-text-muted mt-1">{t("launch.diagnostics.projectLoadDescription")}</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-surface border border-border">
              <input type="checkbox" id="diag-textrender" checked={diagnosticsEnabled.textRender} onChange={() => toggleDiagnostic("textRender")} className="mt-0.5 cursor-pointer" />
              <div className="flex-1">
                <label htmlFor="diag-textrender" className="text-sm font-semibold text-text-primary cursor-pointer block">
                  {t("launch.diagnostics.textRender")}
                </label>
                <p className="text-xs text-text-muted mt-1">
                  {t("launch.diagnostics.textRenderDescription", {
                    command: 'localStorage.setItem("clypra.debug.textRender", "1")',
                  })}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-accent/10 border border-accent/30">
              <input type="checkbox" id="diag-timelineperf" checked={diagnosticsEnabled.timelinePerf} onChange={() => toggleDiagnostic("timelinePerf")} className="mt-0.5 cursor-pointer" />
              <div className="flex-1">
                <label htmlFor="diag-timelineperf" className="text-sm font-semibold text-accent cursor-pointer block">
                  {t("launch.diagnostics.timelinePerformance")}
                </label>
                <p className="text-xs text-text-muted mt-1">
                  {t("launch.diagnostics.timelinePerformanceDescription", {
                    command: "__timelinePerf.enable()",
                  })}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
              <input type="checkbox" id="diag-texttemplate" checked={diagnosticsEnabled.textTemplate} onChange={() => toggleDiagnostic("textTemplate")} className="mt-0.5 cursor-pointer" />
              <div className="flex-1">
                <label htmlFor="diag-texttemplate" className="text-sm font-semibold text-yellow-600 dark:text-yellow-400 cursor-pointer block">
                  {t("launch.diagnostics.textTemplateBounds")}
                </label>
                <p className="text-xs text-text-muted mt-1">
                  {t("launch.diagnostics.textTemplateBoundsDescription", {
                    command: "__textTemplateDebug.enable()",
                  })}
                </p>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-accent/10 border border-accent/20">
            <p className="text-xs text-text-muted leading-relaxed">
              <strong className="text-accent font-semibold">{t("launch.diagnostics.note")}</strong>{" "}
              {t("launch.diagnostics.noteDescription")}
              {(diagnosticsEnabled.performance || diagnosticsEnabled.projectLoad || diagnosticsEnabled.textRender || diagnosticsEnabled.timelinePerf || diagnosticsEnabled.textTemplate) && ` ${t("launch.diagnostics.refreshRequired")}`}
            </p>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="default" onClick={() => setShowDiagnosticsModal(false)}>
              {t("launch.diagnostics.done")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Recording Modal ───────────────────────────────── */}
      {isRecordOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md">
          <div
            className="w-[560px] rounded-2xl p-7 shadow-2xl flex flex-col gap-5 text-slate-100 border border-white/10"
            style={{
              background: "linear-gradient(160deg, rgba(18,18,28,0.97) 0%, rgba(12,12,20,0.99) 100%)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold flex items-center gap-2.5 text-white">
                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-red-500/15 border border-red-500/30">
                  <Video className="w-4 h-4 text-red-400" />
                </span>
                {t("launch.recordScreenAndCamera")}
              </h3>
              <button
                onClick={closeRecordModal}
                disabled={isRecording}
                aria-label={t("recording.closeDialog")}
                className="text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ✕
              </button>
            </div>

            {/* Live Preview */}
            <div className="relative aspect-video rounded-xl bg-[#0a0a12] border border-white/8 overflow-hidden">
              {/* Screen preview (fills the background) */}
              {recordOptions.screen && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#07070c] border border-white/5">
                  <div className="flex flex-col items-center justify-center text-slate-500 gap-2">
                    <span className="text-4xl">🖥️</span>
                    <span className="text-xs font-semibold text-slate-400">{t("recording.screenCaptureEnabled")}</span>
                    <span className="text-[10px] text-slate-500">{t("recording.systemPickerPrompt")}</span>
                  </div>
                </div>
              )}

              {/* Webcam preview (floating bubble at the bottom corner if screen is also active, otherwise fills layout) */}
              {recordOptions.webcam && (
                <div
                  className={
                    recordOptions.screen
                      ? "absolute bottom-3 right-3 w-32 aspect-video rounded-lg overflow-hidden border border-white/20 shadow-2xl bg-black"
                      : "w-full h-full"
                  }
                >
                  <video
                    ref={previewVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover scale-x-[-1]"
                  />
                </div>
              )}

              {/* Placeholder text if neither is active */}
              {!recordOptions.screen && !recordOptions.webcam && (
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                  <span className="text-3xl">🎙️</span>
                  <span className="text-xs font-medium">{t("recording.audioOnly")}</span>
                </div>
              )}

              {/* Camera notice banner */}
              {cameraNotice && (
                <div className="absolute top-2 left-2 right-2 z-20 bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] px-3 py-1.5 rounded-lg flex items-center justify-between backdrop-blur-sm">
                  <span>📷 {cameraNotice}</span>
                  <button onClick={() => setCameraNotice(null)} aria-label={t("recording.dismissCameraNotice")} className="text-amber-400 hover:text-amber-200">✕</button>
                </div>
              )}

              {/* Error banner */}
              {previewError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-8 bg-black/80">
                  <span className="text-2xl">⚠️</span>
                  <p className="text-sm text-red-400 leading-relaxed max-w-xs">{previewError}</p>
                </div>
              )}
              {/* REC badge */}
              {isRecording && (
                <div className="absolute top-3 left-3 bg-red-600 text-white text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                  {t("recording.recordingWithTime", { time: formatTime(seconds) })}
                </div>
              )}
            </div>

            {/* Options */}
            <div className="grid grid-cols-3 gap-3">
              {([
                { key: "screen" as const, label: t("recording.captureScreen"), icon: "🖥️" },
                { key: "webcam" as const, label: t("recording.camera"), icon: "📷" },
                { key: "audio" as const, label: t("recording.microphone"), icon: "🎙️" },
              ] as const).map(({ key, label, icon }) => (
                <label
                  key={key}
                  className={`flex flex-col items-center gap-2 p-3 rounded-xl border select-none transition-all ${
                    recordOptions[key]
                      ? "bg-accent/10 border-accent/40 text-white"
                      : "bg-white/4 border-white/8 text-slate-400 opacity-60"
                  } ${
                    isRecording
                      ? "opacity-40 cursor-not-allowed pointer-events-none"
                      : "cursor-pointer hover:bg-white/8"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={recordOptions[key]}
                    onChange={(e) => setRecordOptions({ ...recordOptions, [key]: e.target.checked })}
                    disabled={isRecording}
                  />
                  <span className="text-xl">{icon}</span>
                  <span className="text-xs font-semibold">{label}</span>
                </label>
              ))}
            </div>

            {/* Screen Capture Source selector */}
            {recordOptions.screen && !isRecording && (
              <div className="flex flex-col gap-3 p-4 rounded-xl bg-white/4 border border-white/8 text-slate-300">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {t("recording.screenCaptureSource")}
                </div>
                <select
                  value={recordOptions.screenType}
                  onChange={(e) => setRecordOptions({ ...recordOptions, screenType: e.target.value as any })}
                  className="w-full bg-[#0d0d15] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent/40 cursor-pointer"
                >
                  <option value="any">{t("recording.standardSystemPicker")}</option>
                  <option value="entire">{t("recording.preferEntireDisplay")}</option>
                  <option value="window">{t("recording.preferApplicationWindow")}</option>
                </select>
              </div>
            )}

            {/* Mic Testing & Selection */}
            {recordOptions.audio && !isRecording && (
              <div className="flex flex-col gap-3 p-4 rounded-xl bg-white/4 border border-white/8 text-slate-300">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <span>{t("recording.microphoneSource")}</span>
                  {audioDevices.length > 0 && <span className="text-emerald-400 font-bold flex items-center gap-1.5 animate-pulse">{t("recording.liveTesting")}</span>}
                </div>
                
                {audioDevices.length > 0 ? (
                  <div className="flex flex-col gap-2.5">
                    <select
                      value={selectedAudioDeviceId}
                      onChange={(e) => setSelectedAudioDeviceId(e.target.value)}
                      className="w-full bg-[#0d0d15] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent/40 cursor-pointer"
                    >
                      {audioDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                    
                    {/* Live Meter */}
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-slate-400 font-medium">{t("recording.inputLevel")}</span>
                      <div className="flex-1 h-2 rounded-full bg-[#07070a] overflow-hidden flex items-center p-0.5 border border-white/5">
                        <div
                          className="h-full rounded-full transition-all duration-75"
                          style={{
                            width: `${micLevel * 100}%`,
                            background: "linear-gradient(90deg, #10b981 0%, #10b981 70%, #f59e0b 85%, #ef4444 100%)",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">{t("recording.noMicrophones")}</p>
                )}
              </div>
            )}

            {/* CTA */}
            <div className="pt-1">
              <button
                onClick={startCapture}
                disabled={!recordOptions.screen && !recordOptions.webcam && !recordOptions.audio}
                className="w-full py-3.5 rounded-xl bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-bold text-sm flex items-center justify-center gap-2.5 transition-colors shadow-lg shadow-red-900/30 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-600"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-white" />
                {t("recording.startCapture")}
              </button>
              {!recordOptions.screen && !recordOptions.webcam && !recordOptions.audio ? (
                <p className="text-center text-xs text-amber-400/80 mt-3">
                  {t("recording.enableSource")}
                </p>
              ) : (
                <p className="text-center text-xs text-slate-500 mt-3">
                  {t("recording.opensAsProject")}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
