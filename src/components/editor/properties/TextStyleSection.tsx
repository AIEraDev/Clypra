import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  Type,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  Save,
  Trash2,
  PaintBucket,
  Layers,
  Layout,
  AlertTriangle,
  User,
  ChevronsUpDown,
  Sparkles,
  MessageSquare,
  Check,
  ChevronDown,
  ChevronUp,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { normalizeFontFamily } from "@/core/evaluation/evaluator";
import type { TextEffectDefinition } from "@/features/text-effects/types/types";
import type { TextClip } from "@/types";
import { PropertySlider } from "./primitives/PropertySlider";
import { KeyframeNavControls } from "./primitives/KeyframeNavControls";
import { useTemplateStore } from "@/features/text-templates/templateStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useHistoryStore } from "@/store/historyStore";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";
import { EffectStylePanel } from "./EffectStylePanel";
import { TemplateLayerEditor } from "./TemplateLayerEditor";
import { ClypraColorPicker } from "@clypra/ui-color-picker";
import { resolveTextTemplateArtifact } from "@clypra-studio/engine";
import { isTauriRuntime } from "@/lib/platform/tauri";
import {
  getBundledNativeFontIds,
  prewarmNativeFontsOnIdle,
} from "@/core/fonts/nativeFontRegistry";
import { getFontLoader } from "@/core/fonts/FontLoader";
import { getPlaybackClock } from "@/core/playback/PlaybackClock";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import { resolveTextClipStyleUpdate } from "@/lib/text/textClip";

// Extracted font list for maintainability
const SYSTEM_FONTS = [
  { value: "Arial", label: "Arial" },
  { value: "Arial Black", label: "Arial Black" },
  { value: "Arial Rounded MT Bold", label: "Arial Rounded MT Bold" },
  { value: "Georgia", label: "Georgia" },
  { value: "Times New Roman", label: "Times New Roman" },
  { value: "Courier New", label: "Courier New" },
  { value: "Impact", label: "Impact" },
  { value: "Verdana", label: "Verdana" },
  { value: "Trebuchet MS", label: "Trebuchet MS" },
  { value: "Palatino", label: "Palatino" },
];

const GOOGLE_FONTS = [
  { value: "Inter Variable", label: "Inter" },
  { value: "Geist Variable", label: "Geist" },
  { value: "Outfit Variable", label: "Outfit" },
  { value: "Space Grotesk Variable", label: "Space Grotesk" },
  { value: "Roboto Variable", label: "Roboto" },
  { value: "Roboto Condensed", label: "Roboto Condensed" },
  { value: "Open Sans", label: "Open Sans" },
  { value: "Lato", label: "Lato" },
  { value: "Montserrat Variable", label: "Montserrat" },
  { value: "Raleway", label: "Raleway" },
  { value: "Oswald", label: "Oswald" },
  { value: "Playfair Display", label: "Playfair Display" },
  { value: "Anton", label: "Anton" },
  { value: "Bebas Neue", label: "Bebas Neue" },
  { value: "Nunito", label: "Nunito" },
  { value: "Poppins", label: "Poppins" },
  { value: "Permanent Marker", label: "Permanent Marker" },
  { value: "Bangers", label: "Bangers" },
  { value: "Press Start 2P", label: "Press Start 2P" },
  { value: "Dancing Script", label: "Dancing Script" },
  { value: "Pacifico", label: "Pacifico" },
];

export const FONT_PICKER_OPTIONS = [...SYSTEM_FONTS, ...GOOGLE_FONTS];

/**
 * Keep the native select controlled even when older clips store a family
 * alias (for example "Dancing Script") while evaluation resolves it to the
 * Fontsource family ("Dancing Script Variable").
 */
export function resolveFontPickerValue(family: string): string {
  const rawFamily = family.trim();
  const primaryFamily = rawFamily.split(",")[0].trim().replace(/^["']|["']$/g, "");
  const normalizedFamily = normalizeFontFamily(rawFamily);
  const normalizedPrimary = normalizeFontFamily(primaryFamily);
  const normalizedBase = normalizedPrimary.replace(/\s+variable$/i, "");

  return (
    FONT_PICKER_OPTIONS.find(
      (font) => font.value.toLowerCase() === rawFamily.toLowerCase(),
    )?.value ??
    FONT_PICKER_OPTIONS.find(
      (font) => font.value.toLowerCase() === normalizedFamily.toLowerCase(),
    )?.value ??
    FONT_PICKER_OPTIONS.find(
      (font) => font.label.toLowerCase() === normalizedFamily.toLowerCase(),
    )?.value ??
    FONT_PICKER_OPTIONS.find(
      (font) => font.value.toLowerCase() === primaryFamily.toLowerCase(),
    )?.value ??
    FONT_PICKER_OPTIONS.find(
      (font) => font.label.toLowerCase() === primaryFamily.toLowerCase(),
    )?.value ??
    FONT_PICKER_OPTIONS.find(
      (font) => font.value.toLowerCase() === normalizedPrimary.toLowerCase(),
    )?.value ??
    FONT_PICKER_OPTIONS.find(
      (font) => font.label.toLowerCase() === normalizedPrimary.toLowerCase(),
    )?.value ??
    FONT_PICKER_OPTIONS.find(
      (font) => font.value.toLowerCase() === normalizedBase.toLowerCase(),
    )?.value ??
    FONT_PICKER_OPTIONS.find(
      (font) => font.label.toLowerCase() === normalizedBase.toLowerCase(),
    )?.value ??
    normalizedFamily
  );
}

const COLOR_PALETTE = [
  { label: "White", value: "#ffffff" },
  { label: "Black", value: "#1a1a1a" },
  { label: "Yellow", value: "#ffcc00" },
  { label: "Red", value: "#ff3b30" },
  { label: "Pink", value: "#ff2d55" },
  { label: "Purple", value: "#af52de" },
  { label: "Blue", value: "#007aff" },
  { label: "Teal", value: "#00f0ff" },
  { label: "Green", value: "#34c759" },
  { label: "Gold", value: "#ffe066, #b38600" },
  { label: "Sunset", value: "#ff3e00, #ff0077, #aa00ff" },
  { label: "Ocean", value: "#00c8ff, #00ff66" },
  { label: "Rainbow", value: "#ff007f, #aa00ff, #00c8ff, #00ff66" },
];

const FONT_WEIGHTS = [
  { value: 100, label: "Thin" },
  { value: 200, label: "Extra Light" },
  { value: 300, label: "Light" },
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 600, label: "Semi Bold" },
  { value: 700, label: "Bold" },
  { value: 800, label: "Extra Bold" },
  { value: 900, label: "Black" },
];

interface BubblePreset {
  id: string;
  name: string;
  background?: {
    color: string;
    padding: number;
    borderRadius: number;
  };
}

const BUBBLE_PRESETS: BubblePreset[] = [
  { id: "none", name: "None", background: undefined },
  {
    id: "dark_pill",
    name: "Dark Pill",
    background: { color: "rgba(24, 24, 27, 0.85)", padding: 8, borderRadius: 999 },
  },
  {
    id: "speech_white",
    name: "Speech Bubble",
    background: { color: "rgba(255, 255, 255, 0.95)", padding: 12, borderRadius: 12 },
  },
  {
    id: "dark_box",
    name: "Dark Box",
    background: { color: "rgba(0, 0, 0, 0.75)", padding: 10, borderRadius: 6 },
  },
  {
    id: "cyan_glow",
    name: "Cyan Glow",
    background: { color: "rgba(6, 182, 212, 0.25)", padding: 10, borderRadius: 8 },
  },
  {
    id: "yellow_tag",
    name: "Yellow Tag",
    background: { color: "#fef08a", padding: 10, borderRadius: 4 },
  },
  {
    id: "rose_pill",
    name: "Rose Pill",
    background: { color: "rgba(244, 63, 94, 0.85)", padding: 8, borderRadius: 999 },
  },
];

interface TextStyleSectionProps {
  textClip: TextClip;
  presets: any[];
  newPresetName: string;
  setNewPresetName: (name: string) => void;
  handleUpdate: (key: string, value: any) => void;
  handleUpdateMultiple: (fields: Record<string, any>) => void;
  /** Immediate command path used when applying a caption style transaction. */
  handleUpdateImmediate?: (key: string, value: any) => void;
  handleUpdateMultipleImmediate?: (fields: Record<string, any>) => void;
  handleApplyPreset: (preset: any) => void;
  savePreset: (name: string, style: any) => void;
  deletePreset: (id: string) => void;
}

interface TextContentEditorProps {
  value: string;
  onChange: (value: string) => void;
  mode: "plain" | "effect";
}

/**
 * Keep text entry responsive while the timeline and preview catch up at RAF
 * cadence. The timeline remains authoritative outside the focused editor,
 * but React store renders must not replace a newer DOM input value while the
 * user is typing.
 */
const TextContentEditor = React.memo<TextContentEditorProps>(
  ({ value, onChange, mode }) => {
    const [draft, setDraft] = useState(value);
    const focusedRef = useRef(false);

    useEffect(() => {
      if (!focusedRef.current || value === draft) {
        setDraft(value);
      }
    }, [value, draft]);

    return (
      <textarea
        value={draft}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
          if (draft !== value) onChange(draft);
        }}
        onChange={(event) => {
          const nextValue = event.target.value;
          setDraft(nextValue);
          onChange(nextValue);
        }}
        rows={3}
        placeholder="Enter text..."
        aria-label={`${mode === "effect" ? "Effect" : "Plain"} text content`}
        className="w-full bg-[#161618] border border-[#2a2a2e] rounded-lg p-3 text-xs text-white placeholder-text-muted/40 outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/20 resize-none font-sans min-h-[84px] transition-colors"
      />
    );
  },
);

