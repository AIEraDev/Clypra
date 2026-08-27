import React from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { normalizeFontFamily } from "@/core/evaluation/evaluator";
import type { TextEffectDefinition } from "@/features/text-effects/types/types";
import type { TextClip } from "@/types";
import { PropertySlider } from "./primitives/PropertySlider";
import { PropertySection } from "./primitives/PropertySection";
import { useTemplateStore } from "@/features/text-templates/templateStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";
import { EffectStylePanel } from "./EffectStylePanel";
import { TemplateLayerEditor } from "./TemplateLayerEditor";
import { ClypraColorPicker } from "@clypra/ui-color-picker";
import { isTauriRuntime } from "@/lib/platform/tauri";
import { getBundledNativeFontIds } from "@/core/fonts/nativeFontRegistry";

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

const FONT_PICKER_OPTIONS = [...SYSTEM_FONTS, ...GOOGLE_FONTS];

/**
 * Keep the native select controlled even when older clips store a family
 * alias (for example "Dancing Script") while evaluation resolves it to the
 * Fontsource family ("Dancing Script Variable").
 */
export function resolveFontPickerValue(family: string): string {
  const rawFamily = family.trim();
  const normalizedFamily = normalizeFontFamily(rawFamily);
  const normalizedBase = normalizedFamily.replace(/\s+variable$/i, "");

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
      (font) => font.value.toLowerCase() === normalizedBase.toLowerCase(),
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

const TEMPLATE_CATEGORIES = [
  "lower-third",
  "title-card",
  "caption",
  "callout",
  "social",
  "countdown",
] as const;

interface TextStyleSectionProps {
  textClip: TextClip;
  presets: any[];
  newPresetName: string;
  setNewPresetName: (name: string) => void;
  handleUpdate: (key: string, value: any) => void;
  handleUpdateMultiple: (fields: Record<string, any>) => void;
  handleApplyPreset: (preset: any) => void;
  savePreset: (name: string, style: any) => void;
  deletePreset: (id: string) => void;
}

export const TextStyleSection: React.FC<TextStyleSectionProps> = ({
  textClip,
  presets,
  newPresetName,
  setNewPresetName,
  handleUpdate: originalHandleUpdate,
  handleUpdateMultiple: originalHandleUpdateMultiple,
  handleApplyPreset,
  savePreset,
  deletePreset,
}) => {
  const [applyToAll, setApplyToAll] = React.useState(false);
  const [effectSearchQuery, setEffectSearchQuery] = React.useState("");
  const [templateSearchQuery, setTemplateSearchQuery] = React.useState("");
  const [templateCategory, setTemplateCategory] =
    React.useState<string>("lower-third");

  const { templates } = useTemplateStore();
  const { definitions } = useEffectsStore();
  const templateDef = templates.find((t) => t.id === textClip.templateId);
  const innerTemplate = templateDef
    ? templateDef.templateData || templateDef.lottieData || templateDef
    : null;

  React.useEffect(() => {
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

  // Determine current mode
  const mode = textClip.templateId
    ? "template"
    : textClip.styleId
      ? "effect"
      : "plain";
  const nativeDesktop = isTauriRuntime();
  const nativeFontIds = React.useMemo(
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

  // Styling properties to batch-update across all caption clips on the same track
  const CAPTION_STYLE_KEYS = [
    "fontFamily",
    "fontSize",
    "color",
    "fontWeight",
    "fontStyle",
    "stroke",
    "shadow",
    "background",
    "lineHeight",
    "letterSpacing",
    "align",
    "valign",
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

      originalHandleUpdate(key, value);

      trackCaptions.forEach((c) => {
        if (c.id !== textClip.id) {
          useTimelineStore.getState().updateClip(c.id, { [key]: value });
        }
      });
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

      originalHandleUpdateMultiple(fields);

      const styleFields: Record<string, any> = {};
      Object.entries(fields).forEach(([k, v]) => {
        if (CAPTION_STYLE_KEYS.includes(k)) {
          styleFields[k] = v;
        }
      });

      trackCaptions.forEach((c) => {
        if (c.id !== textClip.id) {
          useTimelineStore.getState().updateClip(c.id, styleFields);
        }
      });
    } else {
      originalHandleUpdateMultiple(fields);
    }
  };

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

  const handleSwitchMode = (newMode: "plain" | "effect" | "template") => {
    const currentMode = mode;
    if (currentMode === newMode) return;

    if (currentMode === "template") {
      const confirmText =
        "Switching to another mode will discard your template layout customizations. Do you want to proceed?";
      if (!window.confirm(confirmText)) return;
    } else if (currentMode === "effect" && newMode === "template") {
      const confirmText =
        "Switching to template mode will discard your text style settings. Do you want to proceed?";
      if (!window.confirm(confirmText)) return;
    }

    if (newMode === "plain") {
      const textContent = textClip.templateId
        ? (customization.layerTexts?.[
            innerTemplate?.layers?.find((l: any) => l.kind === "text")?.id || ""
          ] ??
          customization.primaryText ??
          textClip.text ??
          "")
        : textClip.text;

      handleUpdateMultiple({
        templateId: undefined,
        styleId: undefined,
        styleDefinition: undefined,
        customization: undefined,
        text: textContent,
      });
    } else if (newMode === "effect") {
      const textContent = textClip.templateId
        ? (customization.layerTexts?.[
            innerTemplate?.layers?.find((l: any) => l.kind === "text")?.id || ""
          ] ??
          customization.primaryText ??
          textClip.text ??
          "")
        : textClip.text;

      handleUpdateMultiple({
        templateId: undefined,
        customization: undefined,
        text: textContent,
      });
    } else if (newMode === "template") {
      handleUpdateMultiple({
        styleId: undefined,
        styleDefinition: undefined,
      });
    }
  };

  const handleDetachTemplate = () => {
    handleSwitchMode("plain");
  };

  const handleDetachEffect = () => {
    handleUpdateMultiple({
      styleId: undefined,
      styleDefinition: undefined,
    });
  };

  const handleApplyTemplate = (templateItem: any) => {
    handleUpdateMultiple({
      templateId: templateItem.id,
      // An empty text value is an intentional user value. Do not replace it
      // with a template placeholder while switching modes.
      text: textClip.text ?? "",
      customization: {
        primaryText: textClip.text ?? "",
        secondaryText: "Subtitle",
        accentText: "Accent",
        primaryColor: "#ffffff",
        secondaryColor: "#ffffff",
        layerColors: {},
        layerTexts: {},
        layerFontSizes: {},
        layerFontWeights: {},
      },
    });
  };

  // Quick switch text effects
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

  // Resolve current font weight to a numeric value for the slider
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
  const weightLabel =
    FONT_WEIGHTS.find((w) => w.value === currentWeight)?.label || "Regular";
  const effectiveFontStyle =
    textClip.fontStyle || effectFont?.style || "normal";
  const effectiveLetterSpacing =
    textClip.letterSpacing ?? effectFont?.letterSpacing ?? 0;
  const effectiveLineHeight =
    textClip.lineHeight ?? effectFont?.lineHeight ?? 1.2;

  const handleCustomStyleUpdate = (key: string, value: any) => {
    const updates: Record<string, any> = { [key]: value };
    if (textClip.styleId && key !== "styleId") {
      updates.styleId = undefined;
      updates.styleDefinition = undefined;
    }
    handleUpdateMultiple(updates);
  };

  // Gradient helper states & functions
  const isGradient = (textClip.color || "").includes(",");
  const gradientPresets = [
    "#ffe066, #b38600",
    "#ff3e00, #ff0077, #aa00ff",
    "#ff007f, #aa00ff, #00c8ff, #00ff66",
  ];
  const isPresetGradient = gradientPresets.includes(textClip.color);

  const getStops = () => {
    if (!isGradient) return ["#ffffff", "#000000"];
    return textClip.color.split(",").map((s) => s.trim());
  };

  const handleStopChange = (index: number, newColor: string) => {
    const stops = getStops();
    stops[index] = newColor;
    handleCustomStyleUpdate("color", stops.join(", "));
  };

  const handleAddStop = () => {
    const stops = getStops();
    if (stops.length >= 4) return;
    stops.push("#ffffff");
    handleCustomStyleUpdate("color", stops.join(", "));
  };

  const handleRemoveStop = (index: number) => {
    const stops = getStops();
    if (stops.length <= 2) return;
    stops.splice(index, 1);
    handleCustomStyleUpdate("color", stops.join(", "));
  };

  // Filtered lists for the preset grids
  const allCachedEffects = Object.values(definitions);
  const filteredEffects = allCachedEffects.filter((effect) =>
    effect.name.toLowerCase().includes(effectSearchQuery.toLowerCase()),
  );

  const filteredTemplates = templates.filter((t) => {
    const matchesCat = t.category === templateCategory;
    const matchesSearch = (t.name || t.label || "")
      .toLowerCase()
      .includes(templateSearchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const isTextExceedingMaxDimension = React.useMemo(() => {
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
    <div className="space-y-3">
      {/* Section A: Content Section */}
      {mode === "template" && (
        <div className="space-y-3 p-3 bg-surface-raised/20 border border-border/40 rounded-xl">
          {templateDef ? (
            <>
              <div className="flex items-center justify-between mb-1 select-none">
                <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider block">
                  Active Template: {templateDef.label || templateDef.name}
                </span>
                <button
                  onClick={handleDetachTemplate}
                  className="text-[9px] font-semibold text-red-400 hover:text-red-300 transition-colors"
                >
                  Detach Template
                </button>
              </div>
              <TemplateLayerEditor
                template={innerTemplate!}
                customization={customization}
                onChange={(nextCust) => {
                  const firstTextLayer = innerTemplate?.layers?.find(
                    (l: any) => l.kind === "text",
                  );
                  const primaryTextVal =
                    nextCust.layerTexts?.[firstTextLayer?.id || ""] ??
                    nextCust.primaryText ??
                    textClip.text;

                  handleUpdateMultiple({
                    customization: nextCust,
                    text: primaryTextVal,
                  });
                }}
              />
            </>
          ) : (
            <div className="text-center py-4 select-none">
              <p className="text-xs text-text-muted mb-2">
                No template active.
              </p>
              <p className="text-[10px] text-zinc-500">
                Select a template from the gallery below to apply it.
              </p>
            </div>
          )}
        </div>
      )}

      {mode === "effect" && activeEffectDefinition && (
        <div className="space-y-3">
          <EffectStylePanel
            effectId={textClip.styleId || "custom"}
            effectDefinition={activeEffectDefinition}
            onDetach={handleDetachEffect}
            onChangeEffect={() => {
              const el = document.getElementById("quick-presets-section");
              el?.scrollIntoView({ behavior: "smooth" });
            }}
            isModified={false}
          />
          <div>
            <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider block mb-1.5 select-none">
              Text Content
            </label>
            <textarea
              value={textClip.text || ""}
              onChange={(e) => handleUpdate("text", e.target.value)}
              rows={3}
              placeholder="CLYPRA"
              className="w-full bg-surface-raised border border-border/60 rounded-lg p-2.5 text-xs text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 resize-none selectable transition-colors"
            />
            {isTextExceedingMaxDimension && (
              <div className="mt-1.5 flex items-start gap-1.5 p-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] leading-tight">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>Text exceeds 8192px canvas budget and was clamped.</span>
              </div>
            )}
          </div>
        </div>
      )}

      {mode === "plain" && (
        <div>
          <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider block mb-1.5 select-none">
            Text Content
          </label>
          <textarea
            value={textClip.text || ""}
            onChange={(e) => handleUpdate("text", e.target.value)}
            rows={3}
            placeholder="CLYPRA"
            className="w-full bg-surface-raised border border-border/60 rounded-lg p-2.5 text-xs text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 resize-none selectable transition-colors"
          />
          {isTextExceedingMaxDimension && (
            <div className="mt-1.5 flex items-start gap-1.5 p-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] leading-tight">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Text exceeds 8192px canvas budget and was clamped.</span>
            </div>
          )}
        </div>
      )}

      {/* Section C: Typography (Plain & Effect mode only) */}
      {mode !== "template" && (
        <div className="space-y-3">
          {mode === "effect" && (
            <div className="p-2 bg-amber-500/10 border border-amber-500/25 rounded text-[10px] text-amber-400 select-none">
              Note: Modifying typography will detach from the effect preset.
            </div>
          )}

          {/* Font Family */}
          <div>
            <label className="text-[10px] font-medium text-text-muted block mb-1 select-none">
              Font Family
            </label>
            <select
              value={selectedFont}
              onChange={(e) =>
                handleCustomStyleUpdate("fontFamily", e.target.value)
              }
              className="w-full bg-surface-raised border border-border/60 rounded-md px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_8px_center] pr-7"
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
              <optgroup
                label={nativeDesktop ? "Native Fonts" : "Google Web Fonts"}
              >
                {selectedFontIsUnavailableNatively && (
                  <option value={selectedFont} disabled>
                    {selectedFont} (not supported by native preview)
                  </option>
                )}
                {GOOGLE_FONTS.filter(
                  (font) =>
                    !nativeDesktop ||
                    nativeFontIds.has(font.value.toLowerCase()),
                ).map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            </select>
            {nativeDesktop && (
              <p className="mt-1 text-[10px] text-text-muted">
                Desktop preview supports the bundled native fonts shown here.
              </p>
            )}
          </div>

          {/* Font Size */}
          <PropertySlider
            label="Font Size"
            value={textClip.fontSize || 48}
            min={10}
            max={1000}
            step={1}
            suffix="px"
            onChange={(v) => handleCustomStyleUpdate("fontSize", v)}
          />

          {/* Font Weight */}
          <div>
            <div className="flex justify-between items-center text-[10px] text-text-muted mb-1 select-none">
              <span>Font Weight</span>
              <span className="text-text-primary font-medium">
                {weightLabel} ({currentWeight})
              </span>
            </div>
            <input
              type="range"
              min={100}
              max={900}
              step={100}
              value={currentWeight}
              onChange={(e) =>
                handleCustomStyleUpdate("fontWeight", Number(e.target.value))
              }
              className="w-full h-1.5 rounded-full appearance-none outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(var(--color-accent-raw),0.35)] [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
              style={{
                background: `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${((currentWeight - 100) / 800) * 100}%, var(--color-border) ${((currentWeight - 100) / 800) * 100}%, var(--color-border) 100%)`,
              }}
            />
          </div>

          {/* Font Style + Alignment */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[9px] text-text-muted block select-none">
                Style
              </label>
              <button
                onClick={() =>
                  handleCustomStyleUpdate(
                    "fontStyle",
                    effectiveFontStyle === "italic" ? "normal" : "italic",
                  )
                }
                className={`w-full py-1.5 rounded-md text-xs italic font-medium transition-all cursor-pointer border ${effectiveFontStyle === "italic" ? "bg-accent/15 text-accent border-accent/30" : "bg-surface-raised text-text-muted border-border/60 hover:text-text-primary hover:bg-white/[0.06]"}`}
              >
                Italic
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[9px] text-text-muted block select-none">
                Horizontal Align
              </label>
              <div className="flex gap-0.5 bg-surface-raised border border-border/60 p-0.5 rounded-md">
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
                    className={`flex-1 py-1.5 rounded flex items-center justify-center transition-all cursor-pointer ${(textClip.align || "center") === align ? "bg-accent text-white" : "text-text-muted hover:text-text-primary"}`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Vertical align + letter spacing */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[9px] text-text-muted block select-none">
                Vertical Align
              </label>
              <div className="flex gap-0.5 bg-surface-raised border border-border/60 p-0.5 rounded-md">
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
                    className={`flex-1 py-1.5 rounded flex items-center justify-center transition-all cursor-pointer ${(textClip.valign || "middle") === valign ? "bg-accent text-white" : "text-text-muted hover:text-text-primary"}`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[9px] text-text-muted block select-none">
                Letter Spacing
              </label>
              <input
                type="number"
                value={effectiveLetterSpacing}
                onChange={(e) =>
                  handleCustomStyleUpdate(
                    "letterSpacing",
                    Number(e.target.value),
                  )
                }
                className="w-full bg-surface-raised border border-border/60 rounded-md py-1.5 px-2 text-center text-xs text-text-primary outline-none focus:border-accent tabular-nums selectable"
              />
            </div>
          </div>

          {/* Line Height */}
          <PropertySlider
            label="Line Height"
            value={effectiveLineHeight}
            min={0.5}
            max={3.0}
            step={0.1}
            onChange={(v) => handleCustomStyleUpdate("lineHeight", v)}
          />

          {/* Text Color */}
          <div className="space-y-2 pt-3 border-t border-border/30">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-text-primary select-none">
                Text Color
              </span>
              <div className="flex items-center gap-2">
                <ClypraColorPicker
                  value={isGradient ? "#ffffff" : textClip.color || "#ffffff"}
                  onChange={(c: string) => handleCustomStyleUpdate("color", c)}
                  onChangeComplete={(c: string) =>
                    handleCustomStyleUpdate("color", c)
                  }
                  format="hex"
                  availableModes={["solid", "wheel"]}
                  presetColors={COLOR_PALETTE.filter(
                    (p) => !p.value.includes(","),
                  ).map((p) => p.value)}
                  showAlpha={true}
                  size="sm"
                  triggerClassName="w-28 h-8 min-w-0 overflow-hidden bg-surface-raised border-border/60 hover:border-border shrink-0 [&>div]:min-w-0 [&>div]:max-w-full [&>div]:overflow-hidden [&>div>span]:min-w-0 [&>div>span]:truncate [&>div>span]:whitespace-nowrap"
                  popoverClassName="z-[100]"
                />
              </div>
            </div>
            {isGradient && !isPresetGradient && (
              <div className="space-y-2 p-2.5 bg-zinc-950/40 border border-zinc-800 rounded-lg select-none">
                <div className="flex justify-between items-center text-[10px] text-zinc-400 mb-1">
                  <span>Gradient Stops</span>
                  {getStops().length < 4 && (
                    <button
                      onClick={handleAddStop}
                      className="text-[10px] text-accent hover:underline cursor-pointer"
                    >
                      + Add Stop
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2.5">
                  {getStops().map((stopColor, idx) => (
                    <div key={idx} className="flex items-center gap-1">
                      <ClypraColorPicker
                        value={stopColor}
                        onChange={(c: string) => handleStopChange(idx, c)}
                        onChangeComplete={(c: string) =>
                          handleStopChange(idx, c)
                        }
                        format="hex"
                        availableModes={["solid", "wheel"]}
                        showAlpha={true}
                        size="sm"
                        triggerClassName="w-20 h-7 bg-surface-raised border-border/60 hover:border-border shrink-0"
                        popoverClassName="z-[100]"
                      />
                      {getStops().length > 2 && (
                        <button
                          onClick={() => handleRemoveStop(idx)}
                          className="text-[10px] text-destructive hover:underline cursor-pointer font-bold px-1"
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Section F: Batch Styling (for captions) */}
      {textClip.textRole === "caption" && (
        <div className="flex items-center justify-between p-2.5 bg-surface-raised/35 border border-border/30 rounded-lg select-none">
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-text-primary">
              Apply to all captions
            </span>
            <span className="text-[9px] text-text-muted">
              Broadcast styles to all clips on this track
            </span>
          </div>
          <button
            onClick={() => setApplyToAll(!applyToAll)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${applyToAll ? "bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25" : "bg-surface-raised border border-border/60 text-text-muted hover:text-text-primary hover:bg-white/[0.04]"}`}
          >
            {applyToAll ? "Active" : "Inactive"}
          </button>
        </div>
      )}
    </div>
  );
};
