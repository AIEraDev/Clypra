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
import { useTranslation } from "react-i18next";
import { AlertCircle, Film, Clock, Monitor, HardDrive, FolderOpen, RotateCcw, X, Pencil, Check } from "lucide-react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";
import { MAX_PROJECT_NAME_LENGTH } from "@/types";

// Import extracted components
import { ProgressRing } from "./ProgressRing";
import { SuccessCheck } from "./SuccessCheck";
import { ExportPresetCard, ExportPreset, PresetConfig } from "./ExportPresetCard";

// Lazy load video export functionality (code splitting)
const exportVideoModule = () => import("@/lib/videoExport");

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type ExportPhase = "configure" | "exporting" | "complete" | "error";

interface VideoExportProgress {
  currentFrame: number;
  totalFrames: number;
  progress: number;
  etaSeconds: number;
  fps: number;
}

interface ExportResult {
  totalFrames: number;
  totalTimeMs: number;
  avgTimePerFrameMs: number;
}

// ─── Preset Configuration ────────────────────────────────────────────────

const PRESET_CONFIGS: Record<ExportPreset, PresetConfig> = {
  "720p-fast": {
    label: "720p Fast",
    shortLabel: "720p",
    resolution: "1280×720",
    codec: "H.264",
    codecLabel: "H.264",
    tier: "fast",
    tierLabel: "Fast",
    width: 1280,
    height: 720,
    codecValue: "h264",
    preset: "fast",
    crf: 23,
    pixelFormat: "yuv420p",
    estimatedBitrateMbps: 4,
  },
  "1080p-fast": {
    label: "1080p Fast",
    shortLabel: "1080p",
    resolution: "1920×1080",
    codec: "H.264",
    codecLabel: "H.264",
    tier: "fast",
    tierLabel: "Fast",
    width: 1920,
    height: 1080,
    codecValue: "h264",
    preset: "fast",
    crf: 23,
    pixelFormat: "yuv420p",
    estimatedBitrateMbps: 8,
  },
  "1080p-quality": {
    label: "1080p Quality",
    shortLabel: "1080p",
    resolution: "1920×1080",
    codec: "H.264",
    codecLabel: "H.264",
    tier: "quality",
    tierLabel: "Quality",
    width: 1920,
    height: 1080,
    codecValue: "h264",
    preset: "slow",
    crf: 18,
    pixelFormat: "yuv420p",
    estimatedBitrateMbps: 15,
  },
  "4k-quality": {
    label: "4K Quality",
    shortLabel: "4K",
    resolution: "3840×2160",
    codec: "H.265",
    codecLabel: "H.265 / HEVC",
    tier: "quality",
    tierLabel: "Quality",
    width: 3840,
    height: 2160,
    codecValue: "h265",
    preset: "medium",
    crf: 20,
    pixelFormat: "yuv420p",
    estimatedBitrateMbps: 30,
  },
  "prores-422hq": {
    label: "ProRes 422 HQ",
    shortLabel: "ProRes",
    resolution: "1920×1080",
    codec: "ProRes",
    codecLabel: "ProRes 422 HQ",
    tier: "pro",
    tierLabel: "Professional",
    width: 1920,
    height: 1080,
    codecValue: "prores",
    preset: "medium",
    crf: 0,
    pixelFormat: "yuv422p10le",
    estimatedBitrateMbps: 220,
  },
};

const PRESET_ORDER: ExportPreset[] = ["720p-fast", "1080p-fast", "1080p-quality", "4k-quality", "prores-422hq"];

// ─── Detail Row ──────────────────────────────────────────────────────────

