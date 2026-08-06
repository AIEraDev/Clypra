import React, { useEffect, useState, useRef } from "react";
import { Film, Image as ImageIcon, Plus, Trash2, Pencil, MoreHorizontal, Clock, ChevronRight, Sparkles, Settings, Activity, Video, FolderOpen, LayoutTemplate, FileVideo, Play, Layers } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useProjectStore } from "@/store/projectStore";
import { useSettingsStore } from "@/store/settingsStore";
import type { AspectRatio, MediaAsset, Project } from "@/types";
import { getProjectThumbnail, formatEditorTimecode } from "@/lib/media/projectThumbnail";
import { MAX_PROJECT_NAME_LENGTH } from "@/types";
import { useUIStore } from "@/store/uiStore";
import { platform } from "@/core/platform";
import { DualRecordService } from "@/services/dualRecordService";
import { useRecordingStore } from "@/store/recordingStore";

interface LaunchScreenProps {
  onProjectCreate: (name: string, aspectRatio: AspectRatio, frameRate: 24 | 30 | 60, initialClipPaths?: string[]) => void;
  onProjectOpen: (project: Project) => void;
}

// const isExternalOrDataUrl = (value: string) => value.startsWith("data:") || value.startsWith("http") || value.startsWith("asset://");

const toPreviewSrc = (value?: string) => {
  if (!value) return undefined;
  return value;
};


const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const countGraphemes = (str: string): number => Array.from(graphemeSegmenter.segment(str)).length;

const getProjectInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "PR";
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Map aspect ratio to a soft accent hue for card hover glow
const aspectRatioGlow: Record<string, string> = {
  "16:9": "rgba(108, 99, 255, 0.18)",
  "9:16": "rgba(236, 72, 153, 0.18)",
  "1:1":  "rgba(20, 184, 166, 0.18)",
  "4:3":  "rgba(245, 158, 11, 0.18)",
};

