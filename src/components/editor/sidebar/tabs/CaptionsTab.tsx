import React, { useRef, useState, useEffect } from "react";
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
  Layers,
  Split,
  Check,
  RotateCcw,
} from "lucide-react";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useHistoryStore } from "@/store/historyStore";
import { useTransportControls } from "@/hooks/usePlaybackClock";
import { useCaptionStore } from "@/store/captionStore";
import { useUIStore } from "@/store/uiStore";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";
import { useTemplateStore } from "@/features/text-templates/templateStore";
import { parseSubtitlesAsync } from "@/features/subtitles/parser";
import { CAPTION_STYLE_PRESETS, getCaptionPresetById } from "@/features/subtitles/captionPresets";
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

export type CaptionStylingTier = "plain" | "effects" | "templates";

const FONT_OPTIONS = [
  "Inter Variable",
  "Outfit Variable",
  "Montserrat",
  "Roboto",
  "Impact",
  "Arial",
];

const BUILTIN_CAPTION_EFFECTS = [
  { id: "neon-glow", name: "Neon Glow", previewColor: "#00FFFF", stroke: "#0055FF" },
  { id: "yellow-bold", name: "Classic Yellow", previewColor: "#FFE600", stroke: "#000000" },
  { id: "gradient-sunset", name: "Sunset Pop", previewColor: "#FF5E3A", stroke: "#8A2387" },
  { id: "metallic-gold", name: "Chrome Gold", previewColor: "#FFD700", stroke: "#B8860B" },
  { id: "minimal-clean", name: "Minimal White", previewColor: "#FFFFFF", stroke: "rgba(0,0,0,0.6)" },
  { id: "black-box", name: "Dark Box", previewColor: "#FFFFFF", bg: "rgba(0,0,0,0.8)" },
];

