import React, { useRef, useState } from "react";
import { Plus, Download, Upload, Trash2, Play, AlertCircle, Sparkles, Settings } from "lucide-react";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useHistoryStore } from "@/store/historyStore";
import { useTransportControls } from "@/hooks/usePlaybackClock";
import { useCaptionStore } from "@/store/captionStore";
import { useUIStore } from "@/store/uiStore";
import { parseSubtitles, parseSubtitlesAsync } from "@/features/subtitles/parser";
import { CAPTION_STYLE_PRESETS, getCaptionPresetById } from "@/features/subtitles/captionPresets";
import {
  type CaptionTrack,
  type CaptionCue,
  CAPTION_MODEL_VERSION,
  DEFAULT_CAPTION_STYLE,
  secondsToTicks,
  ticksToSeconds,
} from "@/types/captions";
import {
  AddCaptionTrackCommand,
  AddCaptionCueCommand,
  RemoveCaptionCueCommand,
  UpdateCaptionCueCommand,
  BatchUpdateCaptionCuesCommand,
  UpdateCaptionTrackCommand,
} from "@/core/history/commands/CaptionCommands";
import { generateSrt, generateVtt, formatSrtTimestamp } from "@/lib/captions/exportSidecar";
import { checkSafeZoneCompliance } from "@/lib/captions/safeZone";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@/core/platform";
import type { TabProps } from "../types";

