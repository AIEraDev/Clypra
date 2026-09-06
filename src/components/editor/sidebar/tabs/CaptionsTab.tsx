import React, { useRef, useState, useCallback, useEffect } from "react";
import {
  Plus,
  Download,
  Upload,
  Trash2,
  Play,
  AlertCircle,
  Sparkles,
  Settings,
  Type,
  Wand2,
  Check,
  RotateCcw,
  Palette,
  Star,
  ChevronRight,
} from "lucide-react";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useHistoryStore } from "@/store/historyStore";
import { useTransportControls } from "@/hooks/usePlaybackClock";
import { useCaptionStore } from "@/store/captionStore";
import { useUIStore } from "@/store/uiStore";
import { ClypraColorPicker } from "@clypra/ui-color-picker";
import { ClypraSlider, ClypraProgressBar } from "@/components/ui/primitives";
import { parseSubtitlesAsync } from "@/features/subtitles/parser";
import {
  type CaptionStyleDefinition,
  getAllCaptionStyles,
} from "@/features/subtitles/captionStyles";
import {
  segmentWordTimestamps,
  type CaptionPacingPreset,
  type InputWordTimestamp,
} from "@/features/subtitles/segmentation";
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
import { ApplyCaptionTrackStyleCommand } from "@/core/history/commands/CaptionTrackStyleCommand";
import {
  generateSrt,
  generateVtt,
  generateSrtFromClips,
  generateVttFromClips,
  formatSrtTimestamp,
} from "@/lib/captions/exportSidecar";
import { checkSafeZoneCompliance } from "@/lib/captions/safeZone";
import { createTextClip } from "@/lib/text/textClip";
import type { TextClip, Clip } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@/core/platform";
import type { TabProps } from "../types";


export type CaptionStylingTier = "plain" | "styles";

const FONT_OPTIONS = [
  "Inter Variable",
  "Outfit Variable",
  "Montserrat",
  "Roboto",
  "Impact",
  "Arial",
];