const BUILTIN_CAPTION_TEMPLATES = [
  { id: "word-pop", name: "Word Pop", desc: "Dynamic scale bounce on each word" },
  { id: "karaoke-glow", name: "Karaoke Highlight", desc: "Active word highlights as spoken" },
  { id: "badge-lower-third", name: "Pill Badge", desc: "Rounded badge container with subtitle text" },
  { id: "minimal-slide", name: "Minimal Slide", desc: "Smooth slide-in subtitle animation" },
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
  const [stylingTier, setStylingTier] = useState<CaptionStylingTier>("plain");
  const [applyToAll, setApplyToAll] = useState(true);
  const [pacingPreset, setPacingPreset] = useState<CaptionPacingPreset>("standard");

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

  // 1-Click Preset selection
  const handleApplyPreset = (presetId: string) => {
    const preset = getCaptionPresetById(presetId);
    if (!preset) return;

    setFontFamily(preset.fontFamily);
    setFontSize(preset.fontSize);
    setFillColor(preset.fillColor);
    setFontWeight(preset.bold ? 700 : 400);

    if (preset.strokeColor && preset.strokeWidth) {
      setHasStroke(true);
      setStrokeColor(preset.strokeColor);
      setStrokeWidth(preset.strokeWidth);
    } else {
      setHasStroke(false);
    }

    if (preset.backgroundColor) {
      setHasBackground(true);
      setBackgroundColor(preset.backgroundColor);
    } else {
      setHasBackground(false);
    }

    applyPlainTextCustomization({
      fontFamily: preset.fontFamily,
      fontSize: preset.fontSize,
      color: preset.fillColor,
      fontWeight: preset.bold ? 700 : 400,
      stroke: preset.strokeColor ? { color: preset.strokeColor, width: preset.strokeWidth || 3 } : undefined,
      background: preset.backgroundColor
        ? { color: preset.backgroundColor, padding: 8, borderRadius: 6 }
        : undefined,
    });
  };

  // Apply Text Effect
  const handleApplyTextEffect = (effectId: string) => {
    broadcastStyleUpdate({ styleId: effectId }, `Apply Text Effect: ${effectId}`);
  };

  // Apply Motion Template
  const handleApplyTemplate = (templateId: string) => {
    broadcastStyleUpdate({ templateId }, `Apply Motion Template: ${templateId}`);
  };

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
          setGenerationProgress(`Transcribing ${asset.name || "media"}…`);
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

          {/* Primary Auto-Generate CTA Button */}
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
        </div>

        {/* ── Section: Multi-Tiered Styling Pipeline ── */}
        <div className="space-y-2 p-2.5 rounded-xl bg-surface-raised/40 border border-white/6">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted/70">
              Caption Styling Mode
            </span>
            {/* Apply to all toggle switch */}
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

          {/* Tier mode switcher tabs */}
          <div className="grid grid-cols-3 gap-1 bg-background/50 p-0.5 rounded-lg border border-white/8 text-[11px]">
            <button
              onClick={() => setStylingTier("plain")}
              className={`flex items-center justify-center gap-1 py-1 rounded-md font-semibold transition-all ${
                stylingTier === "plain" ? "bg-accent text-white shadow-sm" : "text-text-muted hover:text-text-primary"
              }`}
            >
              <Type className="w-3 h-3" />
              Plain Text
            </button>
            <button
              onClick={() => setStylingTier("effects")}
              className={`flex items-center justify-center gap-1 py-1 rounded-md font-semibold transition-all ${
                stylingTier === "effects" ? "bg-accent text-white shadow-sm" : "text-text-muted hover:text-text-primary"
              }`}
            >
              <Wand2 className="w-3 h-3" />
              Effects
            </button>
            <button
              onClick={() => setStylingTier("templates")}
              className={`flex items-center justify-center gap-1 py-1 rounded-md font-semibold transition-all ${
                stylingTier === "templates" ? "bg-accent text-white shadow-sm" : "text-text-muted hover:text-text-primary"
              }`}
            >
              <Layers className="w-3 h-3" />
              Templates
            </button>
          </div>

          {/* ── TIER 1: Plain Text Custom Styling (The Default) ── */}
          {stylingTier === "plain" && (
            <div className="space-y-2.5 pt-1">
              {/* Presets row */}
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase font-semibold text-text-muted/60">Quick Presets</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {CAPTION_STYLE_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleApplyPreset(p.id)}
                      className="flex items-center gap-1.5 p-1.5 rounded-lg bg-surface-raised border border-white/6 hover:border-accent/40 text-[11px] font-semibold text-text-secondary transition-all truncate"
                    >
                      <span
                        className="w-3 h-3 rounded-full shrink-0 border border-white/20"
                        style={{ backgroundColor: p.fillColor }}
                      />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>

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

                <div className="flex flex-col gap-1">
                  <label className="text-[9px] uppercase font-semibold text-text-muted/60">Font Size ({fontSize}px)</label>
                  <input
                    type="range"
                    min="18"
                    max="64"
                    value={fontSize}
                    onChange={(e) => {
                      const sz = parseInt(e.target.value, 10);
                      setFontSize(sz);
                      applyPlainTextCustomization({ fontSize: sz });
                    }}
                    className="w-full accent-accent mt-1"
                  />
                </div>
              </div>

              {/* Color & Uppercase */}
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between p-1.5 bg-background/50 rounded-lg border border-white/8">
                  <span className="text-[10px] font-semibold text-text-secondary">Text Fill</span>
                  <input
                    type="color"
                    value={fillColor}
                    onChange={(e) => {
                      setFillColor(e.target.value);
                      applyPlainTextCustomization({ color: e.target.value });
                    }}
                    className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
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
                    <input
                      type="color"
                      value={strokeColor}
                      onChange={(e) => {
                        setStrokeColor(e.target.value);
                        applyPlainTextCustomization({ stroke: { color: e.target.value, width: strokeWidth } });
                      }}
                      className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
                    />
                  )}
                </div>
                {hasStroke && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[9px] text-text-muted">Width</span>
                    <input
                      type="range"
                      min="1"
                      max="8"
                      value={strokeWidth}
                      onChange={(e) => {
                        const w = parseInt(e.target.value, 10);
                        setStrokeWidth(w);
                        applyPlainTextCustomization({ stroke: { color: strokeColor, width: w } });
                      }}
                      className="flex-1 accent-accent"
                    />
                    <span className="text-[10px] font-mono text-text-muted w-4">{strokeWidth}</span>
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
                    <input
                      type="color"
                      value={backgroundColor.startsWith("#") ? backgroundColor : "#000000"}
                      onChange={(e) => {
                        setBackgroundColor(e.target.value);
                        applyPlainTextCustomization({
                          background: { color: e.target.value, padding: backgroundPadding, borderRadius: backgroundRadius },
                        });
                      }}
                      className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
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

          {/* ── TIER 2: Text Effects ── */}
          {stylingTier === "effects" && (
            <div className="space-y-2 pt-1">
              <span className="text-[9px] uppercase font-semibold text-text-muted/60">
                GPU Shader Text Effects
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {BUILTIN_CAPTION_EFFECTS.map((eff) => (
                  <button
                    key={eff.id}
                    onClick={() => handleApplyTextEffect(eff.id)}
                    className="flex flex-col items-center justify-center p-2 rounded-lg bg-surface-raised border border-white/8 hover:border-accent/50 hover:bg-surface-raised/80 transition-all text-center group"
                  >
                    <span
                      className="text-xs font-bold tracking-wider mb-1 px-2 py-0.5 rounded"
                      style={{
                        color: eff.previewColor,
                        textShadow: eff.stroke ? `0 0 8px ${eff.stroke}` : "none",
                        backgroundColor: eff.bg || "transparent",
                      }}
                    >
                      Aa
                    </span>
                    <span className="text-[10px] font-semibold text-text-secondary group-hover:text-text-primary">
                      {eff.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── TIER 3: Motion Templates ── */}
          {stylingTier === "templates" && (
            <div className="space-y-2 pt-1">
              <span className="text-[9px] uppercase font-semibold text-text-muted/60">
                Motion Text Templates & Badges
              </span>
              <div className="flex flex-col gap-1.5">
                {BUILTIN_CAPTION_TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    onClick={() => handleApplyTemplate(tmpl.id)}
                    className="flex items-start gap-2.5 p-2 rounded-lg bg-surface-raised border border-white/8 hover:border-accent/50 text-left transition-all group"
                  >
                    <Sparkles className="w-4 h-4 text-accent shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-text-primary">{tmpl.name}</p>
                      <p className="text-[10px] text-text-muted leading-tight">{tmpl.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
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
