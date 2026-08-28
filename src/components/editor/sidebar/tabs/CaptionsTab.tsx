import React, { useRef, useState } from "react";
import { Plus, Download, Upload, Trash2, Play, AlertCircle, Sparkles, Settings } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useHistoryStore } from "@/store/historyStore";
import { useTransportControls } from "@/hooks/usePlaybackClock";
import { useCaptionStore } from "@/store/captionStore";
import { useUIStore } from "@/store/uiStore";
import { parseSubtitles } from "@/features/subtitles/parser";
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
      const blocks = parseSubtitles(text);

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
    <div className="flex-1 flex flex-col min-h-0 bg-background overflow-hidden p-3 space-y-3">
      {/* Hidden file input */}
      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".srt,.vtt" className="hidden" />

      {/* Primary Actions Grid */}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="sm" className="w-full flex items-center justify-center gap-1.5" onClick={handleImportClick}>
          <Upload className="w-3.5 h-3.5 text-accent" />
          Import Subtitles
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="w-full flex items-center justify-center gap-1.5"
          onClick={() => handleExport("srt")}
          disabled={cues.length === 0}
        >
          <Download className="w-3.5 h-3.5 text-accent" />
          Export SRT
        </Button>
      </div>

      {/* Style Presets */}
      {cues.length > 0 && activeTrack && (
        <div className="p-2 bg-surface-raised border border-white/6 rounded-lg space-y-1.5 select-none">
          <div className="flex items-center justify-between text-[10px] text-text-muted font-medium">
            <span>Caption Style ({activeTrack.name})</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {CAPTION_STYLE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handleApplyBatchPreset(preset.id)}
                className="flex items-center justify-center gap-1.5 py-1 px-2 text-[10px] font-semibold rounded bg-surface border border-white/10 hover:border-accent/50 text-text-primary hover:text-accent transition-all cursor-pointer truncate"
                title={preset.description}
              >
                <Sparkles className="w-3 h-3 shrink-0 text-accent" />
                <span className="truncate">{preset.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Auto-Generate Section */}
      <div className="space-y-2">
        {!isModelDownloaded && (
          <div className="p-2.5 bg-yellow-500/10 border border-yellow-500/25 rounded-lg text-yellow-200 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">Whisper Model Required</p>
              <p className="mt-1 opacity-90">The "{selectedModel}" model needs to be downloaded before generating captions.</p>
              <button onClick={toggleSettingsModal} className="mt-2 px-2 py-1 bg-yellow-500/20 hover:bg-yellow-500/30 rounded text-xs font-semibold transition-colors">
                Download Model in Settings
              </button>
            </div>
          </div>
        )}

        <div className="relative">
          <Button
            variant="default"
            size="sm"
            className="w-full bg-accent hover:bg-accent/80 text-white flex items-center justify-center gap-1.5"
            onClick={handleAutoGenerate}
            disabled={isGenerating}
          >
            <Sparkles className="w-4 h-4" />
            {isGenerating ? "Generating..." : "Auto-Generate Captions"}
          </Button>

          <button onClick={toggleSettingsModal} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 opacity-40 hover:opacity-100 transition-opacity" title="Caption settings">
            <Settings className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="sm" className="w-full flex items-center justify-center gap-1.5" onClick={handleAddManualCaption}>
          <Plus className="w-4 h-4" />
          Add Manual
        </Button>

        <button
          onClick={() => setKaraokeOverlayEnabled(!karaokeOverlayEnabled)}
          className={`flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
            karaokeOverlayEnabled
              ? "bg-accent/20 border-accent text-accent shadow-[0_0_12px_rgba(124,111,255,0.25)]"
              : "bg-surface border-white/10 text-text-muted hover:text-text-primary hover:border-white/20"
          }`}
          title="Toggle animated word-by-word karaoke overlay in preview"
        >
          <Sparkles className={`w-3.5 h-3.5 ${karaokeOverlayEnabled ? "text-accent" : "text-text-muted"}`} />
          Karaoke: {karaokeOverlayEnabled ? "ON" : "OFF"}
        </button>
      </div>

      {errorMsg && (
        <div className="p-2.5 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-xs">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p>{errorMsg}</p>
            </div>
          </div>
        </div>
      )}

      {/* Caption timing & cue list */}
      <div className="flex-1 flex flex-col min-h-0 pt-2 border-t border-border">
        <div className="flex justify-between items-center mb-2">
          <h4 className="text-xs font-semibold text-text-muted">
            Caption Cues ({cues.length})
          </h4>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin space-y-2 pr-1">
          {cues.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center text-center p-4 border border-dashed border-border rounded-xl">
              <p className="text-xs text-text-muted max-w-[200px]">
                No captions on the timeline. Click Add Manual, Import, or Auto-Generate to begin.
              </p>
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
                  className={`group flex flex-col p-3 bg-surface-raised hover:bg-surface-raised/80 border rounded-xl transition-all space-y-2 relative ${
                    !compliance.isTitleSafe ? "border-amber-500/40 bg-amber-500/5" : "border-border/40"
                  }`}
                >
                  {/* Header timing controls */}
                  <div className="flex items-center justify-between text-[10px] text-text-muted">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded">#{index + 1}</span>
                      <button
                        onClick={() => seek(startSec)}
                        className="flex items-center gap-1 hover:text-accent font-medium transition-colors"
                        title="Jump Playhead to Start"
                      >
                        <Play className="w-2.5 h-2.5 fill-current" />
                        {formatSrtTimestamp(cue.startTicks)}
                      </button>
                      <span>➔</span>
                      <span>{formatSrtTimestamp(cue.endTicks)}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      {!compliance.isTitleSafe && (
                        <span
                          className="flex items-center gap-1 text-[9px] font-semibold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/30"
                          title={compliance.warning || "Caption exceeds Title Safe (80%) area"}
                        >
                          <AlertCircle className="w-2.5 h-2.5 text-amber-400" />
                          Safe Zone Warning
                        </span>
                      )}
                      <button
                        onClick={() => handleDeleteCue(cue.id)}
                        className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-destructive transition-all duration-200"
                        title="Delete Caption"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Subtitle textarea */}
                  <textarea
                    value={cue.text}
                    onChange={(e) => handleTextChange(cue, e.target.value)}
                    className="w-full min-h-[50px] p-2 bg-background/50 focus:bg-background border border-border/50 focus:border-accent rounded-lg text-xs text-text-primary resize-none outline-none transition-colors"
                    placeholder="Enter subtitle text..."
                  />

                  {/* Micro Timing controls */}
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div className="flex items-center gap-1.5">
                      <span className="shrink-0 text-text-muted">Start (s):</span>
                      <input
                        type="number"
                        step="0.1"
                        value={Number(startSec.toFixed(2))}
                        onChange={(e) => handleTimingChange(cue, "start", parseFloat(e.target.value) || 0)}
                        className="w-full px-1.5 py-1 bg-background/30 border border-border/30 rounded text-center outline-none focus:border-accent text-text-primary"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="shrink-0 text-text-muted">Duration (s):</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        value={Number(durationSec.toFixed(2))}
                        onChange={(e) => handleTimingChange(cue, "duration", parseFloat(e.target.value) || 0.1)}
                        className="w-full px-1.5 py-1 bg-background/30 border border-border/30 rounded text-center outline-none focus:border-accent text-text-primary"
                      />
                    </div>
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