export const TextStyleSection: React.FC<TextStyleSectionProps> = ({
  textClip,
  presets,
  newPresetName,
  setNewPresetName,
  handleUpdate: originalHandleUpdate,
  handleUpdateMultiple: originalHandleUpdateMultiple,
  handleUpdateImmediate,
  handleUpdateMultipleImmediate,
  handleApplyPreset,
  savePreset,
  deletePreset,
}) => {
  const [textSubTab, setTextSubTab] = useState<"basic" | "bubble" | "effects">(
    textClip.styleId ? "effects" : "basic",
  );
  const [applyToAll, setApplyToAll] = useState(false);
  const [effectSearchQuery, setEffectSearchQuery] = useState("");
  const [effectCategory, setEffectCategory] = useState("All");

  // Collapsible sections under basic tab
  const [alignExpanded, setAlignExpanded] = useState(false);
  const [strokeExpanded, setStrokeExpanded] = useState(false);
  const [shadowExpanded, setShadowExpanded] = useState(false);
  const [backgroundExpanded, setBackgroundExpanded] = useState(false);

  const { templates } = useTemplateStore();
  const { definitions } = useEffectsStore();
  const templateDef =
    templates.find((t) => t.id === textClip.templateId) ??
    (textClip.templateDefinition as any) ??
    (textClip.templateSnapshot as any);
  const innerTemplate = templateDef
    ? templateDef.templateData || templateDef.lottieData || templateDef
    : (textClip.templateSnapshot as any) ?? (textClip.templateDefinition as any) ?? null;

  useEffect(() => {
    if (
      textClip.templateId &&
      templateDef &&
      !templateDef.templateData &&
      !templateDef.lottieData
    ) {
      useTemplateStore.getState().selectTemplate(templateDef);
    }
  }, [textClip.templateId, templateDef]);

  const effectFont = textClip.styleId
    ? definitions[textClip.styleId]?.font
    : undefined;
  const activeEffectDefinition = textClip.styleId
    ? definitions[textClip.styleId]
    : textClip.styleDefinition;

  const mode = textClip.templateId
    ? "template"
    : textClip.styleId
      ? "effect"
      : "plain";
  const nativeDesktop = isTauriRuntime();
  const nativeFontIds = useMemo(
    () =>
      new Set(getBundledNativeFontIds().map((fontId) => fontId.toLowerCase())),
    [],
  );
  const requestedFont =
    textClip.fontFamily || effectFont?.family || "Inter Variable";
  const resolvedFont = normalizeFontFamily(requestedFont);
  const selectedFont = resolveFontPickerValue(requestedFont);
  const selectedFontIsUnavailableNatively =
    nativeDesktop && !nativeFontIds.has(resolvedFont.toLowerCase());

  const isMissingFont = selectedFontIsUnavailableNatively;

  const hasBidiText = useMemo(() => {
    const text = textClip.text ?? "";
    return /[\u0590-\u083F]|[\u08A0-\u08FF]|[\uFB1D-\uFDFF]|[\uFE70-\uFEFC]/.test(text);
  }, [textClip.text]);

  const CAPTION_STYLE_KEYS = [
    "fontFamily",
    "fontSize",
    "color",
    "fontWeight",
    "fontStyle",
    "textDecoration",
    "textTransform",
    "stroke",
    "shadow",
    "background",
    "lineHeight",
    "letterSpacing",
    "align",
    "valign",
    "styleId",
    "styleVersion",
    "styleRevisionId",
    "styleContentHash",
    "styleSnapshot",
    "styleDefinition",
    "templateId",
    "templateSnapshot",
  ];

  const handleUpdate = (key: string, value: any) => {
    if (
      applyToAll &&
      textClip.textRole === "caption" &&
      CAPTION_STYLE_KEYS.includes(key)
    ) {
      const { clips } = useTimelineStore.getState();
      const trackCaptions = clips.filter(
        (c) =>
          c.trackId === textClip.trackId && (c as any).textRole === "caption",
      );

      const history = useHistoryStore.getState();
      history.beginTransaction("Apply Caption Style to All");
      try {
        (handleUpdateImmediate ?? originalHandleUpdate)(key, value);
        trackCaptions.forEach((c) => {
          if (c.id !== textClip.id) {
            executeCaptionStyleUpdate(c as TextClip, { [key]: value });
          }
        });
        history.commitTransaction();
      } catch (error) {
        history.rollbackTransaction();
        throw error;
      }
    } else {
      originalHandleUpdate(key, value);
    }
  };

  const handleUpdateMultiple = (fields: Record<string, any>) => {
    const hasStyleField = Object.keys(fields).some((k) =>
      CAPTION_STYLE_KEYS.includes(k),
    );
    if (applyToAll && textClip.textRole === "caption" && hasStyleField) {
      const { clips } = useTimelineStore.getState();
      const trackCaptions = clips.filter(
        (c) =>
          c.trackId === textClip.trackId && (c as any).textRole === "caption",
      );

      const styleFields: Record<string, any> = {};
      Object.entries(fields).forEach(([k, v]) => {
        if (CAPTION_STYLE_KEYS.includes(k)) {
          styleFields[k] = v;
        }
      });

      const history = useHistoryStore.getState();
      history.beginTransaction("Apply Caption Style to All");
      try {
        (handleUpdateMultipleImmediate ?? originalHandleUpdateMultiple)(fields);
        trackCaptions.forEach((c) => {
          if (c.id !== textClip.id) {
            executeCaptionStyleUpdate(c as TextClip, styleFields);
          }
        });
        history.commitTransaction();
      } catch (error) {
        history.rollbackTransaction();
        throw error;
      }
    } else {
      originalHandleUpdateMultiple(fields);
    }
  };

  function executeCaptionStyleUpdate(
    clip: TextClip,
    updates: Record<string, any>,
  ): void {
    const project = useProjectStore.getState().project;
    const resolvedUpdates = resolveTextClipStyleUpdate(
      clip,
      updates,
      project?.canvasWidth ?? 1920,
      project?.canvasHeight ?? 1080,
    );
    const oldProperties = Object.fromEntries(
      Object.keys(resolvedUpdates).map((key) => [key, (clip as any)[key]]),
    );
    useHistoryStore
      .getState()
      .execute(
        new TransformClipCommand(clip.id, oldProperties, resolvedUpdates),
      );
  }

  const customization = textClip.customization || {
    primaryText: textClip.text || "",
    secondaryText: "",
    accentText: "",
    primaryColor: "#ffffff",
    secondaryColor: "#ffffff",
    layerColors: {},
    layerTexts: {},
    layerFontSizes: {},
    layerFontWeights: {},
  };

  const handleDetachTemplate = () => {
    handleUpdateMultiple({
      templateId: undefined,
      styleId: undefined,
      styleDefinition: undefined,
      customization: undefined,
      text: textClip.text || "",
    });
  };

  const handleDetachEffect = () => {
    handleUpdateMultiple({
      styleId: undefined,
      styleDefinition: undefined,
    });
  };

  const applyEffectPreset = (effect: TextEffectDefinition) => {
    handleUpdateMultiple({
      styleId: effect.id,
      fontFamily: effect.font.family,
      color: effect.fills?.[0]?.color,
      fontWeight: effect.font.weight,
      fontStyle: effect.font.style,
      stroke: effect.strokes?.[0]
        ? { color: effect.strokes[0].color, width: effect.strokes[0].width }
        : undefined,
      shadow: effect.shadows?.[0]
        ? {
            color: effect.shadows[0].color,
            blur: effect.shadows[0].blur,
            offsetX: effect.shadows[0].offsetX ?? 0,
            offsetY: effect.shadows[0].offsetY ?? 0,
          }
        : undefined,
      background: effect.panel
        ? {
            color: effect.panel.color || "rgba(0,0,0,0.6)",
            padding:
              effect.panel.paddingX !== undefined ? effect.panel.paddingX : 12,
            borderRadius:
              effect.panel.radius !== undefined ? effect.panel.radius : 6,
          }
        : undefined,
    });
  };

  const effectiveFontWeight = textClip.fontWeight ?? effectFont?.weight;
  const parsedWeight =
    typeof effectiveFontWeight === "number"
      ? effectiveFontWeight
      : Number(effectiveFontWeight);
  const currentWeight = Number.isFinite(parsedWeight)
    ? Math.min(900, Math.max(100, parsedWeight))
    : effectiveFontWeight === "bold"
      ? 700
      : 400;
  const effectiveFontStyle =
    textClip.fontStyle || effectFont?.style || "normal";
  const effectiveLetterSpacing =
    textClip.letterSpacing ?? effectFont?.letterSpacing ?? 0;
  const effectiveLineHeight =
    textClip.lineHeight ?? effectFont?.lineHeight ?? 1.2;

  const handleFontPickerPrewarm = useCallback(() => {
    getFontLoader().prewarmRemainingFontsOnIdle();
    prewarmNativeFontsOnIdle();
  }, []);

  const EFFECT_DETACH_KEYS = new Set(["stroke", "shadow", "background"]);

  const handleCustomStyleUpdate = (key: string, value: any) => {
    const updates: Record<string, any> = { [key]: value };
    if (textClip.styleId && key !== "styleId" && EFFECT_DETACH_KEYS.has(key)) {
      updates.styleId = undefined;
      updates.styleDefinition = undefined;
    }
    handleUpdateMultiple(updates);
  };

  // Keyframe helpers for text color
  const currentTime = getPlaybackClock().time;
  const localTime = Math.max(
    0,
    Math.min(textClip.duration, currentTime - textClip.startTime),
  );

  const colorKfState = useMemo(() => {
    const kfs = (textClip as any).keyframes?.color || [];
    const times = kfs.map((k: any) => k.time);
    const isAt = times.some((t: number) => Math.abs(t - localTime) < 0.08);
    const hasPrev = times.some((t: number) => t < localTime - 0.05);
    const hasNext = times.some((t: number) => t > localTime + 0.05);
    return {
      hasKeyframes: times.length > 0,
      isAtKeyframe: isAt,
      hasPrev,
      hasNext,
    };
  }, [textClip, localTime]);

  const handleToggleColorKeyframe = () => {
    const currentKfs = [...((textClip as any).keyframes?.color || [])];
    const existingIndex = currentKfs.findIndex(
      (k: any) => Math.abs(k.time - localTime) < 0.08,
    );
    if (existingIndex >= 0) {
      currentKfs.splice(existingIndex, 1);
    } else {
      currentKfs.push({
        id: `kf-col-${Date.now()}`,
        time: localTime,
        value: textClip.color || "#ffffff",
      });
      currentKfs.sort((a: any, b: any) => a.time - b.time);
    }
    handleUpdate("keyframes", {
      ...(textClip as any).keyframes,
      color: currentKfs,
    });
  };

  const handlePrevColorKeyframe = () => {
    const kfs = (textClip as any).keyframes?.color || [];
    const prevs = kfs.filter((k: any) => k.time < localTime - 0.05);
    if (prevs.length > 0) {
      const targetTime = prevs[prevs.length - 1].time;
      getPlaybackClock().seek(textClip.startTime + targetTime);
    }
  };

  const handleNextColorKeyframe = () => {
    const kfs = (textClip as any).keyframes?.color || [];
    const nexts = kfs.filter((k: any) => k.time > localTime + 0.05);
    if (nexts.length > 0) {
      const targetTime = nexts[0].time;
      getPlaybackClock().seek(textClip.startTime + targetTime);
    }
  };

  const allCachedEffects = Object.values(definitions);
  const filteredEffects = allCachedEffects.filter((effect) =>
    effect.name.toLowerCase().includes(effectSearchQuery.toLowerCase()),
  );

  const isTextExceedingMaxDimension = useMemo(() => {
    const text = textClip.text || "";
    if (!text) return false;
    const fontSize = textClip.fontSize || 32;
    const letterSpacing = textClip.letterSpacing || 0;
    const lines = text.split("\n");
    const maxLineChars = Math.max(...lines.map((l) => l.length), 0);
    const estimatedMaxLinePx = maxLineChars * (fontSize * 0.7 + letterSpacing);
    return estimatedMaxLinePx > 8192;
  }, [textClip.text, textClip.fontSize, textClip.letterSpacing]);

  return (
    <div className="space-y-3.5 select-none text-white">
      {/* ── Sub-tabs Segmented Control: [ Basic | Bubble | Effects ] ── */}
      <div className="bg-[#242428] p-1 rounded-lg flex gap-1 border border-white/5">
        <button
          type="button"
          onClick={() => setTextSubTab("basic")}
          className={`flex-1 py-1.5 text-xs rounded-md transition-all cursor-pointer text-center ${
            textSubTab === "basic"
              ? "bg-[#38383e] text-white shadow-sm font-semibold"
              : "text-[#8e8e93] hover:text-white"
          }`}
        >
          Basic
        </button>
        <button
          type="button"
          onClick={() => setTextSubTab("bubble")}
          className={`flex-1 py-1.5 text-xs rounded-md transition-all cursor-pointer text-center ${
            textSubTab === "bubble"
              ? "bg-[#38383e] text-white shadow-sm font-semibold"
              : "text-[#8e8e93] hover:text-white"
          }`}
        >
          Bubble
        </button>
        <button
          type="button"
          onClick={() => setTextSubTab("effects")}
          className={`flex-1 py-1.5 text-xs rounded-md transition-all cursor-pointer text-center ${
            textSubTab === "effects"
              ? "bg-[#38383e] text-white shadow-sm font-semibold"
              : "text-[#8e8e93] hover:text-white"
          }`}
        >
          Effects
        </button>
      </div>

      {/* ── Template Mode Overlay ── */}
      {mode === "template" && (
        <div className="space-y-3 p-3 bg-surface-raised/20 border border-border/40 rounded-xl">
          {templateDef ? (
            <>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider block">
                  Active Template: {templateDef.label || templateDef.name}
                </span>
                <button
                  onClick={handleDetachTemplate}
                  className="text-[9px] font-semibold text-red-400 hover:text-red-300 transition-colors cursor-pointer"
                >
                  Detach Template
                </button>
              </div>
              <TemplateLayerEditor
                template={innerTemplate!}
                customization={customization}
                onChange={(nextCust) => {
                  const resolvedArtifact = resolveTextTemplateArtifact(innerTemplate);
                  const firstNodeId =
                    resolvedArtifact?.document?.nodes?.find(
                      (n: any) => n.type === "text",
                    )?.id ||
                    innerTemplate?.layers?.find(
                      (l: any) => l.kind === "text",
                    )?.id ||
                    "";
                  const primaryTextVal =
                    nextCust.layerTexts?.[firstNodeId] ??
                    nextCust.primaryText ??
                    textClip.text;
                  const primaryFontVal =
                    nextCust.layerFontFamilies?.[firstNodeId] ??
                    nextCust.primaryFontFamily ??
                    textClip.fontFamily;
                  const primaryColorVal =
                    nextCust.layerColors?.[firstNodeId] ??
                    nextCust.primaryColor ??
                    textClip.color;

                  const existingControlValues = textClip.templateControlValues || {};
                  const nextControlValues: Record<string, unknown> = { ...existingControlValues };

                  if (nextCust.layerTexts) {
                    for (const [nodeId, txt] of Object.entries(nextCust.layerTexts)) {
                      nextControlValues[`text-${nodeId}`] = txt;
                    }
                  }
                  if (nextCust.layerFontFamilies) {
                    for (const [nodeId, font] of Object.entries(nextCust.layerFontFamilies)) {
                      nextControlValues[`font-${nodeId}`] = font;
                    }
                  }
                  if (nextCust.layerColors) {
                    for (const [nodeId, col] of Object.entries(nextCust.layerColors)) {
                      nextControlValues[`color-${nodeId}`] = col;
                    }
                  }

                  handleUpdateMultiple({
                    customization: nextCust,
                    templateControlValues: nextControlValues,
                    text: primaryTextVal,
                    fontFamily: primaryFontVal,
                    color: primaryColorVal,
                  });
                }}
              />
            </>
          ) : (
            <div className="text-center py-4">
              <p className="text-xs text-text-muted mb-2">No template active.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Sub-tab 1: BASIC (CapCut Layout) ── */}
      {textSubTab === "basic" && mode !== "template" && (
        <div className="space-y-3.5">
          {/* Row 1: Textarea */}
          <div>
            <TextContentEditor
              key={`${textClip.id}-content`}
              value={textClip.text || ""}
              onChange={(value) => handleUpdate("text", value)}
              mode={mode === "effect" ? "effect" : "plain"}
            />
            {isTextExceedingMaxDimension && (
              <div className="mt-1 flex items-start gap-1.5 p-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] leading-tight">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>Text exceeds 8192px canvas budget and was clamped.</span>
              </div>
            )}
          </div>

          {/* Row 2: Font */}
          <div className="flex items-center justify-between gap-3">
            <label className="text-xs text-[#a1a1aa] shrink-0 w-20">Font</label>
            <div className="relative flex-1">
              <select
                value={selectedFont}
                onChange={(e) => handleCustomStyleUpdate("fontFamily", e.target.value)}
                onFocus={handleFontPickerPrewarm}
                onPointerEnter={handleFontPickerPrewarm}
                className="w-full bg-[#27272a] hover:bg-[#323238] border border-white/5 rounded-md px-3 py-1.5 text-xs text-white outline-none focus:border-cyan-400/50 cursor-pointer appearance-none transition-colors pr-8"
              >
                {!nativeDesktop && (
                  <optgroup label="System Fonts">
                    {SYSTEM_FONTS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label={nativeDesktop ? "Native Fonts" : "Google Web Fonts"}>
                  {selectedFontIsUnavailableNatively && (
                    <option value={selectedFont} disabled>
                      {selectedFont} (not supported natively)
                    </option>
                  )}
                  {GOOGLE_FONTS.filter(
                    (font) => !nativeDesktop || nativeFontIds.has(font.value.toLowerCase()),
                  ).map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
              </select>
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted flex flex-col items-center">
                <ChevronsUpDown className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>

          {isMissingFont && (
            <div className="flex items-start gap-1.5 p-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] leading-tight">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                <strong>&quot;{requestedFont}&quot;</strong> is not available natively. Fallback used.
              </span>
            </div>
          )}

          {hasBidiText && (
            <div className="flex items-start gap-1.5 p-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] leading-tight">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Contains right-to-left text. Ensure font supports script.</span>
            </div>
          )}

          {/* Row 3: Font size */}
          <div className="flex items-center gap-3">
            <label className="text-xs text-[#a1a1aa] shrink-0 w-20">Font size</label>
            <div className="flex-1 flex items-center">
              <input
                type="range"
                min={10}
                max={300}
                value={textClip.fontSize || 48}
                onChange={(e) => handleCustomStyleUpdate("fontSize", Number(e.target.value))}
                className="w-full h-1 bg-[#3f3f46] rounded-full appearance-none outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
              />
            </div>
            <div className="w-16 shrink-0 bg-[#27272a] border border-white/5 rounded-md px-2 py-1 flex items-center">
              <input
                type="number"
                min={1}
                max={1000}
                value={textClip.fontSize || 48}
                onChange={(e) => handleCustomStyleUpdate("fontSize", Math.max(1, Number(e.target.value) || 1))}
                className="w-full bg-transparent text-xs text-white text-center outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <div className="flex flex-col -mr-1">
                <button
                  type="button"
                  onClick={() => handleCustomStyleUpdate("fontSize", (textClip.fontSize || 48) + 1)}
                  className="text-text-muted hover:text-white px-0.5 leading-none text-[8px] cursor-pointer"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => handleCustomStyleUpdate("fontSize", Math.max(1, (textClip.fontSize || 48) - 1))}
                  className="text-text-muted hover:text-white px-0.5 leading-none text-[8px] cursor-pointer"
                >
                  ▼
                </button>
              </div>
            </div>
          </div>

          {/* Row 4: Pattern (Bold, Underline, Italic) */}
          <div className="flex items-center gap-3">
            <label className="text-xs text-[#a1a1aa] shrink-0 w-20">Pattern</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const isBold = currentWeight >= 700;
                  handleCustomStyleUpdate("fontWeight", isBold ? 400 : 700);
                }}
                className={`w-8 h-8 rounded-md font-bold text-xs flex items-center justify-center transition-colors border cursor-pointer ${
                  currentWeight >= 700
                    ? "bg-[#3e3e44] text-white border-white/20 shadow-sm"
                    : "bg-[#242428] text-text-muted border-white/5 hover:text-white hover:bg-[#2c2c32]"
                }`}
                title="Bold"
              >
                B
              </button>
              <button
                type="button"
                onClick={() => {
                  const isUnderline = (textClip as any).textDecoration === "underline";
                  handleCustomStyleUpdate("textDecoration", isUnderline ? "none" : "underline");
                }}
                className={`w-8 h-8 rounded-md font-semibold text-xs flex items-center justify-center underline transition-colors border cursor-pointer ${
                  (textClip as any).textDecoration === "underline"
                    ? "bg-[#3e3e44] text-white border-white/20 shadow-sm"
                    : "bg-[#242428] text-text-muted border-white/5 hover:text-white hover:bg-[#2c2c32]"
                }`}
                title="Underline"
              >
                U
              </button>
              <button
                type="button"
                onClick={() => {
                  const isItalic = effectiveFontStyle === "italic";
                  handleCustomStyleUpdate("fontStyle", isItalic ? "normal" : "italic");
                }}
                className={`w-8 h-8 rounded-md font-semibold text-xs italic flex items-center justify-center transition-colors border cursor-pointer ${
                  effectiveFontStyle === "italic"
                    ? "bg-[#3e3e44] text-white border-white/20 shadow-sm"
                    : "bg-[#242428] text-text-muted border-white/5 hover:text-white hover:bg-[#2c2c32]"
                }`}
                title="Italic"
              >
                I
              </button>
            </div>
          </div>

          {/* Row 5: Case (TT, tt, Tt) */}
          <div className="flex items-center gap-3">
            <label className="text-xs text-[#a1a1aa] shrink-0 w-20">Case</label>
            <div className="inline-flex bg-[#242428] border border-white/5 p-0.5 rounded-md">
              <button
                type="button"
                onClick={() =>
                  handleCustomStyleUpdate(
                    "textTransform",
                    textClip.textTransform === "uppercase" ? "none" : "uppercase",
                  )
                }
                className={`px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                  textClip.textTransform === "uppercase"
                    ? "bg-[#3e3e44] text-white shadow-sm"
                    : "text-text-muted hover:text-white"
                }`}
                title="Uppercase (ALL CAPS)"
              >
                TT
              </button>
              <button
                type="button"
                onClick={() =>
                  handleCustomStyleUpdate(
                    "textTransform",
                    textClip.textTransform === "lowercase" ? "none" : "lowercase",
                  )
                }
                className={`px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                  textClip.textTransform === "lowercase"
                    ? "bg-[#3e3e44] text-white shadow-sm"
                    : "text-text-muted hover:text-white"
                }`}
                title="Lowercase (all small)"
              >
                tt
              </button>
              <button
                type="button"
                onClick={() =>
                  handleCustomStyleUpdate(
                    "textTransform",
                    textClip.textTransform === "capitalize" ? "none" : "capitalize",
                  )
                }
                className={`px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                  textClip.textTransform === "capitalize"
                    ? "bg-[#3e3e44] text-white shadow-sm"
                    : "text-text-muted hover:text-white"
                }`}
                title="Title Case (Capitalize Words)"
              >
                Tt
              </button>
            </div>
          </div>

          {/* Row 6: Color & Keyframe Stepper */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <label className="text-xs text-[#a1a1aa] shrink-0 w-20">Color</label>
              <div className="relative">
                <ClypraColorPicker
                  value={textClip.color || "#ffffff"}
                  onChange={(c: string) => handleCustomStyleUpdate("color", c)}
                  format="hex"
                  availableModes={["solid", "wheel"]}
                  presetColors={COLOR_PALETTE.filter((p) => !p.value.includes(",")).map(
                    (p) => p.value,
                  )}
                  showAlpha={true}
                  size="sm"
                  triggerClassName="w-24 h-7 bg-[#27272a] border-white/10 hover:border-white/20 rounded-md px-2 flex items-center justify-between cursor-pointer"
                  popoverClassName="z-[100]"
                />
              </div>
            </div>
            {/* Keyframe diamond stepper < ◇ > */}
            <div className="flex items-center">
              <KeyframeNavControls
                hasKeyframes={colorKfState.hasKeyframes}
                isAtKeyframe={colorKfState.isAtKeyframe}
                hasPrev={colorKfState.hasPrev}
                hasNext={colorKfState.hasNext}
                onToggleKeyframe={handleToggleColorKeyframe}
                onPrevKeyframe={handlePrevColorKeyframe}
                onNextKeyframe={handleNextColorKeyframe}
                label="Text Color"
              />
            </div>
          </div>

          {/* Row 7: Spacing (Character & Line) */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-1">
              <span className="text-xs text-[#a1a1aa]">Character</span>
              <div className="flex-1 max-w-[80px] bg-[#27272a] border border-white/5 rounded-md px-2 py-1 flex items-center">
                <input
                  type="number"
                  value={effectiveLetterSpacing}
                  onChange={(e) =>
                    handleCustomStyleUpdate("letterSpacing", Number(e.target.value))
                  }
                  className="w-full bg-transparent text-xs text-white text-center outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <div className="flex flex-col -mr-1">
                  <button
                    type="button"
                    onClick={() =>
                      handleCustomStyleUpdate("letterSpacing", effectiveLetterSpacing + 1)
                    }
                    className="text-text-muted hover:text-white px-0.5 leading-none text-[8px] cursor-pointer"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleCustomStyleUpdate("letterSpacing", effectiveLetterSpacing - 1)
                    }
                    className="text-text-muted hover:text-white px-0.5 leading-none text-[8px] cursor-pointer"
                  >
                    ▼
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-1 justify-end">
              <span className="text-xs text-[#a1a1aa]">Line</span>
              <div className="flex-1 max-w-[80px] bg-[#27272a] border border-white/5 rounded-md px-2 py-1 flex items-center">
                <input
                  type="number"
                  step={0.1}
                  value={Math.round(effectiveLineHeight * 10) / 10}
                  onChange={(e) =>
                    handleCustomStyleUpdate("lineHeight", Number(e.target.value))
                  }
                  className="w-full bg-transparent text-xs text-white text-center outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <div className="flex flex-col -mr-1">
                  <button
                    type="button"
                    onClick={() =>
                      handleCustomStyleUpdate(
                        "lineHeight",
                        Math.round((effectiveLineHeight + 0.1) * 10) / 10,
                      )
                    }
                    className="text-text-muted hover:text-white px-0.5 leading-none text-[8px] cursor-pointer"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleCustomStyleUpdate(
                        "lineHeight",
                        Math.max(0.5, Math.round((effectiveLineHeight - 0.1) * 10) / 10),
                      )
                    }
                    className="text-text-muted hover:text-white px-0.5 leading-none text-[8px] cursor-pointer"
                  >
                    ▼
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Row 8: Save As Preset Button */}
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => {
                const name = prompt("Enter preset name:", newPresetName || "Custom Preset");
                if (name) {
                  savePreset(name, {
                    fontFamily: textClip.fontFamily,
                    fontSize: textClip.fontSize,
                    fontWeight: textClip.fontWeight,
                    fontStyle: textClip.fontStyle,
                    textTransform: textClip.textTransform,
                    textDecoration: (textClip as any).textDecoration,
                    color: textClip.color,
                    align: textClip.align,
                    valign: textClip.valign,
                    lineHeight: textClip.lineHeight,
                    letterSpacing: textClip.letterSpacing,
                    stroke: textClip.stroke,
                    shadow: textClip.shadow,
                    background: textClip.background,
                  });
                }
              }}
              className="bg-cyan-400 hover:bg-cyan-300 text-black font-semibold text-xs px-4 py-1.5 rounded-md transition-colors cursor-pointer shadow-sm"
            >
              Save as preset
            </button>
          </div>

          {/* ── Advanced Collapsible Sections below Spacing ── */}
          <div className="pt-2 border-t border-border/30 space-y-2">
            {/* Alignment Accordion */}
            <div className="border border-white/5 rounded-lg bg-[#202024] overflow-hidden">
              <button
                type="button"
                onClick={() => setAlignExpanded(!alignExpanded)}
                className="w-full px-3 py-2 flex items-center justify-between text-xs font-medium text-[#a1a1aa] hover:text-white transition-colors cursor-pointer"
              >
                <span>Alignment</span>
                {alignExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {alignExpanded && (
                <div className="p-3 pt-0 grid grid-cols-2 gap-3 border-t border-white/5">
                  <div className="space-y-1">
                    <span className="text-[10px] text-text-muted block">Horizontal</span>
                    <div className="flex gap-0.5 bg-[#18181b] p-0.5 rounded-md">
                      {(
                        [
                          ["left", AlignLeft],
                          ["center", AlignCenter],
                          ["right", AlignRight],
                        ] as const
                      ).map(([align, Icon]) => (
                        <button
                          key={align}
                          onClick={() => handleUpdate("align", align)}
                          className={`flex-1 py-1 rounded flex items-center justify-center transition-all cursor-pointer ${
                            (textClip.align || "center") === align
                              ? "bg-cyan-400 text-black font-semibold"
                              : "text-text-muted hover:text-white"
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] text-text-muted block">Vertical</span>
                    <div className="flex gap-0.5 bg-[#18181b] p-0.5 rounded-md">
                      {(
                        [
                          ["top", AlignStartVertical],
                          ["middle", AlignCenterVertical],
                          ["bottom", AlignEndVertical],
                        ] as const
                      ).map(([valign, Icon]) => (
                        <button
                          key={valign}
                          onClick={() => handleUpdate("valign", valign)}
                          className={`flex-1 py-1 rounded flex items-center justify-center transition-all cursor-pointer ${
                            (textClip.valign || "middle") === valign
                              ? "bg-cyan-400 text-black font-semibold"
                              : "text-text-muted hover:text-white"
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Stroke Accordion */}
            <div className="border border-white/5 rounded-lg bg-[#202024] overflow-hidden">
              <div className="px-3 py-2 flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => setStrokeExpanded(!strokeExpanded)}
                  className="flex items-center gap-2 text-left font-medium text-[#a1a1aa] hover:text-white transition-colors cursor-pointer flex-1"
                >
                  {strokeExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  <span>Stroke</span>
                </button>
                <div className="flex items-center gap-2">
                  {textClip.stroke && (
                    <ClypraColorPicker
                      value={textClip.stroke.color || "#000000"}
                      onChange={(c: string) =>
                        handleCustomStyleUpdate("stroke", {
                          color: c,
                          width: textClip.stroke?.width ?? 2,
                        })
                      }
                      format="hex"
                      availableModes={["solid", "wheel"]}
                      presetColors={COLOR_PALETTE.filter((p) => !p.value.includes(",")).map(
                        (p) => p.value,
                      )}
                      showAlpha={true}
                      size="sm"
                      triggerClassName="w-16 h-6 bg-surface-raised border-border/60 hover:border-border shrink-0"
                      popoverClassName="z-[100]"
                    />
                  )}
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(textClip.stroke && (textClip.stroke.width ?? 0) > 0)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          handleCustomStyleUpdate("stroke", { color: "#000000", width: 2 });
                        } else {
                          handleCustomStyleUpdate("stroke", undefined);
                        }
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-7 h-3.5 bg-surface-raised border border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-3.5 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-cyan-400" />
                  </label>
                </div>
              </div>
              {strokeExpanded && textClip.stroke && (
                <div className="p-3 pt-0 border-t border-white/5">
                  <PropertySlider
                    label="Width"
                    value={textClip.stroke.width ?? 2}
                    min={1}
                    max={30}
                    step={1}
                    suffix="px"
                    onChange={(v) =>
                      handleCustomStyleUpdate("stroke", {
                        color: textClip.stroke?.color ?? "#000000",
                        width: v,
                      })
                    }
                  />
                </div>
              )}
            </div>

            {/* Drop Shadow Accordion */}
            <div className="border border-white/5 rounded-lg bg-[#202024] overflow-hidden">
              <div className="px-3 py-2 flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => setShadowExpanded(!shadowExpanded)}
                  className="flex items-center gap-2 text-left font-medium text-[#a1a1aa] hover:text-white transition-colors cursor-pointer flex-1"
                >
                  {shadowExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  <span>Shadow</span>
                </button>
                <div className="flex items-center gap-2">
                  {textClip.shadow && (
                    <ClypraColorPicker
                      value={textClip.shadow.color || "rgba(0,0,0,0.75)"}
                      onChange={(c: string) =>
                        handleCustomStyleUpdate("shadow", {
                          color: c,
                          blur: textClip.shadow?.blur ?? 4,
                          offsetX: textClip.shadow?.offsetX ?? 2,
                          offsetY: textClip.shadow?.offsetY ?? 2,
                        })
                      }
                      format="hex"
                      availableModes={["solid", "wheel"]}
                      presetColors={COLOR_PALETTE.filter((p) => !p.value.includes(",")).map(
                        (p) => p.value,
                      )}
                      showAlpha={true}
                      size="sm"
                      triggerClassName="w-16 h-6 bg-surface-raised border-border/60 hover:border-border shrink-0"
                      popoverClassName="z-[100]"
                    />
                  )}
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(textClip.shadow)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          handleCustomStyleUpdate("shadow", {
                            color: "rgba(0, 0, 0, 0.75)",
                            blur: 4,
                            offsetX: 2,
                            offsetY: 2,
                          });
                        } else {
                          handleCustomStyleUpdate("shadow", undefined);
                        }
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-7 h-3.5 bg-surface-raised border border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-3.5 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-cyan-400" />
                  </label>
                </div>
              </div>
              {shadowExpanded && textClip.shadow && (
                <div className="p-3 pt-0 border-t border-white/5 space-y-2">
                  <PropertySlider
                    label="Blur"
                    value={textClip.shadow.blur ?? 4}
                    min={0}
                    max={60}
                    step={1}
                    suffix="px"
                    onChange={(v) =>
                      handleCustomStyleUpdate("shadow", {
                        color: textClip.shadow?.color ?? "rgba(0, 0, 0, 0.75)",
                        blur: v,
                        offsetX: textClip.shadow?.offsetX ?? 2,
                        offsetY: textClip.shadow?.offsetY ?? 2,
                      })
                    }
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <PropertySlider
                      label="Offset X"
                      value={textClip.shadow.offsetX ?? 2}
                      min={-50}
                      max={50}
                      step={1}
                      suffix="px"
                      onChange={(v) =>
                        handleCustomStyleUpdate("shadow", {
                          color: textClip.shadow?.color ?? "rgba(0, 0, 0, 0.75)",
                          blur: textClip.shadow?.blur ?? 4,
                          offsetX: v,
                          offsetY: textClip.shadow?.offsetY ?? 2,
                        })
                      }
                    />
                    <PropertySlider
                      label="Offset Y"
                      value={textClip.shadow.offsetY ?? 2}
                      min={-50}
                      max={50}
                      step={1}
                      suffix="px"
                      onChange={(v) =>
                        handleCustomStyleUpdate("shadow", {
                          color: textClip.shadow?.color ?? "rgba(0, 0, 0, 0.75)",
                          blur: textClip.shadow?.blur ?? 4,
                          offsetX: textClip.shadow?.offsetX ?? 2,
                          offsetY: v,
                        })
                      }
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Background Box Accordion */}
            <div className="border border-white/5 rounded-lg bg-[#202024] overflow-hidden">
              <div className="px-3 py-2 flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => setBackgroundExpanded(!backgroundExpanded)}
                  className="flex items-center gap-2 text-left font-medium text-[#a1a1aa] hover:text-white transition-colors cursor-pointer flex-1"
                >
                  {backgroundExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  <span>Background Box</span>
                </button>
                <div className="flex items-center gap-2">
                  {textClip.background && (
                    <ClypraColorPicker
                      value={textClip.background.color || "rgba(0,0,0,0.6)"}
                      onChange={(c: string) =>
                        handleCustomStyleUpdate("background", {
                          color: c,
                          padding: textClip.background?.padding ?? 8,
                          borderRadius: textClip.background?.borderRadius ?? 4,
                        })
                      }
                      format="hex"
                      availableModes={["solid", "wheel"]}
                      presetColors={COLOR_PALETTE.filter((p) => !p.value.includes(",")).map(
                        (p) => p.value,
                      )}
                      showAlpha={true}
                      size="sm"
                      triggerClassName="w-16 h-6 bg-surface-raised border-border/60 hover:border-border shrink-0"
                      popoverClassName="z-[100]"
                    />
                  )}
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(textClip.background)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          handleCustomStyleUpdate("background", {
                            color: "rgba(0, 0, 0, 0.6)",
                            padding: 8,
                            borderRadius: 4,
                          });
                        } else {
                          handleCustomStyleUpdate("background", undefined);
                        }
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-7 h-3.5 bg-surface-raised border border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-3.5 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-cyan-400" />
                  </label>
                </div>
              </div>
              {backgroundExpanded && textClip.background && (
                <div className="p-3 pt-0 border-t border-white/5 space-y-2">
                  <PropertySlider
                    label="Padding"
                    value={textClip.background.padding ?? 8}
                    min={0}
                    max={60}
                    step={1}
                    suffix="px"
                    onChange={(v) =>
                      handleCustomStyleUpdate("background", {
                        color: textClip.background?.color ?? "rgba(0, 0, 0, 0.6)",
                        padding: v,
                        borderRadius: textClip.background?.borderRadius ?? 4,
                      })
                    }
                  />
                  <PropertySlider
                    label="Border Radius"
                    value={textClip.background.borderRadius ?? 4}
                    min={0}
                    max={40}
                    step={1}
                    suffix="px"
                    onChange={(v) =>
                      handleCustomStyleUpdate("background", {
                        color: textClip.background?.color ?? "rgba(0, 0, 0, 0.6)",
                        padding: textClip.background?.padding ?? 8,
                        borderRadius: v,
                      })
                    }
                  />
                </div>
              )}
            </div>

            {/* Behind Subject (AI Cutout) */}
            <div className="p-3 bg-[#202024] border border-white/5 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`p-1.5 rounded-md transition-colors ${
                      (textClip as any).behindSubject
                        ? "bg-purple-500/20 text-purple-400"
                        : "bg-[#27272a] text-text-muted"
                    }`}
                  >
                    <User className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-white block">
                      Behind Subject
                    </span>
                    <span className="text-[10px] text-[#8e8e93] block">
                      Place text behind the person using AI cutout
                    </span>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(textClip as any).behindSubject ?? false}
                    onChange={(e) => handleUpdate("behindSubject", e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-8 h-4 bg-surface-raised border border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-purple-500" />
                </label>
              </div>

              {(textClip as any).behindSubject && (
                <div className="pt-2 border-t border-border/30 space-y-2">
                  <PropertySlider
                    label="Edge Softness"
                    value={(textClip as any).subjectFeather ?? 4}
                    min={0}
                    max={20}
                    step={1}
                    suffix="px"
                    onChange={(v) => handleUpdate("subjectFeather", v)}
                  />
                </div>
              )}
            </div>

            {/* Caption Batch Styling */}
            {textClip.textRole === "caption" && (
              <div className="flex items-center justify-between p-2.5 bg-[#202024] border border-white/5 rounded-lg">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-white">Apply to all captions</span>
                  <span className="text-[9px] text-[#8e8e93]">
                    Broadcast styles to all clips on this track
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setApplyToAll(!applyToAll)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                    applyToAll
                      ? "bg-cyan-400 text-black font-bold"
                      : "bg-[#27272a] text-[#8e8e93] hover:text-white"
                  }`}
                >
                  {applyToAll ? "Active" : "Inactive"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Sub-tab 2: BUBBLE ── */}
      {textSubTab === "bubble" && (
        <div className="space-y-4">
          <span className="text-xs font-medium text-[#a1a1aa] block">
            Speech Bubbles & Backgrounds
          </span>

          {/* Bubble Presets Grid */}
          <div className="grid grid-cols-2 gap-2">
            {BUBBLE_PRESETS.map((preset) => {
              const isActive =
                (!preset.background && !textClip.background) ||
                (preset.background &&
                  textClip.background &&
                  textClip.background.borderRadius === preset.background.borderRadius);
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleCustomStyleUpdate("background", preset.background)}
                  className={`p-3 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center min-h-[72px] relative ${
                    isActive
                      ? "bg-[#27272a] border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.15)]"
                      : "bg-[#202024] border-white/5 hover:border-white/20"
                  }`}
                >
                  {/* Miniature bubble demo */}
                  <div
                    className="px-2 py-1 text-[11px] font-bold text-white mb-1.5 flex items-center justify-center max-w-full truncate"
                    style={{
                      background: preset.background?.color || "transparent",
                      borderRadius: preset.background?.borderRadius ?? 4,
                      border: preset.background ? "none" : "1px dashed rgba(255,255,255,0.2)",
                    }}
                  >
                    CLYPRA
                  </div>
                  <span className="text-xs text-white font-medium">{preset.name}</span>
                </button>
              );
            })}
          </div>

          {/* Bubble Adjustments */}
          {textClip.background && (
            <div className="space-y-3 pt-3 border-t border-border/30">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#a1a1aa]">Bubble Color</span>
                <ClypraColorPicker
                  value={textClip.background.color || "rgba(0,0,0,0.6)"}
                  onChange={(c: string) =>
                    handleCustomStyleUpdate("background", {
                      color: c,
                      padding: textClip.background?.padding ?? 8,
                      borderRadius: textClip.background?.borderRadius ?? 4,
                    })
                  }
                  format="hex"
                  availableModes={["solid", "wheel"]}
                  presetColors={COLOR_PALETTE.filter((p) => !p.value.includes(",")).map(
                    (p) => p.value,
                  )}
                  showAlpha={true}
                  size="sm"
                  triggerClassName="w-24 h-7 bg-[#27272a] border-white/10 rounded-md px-2"
                />
              </div>

              <PropertySlider
                label="Padding"
                value={textClip.background.padding ?? 8}
                min={0}
                max={40}
                step={1}
                suffix="px"
                onChange={(v) =>
                  handleCustomStyleUpdate("background", {
                    color: textClip.background?.color ?? "rgba(0, 0, 0, 0.6)",
                    padding: v,
                    borderRadius: textClip.background?.borderRadius ?? 4,
                  })
                }
              />

              <PropertySlider
                label="Border Radius"
                value={textClip.background.borderRadius ?? 4}
                min={0}
                max={999}
                step={2}
                suffix="px"
                onChange={(v) =>
                  handleCustomStyleUpdate("background", {
                    color: textClip.background?.color ?? "rgba(0, 0, 0, 0.6)",
                    padding: textClip.background?.padding ?? 8,
                    borderRadius: v,
                  })
                }
              />
            </div>
          )}
        </div>
      )}

      {/* ── Sub-tab 3: EFFECTS (Style Presets & Gallery) ── */}
      {textSubTab === "effects" && (
        <div className="space-y-4">
          {/* Active Effect banner */}
          {mode === "effect" && activeEffectDefinition && (
            <div className="space-y-3">
              <EffectStylePanel
                effectId={textClip.styleId || "custom"}
                effectDefinition={activeEffectDefinition}
                onDetach={handleDetachEffect}
                onChangeEffect={() => {}}
                isModified={false}
              />
            </div>
          )}

          {/* Search Effects */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#8e8e93] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={effectSearchQuery}
              onChange={(e) => setEffectSearchQuery(e.target.value)}
              placeholder="Search text effects..."
              className="w-full bg-[#202024] border border-white/5 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-text-muted/40 outline-none focus:border-cyan-400/50"
            />
          </div>

          {/* Effects Grid */}
          <div className="grid grid-cols-2 gap-2 max-h-[380px] overflow-y-auto scrollbar-thin pr-1">
            {filteredEffects.map((effect) => {
              const isSelected = textClip.styleId === effect.id;
              return (
                <div
                  key={effect.id}
                  onClick={() => applyEffectPreset(effect)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col items-center justify-center min-h-[80px] relative text-center group ${
                    isSelected
                      ? "bg-[#27272a] border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.2)]"
                      : "bg-[#202024] border-white/5 hover:border-white/20"
                  }`}
                >
                  <div
                    className="text-sm font-bold truncate max-w-full mb-1"
                    style={{
                      color: effect.fills?.[0]?.color || "#ffffff",
                      textShadow: effect.shadows?.[0]
                        ? `0 0 ${effect.shadows[0].blur}px ${effect.shadows[0].color}`
                        : undefined,
                    }}
                  >
                    {effect.name}
                  </div>
                  <span className="text-[10px] text-[#8e8e93] truncate max-w-full">
                    {effect.category || "Style"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