const getAspectRatioGlow = (ratio: string) =>
  aspectRatioGlow[ratio] ?? "rgba(108, 99, 255, 0.14)";

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
    resolution: "1080p" as "720p" | "1080p" | "4k",
    frameRate: 30 as 30 | 60,
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
  const [previewKey, setPreviewKey] = useState(0);
  const micLevelRef = useRef<HTMLDivElement>(null);
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
    if (micLevelRef.current) {
      micLevelRef.current.style.width = "0%";
    }

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
            if (micLevelRef.current) {
              micLevelRef.current.style.width = `${level * 100}%`;
            }
            animationFrameId = requestAnimationFrame(pollLevel);
          };
          pollLevel();
        }
      } catch (err: any) {
        console.error("[LaunchScreen] Camera/microphone setup failed:", err);
        setPreviewError(err?.message || "Could not access camera or microphone. Check System Preferences → Privacy.");
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
    previewKey,
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

      // Release preview streams before starting recording streams to avoid hardware device collisions
      if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
      DualRecordService.getInstance().stopPreview();
      DualRecordService.getInstance().stopMicTest();

      // 1. Start recording streams first (must be called within the user gesture callback stack)
      await DualRecordService.getInstance().startRecording(
        {
          ...recordOptions,
          screenType: recordOptions.screenType === "any" ? undefined : recordOptions.screenType,
          audioDeviceId: selectedAudioDeviceId || undefined,
          resolution: recordOptions.resolution,
          frameRate: recordOptions.frameRate,
        },
        // Callback when recording is stopped externally (OS "Stop Sharing", recorder error)
        (reason, error) => {
          console.warn(`[LaunchScreen] Recording stopped externally: ${reason}`, error);
          setRecordingError(error || "Recording stopped unexpectedly");
        }
      );

      // Detach preview stream from modal video element — App-level widget will re-attach it
      if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
      setIsRecording(true);
      setIsRecordOpen(false);
      timerRef.current = setInterval(() => setSeconds((p) => p + 1), 1000);

      // 2. Save window geometry snapshot and resize window to float layout
      if (isTauri) {
        try {
          const { savePreRecordingWindowGeometry } = await import("@/lib/platform/windowState");
          await savePreRecordingWindowGeometry();

          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const { LogicalSize } = await import("@tauri-apps/api/dpi");
          const win = getCurrentWindow();
          if (await win.isMaximized()) {
            await win.unmaximize();
          }
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
      setPreviewError(`Failed to start recording: ${err?.message || err || "Check permissions."}`);
      setPreviewKey((k) => k + 1); // Restart preview on cancel
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
    onProjectCreate("Untitled Project", "16:9", defaultFrameRate);
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
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };


  return (
    <div className="w-full h-full bg-bg flex flex-col overflow-hidden">
      {/* Keyframe styles */}
      <style>{`
        @keyframes ls-glow-pulse {
          0%, 100% { opacity: 0.10; transform: scale(1); }
          50%       { opacity: 0.17; transform: scale(1.06); }
        }
        @keyframes ls-glow-pulse-warm {
          0%, 100% { opacity: 0.07; transform: scale(1); }
          50%       { opacity: 0.12; transform: scale(1.08); }
        }
        .ls-glow-primary { animation: ls-glow-pulse 6s ease-in-out infinite; }
        .ls-glow-warm    { animation: ls-glow-pulse-warm 8s ease-in-out infinite 1.5s; }
      `}</style>

      {/* Native title bar area */}
      <div className="h-[37px] select-none flex items-center justify-center bg-transparent" data-tauri-drag-region style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
        <span className="text-xs font-semibold text-text-muted/60">Clypra</span>
      </div>

      {/* ── Background gradients ─────────────────────────────────── */}
      {/* Primary accent glow */}
      <div
        className="absolute inset-0 pointer-events-none ls-glow-primary"
        style={{
          background: "radial-gradient(ellipse 80% 45% at 50% -5%, var(--color-accent, #6c63ff) 0%, transparent 60%)",
        }}
      />
      {/* Warm secondary glow */}
      <div
        className="absolute inset-0 pointer-events-none ls-glow-warm"
        style={{
          background: "radial-gradient(ellipse 55% 30% at 80% 10%, #a855f7 0%, transparent 60%)",
        }}
      />

      {/* ── Content ────────────────────────────────────────────── */}
      <div className="relative z-10 flex-1 flex flex-col w-full px-6 md:px-10 py-8 overflow-y-auto scrollbar-thin">
        {/* Bottom scroll fade overlay */}
        <div
          className="pointer-events-none fixed bottom-0 left-0 right-0 h-16 z-20"
          style={{ background: "linear-gradient(to top, var(--color-bg, #0f0f0f) 0%, transparent 100%)" }}
        />
        {/* Header / Brand */}
        <header className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center relative">
              <div className="absolute inset-0 bg-accent/25 blur-2xl rounded-full"></div>
              <div className="absolute inset-0 bg-accent/10 blur-md rounded-full"></div>
              <img src="/clypra.svg" alt="Clypra Logo" className="w-10 h-10 object-contain relative z-10 drop-shadow-[0_0_10px_rgba(108,99,255,0.6)]" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-text-primary tracking-tight leading-tight">Clypra</h1>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-[10px] font-semibold text-accent tracking-wider">VIDEO EDITOR</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" onClick={() => setShowDiagnosticsModal(true)} title="Performance Diagnostics" style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties} className={diagnosticsEnabled.performance || diagnosticsEnabled.projectLoad || diagnosticsEnabled.textRender || diagnosticsEnabled.timelinePerf || diagnosticsEnabled.textTemplate ? "text-accent" : ""}>
              <Activity className="w-3.5 h-3.5" />
            </Button>

            <Button variant="ghost" size="icon-sm" onClick={toggleSettingsModal} title="Settings" style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
              <Settings className="w-3.5 h-3.5" />
            </Button>
          </div>
        </header>

        {/* ── Hero / New Project ────────────────────────────────── */}
        <section className="mb-6">
          <div
            className="relative rounded-2xl overflow-hidden p-8 md:p-10 flex flex-col items-center text-center"
            style={{
              background: "linear-gradient(135deg, var(--color-surface, #1a1a1a) 0%, var(--color-bg, #0f0f0f) 100%)",
              border: "1px solid rgba(255,255,255,0.06)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 24px rgba(0,0,0,0.18)",
            }}
          >
            {/* Primary accent glow */}
            <div
              className="absolute top-0 left-1/2 -translate-x-1/2 w-[340px] h-[130px] rounded-full pointer-events-none"
              style={{
                background: "var(--color-accent, #6c63ff)",
                opacity: 0.10,
                filter: "blur(70px)",
              }}
            />
            {/* Warm secondary glow offset */}
            <div
              className="absolute top-0 right-[15%] w-[200px] h-[90px] rounded-full pointer-events-none"
              style={{
                background: "#a855f7",
                opacity: 0.06,
                filter: "blur(55px)",
              }}
            />

            <div className="relative z-10">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold mb-4">
                <Sparkles className="w-3 h-3" />
                Create something amazing
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-text-primary mb-2 tracking-tight">Start a new project</h2>
              <p className="text-sm text-text-muted mb-6 max-w-md">Begin with a 16:9 landscape canvas, or capture your screen and face simultaneously.</p>
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <Button variant="default" size="lg" onClick={handleStartNewProject} className="py-2 px-5 text-base font-semibold rounded-xl transition-all cursor-pointer shadow-lg shadow-accent/20">
                  <Plus className="mr-1" />
                  New Project
                </Button>
                {!platform.isCapacitor() && (
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={openRecordModal}
                    className="py-2 px-4 text-base font-semibold rounded-xl transition-all cursor-pointer border border-red-500/40 text-red-400 hover:bg-red-500/10 hover:border-red-500/70 hover:text-red-300"
                  >
                    <Video className="mr-1.5 w-4 h-4" />
                    Record Screen & Camera
                  </Button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ── Quick Actions ─────────────────────────────────────── */}
        <section className="mb-10">
          <div className="grid grid-cols-3 gap-3">
            {/* Import Media */}
            <button
              onClick={handleStartNewProject}
              className="group flex flex-col items-start gap-2 p-4 rounded-xl border border-white/5 bg-surface hover:bg-surface-raised hover:border-white/10 hover:shadow-lg hover:shadow-black/20 transition-all duration-200 cursor-pointer text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center group-hover:bg-accent/15 transition-colors">
                <FolderOpen className="w-4 h-4 text-accent" />
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary group-hover:text-accent-soft transition-colors">Import Media</p>
                <p className="text-[11px] text-text-muted mt-0.5">Start from your files</p>
              </div>
            </button>

            {/* New from Template — coming soon */}
            <div
              title="Coming soon"
              className="group flex flex-col items-start gap-2 p-4 rounded-xl border border-white/5 bg-surface opacity-50 cursor-not-allowed text-left select-none"
            >
              <div className="w-8 h-8 rounded-lg bg-surface-raised border border-white/8 flex items-center justify-center">
                <LayoutTemplate className="w-4 h-4 text-text-muted" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold text-text-primary">Templates</p>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-surface-raised text-text-muted border border-white/6 uppercase tracking-wide">Soon</span>
                </div>
                <p className="text-[11px] text-text-muted mt-0.5">Start from a preset</p>
              </div>
            </div>

            {/* Open File */}
            <button
              onClick={handleStartNewProject}
              className="group flex flex-col items-start gap-2 p-4 rounded-xl border border-white/5 bg-surface hover:bg-surface-raised hover:border-white/10 hover:shadow-lg hover:shadow-black/20 transition-all duration-200 cursor-pointer text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center group-hover:bg-emerald-500/15 transition-colors">
                <FileVideo className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary group-hover:text-emerald-300 transition-colors">Open File</p>
                <p className="text-[11px] text-text-muted mt-0.5">Continue a project</p>
              </div>
            </button>
          </div>
        </section>

        {/* ── Recent Projects ──────────────────────────────────── */}
        <section className="flex-1 pb-8">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-text-muted" />
              <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider">Recent Projects</h3>
              {recentProjects.length > 0 && (
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-raised border border-white/6 text-[10px] font-bold text-text-muted">
                  {recentProjects.length}
                </span>
              )}
            </div>
            {recentProjects.length > 0 && (
              <button
                className="text-[11px] font-semibold text-text-muted hover:text-text-primary transition-colors cursor-pointer flex items-center gap-0.5"
                title="See all projects"
                onClick={() => {}}
              >
                See all <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>

          {recentProjects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/8 p-10 flex flex-col items-center justify-center text-center gap-4">
              <div className="w-14 h-14 rounded-full bg-surface-raised border border-white/6 flex items-center justify-center">
                <Film className="w-6 h-6 text-text-muted/40" />
              </div>
              <div>
                <p className="text-sm font-semibold text-text-muted">No projects yet</p>
                <p className="text-xs text-text-muted/50 mt-1">Your recent projects will appear here</p>
              </div>
              <button
                onClick={handleStartNewProject}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent/10 border border-accent/20 text-accent text-xs font-semibold hover:bg-accent/15 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Create your first project
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {recentProjects.map((project) => {
                const thumbnail = getProjectThumbnail(project);
                const cardGlow = getAspectRatioGlow(project.aspectRatio);
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
                    className="group relative text-left rounded-xl border border-white/4 bg-surface hover:bg-surface-raised transition-all duration-300 hover:-translate-y-1 hover:border-white/10 hover:shadow-xl hover:shadow-black/25 overflow-hidden cursor-pointer"
                  >
                    {/* Aspect-ratio colour glow on hover */}
                    <div
                      className="absolute inset-0 rounded-xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      style={{ boxShadow: `0 0 0 1px ${cardGlow}, 0 12px 32px ${cardGlow}` }}
                    />

                    {/* Thumbnail area */}
                    <div className="h-[170px] bg-bg flex items-center justify-center relative overflow-hidden group/stage">
                      {thumbnail ? (
                        <>
                          <img src={thumbnail} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-2xl transition-transform duration-500 group-hover:scale-125" draggable={false} />
                          <div className="absolute inset-2 flex items-center justify-center overflow-hidden rounded-lg bg-black/40 backdrop-blur-xs border border-white/6 shadow-inner">
                            <img src={thumbnail} alt="" className="max-h-full max-w-full object-contain opacity-98 shadow-[0_12px_28px_rgba(0,0,0,0.45)] transition-all duration-300 group-hover:scale-[1.03]" draggable={false} />
                          </div>
                        </>
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-surface-raised/80 via-bg to-surface/90 flex flex-col items-center justify-center p-4">
                          <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:12px_12px]" />
                          <div className="w-11 h-11 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent font-bold text-sm tracking-wider shadow-lg group-hover:scale-110 transition-transform duration-300">
                            {getProjectInitials(project.name)}
                          </div>
                          <span className="text-[10px] uppercase font-mono tracking-widest text-text-muted/50 mt-2">Empty Timeline</span>
                        </div>
                      )}

                      {/* Top/Bottom Gradient Vignette */}
                      <div className="absolute inset-0 bg-gradient-to-t from-bg/70 via-transparent to-bg/25 pointer-events-none" />

                      {/* Play Hover Action Overlay */}
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-black/20 backdrop-blur-[1px]">
                        <div className="w-11 h-11 rounded-full bg-accent/90 text-white flex items-center justify-center shadow-xl shadow-accent/30 transform scale-90 group-hover:scale-100 transition-transform duration-300 pl-0.5">
                          <Play className="w-5 h-5 fill-current" />
                        </div>
                      </div>

                      {/* Badges row */}
                      <div className="absolute top-2 left-2 flex items-center gap-1 z-10 pointer-events-none">
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-bg/85 backdrop-blur-md text-text-primary border border-white/10 shadow-sm">{project.aspectRatio}</span>
                        {(project as any).frameRate && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-bg/85 backdrop-blur-md text-text-muted border border-white/10 shadow-sm">{(project as any).frameRate}fps</span>
                        )}
                        {project.mediaAssets && project.mediaAssets.length > 0 && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-bg/85 backdrop-blur-md text-accent-soft border border-accent/20 shadow-sm flex items-center gap-1">
                            <Layers className="w-2.5 h-2.5" />
                            {project.mediaAssets.length}
                          </span>
                        )}
                      </div>

                      {/* Duration Timecode Overlay (Bottom Right) */}
                      {project.duration !== undefined && project.duration > 0 && (
                        <div className="absolute bottom-2 right-2 z-10 pointer-events-none">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-black/80 backdrop-blur-md text-white/90 border border-white/10 shadow-md">
                            {formatEditorTimecode(project.duration)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="px-3.5 py-3.5">
                      <h4 className="text-sm font-semibold text-text-primary truncate group-hover:text-accent-soft transition-colors">{project.name}</h4>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-xs text-text-muted">{formatDate(project.createdAt)}</span>
                        <ChevronRight className="w-3.5 h-3.5 text-text-muted/30 group-hover:text-accent/60 transition-colors duration-200" />
                      </div>
                    </div>

                    {/* More options button */}
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div onClick={(e) => handleToggleMenu(e, project.id)} className="p-1.5 rounded-lg bg-bg/80 backdrop-blur-sm border border-white/4 hover:bg-surface-raised hover:border-white/8 cursor-pointer transition-colors" title="More options">
                        <MoreHorizontal className="w-3.5 h-3.5 text-text-muted" />
                      </div>

                      {/* Dropdown menu */}
                      {menuOpen === project.id && (
                        <div ref={menuRef} className="absolute top-full right-0 mt-1 z-50 min-w-[140px] rounded-lg border border-border bg-surface py-1 shadow-xl overflow-hidden">
                          <button onClick={(e) => handleRenameClick(e, project)} className="w-full px-3 py-2 text-left flex items-center gap-2 text-sm text-text-primary hover:bg-surface-raised transition-colors cursor-pointer">
                            <Pencil className="w-3.5 h-3.5" />
                            Rename
                          </button>
                          <button onClick={(e) => handleDeleteClick(e, project)} className="w-full px-3 py-2 text-left flex items-center gap-2 text-sm text-danger hover:bg-surface-raised transition-colors cursor-pointer">
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
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
      <Modal isOpen={!!projectToRename} onClose={() => setProjectToRename(null)} title="Rename Project">
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
              placeholder="Project name"
            />
            <div className="flex justify-end mt-1">
              <span className={`text-[10px] font-medium ${countGraphemes(renameValue) > MAX_PROJECT_NAME_LENGTH ? "text-danger" : "text-text-muted/60"}`}>
                {countGraphemes(renameValue)}/{MAX_PROJECT_NAME_LENGTH}
              </span>
            </div>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => setProjectToRename(null)} disabled={isRenaming}>
              Cancel
            </Button>
            <Button variant="default" onClick={handleConfirmRename} disabled={isRenaming || !renameValue.trim() || countGraphemes(renameValue) > MAX_PROJECT_NAME_LENGTH}>
              {isRenaming ? "Renaming..." : "Rename"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={!!projectToDelete} onClose={() => setProjectToDelete(null)} title="Delete Project">
        <div className="p-5 space-y-4">
          <p className="text-sm text-text-primary">
            Are you sure you want to delete <strong>{projectToDelete?.name}</strong>?
          </p>
          <p className="text-xs text-text-muted">This action cannot be undone. All project data will be permanently deleted.</p>

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" className="cursor-pointer" onClick={() => setProjectToDelete(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="default" onClick={handleConfirmDelete} disabled={isDeleting} className="bg-danger hover:bg-danger/80 cursor-pointer">
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Performance Diagnostics Modal */}
      <Modal isOpen={showDiagnosticsModal} onClose={() => setShowDiagnosticsModal(false)} title="Performance Diagnostics">
        <div className="p-5 space-y-5">
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-surface border border-border">
              <input type="checkbox" id="diag-performance" checked={diagnosticsEnabled.performance} onChange={() => toggleDiagnostic("performance")} className="mt-0.5 cursor-pointer" />
              <div className="flex-1">
                <label htmlFor="diag-performance" className="text-sm font-semibold text-text-primary cursor-pointer block">
                  Performance Monitoring
                </label>
                <p className="text-xs text-text-muted mt-1">
                  Track frame rendering and timeline operations via the Resource Tracker.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-surface border border-border">
              <input type="checkbox" id="diag-projectload" checked={diagnosticsEnabled.projectLoad} onChange={() => toggleDiagnostic("projectLoad")} className="mt-0.5 cursor-pointer" />
              <div className="flex-1">
                <label htmlFor="diag-projectload" className="text-sm font-semibold text-text-primary cursor-pointer block">
                  Project Load Diagnostics
                </label>
                <p className="text-xs text-text-muted mt-1">Detailed breakdown of project loading phases. Shows which parts take the longest to load.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-surface border border-border">
              <input type="checkbox" id="diag-textrender" checked={diagnosticsEnabled.textRender} onChange={() => toggleDiagnostic("textRender")} className="mt-0.5 cursor-pointer" />
              <div className="flex-1">
                <label htmlFor="diag-textrender" className="text-sm font-semibold text-text-primary cursor-pointer block">
                  Text Render Tracing
                </label>
                <p className="text-xs text-text-muted mt-1">
                  Verbose logging for text rendering pipeline. Use <code className="px-1 py-0.5 rounded bg-bg text-accent text-[10px]">localStorage.setItem("clypra.debug.textRender", "1")</code>
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-accent/10 border border-accent/30">
              <input type="checkbox" id="diag-timelineperf" checked={diagnosticsEnabled.timelinePerf} onChange={() => toggleDiagnostic("timelinePerf")} className="mt-0.5 cursor-pointer" />
              <div className="flex-1">
                <label htmlFor="diag-timelineperf" className="text-sm font-semibold text-accent cursor-pointer block">
                  ⏱️ Timeline Performance (Focused)
                </label>
                <p className="text-xs text-text-muted mt-1">
                  Focused timeline operation logging. Tracks hydration, clip additions, and timeline mutations. Use <code className="px-1 py-0.5 rounded bg-bg text-accent text-[10px]">__timelinePerf.enable()</code> in console.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
              <input type="checkbox" id="diag-texttemplate" checked={diagnosticsEnabled.textTemplate} onChange={() => toggleDiagnostic("textTemplate")} className="mt-0.5 cursor-pointer" />
              <div className="flex-1">
                <label htmlFor="diag-texttemplate" className="text-sm font-semibold text-yellow-600 dark:text-yellow-400 cursor-pointer block">
                  📐 Text Template Bounds (Debug)
                </label>
                <p className="text-xs text-text-muted mt-1">
                  Debug text template bounding box issues. Logs canvas size, content bounds, and clip dimensions. Use <code className="px-1 py-0.5 rounded bg-bg text-accent text-[10px]">__textTemplateDebug.enable()</code> in console.
                </p>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-accent/10 border border-accent/20">
            <p className="text-xs text-text-muted leading-relaxed">
              <strong className="text-accent font-semibold">Note:</strong> These diagnostics output to the browser console. Open DevTools (F12 or Cmd+Option+I) to view detailed performance metrics and traces.
              {(diagnosticsEnabled.performance || diagnosticsEnabled.projectLoad || diagnosticsEnabled.textRender || diagnosticsEnabled.timelinePerf || diagnosticsEnabled.textTemplate) && " Refresh the page after toggling for changes to take effect."}
            </p>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="default" onClick={() => setShowDiagnosticsModal(false)}>
              Done
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Recording Modal ───────────────────────────────── */}
      {isRecordOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 overflow-y-auto">
          <div
            className="w-full max-w-[520px] max-h-[88vh] rounded-2xl p-5 shadow-2xl flex flex-col gap-3.5 text-slate-100 border border-white/10 overflow-y-auto"
            style={{
              background: "linear-gradient(160deg, rgba(18,18,28,0.97) 0%, rgba(12,12,20,0.99) 100%)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between flex-shrink-0">
              <h3 className="text-base font-bold flex items-center gap-2 text-white">
                <span className="flex items-center justify-center w-7 h-7 rounded-full bg-red-500/15 border border-red-500/30">
                  <Video className="w-3.5 h-3.5 text-red-400" />
                </span>
                Record Screen & Camera
              </h3>
              <button
                onClick={closeRecordModal}
                disabled={isRecording}
                className="text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ✕
              </button>
            </div>

            {/* Live Preview */}
            <div className="relative h-36 rounded-xl bg-[#0a0a12] border border-white/8 overflow-hidden flex-shrink-0">
              {/* Screen preview (fills the background) */}
              {recordOptions.screen && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#07070c] border border-white/5">
                  <div className="flex flex-col items-center justify-center text-slate-500 gap-2">
                    <span className="text-4xl">🖥️</span>
                    <span className="text-xs font-semibold text-slate-400">Screen Capture Enabled</span>
                    <span className="text-[10px] text-slate-500">System picker will prompt when recording starts</span>
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
                  <span className="text-xs font-medium">Recording Audio Only</span>
                </div>
              )}

              {/* Camera notice banner */}
              {cameraNotice && (
                <div className="absolute top-2 left-2 right-2 z-20 bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] px-3 py-1.5 rounded-lg flex items-center justify-between backdrop-blur-sm">
                  <span>📷 {cameraNotice}</span>
                  <button onClick={() => setCameraNotice(null)} className="text-amber-400 hover:text-amber-200">✕</button>
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
                  REC {formatTime(seconds)}
                </div>
              )}
            </div>

            {/* Options */}
            <div className="grid grid-cols-3 gap-3">
              {([
                { key: "screen" as const, label: "Capture Screen", icon: "🖥️" },
                { key: "webcam" as const, label: "Camera", icon: "📷" },
                { key: "audio" as const, label: "Microphone", icon: "🎙️" },
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
              <div className="flex flex-col gap-2 p-3 rounded-xl bg-white/4 border border-white/8 text-slate-300">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Screen Capture Source
                </div>
                <select
                  value={recordOptions.screenType}
                  onChange={(e) => setRecordOptions({ ...recordOptions, screenType: e.target.value as any })}
                  className="w-full bg-[#0d0d15] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-accent/40 cursor-pointer"
                >
                  <option value="any">Standard System Picker (Let me choose)</option>
                  <option value="entire">Prefer Entire Display</option>
                  <option value="window">Prefer Application Window</option>
                </select>
              </div>
            )}

            {/* Quality Presets: Resolution & Frame Rate */}
            {!isRecording && (
              <div className="grid grid-cols-2 gap-2.5 p-3 rounded-xl bg-white/4 border border-white/8 text-slate-300">
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Resolution</span>
                  <div className="grid grid-cols-3 gap-1 bg-[#0d0d15] p-1 rounded-lg border border-white/10">
                    {(["720p", "1080p", "4k"] as const).map((res) => (
                      <button
                        key={res}
                        type="button"
                        onClick={() => setRecordOptions({ ...recordOptions, resolution: res })}
                        className={`py-1 rounded text-[11px] font-bold transition-all cursor-pointer ${
                          recordOptions.resolution === res
                            ? "bg-accent text-white shadow-sm"
                            : "text-slate-400 hover:text-white hover:bg-white/5"
                        }`}
                      >
                        {res.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Frame Rate</span>
                  <div className="grid grid-cols-2 gap-1 bg-[#0d0d15] p-1 rounded-lg border border-white/10">
                    {([30, 60] as const).map((fps) => (
                      <button
                        key={fps}
                        type="button"
                        onClick={() => setRecordOptions({ ...recordOptions, frameRate: fps })}
                        className={`py-1 rounded text-[11px] font-bold transition-all cursor-pointer ${
                          recordOptions.frameRate === fps
                            ? "bg-accent text-white shadow-sm"
                            : "text-slate-400 hover:text-white hover:bg-white/5"
                        }`}
                      >
                        {fps} FPS
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Mic Testing & Selection */}
            {recordOptions.audio && !isRecording && (
              <div className="flex flex-col gap-2 p-3 rounded-xl bg-white/4 border border-white/8 text-slate-300">
                <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <span>Microphone Source</span>
                  {audioDevices.length > 0 && <span className="text-emerald-400 font-bold flex items-center gap-1.5 animate-pulse">● Live Testing</span>}
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
                      <span className="text-[11px] text-slate-400 font-medium">Input level:</span>
                      <div className="flex-1 h-2 rounded-full bg-[#07070a] overflow-hidden flex items-center p-0.5 border border-white/5">
                        <div
                          ref={micLevelRef}
                          className="h-full rounded-full transition-all duration-75"
                          style={{
                            width: "0%",
                            background: "linear-gradient(90deg, #10b981 0%, #10b981 70%, #f59e0b 85%, #ef4444 100%)",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">No microphone devices found.</p>
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
                Start Capture
              </button>
              {!recordOptions.screen && !recordOptions.webcam && !recordOptions.audio ? (
                <p className="text-center text-xs text-amber-400/80 mt-3">
                  Enable at least one source to start recording.
                </p>
              ) : (
                <p className="text-center text-xs text-slate-500 mt-3">
                  The recording will automatically open as a new project in the editor.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
