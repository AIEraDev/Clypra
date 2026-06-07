import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Wand2, Plus, Download, Upload, Trash2, Play, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useTimelineStore, getInsertIndexForNewTrack } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useTransportControls } from "@/hooks/usePlaybackClock";
import { createTextClip } from "@/lib/textClip";
import { parseSubtitles, serializeSubtitles, formatSubtitleTime } from "@/features/subtitles/parser";
import type { TabProps } from "./types";
import type { TextClip } from "@/types";

export const CaptionsTab: React.FC<TabProps> = ({ onAddToTimeline }) => {
  const { t } = useTranslation();
  const { clips, tracks, addClip, removeClip, updateClip, withBatch } = useTimelineStore();
  const { project } = useProjectStore();
  const { seek } = useTransportControls();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Find the text track designated for captions
  const captionTrack = tracks.find(
    (t) => t.type === "text" && (t.name.toLowerCase().includes("caption") || t.name.toLowerCase().includes("subtitle"))
  ) || tracks.find((t) => t.type === "text");

  // Get all text clips belonging to the caption track
  const captionClips = captionTrack
    ? (clips.filter((c) => c.trackId === captionTrack.id) as TextClip[]).sort(
        (a, b) => a.startTime - b.startTime
      )
    : [];

  // Ensure a caption track exists and return its ID
  const ensureCaptionTrackId = (): string => {
    if (captionTrack) return captionTrack.id;

    const timeline = useTimelineStore.getState();
    const insertIndex = getInsertIndexForNewTrack(timeline.tracks, "text");
    const targetTrackId = timeline.insertTrackAt("text", insertIndex);

    // Rename to standard Auto Captions track name
    useTimelineStore.setState((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === targetTrackId ? { ...t, name: "Auto Captions" } : t
      ),
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

    setErrorMsg(null);
    try {
      const text = await file.text();
      const blocks = parseSubtitles(text);

      if (blocks.length === 0) {
        throw new Error(t("media.captions.noBlocks"));
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
            styleId: "neon-crimson",
            fontFamily: "Outfit Variable",
          });
          addClip(textClip);
        });
      });
    } catch (err: any) {
      setErrorMsg(err.message || t("media.captions.parseFailed"));
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
      text: t("media.captions.newCaptionText"),
      canvasWidth,
      canvasHeight,
      fontSize: 32,
      bold: true,
      position: "bottom",
      styleId: "neon-crimson",
      fontFamily: "Outfit Variable",
    });

    addClip(textClip);
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
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".srt,.vtt"
        className="hidden"
      />

      {/* Primary Actions Grid */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="w-full flex items-center justify-center gap-1.5"
          onClick={handleImportClick}
        >
          <Upload className="w-3.5 h-3.5 text-accent" />
          {t("media.captions.importSubtitles")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="w-full flex items-center justify-center gap-1.5"
          onClick={() => handleExport("srt")}
          disabled={captionClips.length === 0}
        >
          <Download className="w-3.5 h-3.5 text-accent" />
          {t("media.captions.exportSrt")}
        </Button>
      </div>

      <div className="flex gap-2">
        <Button
          variant="default"
          size="sm"
          className="flex-1 bg-accent hover:bg-accent/80 text-white flex items-center justify-center gap-1.5"
          onClick={handleAddManualCaption}
        >
          <Plus className="w-4 h-4" />
          {t("media.captions.addManualCaption")}
        </Button>
      </div>

      {errorMsg && (
        <div className="p-2.5 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg flex items-start gap-2 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Subtitles timing editor */}
      <div className="flex-1 flex flex-col min-h-0 pt-2 border-t border-border">
        <div className="flex justify-between items-center mb-2">
          <h4 className="text-xs font-semibold text-text-muted">
            {t("media.captions.timingEditor", { n: captionClips.length })}
          </h4>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin space-y-2 pr-1">
          {captionClips.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center text-center p-4 border border-dashed border-border rounded-xl">
              <p className="text-xs text-text-muted max-w-[200px]">
                {t("media.captions.empty")}
              </p>
            </div>
          ) : (
            captionClips.map((clip, index) => (
              <div
                key={clip.id}
                className="group flex flex-col p-3 bg-surface-raised hover:bg-surface-raised/80 border border-border/40 rounded-xl transition-all space-y-2 relative"
              >
                {/* Header timing controls */}
                <div className="flex items-center justify-between text-[10px] text-text-muted">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                      #{index + 1}
                    </span>
                    <button
                      onClick={() => seek(clip.startTime)}
                      className="flex items-center gap-1 hover:text-accent font-medium transition-colors"
                      title={t("media.captions.jumpToStart")}
                    >
                      <Play className="w-2.5 h-2.5 fill-current" />
                      {formatSubtitleTime(clip.startTime, "vtt").slice(3)}
                    </button>
                    <span>➔</span>
                    <span>{formatSubtitleTime(clip.startTime + clip.duration, "vtt").slice(3)}</span>
                  </div>

                  <button
                    onClick={() => removeClip(clip.id)}
                    className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-destructive transition-all duration-200"
                    title={t("media.captions.deleteCaption")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Subtitle textarea */}
                <textarea
                  value={clip.text}
                  onChange={(e) => handleTextChange(clip.id, e.target.value)}
                  className="w-full min-h-[50px] p-2 bg-background/50 focus:bg-background border border-border/50 focus:border-accent rounded-lg text-xs text-text-primary resize-none outline-none transition-colors"
                  placeholder={t("media.captions.textPlaceholder")}
                />

                {/* Micro Timing controls */}
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="flex items-center gap-1.5">
                    <span className="shrink-0 text-text-muted">{t("media.captions.start")}</span>
                    <input
                      type="number"
                      step="0.1"
                      value={Number(clip.startTime.toFixed(2))}
                      onChange={(e) =>
                        handleTimingChange(clip.id, "startTime", parseFloat(e.target.value) || 0)
                      }
                      className="w-full px-1.5 py-1 bg-background/30 border border-border/30 rounded text-center outline-none focus:border-accent text-text-primary"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="shrink-0 text-text-muted">{t("media.captions.duration")}</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={Number(clip.duration.toFixed(2))}
                      onChange={(e) =>
                        handleTimingChange(clip.id, "duration", parseFloat(e.target.value) || 0.1)
                      }
                      className="w-full px-1.5 py-1 bg-background/30 border border-border/30 rounded text-center outline-none focus:border-accent text-text-primary"
                    />
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
