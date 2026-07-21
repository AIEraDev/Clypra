import React, { useRef, useState } from "react";
import { Plus, Download, Upload, Trash2, Play, AlertCircle, Sparkles, Settings } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useTimelineStore, getInsertIndexForNewTrack } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useTransportControls } from "@/hooks/usePlaybackClock";
import { useCaptionStore } from "@/store/captionStore";
import { useUIStore } from "@/store/uiStore";
import { createTextClip } from "@/lib/text/textClip";
import { parseSubtitles, serializeSubtitles, formatSubtitleTime } from "@/features/subtitles/parser";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@/core/platform";
import type { TabProps } from "./types";
import type { TextClip } from "@/types";
import { t } from "@/i18n";

export type CaptionErrorKind = "parse" | "model-required" | "model-files-missing" | "model-verification" | "no-media" | "desktop-only" | "transcription" | "generation";

export interface CaptionErrorState {
  kind: CaptionErrorKind;
  message: string;
}

export function isCaptionTrackName(name: string): boolean {
  const normalized = name.trim().toLocaleLowerCase();
  return normalized.includes("caption") || normalized.includes("subtitle") || normalized.includes("字幕");
}

export function captionErrorNeedsSettings(error: CaptionErrorState | null): boolean {
  return error?.kind === "model-required" || error?.kind === "model-files-missing" || error?.kind === "model-verification";
}