function DetailRow({ label, value, icon: Icon }: { label: string; value: string; icon?: React.FC<{ className?: string }> }) {
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

export const ExportDialog: React.FC<ExportDialogProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const { project, mediaAssets, renameProject } = useProjectStore();
  const { clips, tracks, transitions, epoch, getTimelineEndTime } = useTimelineStore();

  // State
  const [preset, setPreset] = useState<ExportPreset>("1080p-fast");
  const [outputPath, setOutputPath] = useState<string>("");
  const [phase, setPhase] = useState<ExportPhase>("configure");
  const [progress, setProgress] = useState<VideoExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [ffmpegAvailable, setFfmpegAvailable] = useState<boolean | null>(null);
  const [ffmpegVersion, setFfmpegVersion] = useState<string>("");

  // Project Rename State
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  const exportAbortRef = useRef(false);

  const selectedPreset = PRESET_CONFIGS[preset];

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
    const bytes = (selectedPreset.estimatedBitrateMbps * 1_000_000 * sequenceDuration) / 8;
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
    if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
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
        filters: [{ name: t("screens.export.videoFilter"), extensions: [ext] }],
      });
      if (path) setOutputPath(path);
    } catch (err) {
      console.error("[ExportDialog] File picker failed:", err);
    }
  }, [project?.name, selectedPreset.codecValue]);

  // ─── Export handler ────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (!outputPath || !project) return;

    setPhase("exporting");
    setError(null);
    setResult(null);
    setProgress(null);
    exportAbortRef.current = false;

    try {
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
        width: selectedPreset.width,
        height: selectedPreset.height,
        codec: selectedPreset.codecValue,
        preset: selectedPreset.preset,
        crf: selectedPreset.crf,
        pixelFormat: selectedPreset.pixelFormat,
        onProgress: (p) => setProgress(p),
      });

      if (!exportResult.cancelled) {
        setResult({
          totalFrames: exportResult.totalFrames,
          totalTimeMs: exportResult.totalTimeMs,
          avgTimePerFrameMs: exportResult.avgTimePerFrameMs,
        });
        setPhase("complete");
      } else {
        setPhase("configure");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("screens.export.exportFailedGeneric"));
      setPhase("error");
    }
  }, [outputPath, project, clips, tracks, transitions, mediaAssets, epoch, selectedPreset, sequenceDuration]);

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
  const displayPath = outputPath ? (outputPath.length > 45 ? "…" + outputPath.slice(-42) : outputPath) : "";

  // ─── Can export check ─────────────────────────────────────────────
  const canExport = ffmpegAvailable === true && outputPath.length > 0 && sequenceDuration > 0 && phase === "configure";

  return (
    <Modal isOpen={isOpen} onClose={phase === "exporting" ? () => {} : onClose} title={t("screens.export.title")} size="lg">
      <div className="flex flex-col md:flex-row min-h-[400px]">
        {/* ─── Left Sidebar: Preset Cards ─────────────────────────── */}
        <div className="w-full md:w-[200px] shrink-0 border-b md:border-b-0 md:border-r border-white/6 p-3 flex flex-row md:flex-col gap-2 overflow-x-auto scrollbar-none items-center md:items-stretch">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted px-0.5 hidden md:block">{t("screens.export.preset")}</div>

          {PRESET_ORDER.map((key) => (
            <ExportPresetCard key={key} presetKey={key} config={PRESET_CONFIGS[key]} selected={preset === key} disabled={phase === "exporting"} onSelect={() => setPreset(key)} />
          ))}

          {/* FFmpeg status — bottom of sidebar */}
          <div className="hidden md:block mt-auto pt-3 border-t border-white/6">
            {ffmpegAvailable === null && (
              <div className="flex items-center gap-2 px-1">
                <div className="w-2 h-2 rounded-full bg-text-muted/30 animate-pulse" />
                <span className="text-[10px] text-text-muted">{t("screens.export.checkingFfmpeg")}</span>
              </div>
            )}
            {ffmpegAvailable === true && (
              <div className="flex items-center gap-2 px-1">
                <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_4px_--theme(--color-emerald-500/50)]" />
                <span className="text-[10px] text-text-muted truncate" title={ffmpegVersion}>
                  {ffmpegVersion || t("screens.export.ffmpegReady")}
                </span>
              </div>
            )}
            {ffmpegAvailable === false && (
              <div className="flex items-start gap-2 px-1">
                <div className="w-2 h-2 rounded-full bg-destructive mt-0.5 shrink-0" />
                <div>
                  <span className="text-[10px] font-medium text-destructive block">{t("screens.export.ffmpegMissing")}</span>
                  <span className="text-[9px] text-text-muted leading-tight block mt-0.5">{t("screens.export.ffmpegMissingHint")}</span>
                </div>
              </div>
            )}
          </div>
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
                    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2.5">{t("screens.export.project")}</h3>
                    <div className="rounded-lg border border-white/6 bg-white/2 p-3 space-y-0.5">
                      <div className="flex items-center justify-between py-1.5 min-h-[32px]">
                        <div className="flex items-center gap-2 text-text-muted">
                          <Film className="w-3.5 h-3.5" />
                          <span className="text-[12px]">{t("screens.export.name")}</span>
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
                            <button onClick={handleSaveName} disabled={isRenaming || !editNameValue.trim() || countGraphemes(editNameValue) > MAX_PROJECT_NAME_LENGTH} className="text-accent hover:text-accent-soft disabled:opacity-30 disabled:cursor-not-allowed p-1 rounded hover:bg-white/5 cursor-pointer flex items-center justify-center shrink-0" title={t("screens.export.saveName")}>
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={handleCancelRename} disabled={isRenaming} className="text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed p-1 rounded hover:bg-white/5 cursor-pointer flex items-center justify-center shrink-0" title={t("screens.export.cancel")}>
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
                            title={t("screens.export.clickToRename")}
                          >
                            <span className="truncate">{project.name}</span>
                            <Pencil className="w-3.5 h-3.5 text-text-muted group-hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity" />
                          </button>
                        )}
                      </div>
                      <DetailRow label={t("screens.export.duration")} value={formatDuration(sequenceDuration)} icon={Clock} />
                      <DetailRow label={t("screens.export.canvas")} value={`${project.canvasWidth}×${project.canvasHeight}`} icon={Monitor} />
                      <DetailRow label={t("screens.export.frameRate")} value={`${project.frameRate} fps`} />
                    </div>
                  </section>
                )}

                {/* Export Details */}
                <section>
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2.5">{t("screens.export.settings")}</h3>
                  <div className="rounded-lg border border-white/6 bg-white/2 p-3 space-y-0.5">
                    <DetailRow label={t("screens.export.resolution")} value={selectedPreset.resolution} icon={Monitor} />
                    <DetailRow label={t("screens.export.codec")} value={selectedPreset.codecLabel} />
                    <DetailRow label={t("screens.export.quality")} value={`CRF ${selectedPreset.crf} / ${selectedPreset.preset}`} />
                    <DetailRow label={t("screens.export.pixelFormat")} value={selectedPreset.pixelFormat} />
                    <DetailRow label={t("screens.export.estFileSize")} value={estimatedFileSize} icon={HardDrive} />
                  </div>
                </section>

                {/* Output Path */}
                <section>
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2.5">{t("screens.export.output")}</h3>
                  <div className="flex items-center gap-2">
                    <div className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border text-[12px] min-w-0 ${outputPath ? "border-white/8 bg-white/2 text-text-primary" : "border-white/6 bg-white/1 text-text-muted"}`}>
                      <FolderOpen className="w-3.5 h-3.5 shrink-0 text-text-muted" />
                      <span className="truncate">{displayPath || t("screens.export.noOutputSelected")}</span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={handleSelectOutputPath} className="shrink-0 text-[12px]">
                      {t("screens.export.browse")}
                    </Button>
                  </div>
                </section>

                {/* Empty timeline warning */}
                {sequenceDuration <= 0 && (
                  <div className="flex items-start gap-3 p-3 bg-amber-500/8 border border-amber-500/20 rounded-lg">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-amber-400">{t("screens.export.noContentTitle")}</p>
                      <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">{t("screens.export.noContentHint")}</p>
                    </div>
                  </div>
                )}

                {/* FFmpeg Warning (inline, only if missing) */}
                {ffmpegAvailable === false && (
                  <div className="flex items-start gap-3 p-3 bg-destructive/8 border border-destructive/20 rounded-lg">
                    <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-destructive">{t("screens.export.ffmpegRequired")}</p>
                      <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">{t("screens.export.ffmpegRequiredHint")}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t border-white/6 flex items-center justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>
                  {t("screens.export.cancel")}
                </Button>
                <Button
                  variant="default"
                  onClick={handleExport}
                  disabled={!canExport}
                  className="min-w-[100px]"
                  style={{
                    background: canExport ? "linear-gradient(135deg, var(--color-accent), var(--color-accent-soft))" : undefined,
                  }}
                >
                  {t("screens.export.export")}
                </Button>
              </div>
            </>
          )}

          {/* ═══ PHASE: Exporting ═══ */}
          {phase === "exporting" && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-6">
              <ProgressRing progress={progress?.progress || 0} />

              <div className="w-full max-w-[320px] text-center space-y-3">
                <h3 className="text-[15px] font-semibold text-text-primary tracking-tight">{t("screens.export.exporting")}</h3>

                {progress && (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 p-3 rounded-lg border border-white/6 bg-white/1 text-[11px]">
                    <div className="text-left text-text-muted">{t("screens.export.progress")}</div>
                    <div className="text-right font-medium text-text-primary tabular-nums">
                      {t("screens.export.frameProgress", { current: progress.currentFrame, total: progress.totalFrames })}
                    </div>

                    <div className="text-left text-text-muted">{t("screens.export.speed")}</div>
                    <div className="text-right font-medium text-text-primary tabular-nums">{progress.fps.toFixed(1)} fps</div>

                    <div className="text-left text-text-muted">{t("screens.export.timeRemaining")}</div>
                    <div className="text-right font-medium text-text-primary tabular-nums">{formatTime(progress.etaSeconds)}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══ PHASE: Complete ═══ */}
          {phase === "complete" && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-6 overflow-y-auto">
              <SuccessCheck />

              <div className="w-full max-w-[360px] text-center space-y-4">
                <div>
                  <h3 className="text-[16px] font-bold text-text-primary tracking-tight">{t("screens.export.complete")}</h3>
                  <p className="text-[12px] text-text-muted mt-1 leading-relaxed">{t("screens.export.completeHint")}</p>
                </div>

                {result && (
                  <div className="p-3 rounded-lg border border-white/6 bg-white/1 text-[11px] space-y-1.5 text-left">
                    <div className="flex justify-between">
                      <span className="text-text-muted">{t("screens.export.totalRenderTime")}</span>
                      <span className="font-medium text-text-primary">{formatMs(result.totalTimeMs)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">{t("screens.export.renderedFrames")}</span>
                      <span className="font-medium text-text-primary">{t("screens.export.framesValue", { n: result.totalFrames })}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">{t("screens.export.averageSpeed")}</span>
                      <span className="font-medium text-text-primary">
                        {(1000 / result.avgTimePerFrameMs).toFixed(1)} fps ({result.avgTimePerFrameMs.toFixed(1)}ms/f)
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">{t("screens.export.savedPath")}</span>
                      <span className="font-medium text-accent truncate max-w-[220px]" title={outputPath}>
                        {displayPath}
                      </span>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-center gap-2 pt-2">
                  <Button variant="ghost" size="sm" onClick={handleRevealInFinder} className="text-[11px]">
                    {t("screens.export.revealInFinder")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleExportAnother} className="text-[11px] gap-1.5">
                    <RotateCcw className="w-3.5 h-3.5" />
                    {t("screens.export.exportAnother")}
                  </Button>
                  <Button variant="default" size="sm" onClick={onClose} className="text-[11px]">
                    {t("screens.export.done")}
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
                  <h3 className="text-[15px] font-bold text-text-primary tracking-tight">{t("screens.export.failed")}</h3>
                  <p className="text-[11px] text-text-muted mt-1 leading-relaxed">{t("screens.export.failedHint")}</p>
                </div>

                {error && <div className="p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-destructive text-[11px] text-left leading-normal font-mono break-all max-h-[120px] overflow-y-auto scrollbar-thin">{error}</div>}

                <div className="flex items-center justify-center gap-2 pt-2">
                  <Button variant="ghost" size="sm" onClick={handleExportAnother} className="text-[11px]">
                    {t("screens.export.tryAgain")}
                  </Button>
                  <Button variant="default" size="sm" onClick={onClose} className="text-[11px]">
                    {t("screens.export.close")}
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
