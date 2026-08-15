/**
 * Export Dialog
 *
 * Premium export modal with multi-phase UX:
 *   Configure → Exporting → Complete → Error
 *
 * Features:
 * - Two-column layout: preset card sidebar + config/progress panel
 * - Visual preset cards with resolution badges and quality tier icons
 * - Animated SVG circular progress ring during export
 * - Project summary with live store data
 * - Estimated file size calculation
 * - FFmpeg availability detection
 * - Tauri save dialog integration
 * - Keyboard accessible (Tab/Arrow navigation, Escape to close)
 *
 * Lazy-loaded to reduce initial bundle size.
 * Uses theme-aware styling (respects user's color theme).
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  AlertCircle,
  Film,
  Clock,
  Monitor,
  HardDrive,
  FolderOpen,
  RotateCcw,
  X,
  Pencil,
  Check,
  XCircle,
  Download,
  CheckCircle2,
  Cloud,
} from "lucide-react";
import { Modal } from "../primitives/Modal";
import { Button } from "../primitives/Button";
import { platform } from "@/core/platform";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";
import { MAX_PROJECT_NAME_LENGTH } from "@/types";

// Import extracted components
import { ProgressRing } from "../primitives/ProgressRing";
import { SuccessCheck } from "../primitives/SuccessCheck";
import {
  ExportPresetCard,
  type ExportPreset,
  type PresetConfig,
} from "../cards/ExportPresetCard";
import {
  QUALITY_TIERS,
  resolveExportDimensions,
} from "@/lib/export/exportDimensions";
import { PRESET_CONFIGS, PRESET_ORDER } from "@/lib/export/exportPresets";

// Lazy load video export functionality (code splitting)
const exportVideoModule = () => import("@/lib/export/videoExport");

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type ExportPhase = "configure" | "exporting" | "complete" | "error";

interface VideoExportProgress {
  currentFrame?: number;
  totalFrames?: number;
  progress: number;
  etaSeconds?: number;
  fps?: number;
  status?: string;
}

interface ExportResult {
  totalFrames: number;
  totalTimeMs: number;
  avgTimePerFrameMs: number;
  outputPath?: string;
  cancelled?: boolean;
}

function getQualityTierForPreset(presetKey: ExportPreset) {
  if (presetKey.startsWith("720p")) {
    return QUALITY_TIERS[0]; // 720p
  }
  if (
    presetKey.startsWith("1080p") ||
    presetKey.startsWith("prores") ||
    presetKey.startsWith("webm")
  ) {
    return QUALITY_TIERS[1]; // 1080p
  }
  if (presetKey === "gif-animated") {
    return { id: "gif", label: "GIF", longEdge: 480 };
  }
  return QUALITY_TIERS[2]; // 4k
}

// ─── Detail Row ──────────────────────────────────────────────────────────

function DetailRow({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: React.FC<{ className?: string }>;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2 text-text-muted">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        <span className="text-[12px]">{label}</span>
      </div>
      <span className="text-[12px] font-medium text-text-primary">{value}</span>
    </div>
  );
}

// Grapheme counting helper
const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const countGraphemes = (str: string): number => {
  return Array.from(graphemeSegmenter.segment(str)).length;
};

// ─── Main Export Dialog ──────────────────────────────────────────────────

export const ExportDialog: React.FC<ExportDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const { project, mediaAssets, renameProject } = useProjectStore();
  const { clips, tracks, transitions, epoch, getTimelineEndTime } =
    useTimelineStore();

  // State
  const [preset, setPreset] = useState<ExportPreset>("1080p-fast");
  const [outputPath, setOutputPath] = useState<string>("");
  const [phase, setPhase] = useState<ExportPhase>("configure");
  const [progress, setProgress] = useState<VideoExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [ffmpegAvailable, setFfmpegAvailable] = useState<boolean | null>(null);
  const [ffmpegVersion, setFfmpegVersion] = useState<string>("");
  const [mobileExportMode, setMobileExportMode] = useState<
    "webcodecs" | "cloud" | "clypra"
  >("webcodecs");

  // Project Rename State
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const exportAbortRef = useRef(false);

  // FIX (BUG-C2): Stores the live cancel function provided by exportVideo() once the
  // FFmpeg session is started. Calling it kills the backend process and stops the
  // frame loop — previously the cancel button only reset the UI without stopping FFmpeg.
  const cancelExportFnRef = useRef<(() => Promise<void>) | null>(null);

  const selectedPreset = PRESET_CONFIGS[preset];

  // Dynamically resolve export dimensions using project aspect ratio and quality tier
  const projectW = project?.canvasWidth || 1920;
  const projectH = project?.canvasHeight || 1080;
  const qualityTier = getQualityTierForPreset(preset);
  const { width: resolvedWidth, height: resolvedHeight } =
    resolveExportDimensions(projectW, projectH, qualityTier);

  // ─── Component Lifecycle & Unmount Teardown ────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // On unmount (modal close or route change), abort running export & cleanup backend child process
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (cancelExportFnRef.current) {
        cancelExportFnRef.current().catch(console.error);
        cancelExportFnRef.current = null;
      }
    };
  }, []);

  // Safe state dispatchers that prevent updates on unmounted components
  const safeSetProgress = useCallback((p: VideoExportProgress | null) => {
    if (isMountedRef.current) setProgress(p);
  }, []);
  const safeSetPhase = useCallback((p: ExportPhase) => {
    if (isMountedRef.current) setPhase(p);
  }, []);
  const safeSetError = useCallback((e: string | null) => {
    if (isMountedRef.current) setError(e);
  }, []);
  const safeSetResult = useCallback((r: ExportResult | null) => {
    if (isMountedRef.current) setResult(r);
  }, []);

  // ─── Reset state on open ───────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setPhase("configure");
      setProgress(null);
      setError(null);
      setResult(null);
      exportAbortRef.current = false;
      setIsEditingName(false);
      setEditNameValue("");
      setIsRenaming(false);
    }
  }, [isOpen]);

  // ─── FFmpeg check ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    const checkFFmpeg = async () => {
      if (platform.isCapacitor()) {
        setFfmpegAvailable(false);
        return;
      }
      try {
        const module = await exportVideoModule();
        const available = await module.checkFFmpegAvailable();
        setFfmpegAvailable(available);
        if (available) {
          try {
            const version = await module.getFFmpegVersion();
            setFfmpegVersion(version);
          } catch {
            // Version detection is non-critical
          }
        }
      } catch (err) {
        console.error("[ExportDialog] FFmpeg check failed:", err);
        setFfmpegAvailable(false);
      }
    };

    checkFFmpeg();
  }, [isOpen]);

  // ─── Sequence duration (actual authored content) ───────────────────
  const sequenceDuration = getTimelineEndTime();

  // ─── Estimated file size ───────────────────────────────────────────
  const estimatedFileSize = (() => {
    if (sequenceDuration <= 0) return "—";
    const bytes =
      (selectedPreset.estimatedBitrateMbps * 1_000_000 * sequenceDuration) / 8;
    if (bytes < 1_000_000) return `~${(bytes / 1_000).toFixed(0)} KB`;
    if (bytes < 1_000_000_000) return `~${(bytes / 1_000_000).toFixed(1)} MB`;
    return `~${(bytes / 1_000_000_000).toFixed(2)} GB`;
  })();

  // ─── Format helpers ────────────────────────────────────────────────
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatDuration = (seconds: number): string => {
    if (seconds <= 0) return "0:00";
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0)
      return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatMs = (ms: number): string => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  // ─── Project Rename Handlers ───────────────────────────────────────
  const handleSaveName = useCallback(async () => {
    if (!project) return;
    const trimmed = editNameValue.trim();
    if (!trimmed || trimmed === project.name) {
      setIsEditingName(false);
      return;
    }

    if (countGraphemes(trimmed) > MAX_PROJECT_NAME_LENGTH) {
      return;
    }

    setIsRenaming(true);
    try {
      await renameProject(project.id, trimmed);
      setIsEditingName(false);
    } catch (err) {
      console.error("[ExportDialog] Failed to rename project:", err);
    } finally {
      setIsRenaming(false);
    }
  }, [editNameValue, project, renameProject]);

  const handleCancelRename = useCallback(() => {
    setIsEditingName(false);
  }, []);

  // ─── Output path picker ───────────────────────────────────────────
  const handleSelectOutputPath = useCallback(async () => {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const ext = selectedPreset.codecValue === "prores" ? "mov" : "mp4";
      const path = await save({
        defaultPath: `${project?.name || "video"}.${ext}`,
        filters: [{ name: "Video", extensions: [ext] }],
      });
      if (path) setOutputPath(path);
    } catch (err) {
      console.error("[ExportDialog] File picker failed:", err);
    }
  }, [project?.name, selectedPreset.codecValue]);

  // ─── Mobile Project Export Handler ──────────────────────────────────
  const handleExportProjectFile = useCallback(async () => {
    if (!project) return;
    try {
      const { toRustProject } = await import("@/types/serialization");
      const { gaps, markers } = useTimelineStore.getState();

      const rustProject = toRustProject(project, {
        tracks,
        clips,
        transitions,
        gaps,
        markers,
        mediaAssets,
      });

      const blob = new Blob([JSON.stringify(rustProject, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.name || "video-project"}.clypra`;
      a.click();
      URL.revokeObjectURL(url);

      // Close the modal upon successful export
      onClose();
    } catch (err) {
      console.error("[ExportDialog] Failed to export project file:", err);
    }
  }, [project, tracks, clips, transitions, mediaAssets, onClose]);

  // ─── Mobile Cloud Export Handler ────────────────────────────────────
  const handleCloudExport = useCallback(async () => {
    if (!project) return;
    setPhase("exporting");
    setError(null);
    setResult(null);
    setProgress(null);

    try {
      const { renderViaCloud } = await import("@/lib/export/cloudExport");
      const videoBlob = await renderViaCloud(
        project,
        {
          clips,
          tracks,
          transitions,
          mediaAssets,
          duration: sequenceDuration,
        },
        (progressInfo) => {
          setProgress({
            progress: progressInfo.progress,
            status: progressInfo.status,
          });
        },
      );

      // Save and share on mobile
      const filename = `${project.name || "video-cloud"}-${Date.now()}.mp4`;
      const sharedPath = await platform.saveAndShareVideo(videoBlob, filename);

      setPhase("complete");
      setResult({
        outputPath: sharedPath,
        totalFrames: Math.round(sequenceDuration * 30),
        totalTimeMs: 0,
        avgTimePerFrameMs: 0,
        cancelled: false,
      });
    } catch (err: any) {
      console.error("[ExportDialog] Cloud render failed:", err);
      setError(err?.message || "Cloud rendering failed.");
      setPhase("error");
    }
  }, [project, clips, tracks, transitions, mediaAssets, sequenceDuration]);

  // ─── Mobile capabilities check ─────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    if (platform.isCapacitor()) {
      const checkMobileCapabilities = async () => {
        try {
          const { isWebCodecsSupported } =
            await import("@/lib/export/videoExport");
          if (isWebCodecsSupported()) {
            setMobileExportMode("webcodecs");
          } else {
            const { isCloudRenderAvailable } =
              await import("@/lib/export/cloudExport");
            const cloudAvailable = await isCloudRenderAvailable();
            if (cloudAvailable) {
              setMobileExportMode("cloud");
            } else {
              setMobileExportMode("clypra");
            }
          }
        } catch (err) {
          console.error("[ExportDialog] Capability check failed:", err);
          setMobileExportMode("clypra");
        }
      };
      checkMobileCapabilities();
    }
  }, [isOpen]);

  // ─── Export handler ────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (!outputPath || !project) return;

    safeSetPhase("exporting");
    safeSetError(null);
    safeSetResult(null);
    safeSetProgress(null);
    exportAbortRef.current = false;
    cancelExportFnRef.current = null; // clear any stale cancel fn from previous export

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // 1. Analyze if the timeline is eligible for native zero-copy hardware acceleration
      const { analyzeNativeTimelineExport, runNativeTimelineExport } =
        await import("@/lib/export/nativeTimelineExport");
      const eligibility = analyzeNativeTimelineExport({
        clips,
        tracks,
        transitions,
        assets: mediaAssets,
        project,
        startTime: 0,
        endTime: sequenceDuration,
        outputPath,
        width: resolvedWidth,
        height: resolvedHeight,
        frameRate: project.frameRate,
        codec: selectedPreset.codecValue as any,
        preset: selectedPreset.preset,
        crf: selectedPreset.crf,
        pixelFormat: selectedPreset.pixelFormat as any,
      });

      if (eligibility.eligible) {
        console.log(
          "[ExportDialog] Fast-Path: Native Hardware Acceleration activated!",
          eligibility.plan,
        );
        const nativeResult = await runNativeTimelineExport(eligibility.plan, {
          signal: controller.signal,
          onProgress: (p) =>
            safeSetProgress({
              currentFrame: p.currentFrame,
              totalFrames: p.totalFrames,
              progress: p.progress,
              fps: p.fps,
              etaSeconds: p.etaSeconds,
            }),
          onSessionReady: (cancel) => {
            cancelExportFnRef.current = cancel;
          },
        });

        if (!isMountedRef.current) return;

        if (!nativeResult.cancelled) {
          safeSetResult({
            totalFrames: nativeResult.completedFrames,
            totalTimeMs: nativeResult.totalTimeMs,
            avgTimePerFrameMs:
              nativeResult.totalTimeMs > 0 && nativeResult.completedFrames > 0
                ? nativeResult.totalTimeMs / nativeResult.completedFrames
                : 0,
          });
          safeSetPhase("complete");
          return;
        } else {
          safeSetPhase("configure");
          return;
        }
      }

      // 2. Fallback to Compositor export for complex layers / overlays
      const { exportVideo } = await exportVideoModule();

      const exportResult = await exportVideo({
        clips,
        tracks,
        transitions,
        assets: mediaAssets,
        project,
        epoch,
        startTime: 0,
        endTime: sequenceDuration,
        outputPath,
        width: resolvedWidth,
        height: resolvedHeight,
        // FIX (BUG-5): Explicitly pass frameRate from project settings
        // so the user knows exactly what fps the export uses
        frameRate: project.frameRate,
        codec: selectedPreset.codecValue as any,
        preset: selectedPreset.preset,
        crf: selectedPreset.crf,
        pixelFormat: selectedPreset.pixelFormat as any,
        signal: controller.signal,
        onProgress: (p) => safeSetProgress(p),
        // FIX (BUG-C2): Receive the live cancel function as soon as FFmpeg starts.
        // Storing it in a ref lets handleCancelExport call it at any time.
        onSessionReady: (cancel) => {
          cancelExportFnRef.current = cancel;
        },
      });

      if (!isMountedRef.current) return;

      if (!exportResult.cancelled) {
        safeSetResult({
          totalFrames: exportResult.totalFrames,
          totalTimeMs: exportResult.totalTimeMs,
          avgTimePerFrameMs: exportResult.avgTimePerFrameMs,
        });
        safeSetPhase("complete");
      } else {
        safeSetPhase("configure");
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      safeSetError(err instanceof Error ? err.message : "Export failed");
      safeSetPhase("error");
    } finally {
      abortControllerRef.current = null;
      cancelExportFnRef.current = null;
    }
  }, [
    outputPath,
    project,
    clips,
    tracks,
    transitions,
    mediaAssets,
    epoch,
    selectedPreset,
    sequenceDuration,
    resolvedWidth,
    resolvedHeight,
    safeSetPhase,
    safeSetError,
    safeSetResult,
    safeSetProgress,
  ]);

  // FIX (BUG-C2): Actually cancel the backend FFmpeg session and stop the frame loop.
  // Previously this only reset the UI; FFmpeg kept running and writing output.
  const handleCancelExport = useCallback(async () => {
    exportAbortRef.current = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (cancelExportFnRef.current) {
      await cancelExportFnRef.current().catch(() => {});
      cancelExportFnRef.current = null;
    }
    safeSetPhase("configure");
    safeSetProgress(null);
  }, [safeSetPhase, safeSetProgress]);

  // ─── Reveal in Finder ──────────────────────────────────────────────
  const handleRevealInFinder = useCallback(async () => {
    if (!outputPath) return;
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(outputPath);
    } catch (err) {
      console.error("[ExportDialog] Reveal in finder failed:", err);
    }
  }, [outputPath]);

  // ─── Reset for another export ──────────────────────────────────────
  const handleExportAnother = useCallback(() => {
    setPhase("configure");
    setProgress(null);
    setResult(null);
    setError(null);
    setOutputPath("");
  }, []);

  // ─── Truncated path display ────────────────────────────────────────
  const displayPath = outputPath
    ? outputPath.length > 45
      ? "…" + outputPath.slice(-42)
      : outputPath
    : "";

  // ─── Can export check ─────────────────────────────────────────────
  const canExport =
    ffmpegAvailable === true &&
    outputPath.length > 0 &&
    sequenceDuration > 0 &&
    phase === "configure";

  return (
    <Modal
      isOpen={isOpen}
      onClose={phase === "exporting" ? () => {} : onClose}
      title="Export Video"
      size="lg"
    >
      <div className="flex flex-col md:flex-row min-h-[400px]">
        {/* ─── Left Sidebar: Preset Cards ─────────────────────────── */}
        <div className="w-full md:w-[200px] shrink-0 border-b md:border-b-0 md:border-r border-white/6 p-3 flex flex-row md:flex-col gap-2 overflow-x-auto scrollbar-none items-center md:items-stretch">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted px-0.5 hidden md:block">
            Export Preset
          </div>

          {PRESET_ORDER.map((key) => {
            const tier = getQualityTierForPreset(key);
            const resolved = resolveExportDimensions(projectW, projectH, tier);
            const dynamicConfig = {
              ...PRESET_CONFIGS[key],
              resolution: `${resolved.width}×${resolved.height}`,
            };
            return (
              <ExportPresetCard
                key={key}
                presetKey={key}
                config={dynamicConfig}
                selected={preset === key}
                disabled={phase === "exporting"}
                onSelect={() => setPreset(key)}
              />
            );
          })}

          {/* FFmpeg status — bottom of sidebar */}
          {!platform.isCapacitor() && (
            <div className="hidden md:block mt-auto pt-3 border-t border-white/6">
              {ffmpegAvailable === null && (
                <div className="flex items-center gap-2 px-1">
                  <div className="w-2 h-2 rounded-full bg-text-muted/30 animate-pulse" />
                  <span className="text-[10px] text-text-muted">
                    Checking FFmpeg…
                  </span>
                </div>
              )}
              {ffmpegAvailable === true && (
                <div className="flex items-center gap-2 px-1">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_4px_--theme(--color-emerald-500/50)]" />
                  <span
                    className="text-[10px] text-text-muted truncate"
                    title={ffmpegVersion}
                  >
                    {ffmpegVersion || "FFmpeg ready"}
                  </span>
                </div>
              )}
              {ffmpegAvailable === false && (
                <div className="flex items-start gap-2 px-1">
                  <div className="w-2 h-2 rounded-full bg-destructive mt-0.5 shrink-0" />
                  <div>
                    <span className="text-[10px] font-medium text-destructive block">
                      FFmpeg missing
                    </span>
                    <span className="text-[9px] text-text-muted leading-tight block mt-0.5">
                      Install FFmpeg and add to PATH
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── Right Panel ────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* ═══ PHASE: Configure ═══ */}
          {phase === "configure" && (
            <>
              <div className="flex-1 p-5 space-y-5 overflow-y-auto">
                {/* Project Summary */}
                {project && (
                  <section>
                    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2.5">
                      Project
                    </h3>
                    <div className="rounded-lg border border-white/6 bg-white/2 p-3 space-y-0.5">
                      <div className="flex items-center justify-between py-1.5 min-h-[32px]">
                        <div className="flex items-center gap-2 text-text-muted">
                          <Film className="w-3.5 h-3.5" />
                          <span className="text-[12px]">Name</span>
                        </div>
                        {isEditingName ? (
                          <div className="flex items-center gap-1.5 flex-1 justify-end pl-4">
                            <input
                              type="text"
                              value={editNameValue}
                              onChange={(e) => setEditNameValue(e.target.value)}
                              onBlur={handleSaveName}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveName();
                                if (e.key === "Escape") handleCancelRename();
                              }}
                              autoFocus
                              disabled={isRenaming}
                              maxLength={MAX_PROJECT_NAME_LENGTH}
                              className="w-full max-w-[180px] px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[12px] text-text-primary text-right focus:outline-none focus:border-accent focus:bg-white/8 transition-all"
                            />
                            <button
                              onClick={handleSaveName}
                              disabled={
                                isRenaming ||
                                !editNameValue.trim() ||
                                countGraphemes(editNameValue) >
                                  MAX_PROJECT_NAME_LENGTH
                              }
                              className="text-accent hover:text-accent-soft disabled:opacity-30 disabled:cursor-not-allowed p-1 rounded hover:bg-white/5 cursor-pointer flex items-center justify-center shrink-0"
                              title="Save Name"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={handleCancelRename}
                              disabled={isRenaming}
                              className="text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed p-1 rounded hover:bg-white/5 cursor-pointer flex items-center justify-center shrink-0"
                              title="Cancel"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setEditNameValue(project.name);
                              setIsEditingName(true);
                            }}
                            className="group flex items-center gap-1.5 hover:text-accent text-[12px] font-medium text-text-primary transition-colors cursor-pointer text-right max-w-[240px] truncate"
                            title="Click to rename project"
                          >
                            <span className="truncate">{project.name}</span>
                            <Pencil className="w-3.5 h-3.5 text-text-muted group-hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity" />
                          </button>
                        )}
                      </div>
                      <DetailRow
                        label="Duration"
                        value={formatDuration(sequenceDuration)}
                        icon={Clock}
                      />
                      <DetailRow
                        label="Canvas"
                        value={`${project.canvasWidth}×${project.canvasHeight}`}
                        icon={Monitor}
                      />
                      <DetailRow
                        label="Frame Rate"
                        value={`${project.frameRate} fps`}
                      />
                    </div>
                  </section>
                )}

                {/* Export Details */}
                <section>
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2.5">
                    Export Settings
                  </h3>
                  <div className="rounded-lg border border-white/6 bg-white/2 p-3 space-y-0.5">
                    <DetailRow
                      label="Resolution"
                      value={`${resolvedWidth}×${resolvedHeight}`}
                      icon={Monitor}
                    />
                    <DetailRow
                      label="Codec"
                      value={selectedPreset.codecLabel}
                    />
                    <DetailRow
                      label="Quality"
                      value={`CRF ${selectedPreset.crf} / ${selectedPreset.preset}`}
                    />
                    <DetailRow
                      label="Pixel Format"
                      value={selectedPreset.pixelFormat}
                    />
                    {/* FIX (BUG-5): Show the frame rate that will be used in the export */}
                    <DetailRow
                      label="Frame Rate"
                      value={`${project?.frameRate || 30} fps`}
                    />
                    <DetailRow
                      label="Est. File Size"
                      value={estimatedFileSize}
                      icon={HardDrive}
                    />
                  </div>
                </section>

                {/* Output/Sharing section */}
                {platform.isCapacitor() ? (
                  <section>
                    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2.5">
                      Mobile Export
                    </h3>
                    {mobileExportMode === "webcodecs" && (
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/2 p-4 flex gap-3 items-start">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                        <div>
                          <h4 className="text-xs font-semibold text-text-primary mb-1">
                            On-Device Rendering Available
                          </h4>
                          <p className="text-[11px] text-text-muted leading-relaxed">
                            This device supports hardware-accelerated video
                            encoding (WebCodecs). Your video will render locally
                            on-device and can be shared or saved to your photo
                            library.
                          </p>
                        </div>
                      </div>
                    )}
                    {mobileExportMode === "cloud" && (
                      <div className="rounded-lg border border-accent/20 bg-accent/2 p-4 flex gap-3 items-start">
                        <Cloud className="w-5 h-5 text-accent shrink-0 mt-0.5" />
                        <div>
                          <h4 className="text-xs font-semibold text-text-primary mb-1">
                            Cloud Rendering Fallback
                          </h4>
                          <p className="text-[11px] text-text-muted leading-relaxed">
                            On-device hardware encoding is unsupported or
                            disabled. We will render your project securely on
                            our Cloud Render Worker service and download the
                            finished MP4 video.
                          </p>
                        </div>
                      </div>
                    )}
                    {mobileExportMode === "clypra" && (
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/2 p-4 flex gap-3 items-start">
                        <Download className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <h4 className="text-xs font-semibold text-text-primary mb-1">
                            Project File Export Fallback
                          </h4>
                          <p className="text-[11px] text-text-muted leading-relaxed">
                            On-device encoding and Cloud Rendering are currently
                            unavailable. You can export the project metadata
                            file (.clypra) and open it on Clypra Desktop to
                            render it at full quality.
                          </p>
                        </div>
                      </div>
                    )}
                  </section>
                ) : (
                  <section>
                    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2.5">
                      Output
                    </h3>
                    <div className="flex items-center gap-2">
                      <div
                        className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border text-[12px] min-w-0 ${outputPath ? "border-white/8 bg-white/2 text-text-primary" : "border-white/6 bg-white/1 text-text-muted"}`}
                      >
                        <FolderOpen className="w-3.5 h-3.5 shrink-0 text-text-muted" />
                        <span className="truncate">
                          {displayPath || "No output file selected…"}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleSelectOutputPath}
                        className="shrink-0 text-[12px]"
                      >
                        Browse
                      </Button>
                    </div>
                  </section>
                )}

                {/* Empty timeline warning */}
                {sequenceDuration <= 0 && (
                  <div className="flex items-start gap-3 p-3 bg-amber-500/8 border border-amber-500/20 rounded-lg">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-amber-400">
                        No content to export
                      </p>
                      <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                        Add clips to the timeline before exporting.
                      </p>
                    </div>
                  </div>
                )}

                {/* FFmpeg Warning (inline, only if missing and not on Capacitor) */}
                {ffmpegAvailable === false && !platform.isCapacitor() && (
                  <div className="flex items-start gap-3 p-3 bg-destructive/8 border border-destructive/20 rounded-lg">
                    <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-destructive">
                        FFmpeg is required
                      </p>
                      <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                        Video export requires FFmpeg to be installed and
                        available in your system PATH.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t border-white/6 flex items-center justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                {platform.isCapacitor() ? (
                  <Button
                    variant="default"
                    onClick={
                      mobileExportMode === "webcodecs"
                        ? handleExport
                        : mobileExportMode === "cloud"
                          ? handleCloudExport
                          : handleExportProjectFile
                    }
                    disabled={sequenceDuration <= 0}
                    className="min-w-[150px]"
                    style={{
                      background:
                        sequenceDuration > 0
                          ? "linear-gradient(135deg, var(--color-accent), var(--color-accent-soft))"
                          : undefined,
                    }}
                  >
                    {mobileExportMode === "webcodecs"
                      ? "Export Video"
                      : mobileExportMode === "cloud"
                        ? "Cloud Render Video"
                        : "Export Project File"}
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    onClick={handleExport}
                    disabled={!canExport}
                    className="min-w-[100px]"
                    style={{
                      background: canExport
                        ? "linear-gradient(135deg, var(--color-accent), var(--color-accent-soft))"
                        : undefined,
                    }}
                  >
                    Export
                  </Button>
                )}
              </div>
            </>
          )}

          {/* ═══ PHASE: Exporting ═══ */}
          {phase === "exporting" && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-6">
              <ProgressRing progress={progress?.progress || 0} />

              <div className="w-full max-w-[320px] text-center space-y-3">
                <h3 className="text-[15px] font-semibold text-text-primary tracking-tight">
                  Exporting Video…
                </h3>

                {progress && (
                  <div className="space-y-2">
                    {progress.status && (
                      <p className="text-[12px] font-medium text-accent animate-pulse mb-2">
                        {progress.status}
                      </p>
                    )}
                    {progress.currentFrame !== undefined &&
                    progress.totalFrames !== undefined ? (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 p-3 rounded-lg border border-white/6 bg-white/1 text-[11px]">
                        <div className="text-left text-text-muted">Frames</div>
                        <div className="text-right font-medium text-text-primary tabular-nums">
                          {progress.currentFrame} / {progress.totalFrames}
                        </div>

                        {progress.fps !== undefined && (
                          <>
                            <div className="text-left text-text-muted">
                              Speed
                            </div>
                            <div className="text-right font-medium text-text-primary tabular-nums">
                              {progress.fps.toFixed(1)} fps
                            </div>
                          </>
                        )}

                        {progress.etaSeconds !== undefined && (
                          <>
                            <div className="text-left text-text-muted">
                              Time Remaining
                            </div>
                            <div className="text-right font-medium text-text-primary tabular-nums">
                              {formatTime(progress.etaSeconds)}
                            </div>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                )}

                {/* FIX (BUG-3): Cancel button during export */}
                <div className="pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCancelExport}
                    className="text-[11px] gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Cancel Export
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ═══ PHASE: Complete ═══ */}
          {phase === "complete" && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-6 overflow-y-auto">
              <SuccessCheck />

              <div className="w-full max-w-[360px] text-center space-y-4">
                <div>
                  <h3 className="text-[16px] font-bold text-text-primary tracking-tight">
                    Export Complete!
                  </h3>
                  <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
                    Your video has been successfully generated and saved to your
                    device.
                  </p>
                </div>

                {result && (
                  <div className="p-3 rounded-lg border border-white/6 bg-white/1 text-[11px] space-y-1.5 text-left">
                    {result.totalTimeMs > 0 && (
                      <div className="flex justify-between">
                        <span className="text-text-muted">
                          Total Render Time
                        </span>
                        <span className="font-medium text-text-primary">
                          {formatMs(result.totalTimeMs)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-text-muted">Rendered Frames</span>
                      <span className="font-medium text-text-primary">
                        {result.totalFrames} frames
                      </span>
                    </div>
                    {result.avgTimePerFrameMs > 0 && (
                      <div className="flex justify-between">
                        <span className="text-text-muted">Average Speed</span>
                        <span className="font-medium text-text-primary">
                          {(1000 / result.avgTimePerFrameMs).toFixed(1)} fps (
                          {result.avgTimePerFrameMs.toFixed(1)}ms/f)
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-text-muted">
                        {platform.isCapacitor() ? "Shared File" : "Saved Path"}
                      </span>
                      <span
                        className="font-medium text-accent truncate max-w-[220px]"
                        title={
                          platform.isCapacitor()
                            ? result.outputPath?.split("/").pop()
                            : outputPath
                        }
                      >
                        {platform.isCapacitor()
                          ? result.outputPath?.split("/").pop()
                          : displayPath}
                      </span>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-center gap-2 pt-2">
                  {!platform.isCapacitor() && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRevealInFinder}
                      className="text-[11px]"
                    >
                      Reveal in Finder
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleExportAnother}
                    className="text-[11px] gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Export Another
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={onClose}
                    className="text-[11px]"
                  >
                    Done
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ═══ PHASE: Error ═══ */}
          {phase === "error" && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-5">
              <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
                <AlertCircle className="w-8 h-8" />
              </div>

              <div className="w-full max-w-[320px] text-center space-y-4">
                <div>
                  <h3 className="text-[15px] font-bold text-text-primary tracking-tight">
                    Export Failed
                  </h3>
                  <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
                    An error occurred during the rendering and encoding process.
                  </p>
                </div>

                {error && (
                  <div className="p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-destructive text-[11px] text-left leading-normal font-mono break-all max-h-[120px] overflow-y-auto scrollbar-thin">
                    {error}
                  </div>
                )}

                <div className="flex items-center justify-center gap-2 pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleExportAnother}
                    className="text-[11px]"
                  >
                    Try Again
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={onClose}
                    className="text-[11px]"
                  >
                    Close
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