export const CaptionsTab: React.FC<TabProps> = () => {
  const {
    captionTracks,
    activeCaptionTrackId,
    clips,
    tracks,
    setActiveCaptionTrackId,
    ensureTrackForType,
  } = useTimelineStore();
  const { project } = useProjectStore();
  const { execute } = useHistoryStore();
  const { seek } = useTransportControls();
  const { captionSettings, karaokeOverlayEnabled, setKaraokeOverlayEnabled } = useCaptionStore();
  const { toggleSettingsModal } = useUIStore();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<string | null>(null);

  // Styling Tier state
  const [stylingTier, setStylingTier] = useState<CaptionStylingTier>("styles");
  const [applyToAll, setApplyToAll] = useState(true);
  const [pacingPreset, setPacingPreset] = useState<CaptionPacingPreset>("standard");
  const [selectedStyleId, setSelectedStyleId] = useState<string>("classic-yellow");

  // Plain Text custom properties state
  const [fontFamily, setFontFamily] = useState("Outfit Variable");
  const [fontSize, setFontSize] = useState(34);
  const [fontWeight, setFontWeight] = useState<string | number>(700);
  const [uppercase, setUppercase] = useState(false);
  const [fillColor, setFillColor] = useState("#FFFFFF");
  const [hasStroke, setHasStroke] = useState(true);
  const [strokeColor, setStrokeColor] = useState("#000000");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [hasShadow, setHasShadow] = useState(true);
  const [shadowColor, setShadowColor] = useState("rgba(0,0,0,0.85)");
  const [shadowBlur, setShadowBlur] = useState(4);
  const [shadowOffsetY, setShadowOffsetY] = useState(2);
  const [hasBackground, setHasBackground] = useState(false);
  const [backgroundColor, setBackgroundColor] = useState("rgba(0,0,0,0.7)");
  const [backgroundPadding, setBackgroundPadding] = useState(8);
  const [backgroundRadius, setBackgroundRadius] = useState(6);
  const [verticalPosition, setVerticalPosition] = useState<"bottom" | "center" | "top">("bottom");
  const [align, setAlign] = useState<"center" | "left" | "right">("center");

  const mediaAssets = project?.mediaAssets || [];
  const canvasWidth = project?.canvasWidth || 1920;
  const canvasHeight = project?.canvasHeight || 1080;

  // Active track resolution (CaptionTrack model)
  const activeTrack =
    captionTracks.find((t) => t.id === activeCaptionTrackId) ||
    captionTracks[0] ||
    null;

  const cues = activeTrack?.cues || [];

  // Find corresponding timeline caption track & timeline clips
  const timelineCaptionTrack = tracks.find(
    (t) => t.name === "Captions" || (t.type === "text" && t.name.toLowerCase().includes("caption")),
  );

  const timelineCaptionClips = (timelineCaptionTrack
    ? clips.filter((c) => c.trackId === timelineCaptionTrack.id && (c.kind === "text" || (c as any).textRole === "caption"))
    : clips.filter((c) => (c as any).textRole === "caption")
  ) as TextClip[];

  // Model status check
  const selectedModel = captionSettings.activeModel || "tiny";
  const isModelDownloaded = captionSettings.models[selectedModel]?.status === "downloaded";

  // Helper to ensure both timeline track and CaptionTrack exist
  const getOrCreateActiveTrack = (): CaptionTrack => {
    if (activeTrack) return activeTrack;

    const newTrack: CaptionTrack = {
      id: `caption-track-${Date.now()}`,
      captionModelVersion: CAPTION_MODEL_VERSION,
      name: "Captions",
      visible: true,
      locked: false,
      defaultStyle: { ...DEFAULT_CAPTION_STYLE },
      cues: [],
    };

    execute(new AddCaptionTrackCommand(newTrack, captionTracks));
    setActiveCaptionTrackId(newTrack.id);
    return newTrack;
  };

  const getOrCreateTimelineCaptionTrackId = (): string => {
    if (timelineCaptionTrack) return timelineCaptionTrack.id;
    const trackId = ensureTrackForType("text");
    useTimelineStore.setState((state) => ({
      tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, name: "Captions" } : t)),
    }));
    return trackId;
  };

  // Broadcast style updates to all caption clips on the timeline
  const broadcastStyleUpdate = (patch: Partial<TextClip>, label = "Update Caption Style") => {
    const targetTrackId = getOrCreateTimelineCaptionTrackId();
    execute(new ApplyCaptionTrackStyleCommand(targetTrackId, patch, label));

    // Also sync track default style on CaptionTrack if active
    if (activeTrack) {
      const updatedTrack: CaptionTrack = {
        ...activeTrack,
        defaultStyle: {
          ...activeTrack.defaultStyle,
          fontFamily: patch.fontFamily ?? activeTrack.defaultStyle.fontFamily,
          fontSize: patch.fontSize ?? activeTrack.defaultStyle.fontSize,
          color: patch.color ?? activeTrack.defaultStyle.color,
          fontWeight: (patch.fontWeight as any) ?? activeTrack.defaultStyle.fontWeight,
        },
      };
      execute(new UpdateCaptionTrackCommand(activeTrack, updatedTrack, label));
    }
  };

  // Handle Plain Text property changes
  const applyPlainTextCustomization = (override?: Partial<TextClip>) => {
    const patch: Partial<TextClip> = {
      fontFamily,
      fontSize,
      fontWeight,
      textTransform: uppercase ? "uppercase" : "none",
      color: fillColor,
      align,
      valign: verticalPosition === "center" ? "middle" : verticalPosition,
      stroke: hasStroke ? { color: strokeColor, width: strokeWidth } : undefined,
      shadow: hasShadow
        ? { color: shadowColor, blur: shadowBlur, offsetX: 0, offsetY: shadowOffsetY }
        : undefined,
      background: hasBackground
        ? { color: backgroundColor, padding: backgroundPadding, borderRadius: backgroundRadius }
        : undefined,
      styleId: undefined, // Clear effect if reverting to plain text
      templateId: undefined,
      ...override,
    };

    broadcastStyleUpdate(patch, "Customize Caption Typography");
  };

  // Apply a full CaptionStyleDefinition to all caption clips
  const handleApplyCaptionStyle = useCallback(
    (style: CaptionStyleDefinition) => {
      setSelectedStyleId(style.id);
      broadcastStyleUpdate(style.patch, `Apply Caption Style: ${style.name}`);

      // Sync the plain-text controls to match this style (for round-trip editing)
      if (style.patch.fontFamily) setFontFamily(style.patch.fontFamily);
      if (style.patch.fontSize) setFontSize(style.patch.fontSize);
      if (style.patch.fontWeight !== undefined) setFontWeight(style.patch.fontWeight);
      if (style.patch.color) setFillColor(style.patch.color);
      if (style.patch.textTransform) setUppercase(style.patch.textTransform === "uppercase");
      if (style.patch.align) setAlign(style.patch.align as any);
      if (style.patch.valign)
        setVerticalPosition(style.patch.valign === "middle" ? "center" : (style.patch.valign as any));
      if (style.patch.stroke) {
        setHasStroke(true);
        setStrokeColor(style.patch.stroke.color);
        setStrokeWidth(style.patch.stroke.width);
      } else if (style.patch.stroke === undefined && "stroke" in style.patch) {
        setHasStroke(false);
      }
      if (style.patch.shadow) {
        setHasShadow(true);
        setShadowColor(style.patch.shadow.color);
        setShadowBlur(style.patch.shadow.blur);
        setShadowOffsetY(style.patch.shadow.offsetY ?? 2);
      } else if (style.patch.shadow === undefined && "shadow" in style.patch) {
        setHasShadow(false);
      }
      if (style.patch.background) {
        setHasBackground(true);
        setBackgroundColor(style.patch.background.color);
        setBackgroundPadding(style.patch.background.padding ?? 10);
        setBackgroundRadius(style.patch.background.borderRadius ?? 8);
      } else if (style.patch.background === undefined && "background" in style.patch) {
        setHasBackground(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [broadcastStyleUpdate],
  );

  // Reset to Plain Text Default
  const handleResetToDefault = () => {
    setFontFamily("Outfit Variable");
    setFontSize(34);
    setFontWeight(700);
    setUppercase(false);
    setFillColor("#FFFFFF");
    setHasStroke(true);
    setStrokeColor("#000000");
    setStrokeWidth(3);
    setHasShadow(true);
    setHasBackground(false);
    setVerticalPosition("bottom");
    setAlign("center");

    applyPlainTextCustomization({
      fontFamily: "Outfit Variable",
      fontSize: 34,
      fontWeight: 700,
      textTransform: "none",
      color: "#FFFFFF",
      stroke: { color: "#000000", width: 3 },
      shadow: { color: "rgba(0,0,0,0.85)", blur: 4, offsetX: 0, offsetY: 2 },
      background: undefined,
      styleId: undefined,
      templateId: undefined,
      valign: "bottom",
      align: "center",
    });
  };

  // Handle subtitle file import (.srt / .vtt)
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

      const captionTrack = getOrCreateActiveTrack();
      const timelineTrackId = getOrCreateTimelineCaptionTrackId();

      const newCues: CaptionCue[] = blocks.map((block, idx) => ({
        id: `cue-${Date.now()}-${idx}`,
        startTicks: secondsToTicks(block.startTime),
        endTicks: secondsToTicks(block.endTime),
        text: block.text,
        styleVersion: 1,
      }));

      // Create native timeline TextClips
      const newClips: TextClip[] = blocks.map((block, idx) =>
        createTextClip({
          trackId: timelineTrackId,
          startTime: block.startTime,
          duration: Math.max(0.1, block.endTime - block.startTime),
          text: block.text,
          canvasWidth,
          canvasHeight,
          fontFamily,
          fontSize,
          fontWeight,
          color: fillColor,
          position: verticalPosition,
          textRole: "caption",
          stroke: hasStroke ? { color: strokeColor, width: strokeWidth } : undefined,
          background: hasBackground
            ? { color: backgroundColor, padding: backgroundPadding, borderRadius: backgroundRadius }
            : undefined,
        }),
      );

      execute(new BatchUpdateCaptionCuesCommand(captionTrack, newCues, "Import Subtitles"));

      // Add to timeline clips
      useTimelineStore.getState().withBatch(() => {
        newClips.forEach((clip) => useTimelineStore.getState().addClip(clip));
      });
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to parse subtitle file.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Export captions as SRT or VTT
  const handleExport = (format: "srt" | "vtt") => {
    const clipsToExport = timelineCaptionClips.length > 0 ? timelineCaptionClips : null;
    let content = "";

    if (clipsToExport && clipsToExport.length > 0) {
      content = format === "vtt" ? generateVttFromClips(clipsToExport) : generateSrtFromClips(clipsToExport);
    } else if (activeTrack && cues.length > 0) {
      content = format === "vtt" ? generateVtt(activeTrack) : generateSrt(activeTrack);
    } else {
      return;
    }

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `captions_${Date.now()}.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Add a manual caption cue at the current playhead
  const handleAddManualCaption = () => {
    const playheadTime = (window as any)._lastPlayheadTime || 0;
    const duration = 2.0;
    const track = getOrCreateActiveTrack();
    const timelineTrackId = getOrCreateTimelineCaptionTrackId();

    const newCue: CaptionCue = {
      id: `cue-${Date.now()}`,
      startTicks: secondsToTicks(playheadTime),
      endTicks: secondsToTicks(playheadTime + duration),
      text: "New Caption Text",
      styleVersion: 1,
    };

    const textClip = createTextClip({
      trackId: timelineTrackId,
      startTime: playheadTime,
      duration,
      text: "New Caption Text",
      canvasWidth,
      canvasHeight,
      fontFamily,
      fontSize,
      fontWeight,
      color: fillColor,
      position: verticalPosition,
      textRole: "caption",
      stroke: hasStroke ? { color: strokeColor, width: strokeWidth } : undefined,
    });

    execute(new AddCaptionCueCommand(track, newCue));
    useTimelineStore.getState().addClip(textClip);
  };

  // Auto-generate captions using local Whisper model + Smart NLE Segmentation
  const handleAutoGenerate = async () => {
    const model = captionSettings.activeModel || "tiny";
    const language = captionSettings.language || "auto";

    const modelState = captionSettings.models[model];
    if (modelState?.status !== "downloaded") {
      setErrorMsg(`Whisper model "${model}" is not downloaded yet. Please download it from Settings → Captions.`);
      toggleSettingsModal();
      return;
    }

    if (platform.isCapacitor()) {
      setErrorMsg("Local auto-captions are only supported on Clypra Desktop.");
      return;
    }

    const mediaClips = clips.filter(
      (c) => (c.kind === "video" || c.kind === "audio" || (c as any).mediaId) && c.duration > 0,
    );

    if (mediaClips.length === 0) {
      setErrorMsg("No video or audio clips found on the timeline. Add media first.");
      return;
    }

    setErrorMsg(null);
    setIsGenerating(true);
    setGenerationProgress("Extracting timeline audio & running Whisper…");

    try {
      const captionTrack = getOrCreateActiveTrack();
      const timelineTrackId = getOrCreateTimelineCaptionTrackId();
      const generatedCues: CaptionCue[] = [];
      const generatedTimelineClips: TextClip[] = [];

      for (const mediaClip of mediaClips) {
        const asset = mediaAssets.find((a) => a.id === (mediaClip as any).mediaId);
        if (!asset || !asset.path) continue;

        try {
          // Build a short, readable display name:
          // strip extension → strip trailing bracket IDs like [1120622...] → trim to 22 chars
          const rawName = asset.name || "media";
          const noExt = rawName.replace(/\.[^.]+$/, "");
          const cleaned = noExt.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
          const displayName = cleaned.length > 22 ? `${cleaned.slice(0, 22)}…` : cleaned;
          setGenerationProgress(`Transcribing "${displayName}"…`);
          const rawSegments = await invoke<any[]>("generate_auto_captions", {
            videoPath: asset.path,
            modelSize: model,
            language: language === "auto" ? null : language,
          });

          if (!rawSegments || rawSegments.length === 0) continue;

          // Flatten token-level word timestamps
          const allWords: InputWordTimestamp[] = [];
          rawSegments.forEach((seg) => {
            if (seg.words && seg.words.length > 0) {
              seg.words.forEach((w: any) => {
                allWords.push({
                  word: w.word,
                  startMs: w.startMs ?? w.start_ms ?? 0,
                  endMs: w.endMs ?? w.end_ms ?? 0,
                  probability: w.probability,
                });
              });
            } else {
              allWords.push({
                word: seg.text,
                startMs: seg.startMs ?? seg.start_ms ?? 0,
                endMs: seg.endMs ?? seg.end_ms ?? 0,
              });
            }
          });

          // Run Smart NLE Segmentation with selected pacing preset
          setGenerationProgress("Applying smart subtitle segmentation…");
          const segmentedCues = segmentWordTimestamps(allWords, { preset: pacingPreset });

          const clipStartSec = mediaClip.startTime;
          const clipTrimInSec = (mediaClip as any).trimIn || 0;
          const clipDurationSec = mediaClip.duration;

          segmentedCues.forEach((sc, idx) => {
            const cueStartSec = sc.startMs / 1000;
            const cueEndSec = sc.endMs / 1000;
            const relativeStartSec = cueStartSec - clipTrimInSec;

            if (relativeStartSec >= 0 && relativeStartSec < clipDurationSec) {
              const finalStartSec = clipStartSec + relativeStartSec;
              const finalDurationSec = Math.min(cueEndSec - cueStartSec, clipDurationSec - relativeStartSec);
              const finalEndSec = finalStartSec + finalDurationSec;

              const cueId = `caption-${Date.now()}-${mediaClip.id}-${idx}`;

              generatedCues.push({
                id: cueId,
                startTicks: secondsToTicks(finalStartSec),
                endTicks: secondsToTicks(finalEndSec),
                text: sc.text,
                styleVersion: 1,
              });

              // Create native TextClip with word timestamps
              const textClip = createTextClip({
                trackId: timelineTrackId,
                startTime: finalStartSec,
                duration: finalDurationSec,
                text: sc.text,
                canvasWidth,
                canvasHeight,
                fontFamily,
                fontSize,
                fontWeight,
                textTransform: uppercase ? "uppercase" : "none",
                color: fillColor,
                position: verticalPosition,
                textRole: "caption",
                words: sc.words.map((w) => ({
                  word: w.word,
                  start: w.start,
                  end: w.end,
                  probability: w.probability,
                })),
                stroke: hasStroke ? { color: strokeColor, width: strokeWidth } : undefined,
                shadow: hasShadow
                  ? { color: shadowColor, blur: shadowBlur, offsetX: 0, offsetY: shadowOffsetY }
                  : undefined,
                background: hasBackground
                  ? { color: backgroundColor, padding: backgroundPadding, borderRadius: backgroundRadius }
                  : undefined,
              });

              generatedTimelineClips.push(textClip);
            }
          });
        } catch (clipErr: any) {
          console.error(`[CaptionsTab] Transcription error for clip ${mediaClip.id}:`, clipErr);
        }
      }

      if (generatedCues.length > 0) {
        execute(new BatchUpdateCaptionCuesCommand(captionTrack, generatedCues, "Auto-Generate Captions"));

        // Insert native clips onto timeline in a single batch
        useTimelineStore.getState().withBatch(() => {
          generatedTimelineClips.forEach((clip) => {
            useTimelineStore.getState().addClip(clip);
          });
        });

        setErrorMsg(null);
      } else {
        setErrorMsg("No captions were detected in the audio. Please check your timeline speech content.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to generate captions.");
    } finally {
      setIsGenerating(false);
      setGenerationProgress(null);
    }
  };

  // Direct cue mutations
  const handleCueTextChange = (cue: CaptionCue, text: string) => {
    if (!activeTrack) return;
    execute(new UpdateCaptionCueCommand(activeTrack, { ...cue, text }));

    // Also sync matching timeline clip if found
    const matchingClip = timelineCaptionClips.find(
      (c) => Math.abs(c.startTime - ticksToSeconds(cue.startTicks)) < 0.1,
    );
    if (matchingClip) {
      useTimelineStore.getState().updateClip(matchingClip.id, { text } as any);
    }
  };

  const handleCueDelete = (cueId: string) => {
    if (!activeTrack) return;
    execute(new RemoveCaptionCueCommand(activeTrack, cueId));
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background overflow-hidden">
      {/* Hidden file input for SRT/VTT import */}
      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".srt,.vtt" className="hidden" />

      {/* ── Scrollable controls area ── */}
      <div className="flex flex-col gap-3 p-3 pb-2 overflow-y-auto scrollbar-thin">

        {/* ── Section: Generator / AI Speech Model ── */}
        <div className="space-y-2 p-2.5 rounded-xl bg-surface-raised/40 border border-white/6">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted/70 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-accent" />
              Local AI Speech Model
            </span>
            <button
              onClick={toggleSettingsModal}
              className="text-[11px] text-accent hover:underline flex items-center gap-1 font-medium"
            >
              <Settings className="w-3 h-3" />
              {selectedModel} ({captionSettings.language})
            </button>
          </div>

          {/* Model warning if not ready */}
          {!isModelDownloaded && (
            <div className="flex items-start gap-2 p-2 rounded-lg bg-status-warning/8 border border-status-warning/20 text-[11px] text-status-warning">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span>Model "{selectedModel}" needs downloading. </span>
                <button onClick={toggleSettingsModal} className="underline font-semibold">
                  Open Settings
                </button>
              </div>
            </div>
          )}

          {/* Pacing preset selector */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase text-text-muted/60">
              Pacing & Chunking
            </label>
            <div className="grid grid-cols-3 gap-1 bg-background/50 p-0.5 rounded-lg border border-white/8 text-[11px]">
              <button
                onClick={() => setPacingPreset("standard")}
                className={`py-1 rounded-md font-semibold transition-all ${
                  pacingPreset === "standard" ? "bg-accent text-white shadow-sm" : "text-text-muted hover:text-text-primary"
                }`}
                title="Standard 1-2 line broadcast subtitles (38 chars/line)"
              >
                Standard
              </button>
              <button
                onClick={() => setPacingPreset("kinetic")}
                className={`py-1 rounded-md font-semibold transition-all ${
                  pacingPreset === "kinetic" ? "bg-accent text-white shadow-sm" : "text-text-muted hover:text-text-primary"
                }`}
                title="Shorts/Reels punchy word-pop (1-3 words/clip)"
              >
                Kinetic
              </button>
              <button
                onClick={() => setPacingPreset("phrase")}
                className={`py-1 rounded-md font-semibold transition-all ${
                  pacingPreset === "phrase" ? "bg-accent text-white shadow-sm" : "text-text-muted hover:text-text-primary"
                }`}
                title="Balanced phrase chunks (5-8 words/clip)"
              >
                Phrase
              </button>
            </div>
          </div>

          {/* Primary Auto-Generate CTA Button & Progress */}
          <div className="space-y-1.5">
            <button
              onClick={handleAutoGenerate}
              disabled={isGenerating}
              className={`w-full h-9 flex items-center justify-center gap-2 rounded-lg text-xs font-bold transition-all shadow-md ${
                isGenerating
                  ? "bg-accent/50 text-white/70 cursor-wait"
                  : "bg-accent hover:bg-accent/85 active:scale-[0.99] text-white"
              }`}
            >
              <Sparkles className={`w-3.5 h-3.5 ${isGenerating ? "animate-spin" : ""}`} />
              {isGenerating ? (generationProgress || "Generating captions…") : "Auto-Generate Captions"}
            </button>
            {isGenerating && (
              <ClypraProgressBar
                size="xs"
                variant="gradient"
                animated={true}
                className="px-0.5"
              />
            )}
          </div>
        </div>


        {/* ── Section: Caption Styling ── */}
        <div className="space-y-2 p-2.5 rounded-xl bg-surface-raised/40 border border-white/6">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted/70 flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-accent" />
              Caption Style
            </span>
            {/* Apply to all toggle */}
            <button
              onClick={() => setApplyToAll(!applyToAll)}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold border transition-all ${
                applyToAll
                  ? "bg-accent/15 text-accent border-accent/40"
                  : "bg-white/5 text-text-muted border-white/10"
              }`}
              title="Broadcast styling changes to all captions on the track"
            >
              <Check className={`w-3 h-3 ${applyToAll ? "opacity-100" : "opacity-30"}`} />
              Apply to All
            </button>
          </div>

          {/* Tier switcher: Caption Styles | Custom Typography */}
          <div className="grid grid-cols-2 gap-1 bg-background/50 p-0.5 rounded-lg border border-white/8 text-[11px]">
            <button
              onClick={() => setStylingTier("styles")}
              className={`flex items-center justify-center gap-1 py-1 rounded-md font-semibold transition-all ${
                stylingTier === "styles" ? "bg-accent text-white shadow-sm" : "text-text-muted hover:text-text-primary"
              }`}
            >
              <Star className="w-3 h-3" />
              Caption Styles
            </button>
            <button
              onClick={() => setStylingTier("plain")}
              className={`flex items-center justify-center gap-1 py-1 rounded-md font-semibold transition-all ${
                stylingTier === "plain" ? "bg-accent text-white shadow-sm" : "text-text-muted hover:text-text-primary"
              }`}
            >
              <Type className="w-3 h-3" />
              Custom
            </button>
          </div>

          {/* ── TIER 1: Caption Style Gallery ── */}
          {stylingTier === "styles" && (
            <div className="space-y-2 pt-0.5">
              <p className="text-[9px] text-text-muted/60 font-medium">
                Tap a style to apply it to all caption clips instantly.
              </p>
              {/* Style cards grid */}
              <div className="grid grid-cols-2 gap-2">
                {getAllCaptionStyles().map((style) => {
                  const isSelected = selectedStyleId === style.id;
                  const p = style.preview;

                  return (
                    <button
                      key={style.id}
                      onClick={() => handleApplyCaptionStyle(style)}
                      title={style.description}
                      className={`relative flex flex-col rounded-xl overflow-hidden border transition-all duration-150 group ${
                        isSelected
                          ? "border-accent shadow-[0_0_0_1.5px] shadow-accent/40 ring-1 ring-accent/30"
                          : "border-white/10 hover:border-white/25"
                      }`}
                      style={{
                        background: p.bgColor
                          ? `linear-gradient(135deg, ${p.bgColor}40 0%, rgba(20,20,20,0.95) 100%)`
                          : "linear-gradient(135deg, rgba(30,30,30,0.95) 0%, rgba(18,18,18,0.95) 100%)",
                      }}
                    >
                      {/* Preview area */}
                      <div
                        className="flex items-center justify-center px-2 pt-3 pb-2"
                        style={{ minHeight: 52 }}
                      >
                        {/* Text preview */}
                        {p.hasPill ? (
                          <span
                            className="text-xs font-semibold px-3 py-1 rounded-full"
                            style={{
                              color: p.textColor,
                              backgroundColor: p.bgColor || "rgba(0,0,0,0.7)",
                              fontWeight: p.fontWeight || 600,
                              fontFamily: p.fontFamily !== "monospace" ? undefined : "monospace",
                              border: p.strokeColor ? `1px solid ${p.strokeColor}` : undefined,
                              borderRadius: p.bgBorderRadius || 9999,
                            }}
                          >
                            Aa
                          </span>
                        ) : (
                          <span
                            className="text-sm font-black tracking-wide uppercase"
                            style={{
                              color: p.textColor,
                              fontWeight: p.fontWeight || 700,
                              fontFamily: p.fontFamily !== "monospace" ? undefined : "monospace",
                              WebkitTextStroke: p.strokeColor
                                ? `${p.strokeWidth ?? 2}px ${p.strokeColor}`
                                : undefined,
                              textShadow: p.strokeColor
                                ? `0 0 6px ${p.strokeColor}40`
                                : "0 1px 4px rgba(0,0,0,0.8)",
                            }}
                          >
                            Aa
                          </span>
                        )}
                      </div>

                      {/* Label */}
                      <div className="px-2 pb-2 text-center">
                        <p
                          className={`text-[10px] font-semibold leading-tight transition-colors ${
                            isSelected ? "text-accent" : "text-text-secondary group-hover:text-text-primary"
                          }`}
                        >
                          {style.name}
                        </p>
                      </div>

                      {/* Active check badge */}
                      {isSelected && (
                        <span className="absolute top-1.5 right-1.5 w-4 h-4 flex items-center justify-center rounded-full bg-accent text-white">
                          <Check className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* "Customise further" link */}
              <button
                onClick={() => setStylingTier("plain")}
                className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg border border-dashed border-white/12 text-[10px] text-text-muted hover:text-text-primary hover:border-accent/30 transition-all"
              >
                <Wand2 className="w-3 h-3" />
                Customise further…
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* ── TIER 2: Custom Typography (Plain Text Designer) ── */}
          {stylingTier === "plain" && (
            <div className="space-y-2.5 pt-1">

              {/* Typography controls */}
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[9px] uppercase font-semibold text-text-muted/60">Font Family</label>
                  <select
                    value={fontFamily}
                    onChange={(e) => {
                      setFontFamily(e.target.value);
                      applyPlainTextCustomization({ fontFamily: e.target.value });
                    }}
                    className="h-7 px-2 bg-background border border-white/10 rounded-md text-xs text-text-primary outline-none"
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col justify-end">
                  <ClypraSlider
                    label="Font Size"
                    min={18}
                    max={64}
                    step={1}
                    value={fontSize}
                    suffix="px"
                    size="sm"
                    defaultValue={34}
                    onChange={(sz) => {
                      setFontSize(sz);
                      applyPlainTextCustomization({ fontSize: sz });
                    }}
                  />
                </div>
              </div>


              {/* Color & Uppercase */}
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between p-1.5 bg-background/50 rounded-lg border border-white/8">
                  <span className="text-[10px] font-semibold text-text-secondary">Text Fill</span>
                  <ClypraColorPicker
                    value={fillColor}
                    onChange={(c: string) => {
                      setFillColor(c);
                      applyPlainTextCustomization({ color: c });
                    }}
                    format="hex"
                    availableModes={["solid", "wheel"]}
                    showAlpha={true}
                    size="sm"
                    triggerClassName="w-7 h-7 min-w-0 shrink-0 bg-surface-raised border-border/60 hover:border-border"
                    popoverClassName="z-[100]"
                  />
                </div>

                <button
                  onClick={() => {
                    const next = !uppercase;
                    setUppercase(next);
                    applyPlainTextCustomization({ textTransform: next ? "uppercase" : "none" });
                  }}
                  className={`flex items-center justify-center gap-1.5 p-1.5 rounded-lg border text-[11px] font-semibold transition-all ${
                    uppercase
                      ? "bg-accent/15 border-accent/40 text-accent"
                      : "bg-background/50 border-white/8 text-text-muted hover:text-text-primary"
                  }`}
                >
                  <Type className="w-3.5 h-3.5" />
                  UPPERCASE
                </button>
              </div>

              {/* Outline / Stroke */}
              <div className="flex flex-col gap-1 p-2 bg-background/40 rounded-lg border border-white/6">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasStroke}
                      onChange={(e) => {
                        setHasStroke(e.target.checked);
                        applyPlainTextCustomization({
                          stroke: e.target.checked ? { color: strokeColor, width: strokeWidth } : undefined,
                        });
                      }}
                      className="accent-accent"
                    />
                    Outline Stroke
                  </label>
                  {hasStroke && (
                    <ClypraColorPicker
                      value={strokeColor}
                      onChange={(c: string) => {
                        setStrokeColor(c);
                        applyPlainTextCustomization({ stroke: { color: c, width: strokeWidth } });
                      }}
                      format="hex"
                      availableModes={["solid", "wheel"]}
                      showAlpha={true}
                      size="sm"
                      triggerClassName="w-7 h-7 min-w-0 shrink-0 bg-surface-raised border-border/60 hover:border-border"
                      popoverClassName="z-[100]"
                    />
                  )}
                </div>
                {hasStroke && (
                  <div className="pt-1.5 border-t border-white/5">
                    <ClypraSlider
                      label="Stroke Width"
                      min={1}
                      max={8}
                      step={1}
                      value={strokeWidth}
                      suffix="px"
                      size="sm"
                      compact={true}
                      defaultValue={3}
                      onChange={(w) => {
                        setStrokeWidth(w);
                        applyPlainTextCustomization({ stroke: { color: strokeColor, width: w } });
                      }}
                    />
                  </div>
                )}
              </div>


              {/* Background Box */}
              <div className="flex flex-col gap-1 p-2 bg-background/40 rounded-lg border border-white/6">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasBackground}
                      onChange={(e) => {
                        setHasBackground(e.target.checked);
                        applyPlainTextCustomization({
                          background: e.target.checked
                            ? { color: backgroundColor, padding: backgroundPadding, borderRadius: backgroundRadius }
                            : undefined,
                        });
                      }}
                      className="accent-accent"
                    />
                    Background Box / Pill
                  </label>
                  {hasBackground && (
                    <ClypraColorPicker
                      value={backgroundColor}
                      onChange={(c: string) => {
                        setBackgroundColor(c);
                        applyPlainTextCustomization({
                          background: { color: c, padding: backgroundPadding, borderRadius: backgroundRadius },
                        });
                      }}
                      format="hex"
                      availableModes={["solid", "wheel"]}
                      showAlpha={true}
                      size="sm"
                      triggerClassName="w-7 h-7 min-w-0 shrink-0 bg-surface-raised border-border/60 hover:border-border"
                      popoverClassName="z-[100]"
                    />
                  )}
                </div>
              </div>


              {/* Reset to clean defaults */}
              <button
                onClick={handleResetToDefault}
                className="flex items-center justify-center gap-1.5 py-1 text-[10px] text-text-muted hover:text-text-primary transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Reset Typography Defaults
              </button>
            </div>
          )}
        </div>

        {/* ── Section: Files & Tools ── */}
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-1.5 h-7 px-2 rounded-lg bg-surface-raised border border-white/8 hover:border-accent/40 text-[11px] font-semibold text-text-primary transition-all"
          >
            <Upload className="w-3 h-3 text-accent" />
            Import
          </button>
          <button
            onClick={() => handleExport("srt")}
            disabled={cues.length === 0 && timelineCaptionClips.length === 0}
            className="flex items-center justify-center gap-1.5 h-7 px-2 rounded-lg bg-surface-raised border border-white/8 hover:border-accent/40 text-[11px] font-semibold text-text-primary transition-all disabled:opacity-35 disabled:pointer-events-none"
          >
            <Download className="w-3 h-3 text-accent" />
            Export SRT
          </button>
          <button
            onClick={handleAddManualCaption}
            className="flex items-center justify-center gap-1.5 h-7 px-2 rounded-lg bg-surface-raised border border-white/8 hover:border-accent/40 text-[11px] font-semibold text-text-primary transition-all"
          >
            <Plus className="w-3 h-3 text-accent" />
            Add Cue
          </button>
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="flex items-start gap-2 p-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span className="flex-1">{errorMsg}</span>
          </div>
        )}
      </div>

      {/* ── Section: Interactive Subtitle Transcript / Cues List ── */}
      <div className="flex-1 flex flex-col min-h-0 border-t border-border/50">
        <div className="flex items-center justify-between px-3 py-2 shrink-0">
          <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-muted/70">
            Caption Cues
          </h4>
          <span className="text-[10px] font-semibold tabular-nums text-text-muted bg-surface-raised px-1.5 py-0.5 rounded-full border border-white/8">
            {cues.length} cues
          </span>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-3 pb-3 space-y-2">
          {cues.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 px-4 rounded-xl border border-dashed border-border/40 text-center">
              <Sparkles className="w-6 h-6 text-accent/60" />
              <p className="text-xs font-semibold text-text-primary">No captions on timeline</p>
              <p className="text-[10px] text-text-muted max-w-[180px]">
                Click Auto-Generate or Import to create your subtitle track.
              </p>
            </div>
          ) : (
            cues.map((cue, index) => {
              const startSec = ticksToSeconds(cue.startTicks);
              const durationSec = ticksToSeconds(cue.endTicks - cue.startTicks);

              // Safe-zone check
              const estimatedWidth = Math.min(1536, cue.text.length * 18);
              const compliance = checkSafeZoneCompliance(
                { x: (canvasWidth - estimatedWidth) / 2, y: canvasHeight * 0.82, width: estimatedWidth, height: 60 },
                canvasWidth,
                canvasHeight,
              );

              return (
                <div
                  key={cue.id}
                  className={`group flex flex-col gap-1.5 p-2 rounded-xl border transition-all ${
                    !compliance.isTitleSafe
                      ? "bg-status-warning/5 border-status-warning/30"
                      : "bg-surface-raised/70 border-white/8 hover:border-white/18"
                  }`}
                >
                  {/* Cue Header */}
                  <div className="flex items-center gap-2 text-[10px] text-text-muted">
                    <span className="w-4 h-4 flex items-center justify-center rounded bg-accent/15 text-accent font-bold text-[9px]">
                      {index + 1}
                    </span>

                    {/* Jump playhead to start */}
                    <button
                      onClick={() => seek(startSec)}
                      className="flex items-center gap-1 font-mono hover:text-accent transition-colors cursor-pointer"
                      title="Seek playhead to cue"
                    >
                      <Play className="w-2.5 h-2.5 fill-current" />
                      {formatSrtTimestamp(cue.startTicks)}
                    </button>
                    <span className="text-text-muted/40">→</span>
                    <span className="font-mono">{formatSrtTimestamp(cue.endTicks)}</span>

                    <span className="flex-1" />

                    {!compliance.isTitleSafe && (
                      <span className="text-[8px] font-bold text-status-warning bg-status-warning/10 px-1 py-0.5 rounded border border-status-warning/20">
                        Safe Zone
                      </span>
                    )}

                    <button
                      onClick={() => handleCueDelete(cue.id)}
                      className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-destructive transition-opacity"
                      title="Delete cue"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Textarea */}
                  <textarea
                    value={cue.text}
                    onChange={(e) => handleCueTextChange(cue, e.target.value)}
                    className="w-full min-h-[40px] p-1.5 bg-background/50 focus:bg-background/80 border border-white/8 focus:border-accent/60 rounded-md text-xs text-text-primary resize-none outline-none transition-colors"
                    placeholder="Subtitle text…"
                  />
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