export const CaptionsTab: React.FC<TabProps> = () => {
  const {
    captionTracks,
    activeCaptionTrackId,
    clips,
    setActiveCaptionTrackId,
  } = useTimelineStore();
  const { project } = useProjectStore();
  const { execute } = useHistoryStore();
  const { seek } = useTransportControls();
  const { captionSettings, karaokeOverlayEnabled, setKaraokeOverlayEnabled } = useCaptionStore();
  const { toggleSettingsModal } = useUIStore();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const mediaAssets = project?.mediaAssets || [];
  const canvasWidth = project?.canvasWidth || 1920;
  const canvasHeight = project?.canvasHeight || 1080;

  // Active track resolution
  const activeTrack =
    captionTracks.find((t) => t.id === activeCaptionTrackId) ||
    captionTracks[0] ||
    null;

  const cues = activeTrack?.cues || [];

  // Check model status for helpful UI hints
  const selectedModel = captionSettings.activeModel || "tiny";
  const isModelDownloaded = captionSettings.models[selectedModel]?.status === "downloaded";

  // Helper to ensure a CaptionTrack exists with full snapshot history
  const getOrCreateActiveTrack = (): CaptionTrack => {
    if (activeTrack) return activeTrack;

    const newTrack: CaptionTrack = {
      id: `caption-track-${Date.now()}`,
      captionModelVersion: CAPTION_MODEL_VERSION,
      name: "Subtitles",
      visible: true,
      locked: false,
      defaultStyle: { ...DEFAULT_CAPTION_STYLE },
      cues: [],
    };

    execute(new AddCaptionTrackCommand(newTrack, captionTracks));
    setActiveCaptionTrackId(newTrack.id);
    return newTrack;
  };

  // Trigger file import
  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  // Handle subtitle file selection (.srt / .vtt)
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg(null);
    try {
      const text = await file.text();
      const format = file.name.toLowerCase().endsWith(".vtt") ? "vtt" : "srt";
      const blocks = await parseSubtitlesAsync(text, format);

      if (blocks.length === 0) {
        throw new Error("No subtitle blocks found. Please ensure the file is valid SRT or WebVTT.");
      }

      const track = getOrCreateActiveTrack();
      const newCues: CaptionCue[] = blocks.map((block, idx) => ({
        id: `cue-${Date.now()}-${idx}`,
        startTicks: secondsToTicks(block.startTime),
        endTicks: secondsToTicks(block.endTime),
        text: block.text,
        styleVersion: 1,
      }));

      execute(new BatchUpdateCaptionCuesCommand(track, newCues, "Import Subtitles"));
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to parse subtitle file.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Export captions as SRT or VTT
  const handleExport = (format: "srt" | "vtt") => {
    if (!activeTrack || cues.length === 0) return;

    const content = format === "vtt" ? generateVtt(activeTrack) : generateSrt(activeTrack);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeTrack.name || "captions"}.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Add a manual caption cue at the current playhead
  const handleAddManualCaption = () => {
    const track = getOrCreateActiveTrack();
    const playheadTime = (window as any)._lastPlayheadTime || 0;
    const startTicks = secondsToTicks(playheadTime);
    const endTicks = startTicks + secondsToTicks(2.0);

    const newCue: CaptionCue = {
      id: `cue-${Date.now()}`,
      startTicks,
      endTicks,
      text: "New Caption Text",
      styleVersion: 1,
    };

    execute(new AddCaptionCueCommand(track, newCue));
  };

  // Auto-generate captions using Whisper
  const handleAutoGenerate = async () => {
    const model = captionSettings.activeModel || "tiny";
    const language = captionSettings.language || "auto";

    const modelState = captionSettings.models[model];
    if (modelState?.status !== "downloaded") {
      setErrorMsg(`Whisper model "${model}" is not downloaded yet. Please download it from Settings → Captions.`);
      toggleSettingsModal();
      return;
    }

    try {
      const exists = await invoke<boolean>("verify_whisper_model_exists", { size: model });
      if (!exists) {
        setErrorMsg(`Whisper model "${model}" file is missing or invalid on disk. Please redownload in Settings.`);
        toggleSettingsModal();
        return;
      }
    } catch (err: any) {
      setErrorMsg(`Failed to verify model: ${err.message || err}`);
      return;
    }

    // Find media clips on timeline to transcribe
    const mediaClips = clips.filter(
      (c) => (c.kind === "video" || c.kind === "audio" || (c as any).mediaId) && c.duration > 0,
    );

    if (mediaClips.length === 0) {
      setErrorMsg("No video or audio clips found on the timeline. Add media first.");
      return;
    }

    if (platform.isCapacitor()) {
      setErrorMsg("Local auto-captions are only supported on Clypra Desktop.");
      return;
    }

    setErrorMsg(null);
    setIsGenerating(true);

    try {
      const track = getOrCreateActiveTrack();
      const generatedCues: CaptionCue[] = [];
      const allRawSegments: any[] = [];

      for (const mediaClip of mediaClips) {
        const asset = mediaAssets.find((a) => a.id === (mediaClip as any).mediaId);
        if (!asset || !asset.path) continue;

        try {
          const segments = await invoke<any[]>("generate_auto_captions", {
            videoPath: asset.path,
            modelSize: model,
            language: language === "auto" ? null : language,
          });

          if (!segments || segments.length === 0) continue;

          allRawSegments.push(...segments);

          const clipStartTicks = secondsToTicks(mediaClip.startTime);
          const clipTrimInTicks = secondsToTicks((mediaClip as any).trimIn || 0);
          const clipDurationTicks = secondsToTicks(mediaClip.duration);

          segments.forEach((seg, idx) => {
            const segStartTicks = seg.startTicks ?? Math.round((seg.startMs || 0) * 1000);
            const segEndTicks = seg.endTicks ?? Math.round((seg.endMs || 0) * 1000);
            const relativeStartTicks = segStartTicks - clipTrimInTicks;

            if (relativeStartTicks >= 0 && relativeStartTicks < clipDurationTicks) {
              const cueStartTicks = clipStartTicks + relativeStartTicks;
              const cueDurationTicks = Math.min(segEndTicks - segStartTicks, clipDurationTicks - relativeStartTicks);
              const cueEndTicks = cueStartTicks + cueDurationTicks;

              generatedCues.push({
                id: `cue-${Date.now()}-${mediaClip.id}-${idx}`,
                startTicks: cueStartTicks,
                endTicks: cueEndTicks,
                text: seg.text.trim(),
                styleVersion: 1,
              });
            }
          });
        } catch (clipErr: any) {
          console.error(`[CaptionsTab] Transcription error for clip ${mediaClip.id}:`, clipErr);
        }
      }

      if (generatedCues.length > 0) {
        execute(new BatchUpdateCaptionCuesCommand(track, generatedCues, "Auto-Generate Captions"));
        if (allRawSegments.length > 0) {
          useCaptionStore.setState({ segments: allRawSegments });
        }
        setErrorMsg(null);
      } else {
        setErrorMsg("No captions were generated. Please check that your audio contains speech.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to generate captions.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Direct cue mutation with full-snapshot commands
  const handleTextChange = (cue: CaptionCue, text: string) => {
    if (!activeTrack) return;
    execute(new UpdateCaptionCueCommand(activeTrack, { ...cue, text }));
  };

  const handleTimingChange = (
    cue: CaptionCue,
    field: "start" | "duration",
    valueInSeconds: number,
  ) => {
    if (!activeTrack || valueInSeconds < 0) return;
    const currentDurationSec = ticksToSeconds(cue.endTicks - cue.startTicks);

    let nextStartTicks = cue.startTicks;
    let nextEndTicks = cue.endTicks;

    if (field === "start") {
      nextStartTicks = secondsToTicks(valueInSeconds);
      nextEndTicks = nextStartTicks + secondsToTicks(currentDurationSec);
    } else {
      nextEndTicks = nextStartTicks + secondsToTicks(Math.max(0.1, valueInSeconds));
    }

    execute(
      new UpdateCaptionCueCommand(activeTrack, {
        ...cue,
        startTicks: nextStartTicks,
        endTicks: nextEndTicks,
      }),
    );
  };

  const handleDeleteCue = (cueId: string) => {
    if (!activeTrack) return;
    execute(new RemoveCaptionCueCommand(activeTrack, cueId));
  };

  const handleApplyBatchPreset = (presetId: string) => {
    const preset = getCaptionPresetById(presetId);
    if (!preset || !activeTrack) return;

    const updatedTrack: CaptionTrack = {
      ...activeTrack,
      defaultStyle: {
        ...activeTrack.defaultStyle,
        color: preset.fillColor,
        fontFamily: preset.fontFamily,
        fontSize: preset.fontSize,
      },
    };

    execute(new UpdateCaptionTrackCommand(activeTrack, updatedTrack, `Apply Preset: ${preset.name}`));
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background overflow-hidden">
      {/* Hidden file input */}
      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".srt,.vtt" className="hidden" />

      {/* ── Scrollable controls area ── */}
      <div className="flex flex-col gap-3 p-3 pb-0">

        {/* ── Section: Import / Export ── */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted/60 px-0.5">Files</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleImportClick}
              className="group flex items-center justify-center gap-2 h-8 px-3 rounded-lg bg-surface-raised border border-white/8 hover:border-accent/40 hover:bg-surface-raised/70 text-xs font-semibold text-text-primary transition-all"
            >
              <Upload className="w-3.5 h-3.5 text-accent transition-transform group-hover:-translate-y-px" />
              Import
            </button>
            <button
              onClick={() => handleExport("srt")}
              disabled={cues.length === 0}
              className="group flex items-center justify-center gap-2 h-8 px-3 rounded-lg bg-surface-raised border border-white/8 hover:border-accent/40 hover:bg-surface-raised/70 text-xs font-semibold text-text-primary transition-all disabled:opacity-35 disabled:pointer-events-none"
            >
              <Download className="w-3.5 h-3.5 text-accent transition-transform group-hover:translate-y-px" />
              Export SRT
            </button>
          </div>
        </div>

        {/* ── Section: Auto-Generate ── */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted/60 px-0.5">AI Captions</p>

          {/* Model warning banner */}
          {!isModelDownloaded && (
            <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-status-warning/8 border border-status-warning/20 text-[11px] text-status-warning">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <div className="flex-1 min-w-0">
                <span className="font-semibold">"{selectedModel}" model not downloaded. </span>
                <button
                  onClick={toggleSettingsModal}
                  className="underline underline-offset-2 opacity-80 hover:opacity-100 transition-opacity font-medium"
                >
                  Open Settings →
                </button>
              </div>
            </div>
          )}

          {/* Auto-generate primary CTA */}
          <div className="relative">
            <button
              onClick={handleAutoGenerate}
              disabled={isGenerating}
              className={`relative w-full h-10 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all overflow-hidden
                ${isGenerating
                  ? "bg-accent/60 text-white/70 cursor-wait"
                  : "bg-accent hover:bg-accent/85 active:scale-[0.98] text-white shadow-[0_2px_14px_rgba(0,0,0,0.35)]"
                }`}
            >
              <Sparkles className={`w-4 h-4 shrink-0 ${isGenerating ? "animate-pulse" : ""}`} />
              {isGenerating ? "Generating captions…" : "Auto-Generate Captions"}
            </button>

            <button
              onClick={toggleSettingsModal}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-white/40 hover:text-white/90 hover:bg-white/10 transition-all"
              title="Caption settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* ── Section: Manual / Karaoke ── */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted/60 px-0.5">Tools</p>
          <div className="grid grid-cols-2 gap-2">
            {/* Add Manual */}
            <button
              onClick={handleAddManualCaption}
              className="group flex items-center justify-center gap-2 h-8 px-3 rounded-lg bg-surface-raised border border-white/8 hover:border-accent/40 hover:bg-surface-raised/70 text-xs font-semibold text-text-primary transition-all"
            >
              <Plus className="w-3.5 h-3.5 text-accent" />
              Add Manual
            </button>

            {/* Karaoke toggle */}
            <button
              onClick={() => setKaraokeOverlayEnabled(!karaokeOverlayEnabled)}
              title="Toggle animated word-by-word karaoke overlay in preview"
              className={`flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-semibold transition-all ${
                karaokeOverlayEnabled
                  ? "bg-accent/15 border-accent/60 text-accent"
                  : "bg-surface-raised border-white/8 text-text-muted hover:text-text-primary hover:border-white/18"
              }`}
            >
              <Sparkles className={`w-3.5 h-3.5 shrink-0 ${karaokeOverlayEnabled ? "text-accent" : "text-text-muted"}`} />
              <span>Karaoke</span>
              <span
                className={`ml-1 text-[9px] font-bold px-1 py-px rounded ${
                  karaokeOverlayEnabled
                    ? "bg-accent/25 text-accent"
                    : "bg-white/8 text-text-muted"
                }`}
              >
                {karaokeOverlayEnabled ? "ON" : "OFF"}
              </span>
            </button>
          </div>
        </div>

        {/* ── Style Presets (only when cues exist) ── */}
        {cues.length > 0 && activeTrack && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted/60 px-0.5">
              Style — {activeTrack.name}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {CAPTION_STYLE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handleApplyBatchPreset(preset.id)}
                  title={preset.description}
                  className="flex items-center gap-1.5 py-1.5 px-2.5 text-[11px] font-semibold rounded-lg bg-surface-raised border border-white/8 hover:border-accent/40 hover:text-accent text-text-secondary transition-all truncate"
                >
                  <Sparkles className="w-3 h-3 shrink-0 text-accent" />
                  <span className="truncate">{preset.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Error banner ── */}
        {errorMsg && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/8 border border-destructive/20 text-destructive text-xs">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
            <p className="flex-1 min-w-0">{errorMsg}</p>
          </div>
        )}
      </div>

      {/* ── Cue list ── */}
      <div className="flex-1 flex flex-col min-h-0 mt-3 border-t border-border/50">
        {/* List header */}
        <div className="flex items-center justify-between px-3 py-2">
          <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-muted/60">
            Caption Cues
          </h4>
          <span className="text-[10px] font-semibold tabular-nums text-text-muted bg-surface-raised px-1.5 py-0.5 rounded-full border border-white/8">
            {cues.length}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-3 pb-3 space-y-1.5">
          {cues.length === 0 ? (
            /* ── Empty state ── */
            <div className="mt-2 flex flex-col items-center justify-center gap-3 py-10 px-4 rounded-xl border border-dashed border-border/50 text-center">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-accent/10 border border-accent/20">
                <Sparkles className="w-4 h-4 text-accent" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold text-text-primary">No captions yet</p>
                <p className="text-[11px] text-text-muted leading-relaxed max-w-[180px]">
                  Use Auto-Generate, Import, or Add Manual to get started.
                </p>
              </div>
            </div>
          ) : (
            cues.map((cue, index) => {
              const startSec = ticksToSeconds(cue.startTicks);
              const durationSec = ticksToSeconds(cue.endTicks - cue.startTicks);

              // Safe Zone compliance check
              const estimatedWidth = Math.min(1536, cue.text.length * 18);
              const compliance = checkSafeZoneCompliance(
                { x: (canvasWidth - estimatedWidth) / 2, y: canvasHeight * 0.82, width: estimatedWidth, height: 60 },
                canvasWidth,
                canvasHeight,
              );

              return (
                <div
                  key={cue.id}
                  className={`group flex flex-col gap-2 p-2.5 rounded-xl border transition-all relative ${
                    !compliance.isTitleSafe
                      ? "bg-status-warning/5 border-status-warning/30 hover:border-status-warning/50"
                      : "bg-surface-raised border-border/30 hover:border-border/60"
                  }`}
                >
                  {/* ── Cue header: index + timecodes + actions ── */}
                  <div className="flex items-center gap-2 text-[10px] text-text-muted">
                    {/* Index badge */}
                    <span className="shrink-0 w-5 h-5 flex items-center justify-center rounded-md bg-accent/12 text-accent font-bold text-[9px] border border-accent/20">
                      {index + 1}
                    </span>

                    {/* Timecode — clickable start */}
                    <button
                      onClick={() => seek(startSec)}
                      className="flex items-center gap-1 font-mono hover:text-accent transition-colors"
                      title="Jump playhead to start"
                    >
                      <Play className="w-2.5 h-2.5 fill-current" />
                      {formatSrtTimestamp(cue.startTicks)}
                    </button>
                    <span className="text-text-muted/40">→</span>
                    <span className="font-mono">{formatSrtTimestamp(cue.endTicks)}</span>

                    {/* Spacer */}
                    <span className="flex-1" />

                    {/* Safe-zone badge */}
                    {!compliance.isTitleSafe && (
                      <span
                        className="flex items-center gap-1 text-[9px] font-semibold text-status-warning bg-status-warning/10 px-1.5 py-0.5 rounded border border-status-warning/20"
                        title={compliance.warning || "Caption exceeds Title Safe (80%) area"}
                      >
                        <AlertCircle className="w-2.5 h-2.5" />
                        Safe Zone
                      </span>
                    )}

                    {/* Delete button */}
                    <button
                      onClick={() => handleDeleteCue(cue.id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-text-muted hover:text-destructive transition-all duration-150"
                      title="Delete caption"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* ── Text editor ── */}
                  <textarea
                    value={cue.text}
                    onChange={(e) => handleTextChange(cue, e.target.value)}
                    className="w-full min-h-[44px] p-2 bg-background/40 focus:bg-background/70 border border-border/40 focus:border-accent/60 rounded-lg text-xs text-text-primary resize-none outline-none transition-colors placeholder:text-text-muted/50"
                    placeholder="Enter subtitle text…"
                  />

                  {/* ── Timing inputs ── */}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-text-muted/60">Start (s)</span>
                      <input
                        type="number"
                        step="0.1"
                        value={Number(startSec.toFixed(2))}
                        onChange={(e) => handleTimingChange(cue, "start", parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1 bg-background/30 border border-border/30 focus:border-accent/60 rounded-md text-[11px] text-center outline-none text-text-primary transition-colors font-mono"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-text-muted/60">Duration (s)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        value={Number(durationSec.toFixed(2))}
                        onChange={(e) => handleTimingChange(cue, "duration", parseFloat(e.target.value) || 0.1)}
                        className="w-full px-2 py-1 bg-background/30 border border-border/30 focus:border-accent/60 rounded-md text-[11px] text-center outline-none text-text-primary transition-colors font-mono"
                      />
                    </label>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

    </div>
  );
};