function getErrorDetail(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

export const CaptionsTab: React.FC<TabProps> = ({ onAddToTimeline }) => {
  const { clips, tracks, addClip, removeClip, updateClip, withBatch } = useTimelineStore();
  const { project } = useProjectStore();
  const { seek } = useTransportControls();
  const { captionSettings } = useCaptionStore();
  const { toggleSettingsModal } = useUIStore();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [captionError, setCaptionError] = useState<CaptionErrorState | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const mediaAssets = project?.mediaAssets || [];

  // Check model status for helpful UI hints
  const selectedModel = captionSettings.activeModel || "tiny";
  const isModelDownloaded = captionSettings.models[selectedModel]?.status === "downloaded";

  // Find the text track designated for captions
  const captionTrack = tracks.find((track) => track.type === "text" && isCaptionTrackName(track.name)) || tracks.find((track) => track.type === "text");

  // Get all text clips belonging to the caption track
  const captionClips = captionTrack ? (clips.filter((c) => c.trackId === captionTrack.id) as TextClip[]).sort((a, b) => a.startTime - b.startTime) : [];

  // Ensure a caption track exists and return its ID
  const ensureCaptionTrackId = (): string => {
    if (captionTrack) return captionTrack.id;

    const timeline = useTimelineStore.getState();
    const insertIndex = getInsertIndexForNewTrack(timeline.tracks, "text");
    const targetTrackId = timeline.insertTrackAt("text", insertIndex);

    // Rename to standard Auto Captions track name
    useTimelineStore.setState((state) => ({
      tracks: state.tracks.map((track) => (track.id === targetTrackId ? { ...track, name: t("features.captions.trackName") } : track)),
    }));

    return targetTrackId;
  };

  // Trigger file import
  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  // Handle subtitle file selection
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCaptionError(null);
    try {
      const text = await file.text();
      const blocks = parseSubtitles(text);

      if (blocks.length === 0) {
        throw new Error(t("features.captions.noSubtitleBlocks"));
      }

      const trackId = ensureCaptionTrackId();
      const canvasWidth = project?.canvasWidth || 1920;
      const canvasHeight = project?.canvasHeight || 1080;

      withBatch(() => {
        blocks.forEach((block) => {
          const textClip = createTextClip({
            trackId,
            startTime: block.startTime,
            duration: Math.max(0.2, block.endTime - block.startTime),
            text: block.text,
            canvasWidth,
            canvasHeight,
            fontSize: 32,
            bold: true,
            position: "bottom",
            textRole: "caption",
            styleId: "neon-crimson",
            fontFamily: "Outfit Variable",
          });
          addClip(textClip);
        });
      });
    } catch (error) {
      setCaptionError({
        kind: "parse",
        message: t("features.captions.parseError", {
          error: getErrorDetail(error, t("features.captions.parseFailed")),
        }),
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Export captions as SRT or VTT
  const handleExport = (format: "srt" | "vtt") => {
    if (captionClips.length === 0) return;

    const subtitleBlocks = captionClips.map((clip) => ({
      id: clip.id,
      startTime: clip.startTime,
      endTime: clip.startTime + clip.duration,
      text: clip.text,
    }));

    const content = serializeSubtitles(subtitleBlocks, format);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `captions.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Add a manual caption at the current playhead time
  const handleAddManualCaption = () => {
    const trackId = ensureCaptionTrackId();
    const timeline = useTimelineStore.getState();
    const playheadTime = timeline.clips.length > 0 ? (window as any)._lastPlayheadTime || 0 : 0;

    const canvasWidth = project?.canvasWidth || 1920;
    const canvasHeight = project?.canvasHeight || 1080;

    const textClip = createTextClip({
      trackId,
      startTime: playheadTime,
      duration: 2.0,
      text: t("features.captions.newText"),
      canvasWidth,
      canvasHeight,
      fontSize: 32,
      bold: true,
      position: "bottom",
      textRole: "caption",
      styleId: "neon-crimson",
      fontFamily: "Outfit Variable",
    });

    addClip(textClip);
  };

  // Auto-generate captions using Whisper — ZERO CONFIG
  const handleAutoGenerate = async () => {
    // Smart defaults — no pre-flight checks blocking the user
    const model = captionSettings.activeModel || "tiny"; // Default to tiny if none selected
    const language = captionSettings.language || "auto"; // Default to auto-detect

    console.log(`[CaptionsTab] Starting auto-generate with model: ${model}, language: ${language}`);

    // Check if the selected model is marked as downloaded in store
    const modelState = captionSettings.models[model];
    if (modelState.status !== "downloaded") {
      console.error(`[CaptionsTab] Model "${model}" status is: ${modelState.status}`);
      setCaptionError({ kind: "model-required", message: t("features.captions.modelNotDownloaded", { model }) });
      // Open settings modal to help user
      toggleSettingsModal();
      return;
    }

    // Verify the model actually exists on disk (double-check)
    try {
      console.log(`[CaptionsTab] Verifying model "${model}" exists on disk...`);
      const exists = await invoke<boolean>("verify_whisper_model_exists", { size: model });
      console.log(`[CaptionsTab] Model verification result: ${exists}`);

      if (!exists) {
        console.error(`[CaptionsTab] Model "${model}" marked as downloaded but files not found on disk`);
        setCaptionError({ kind: "model-files-missing", message: t("features.captions.modelFilesMissing", { model }) });
        toggleSettingsModal();
        return;
      }
    } catch (error) {
      console.error(`[CaptionsTab] Failed to verify model:`, error);
      setCaptionError({
        kind: "model-verification",
        message: t("features.captions.modelVerificationFailed", {
          error: getErrorDetail(error, String(error)),
        }),
      });
      toggleSettingsModal();
      return;
    }

    // Find video or audio clips on the timeline
    const mediaClips = clips.filter((clip) => {
      const asset = mediaAssets.find((a) => a.id === clip.mediaId);
      return asset && (asset.type === "video" || asset.type === "audio");
    });

    if (mediaClips.length === 0) {
      console.warn(`[CaptionsTab] No media clips found on timeline`);
      setCaptionError({ kind: "no-media", message: t("features.captions.noMedia") });
      return;
    }

    console.log(`[CaptionsTab] Found ${mediaClips.length} media clips to process`);

    if (platform.isCapacitor()) {
      setCaptionError({ kind: "desktop-only", message: t("features.captions.desktopOnly") });
      return;
    }

    setCaptionError(null);
    setIsGenerating(true);

    try {
      // Auto-download model if needed (Phase 2 — currently model must be pre-downloaded)
      // TODO: Implement auto-download in Phase 2
      // const modelState = captionSettings.models[model];
      // if (modelState.status !== "downloaded") {
      //   await downloadWhisperModel(model);
      // }

      const trackId = ensureCaptionTrackId();
      const canvasWidth = project?.canvasWidth || 1920;
      const canvasHeight = project?.canvasHeight || 1080;
      let totalCaptions = 0;

      // Process each media clip
      for (const mediaClip of mediaClips) {
        const asset = mediaAssets.find((a) => a.id === mediaClip.mediaId);
        if (!asset) continue;

        try {
          console.log(`[CaptionsTab] Processing clip: ${mediaClip.id}, asset: ${asset.path}`);

          // Extract audio from the clip
          const tempAudioPath = await invoke<string>("extract_audio_track", {
            path: asset.path,
          });

          console.log(`[CaptionsTab] Audio extracted to: ${tempAudioPath}`);

          // Transcribe using Whisper with selected/default model and language
          console.log(`[CaptionsTab] About to call transcribe_audio_local...`);
          console.log(`[CaptionsTab] Parameters:`, {
            audioPath: tempAudioPath,
            modelSize: model,
            language: language === "auto" ? null : language,
            languageHints: captionSettings.languageHints?.length > 0 ? captionSettings.languageHints : null,
          });

          const resultJsonStr = await invoke<string>("transcribe_audio_local", {
            audioPath: tempAudioPath,
            modelSize: model,
            language: language === "auto" ? null : language,
            languageHints: captionSettings.languageHints?.length > 0 ? captionSettings.languageHints : null,
          });

          console.log(`[CaptionsTab] Transcription completed, result:`, resultJsonStr);
          const result = JSON.parse(resultJsonStr);

          if (result.error) {
            console.error(`Failed to transcribe ${mediaClip.id}:`, result.error);
            setCaptionError({ kind: "transcription", message: t("features.captions.transcriptionError", { error: String(result.error) }) });
            continue;
          }

          // Add segments to timeline
          const segments = result.segments || [];
          console.log(`[CaptionsTab] Found ${segments.length} segments`);

          if (segments.length === 0) {
            console.warn(`[CaptionsTab] No segments found in transcription result`);
          }

          withBatch(() => {
            segments.forEach((seg: any) => {
              const relativeStart = seg.start - mediaClip.trimIn;

              if (relativeStart >= 0 && relativeStart < mediaClip.duration) {
                const startTime = mediaClip.startTime + relativeStart;
                const segmentDuration = Math.min(seg.end - seg.start, mediaClip.duration - relativeStart);

                // Convert word timestamps to clip-relative time
                const words = seg.words?.map((w: any) => ({
                  word: w.word,
                  start: w.start - seg.start, // Convert to clip-relative time
                  end: w.end - seg.start,
                  probability: w.probability,
                }));

                const textClip = createTextClip({
                  trackId,
                  startTime,
                  duration: segmentDuration,
                  text: seg.text,
                  canvasWidth,
                  canvasHeight,
                  fontSize: 32,
                  bold: false,
                  position: "bottom",
                  textRole: "caption",
                  words, // Include word-level timestamps
                  styleId: undefined,
                  fontFamily: "Inter",
                });

                addClip(textClip);
                totalCaptions++;
                console.log(`[CaptionsTab] Added caption: "${seg.text}"`);
              }
            });
          });
        } catch (clipError: any) {
          console.error(`[CaptionsTab] Error processing clip ${mediaClip.id}:`, clipError);
          console.error(`[CaptionsTab] Error stack:`, clipError.stack);
          setCaptionError({
            kind: "generation",
            message: t("features.captions.processingError", {
              error: getErrorDetail(clipError, String(clipError)),
            }),
          });
        }
      }

      if (totalCaptions > 0) {
        setCaptionError(null);
      } else {
        setCaptionError({ kind: "generation", message: t("features.captions.noGenerated") });
      }
    } catch (error: any) {
      console.error(`[CaptionsTab] Top-level error:`, error);
      console.error(`[CaptionsTab] Error stack:`, error.stack);
      setCaptionError({
        kind: "generation",
        message: t("features.captions.processingError", {
          error: getErrorDetail(error, t("features.captions.generationFailed")),
        }),
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Direct update helpers
  const handleTextChange = (clipId: string, text: string) => {
    updateClip(clipId, { text } as any);
  };

  const handleTimingChange = (clipId: string, field: "startTime" | "duration", value: number) => {
    if (value < 0) return;
    updateClip(clipId, { [field]: value });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background overflow-hidden p-3 space-y-3">
      {/* Hidden file input */}
      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".srt,.vtt" className="hidden" />

      {/* Primary Actions Grid */}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="sm" className="w-full flex items-center justify-center gap-1.5" onClick={handleImportClick}>
          <Upload className="w-3.5 h-3.5 text-accent" />
          {t("features.captions.import")}
        </Button>
        <Button variant="secondary" size="sm" className="w-full flex items-center justify-center gap-1.5" onClick={() => handleExport("srt")} disabled={captionClips.length === 0}>
          <Download className="w-3.5 h-3.5 text-accent" />
          {t("features.captions.exportSrt")}
        </Button>
      </div>

      {/* Auto-Generate Section — Zero Config UX */}
      <div className="space-y-2">
        {!isModelDownloaded && (
          <div className="p-2.5 bg-yellow-500/10 border border-yellow-500/25 rounded-lg text-yellow-200 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">{t("features.captions.modelRequiredTitle")}</p>
              <p className="mt-1 opacity-90">{t("features.captions.modelNeeded", { model: selectedModel })}</p>
              <button onClick={toggleSettingsModal} className="mt-2 px-2 py-1 bg-yellow-500/20 hover:bg-yellow-500/30 rounded text-xs font-semibold transition-colors">
                {t("features.captions.downloadModelInSettings")}
              </button>
            </div>
          </div>
        )}

        <div className="relative">
          <Button variant="default" size="sm" className="w-full bg-accent hover:bg-accent/80 text-white flex items-center justify-center gap-1.5" onClick={handleAutoGenerate} disabled={isGenerating}>
            <Sparkles className="w-4 h-4" />
            {isGenerating ? t("features.captions.generating") : t("features.captions.autoGenerate")}
          </Button>

          {/* Settings gear — subtle, non-blocking */}
          <button onClick={toggleSettingsModal} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 opacity-40 hover:opacity-100 transition-opacity" title={t("features.captions.settings")}>
            <Settings className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      </div>

      <Button variant="secondary" size="sm" className="w-full flex items-center justify-center gap-1.5" onClick={handleAddManualCaption}>
        <Plus className="w-4 h-4" />
        {t("features.captions.addManual")}
      </Button>

      {captionError && (
        <div className="p-2.5 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-xs">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p>{captionError.message}</p>
              {captionErrorNeedsSettings(captionError) && (
                <button onClick={toggleSettingsModal} className="mt-2 px-2 py-1 bg-accent/20 hover:bg-accent/30 text-accent rounded text-xs font-semibold transition-colors">
                  {t("features.captions.openSettings")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Subtitles timing editor */}
      <div className="flex-1 flex flex-col min-h-0 pt-2 border-t border-border">
        <div className="flex justify-between items-center mb-2">
          <h4 className="text-xs font-semibold text-text-muted">{t("features.captions.timingEditor", { count: captionClips.length })}</h4>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin space-y-2 pr-1">
          {captionClips.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center text-center p-4 border border-dashed border-border rounded-xl">
              <p className="text-xs text-text-muted max-w-[200px]">{t("features.captions.empty")}</p>
            </div>
          ) : (
            captionClips.map((clip, index) => (
              <div key={clip.id} className="group flex flex-col p-3 bg-surface-raised hover:bg-surface-raised/80 border border-border/40 rounded-xl transition-all space-y-2 relative">
                {/* Header timing controls */}
                <div className="flex items-center justify-between text-[10px] text-text-muted">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded">#{index + 1}</span>
                    <button onClick={() => seek(clip.startTime)} className="flex items-center gap-1 hover:text-accent font-medium transition-colors" title={t("features.captions.jumpToStart")}>
                      <Play className="w-2.5 h-2.5 fill-current" />
                      {formatSubtitleTime(clip.startTime, "vtt").slice(3)}
                    </button>
                    <span>➔</span>
                    <span>{formatSubtitleTime(clip.startTime + clip.duration, "vtt").slice(3)}</span>
                  </div>

                  <button onClick={() => removeClip(clip.id)} className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-destructive transition-all duration-200" title={t("features.captions.delete")}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Subtitle textarea */}
                <textarea value={clip.text} onChange={(e) => handleTextChange(clip.id, e.target.value)} className="w-full min-h-[50px] p-2 bg-background/50 focus:bg-background border border-border/50 focus:border-accent rounded-lg text-xs text-text-primary resize-none outline-none transition-colors" placeholder={t("features.captions.placeholder")} />

                {/* Micro Timing controls */}
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="flex items-center gap-1.5">
                    <span className="shrink-0 text-text-muted">{t("features.captions.start")}</span>
                    <input type="number" step="0.1" value={Number(clip.startTime.toFixed(2))} onChange={(e) => handleTimingChange(clip.id, "startTime", parseFloat(e.target.value) || 0)} className="w-full px-1.5 py-1 bg-background/30 border border-border/30 rounded text-center outline-none focus:border-accent text-text-primary" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="shrink-0 text-text-muted">{t("features.captions.duration")}</span>
                    <input type="number" step="0.1" min="0.1" value={Number(clip.duration.toFixed(2))} onChange={(e) => handleTimingChange(clip.id, "duration", parseFloat(e.target.value) || 0.1)} className="w-full px-1.5 py-1 bg-background/30 border border-border/30 rounded text-center outline-none focus:border-accent text-text-primary" />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
