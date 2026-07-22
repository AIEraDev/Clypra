import React from "react";
import { Type, Palette, AlignLeft, AlignCenter, AlignRight, AlignStartVertical, AlignCenterVertical, AlignEndVertical, Save, Trash2, PaintBucket, Layers, Layout } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { normalizeFontFamily } from "@/core/evaluation/evaluator";
import type { TextEffectDefinition } from "@/features/text-effects/types/types";
import type { TextClip } from "@/types";
import { PropertySlider } from "./primitives/PropertySlider";
import { PropertySection } from "./primitives/PropertySection";
import { useTemplateStore } from "@/features/text-templates/templateStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";
import { TextModeSelector } from "./TextModeSelector";
import { EffectStylePanel } from "./EffectStylePanel";
import { TemplateLayerEditor } from "./TemplateLayerEditor";
import { t, type MessageKey } from "@/i18n";
import { TEMPLATE_CATEGORIES, TEMPLATE_CATEGORY_LABEL_KEYS } from "@/features/text-templates/types";

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

const COLOR_PALETTE = [
  { labelKey: "properties.textStyle.palette.white", value: "#ffffff" },
  { labelKey: "properties.textStyle.palette.black", value: "#1a1a1a" },
  { labelKey: "properties.textStyle.palette.yellow", value: "#ffcc00" },
  { labelKey: "properties.textStyle.palette.red", value: "#ff3b30" },
  { labelKey: "properties.textStyle.palette.pink", value: "#ff2d55" },
  { labelKey: "properties.textStyle.palette.purple", value: "#af52de" },
  { labelKey: "properties.textStyle.palette.blue", value: "#007aff" },
  { labelKey: "properties.textStyle.palette.teal", value: "#00f0ff" },
  { labelKey: "properties.textStyle.palette.green", value: "#34c759" },
  { labelKey: "properties.textStyle.palette.gold", value: "#ffe066, #b38600" },
  { labelKey: "properties.textStyle.palette.sunset", value: "#ff3e00, #ff0077, #aa00ff" },
  { labelKey: "properties.textStyle.palette.ocean", value: "#00c8ff, #00ff66" },
  { labelKey: "properties.textStyle.palette.rainbow", value: "#ff007f, #aa00ff, #00c8ff, #00ff66" },
] as const satisfies ReadonlyArray<{ labelKey: MessageKey; value: string }>;

const FONT_WEIGHTS = [
  { value: 100, labelKey: "properties.textStyle.weight.thin" },
  { value: 200, labelKey: "properties.textStyle.weight.extraLight" },
  { value: 300, labelKey: "properties.textStyle.weight.light" },
  { value: 400, labelKey: "properties.textStyle.weight.regular" },
  { value: 500, labelKey: "properties.textStyle.weight.medium" },
  { value: 600, labelKey: "properties.textStyle.weight.semiBold" },
  { value: 700, labelKey: "properties.textStyle.weight.bold" },
  { value: 800, labelKey: "properties.textStyle.weight.extraBold" },
  { value: 900, labelKey: "properties.textStyle.weight.black" },
] as const satisfies ReadonlyArray<{ value: number; labelKey: MessageKey }>;

const ALIGN_LABEL_KEYS = {
  left: "properties.textStyle.alignLeft",
  center: "properties.textStyle.alignCenter",
  right: "properties.textStyle.alignRight",
  top: "properties.textStyle.alignTop",
  middle: "properties.textStyle.alignMiddle",
  bottom: "properties.textStyle.alignBottom",
} as const satisfies Record<string, MessageKey>;

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

export const TextStyleSection: React.FC<TextStyleSectionProps> = ({ textClip, presets, newPresetName, setNewPresetName, handleUpdate: originalHandleUpdate, handleUpdateMultiple: originalHandleUpdateMultiple, handleApplyPreset, savePreset, deletePreset }) => {
  const [applyToAll, setApplyToAll] = React.useState(false);
  const [effectSearchQuery, setEffectSearchQuery] = React.useState("");
  const [templateSearchQuery, setTemplateSearchQuery] = React.useState("");
  const [templateCategory, setTemplateCategory] = React.useState<string>("lower-third");

  const { templates } = useTemplateStore();
  const { definitions } = useEffectsStore();
  const templateDef = templates.find((t) => t.id === textClip.templateId);
  const innerTemplate = templateDef ? templateDef.templateData || templateDef.lottieData || templateDef : null;

  React.useEffect(() => {
    if (textClip.templateId && templateDef && !templateDef.templateData && !templateDef.lottieData) {
      useTemplateStore.getState().selectTemplate(templateDef);
    }
  }, [textClip.templateId, templateDef]);

  const effectFont = textClip.styleId ? definitions[textClip.styleId]?.font : undefined;
  const activeEffectDefinition = textClip.styleId ? definitions[textClip.styleId] : textClip.styleDefinition;

  // Determine current mode
  const mode = textClip.templateId ? "template" : textClip.styleId ? "effect" : "plain";

  // Styling properties to batch-update across all caption clips on the same track
  const CAPTION_STYLE_KEYS = ["fontFamily", "fontSize", "color", "fontWeight", "fontStyle", "stroke", "shadow", "background", "lineHeight", "letterSpacing", "align", "valign"];

  const handleUpdate = (key: string, value: any) => {
    if (applyToAll && textClip.textRole === "caption" && CAPTION_STYLE_KEYS.includes(key)) {
      const { clips } = useTimelineStore.getState();
      const trackCaptions = clips.filter((c) => c.trackId === textClip.trackId && (c as any).textRole === "caption");

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
    const hasStyleField = Object.keys(fields).some((k) => CAPTION_STYLE_KEYS.includes(k));
    if (applyToAll && textClip.textRole === "caption" && hasStyleField) {
      const { clips } = useTimelineStore.getState();
      const trackCaptions = clips.filter((c) => c.trackId === textClip.trackId && (c as any).textRole === "caption");

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
      const confirmText = t("properties.textStyle.confirmTemplateSwitch");
      if (!window.confirm(confirmText)) return;
    } else if (currentMode === "effect" && newMode === "template") {
      const confirmText = t("properties.textStyle.confirmEffectSwitch");
      if (!window.confirm(confirmText)) return;
    }

    if (newMode === "plain") {
      const textContent = textClip.templateId ? customization.layerTexts?.[innerTemplate?.layers?.find((l: any) => l.kind === "text")?.id || ""] || customization.primaryText || textClip.text || t("properties.textStyle.defaultText") : textClip.text;

      handleUpdateMultiple({
        templateId: undefined,
        styleId: undefined,
        styleDefinition: undefined,
        customization: undefined,
        text: textContent,
      });
    } else if (newMode === "effect") {
      const textContent = textClip.templateId ? customization.layerTexts?.[innerTemplate?.layers?.find((l: any) => l.kind === "text")?.id || ""] || customization.primaryText || textClip.text || t("properties.textStyle.defaultText") : textClip.text;

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
    const title = textClip.text || t("properties.textStyle.defaultTitle");
    handleUpdateMultiple({
      templateId: templateItem.id,
      text: title,
      customization: {
        primaryText: title,
        secondaryText: t("properties.textStyle.defaultSubtitle"),
        accentText: t("properties.textStyle.defaultAccent"),
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
      stroke: effect.strokes?.[0] ? { color: effect.strokes[0].color, width: effect.strokes[0].width } : undefined,
      shadow: effect.shadows?.[0] ? { color: effect.shadows[0].color, blur: effect.shadows[0].blur, offsetX: effect.shadows[0].offsetX ?? 0, offsetY: effect.shadows[0].offsetY ?? 0 } : undefined,
      background: effect.panel
        ? {
            color: effect.panel.color || "rgba(0,0,0,0.6)",
            padding: effect.panel.paddingX !== undefined ? effect.panel.paddingX : 12,
            borderRadius: effect.panel.radius !== undefined ? effect.panel.radius : 6,
          }
        : undefined,
    });
  };

  // Resolve current font weight to a numeric value for the slider
  const effectiveFontWeight = textClip.fontWeight ?? effectFont?.weight;
  const currentWeight = typeof effectiveFontWeight === "number" ? effectiveFontWeight : effectiveFontWeight === "bold" ? 700 : 400;
  const weightLabel = t(FONT_WEIGHTS.find((w) => w.value === currentWeight)?.labelKey || "properties.textStyle.weight.regular");
  const effectiveFontStyle = textClip.fontStyle || effectFont?.style || "normal";
  const effectiveLetterSpacing = textClip.letterSpacing ?? effectFont?.letterSpacing ?? 0;
  const effectiveLineHeight = textClip.lineHeight ?? effectFont?.lineHeight ?? 1.2;

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
  const gradientPresets = ["#ffe066, #b38600", "#ff3e00, #ff0077, #aa00ff", "#ff007f, #aa00ff, #00c8ff, #00ff66"];
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
  const filteredEffects = allCachedEffects.filter((effect) => effect.name.toLowerCase().includes(effectSearchQuery.toLowerCase()));

  const filteredTemplates = templates.filter((t) => {
    const matchesCat = t.category === templateCategory;
    const matchesSearch = (t.name || t.label || "").toLowerCase().includes(templateSearchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div className="space-y-3">
      {/* Mode Selector */}
      <TextModeSelector mode={mode} onSwitch={handleSwitchMode} />

      {/* Section A: Content Section */}
      {mode === "template" && (
        <div className="space-y-3 p-3 bg-surface-raised/20 border border-border/40 rounded-xl">
          {templateDef ? (
            <>
              <div className="flex items-center justify-between mb-1 select-none">
                <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider block">{t("properties.textStyle.activeTemplate", { name: templateDef.label || templateDef.name || templateDef.id })}</span>
                <button onClick={handleDetachTemplate} className="text-[9px] font-semibold text-red-400 hover:text-red-300 transition-colors">
                  {t("properties.textStyle.detachTemplate")}
                </button>
              </div>
              <TemplateLayerEditor
                template={innerTemplate!}
                customization={customization}
                onChange={(nextCust) => {
                  const firstTextLayer = innerTemplate?.layers?.find((l: any) => l.kind === "text");
                  const primaryTextVal = nextCust.layerTexts?.[firstTextLayer?.id || ""] || nextCust.primaryText || textClip.text;

                  handleUpdateMultiple({
                    customization: nextCust,
                    text: primaryTextVal,
                  });
                }}
              />
            </>
          ) : (
            <div className="text-center py-4 select-none">
              <p className="text-xs text-text-muted mb-2">{t("properties.textStyle.noActiveTemplate")}</p>
              <p className="text-[10px] text-zinc-500">{t("properties.textStyle.selectTemplateTip")}</p>
            </div>
          )}
        </div>
      )}

      {mode === "effect" && (
        <div className="space-y-3">
          <EffectStylePanel
            effectId={textClip.styleId || "custom"}
            effectDefinition={activeEffectDefinition}
            onDetach={handleDetachEffect}
            onChangeEffect={() => {
              const el = document.getElementById("quick-presets-section");
              el?.scrollIntoView({ behavior: "smooth" });
            }}
            isModified={false} // Will display detach tips if user changes style properties
          />
          <div>
            <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider block mb-1.5 select-none">{t("properties.textStyle.content")}</label>
            <textarea value={textClip.text || ""} onChange={(e) => handleUpdate("text", e.target.value)} rows={3} placeholder="CLYPRA" className="w-full bg-surface-raised border border-border/60 rounded-lg p-2.5 text-xs text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 resize-none selectable transition-colors" />
          </div>
        </div>
      )}

      {mode === "plain" && (
        <div>
          <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider block mb-1.5 select-none">{t("properties.textStyle.content")}</label>
          <textarea value={textClip.text || ""} onChange={(e) => handleUpdate("text", e.target.value)} rows={3} placeholder="CLYPRA" className="w-full bg-surface-raised border border-border/60 rounded-lg p-2.5 text-xs text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 resize-none selectable transition-colors" />
        </div>
      )}

      {/* Section B: Style Presets (Plain & Effect mode only) */}
      {mode !== "template" && (
        <PropertySection title={t("properties.textStyle.stylePresets")} icon={<Layers className="w-3.5 h-3.5" />} defaultCollapsed>
          <div className="space-y-3">
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
              {presets.map((preset) => (
                <div key={preset.id} className="relative shrink-0 group/preset">
                  <button onClick={() => handleApplyPreset(preset)} className="px-3 py-2 bg-surface-raised hover:bg-surface-raised/80 border border-border/60 hover:border-accent rounded-lg text-xs font-semibold text-text-primary transition-all cursor-pointer whitespace-nowrap" style={{ fontFamily: preset.fontFamily, color: preset.color }}>
                    {preset.name}
                  </button>
                  {preset.isCustom && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deletePreset(preset.id);
                      }}
                      aria-label={t("properties.textStyle.deletePreset", { name: preset.name })}
                      title={t("properties.textStyle.deletePreset", { name: preset.name })}
                      className="absolute -top-1.5 -right-1.5 p-0.5 bg-destructive text-white rounded-full opacity-0 group-hover/preset:opacity-100 transition-opacity hover:bg-destructive/80 cursor-pointer"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-border/30">
              <input type="text" value={newPresetName} onChange={(e) => setNewPresetName(e.target.value)} placeholder={t("properties.textStyle.customStylePlaceholder")} className="flex-1 min-w-0 bg-surface-raised border border-border/60 rounded-md px-2 py-1 text-xs text-text-primary outline-none focus:border-accent selectable" />
              <Button
                size="sm"
                variant="secondary"
                className="flex items-center gap-1 shrink-0"
                aria-label={t("properties.textStyle.savePreset")}
                title={t("properties.textStyle.savePreset")}
                onClick={() => {
                  if (!newPresetName.trim()) return;
                  savePreset(newPresetName.trim(), {
                    fontFamily: textClip.fontFamily,
                    fontSize: textClip.fontSize,
                    fontWeight: textClip.fontWeight,
                    fontStyle: textClip.fontStyle,
                    color: textClip.color,
                    align: textClip.align,
                    valign: textClip.valign,
                    lineHeight: textClip.lineHeight,
                    letterSpacing: textClip.letterSpacing,
                    stroke: textClip.stroke,
                    shadow: textClip.shadow,
                    background: textClip.background,
                  });
                  setNewPresetName("");
                }}
              >
                <Save className="w-3.5 h-3.5" />
                {t("properties.textStyle.savePreset")}
              </Button>
            </div>
          </div>
        </PropertySection>
      )}

      {/* Section C: Typography (Plain & Effect mode only) */}
      {mode !== "template" && (
        <PropertySection title={t("properties.textStyle.typography")} icon={<Type className="w-3.5 h-3.5" />}>
          <div className="space-y-3">
            {mode === "effect" && <div className="p-2 bg-amber-500/10 border border-amber-500/25 rounded text-[10px] text-amber-400 select-none">{t("properties.textStyle.detachTypographyTip")}</div>}

            {/* Font Family */}
            <div>
              <label className="text-[10px] font-medium text-text-muted block mb-1 select-none">{t("properties.textStyle.fontFamily")}</label>
              <select value={normalizeFontFamily(textClip.fontFamily || effectFont?.family || "Inter Variable")} onChange={(e) => handleCustomStyleUpdate("fontFamily", e.target.value)} className="w-full bg-surface-raised border border-border/60 rounded-md px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_8px_center] pr-7">
                <optgroup label={t("properties.textStyle.systemFonts")}>
                  {SYSTEM_FONTS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("properties.textStyle.googleFonts")}>
                  {GOOGLE_FONTS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            {/* Font Size */}
            <PropertySlider label={t("properties.textStyle.fontSize")} value={textClip.fontSize || 48} min={10} max={1000} step={1} suffix="px" onChange={(v) => handleCustomStyleUpdate("fontSize", v)} />

            {/* Font Weight */}
            <div>
              <div className="flex justify-between items-center text-[10px] text-text-muted mb-1 select-none">
                <span>{t("properties.textStyle.fontWeight")}</span>
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
                aria-label={t("properties.textStyle.fontWeight")}
                onChange={(e) => handleCustomStyleUpdate("fontWeight", Number(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(var(--color-accent-raw),0.35)] [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
                style={{
                  background: `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${((currentWeight - 100) / 800) * 100}%, var(--color-border) ${((currentWeight - 100) / 800) * 100}%, var(--color-border) 100%)`,
                }}
              />
            </div>

            {/* Font Style + Alignment */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[9px] text-text-muted block select-none">{t("properties.textStyle.style")}</label>
                <button onClick={() => handleCustomStyleUpdate("fontStyle", effectiveFontStyle === "italic" ? "normal" : "italic")} className={`w-full py-1.5 rounded-md text-xs italic font-medium transition-all cursor-pointer border ${effectiveFontStyle === "italic" ? "bg-accent/15 text-accent border-accent/30" : "bg-surface-raised text-text-muted border-border/60 hover:text-text-primary hover:bg-white/[0.06]"}`}>
                  {t("properties.textStyle.italic")}
                </button>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] text-text-muted block select-none">{t("properties.textStyle.horizontalAlign")}</label>
                <div className="flex gap-0.5 bg-surface-raised border border-border/60 p-0.5 rounded-md">
                  {(
                    [
                      ["left", AlignLeft],
                      ["center", AlignCenter],
                      ["right", AlignRight],
                    ] as const
                  ).map(([align, Icon]) => (
                    <button key={align} onClick={() => handleUpdate("align", align)} aria-label={t(ALIGN_LABEL_KEYS[align])} title={t(ALIGN_LABEL_KEYS[align])} className={`flex-1 py-1.5 rounded flex items-center justify-center transition-all cursor-pointer ${(textClip.align || "center") === align ? "bg-accent text-white" : "text-text-muted hover:text-text-primary"}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Vertical align + letter spacing */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[9px] text-text-muted block select-none">{t("properties.textStyle.verticalAlign")}</label>
                <div className="flex gap-0.5 bg-surface-raised border border-border/60 p-0.5 rounded-md">
                  {(
                    [
                      ["top", AlignStartVertical],
                      ["middle", AlignCenterVertical],
                      ["bottom", AlignEndVertical],
                    ] as const
                  ).map(([valign, Icon]) => (
                    <button key={valign} onClick={() => handleUpdate("valign", valign)} aria-label={t(ALIGN_LABEL_KEYS[valign])} title={t(ALIGN_LABEL_KEYS[valign])} className={`flex-1 py-1.5 rounded flex items-center justify-center transition-all cursor-pointer ${(textClip.valign || "middle") === valign ? "bg-accent text-white" : "text-text-muted hover:text-text-primary"}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] text-text-muted block select-none">{t("properties.textStyle.letterSpacing")}</label>
                <input type="number" value={effectiveLetterSpacing} onChange={(e) => handleCustomStyleUpdate("letterSpacing", Number(e.target.value))} className="w-full bg-surface-raised border border-border/60 rounded-md py-1.5 px-2 text-center text-xs text-text-primary outline-none focus:border-accent tabular-nums selectable" />
              </div>
            </div>

            {/* Line Height */}
            <PropertySlider label={t("properties.textStyle.lineHeight")} value={effectiveLineHeight} min={0.5} max={3.0} step={0.1} onChange={(v) => handleCustomStyleUpdate("lineHeight", v)} />
          </div>
        </PropertySection>
      )}

      {/* Section D: Colors & Effects (Plain & Effect mode only) */}
      {mode !== "template" && (
        <PropertySection title={t("properties.textStyle.colorsEffects")} icon={<Palette className="w-3.5 h-3.5" />}>
          <div className="space-y-3.5">
            {mode === "effect" && <div className="p-2 bg-amber-500/10 border border-amber-500/25 rounded text-[10px] text-amber-400 select-none">{t("properties.textStyle.detachColorsTip")}</div>}

            {/* Text Color */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-text-primary select-none">{t("properties.textStyle.textColor")}</span>
                <div className="flex items-center gap-2">
                  <select
                    value={isPresetGradient ? textClip.color : isGradient ? "custom_gradient" : "solid"}
                    onChange={(e) => {
                      if (e.target.value === "solid") {
                        handleCustomStyleUpdate("color", "#ffffff");
                      } else if (e.target.value === "custom_gradient") {
                        handleCustomStyleUpdate("color", "#ff0000, #0000ff");
                      } else {
                        handleCustomStyleUpdate("color", e.target.value);
                      }
                    }}
                    className="bg-surface-raised border border-border/60 rounded text-[10px] py-1 px-1.5 text-text-muted outline-none cursor-pointer"
                  >
                    <option value="solid">{t("properties.textStyle.solidColor")}</option>
                    <option value="#ffe066, #b38600">{t("properties.textStyle.gradient.gold")}</option>
                    <option value="#ff3e00, #ff0077, #aa00ff">{t("properties.textStyle.gradient.sunset")}</option>
                    <option value="#ff007f, #aa00ff, #00c8ff, #00ff66">{t("properties.textStyle.gradient.rainbow")}</option>
                    <option value="custom_gradient">{t("properties.textStyle.gradient.custom")}</option>
                  </select>
                  <input type="color" value={isGradient ? "#ffffff" : textClip.color || "#ffffff"} onChange={(e) => handleCustomStyleUpdate("color", e.target.value)} aria-label={t("properties.textStyle.customColor", { label: t("properties.textStyle.textColor") })} title={t("properties.textStyle.customColor", { label: t("properties.textStyle.textColor") })} className="w-7 h-7 bg-transparent border-0 cursor-pointer rounded overflow-hidden" />
                </div>
              </div>

              {/* Custom Gradient Stops */}
              {isGradient && !isPresetGradient && (
                <div className="space-y-2 p-2.5 bg-zinc-950/40 border border-zinc-800 rounded-lg select-none">
                  <div className="flex justify-between items-center text-[10px] text-zinc-400 mb-1">
                    <span>{t("properties.textStyle.gradientStops")}</span>
                    {getStops().length < 4 && (
                      <button onClick={handleAddStop} className="text-[10px] text-accent hover:underline cursor-pointer">
                        {t("properties.textStyle.addStop")}
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2.5">
                    {getStops().map((stopColor, idx) => (
                      <div key={idx} className="flex items-center gap-1">
                        <input type="color" value={stopColor} onChange={(e) => handleStopChange(idx, e.target.value)} aria-label={t("properties.textStyle.colorStop", { index: idx + 1 })} title={t("properties.textStyle.colorStop", { index: idx + 1 })} className="w-6 h-6 bg-transparent border-0 cursor-pointer rounded overflow-hidden" />
                        {getStops().length > 2 && (
                          <button onClick={() => handleRemoveStop(idx)} aria-label={t("properties.textStyle.removeStop", { index: idx + 1 })} title={t("properties.textStyle.removeStop", { index: idx + 1 })} className="text-[10px] text-destructive hover:underline cursor-pointer font-bold px-1">
                            &times;
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick Color Palette */}
              <div className="flex flex-wrap gap-1.5 pt-1 justify-start">
                {COLOR_PALETTE.map((p, idx) => {
                  const isGrad = p.value.includes(",");
                  const style: React.CSSProperties = isGrad ? { background: `linear-gradient(135deg, ${p.value})` } : { backgroundColor: p.value };
                  const isSelected = textClip.color === p.value;

                  const label = t(p.labelKey);
                  return <button key={idx} onClick={() => handleCustomStyleUpdate("color", p.value)} className={`w-6 h-6 rounded-full border cursor-pointer hover:scale-110 active:scale-95 transition-all focus:outline-none ${isSelected ? "border-accent ring-2 ring-accent/30 scale-105" : "border-border/60 hover:border-text-primary"}`} style={style} aria-label={label} title={label} />;
                })}
              </div>
            </div>

            {/* Stroke / Outline */}
            <div className="border-t border-border/30 pt-3 space-y-2">
              <div className="flex items-center justify-between select-none">
                <span className="text-[10px] font-medium text-text-primary">{t("properties.textStyle.outlineStroke")}</span>
                <button
                  onClick={() => {
                    if (textClip.stroke) {
                      handleCustomStyleUpdate("stroke", null);
                    } else {
                      handleCustomStyleUpdate("stroke", { color: "#000000", width: 4 });
                    }
                  }}
                  className={`px-2 py-0.5 text-[9px] font-medium rounded-full transition-all cursor-pointer ${textClip.stroke ? "bg-accent/15 text-accent border border-accent/30" : "bg-surface-raised text-text-muted border border-border/60 hover:text-text-primary"}`}
                >
                  {textClip.stroke ? t("properties.textStyle.enabled") : t("properties.textStyle.disabled")}
                </button>
              </div>

              {textClip.stroke && (
                <div className="space-y-2.5 p-2.5 bg-surface-raised/30 border border-border/30 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-text-muted">{t("properties.textStyle.color")}</span>
                    <div className="flex items-center gap-1.5">
                      {["#000000", "#ffffff", "#ff3b30", "#ffcc00"].map((c, idx) => (
                        <button key={idx} onClick={() => handleCustomStyleUpdate("stroke", { ...textClip.stroke, color: c })} aria-label={t("properties.textStyle.colorValue", { label: t("properties.textStyle.outlineStroke"), value: c })} title={t("properties.textStyle.colorValue", { label: t("properties.textStyle.outlineStroke"), value: c })} className={`w-4 h-4 rounded-full border cursor-pointer transition-all ${textClip.stroke?.color === c ? "ring-2 ring-accent/40 border-accent" : "border-border/60"}`} style={{ backgroundColor: c }} />
                      ))}
                      <input type="color" value={textClip.stroke.color} onChange={(e) => handleCustomStyleUpdate("stroke", { ...textClip.stroke, color: e.target.value })} aria-label={t("properties.textStyle.customColor", { label: t("properties.textStyle.outlineStroke") })} title={t("properties.textStyle.customColor", { label: t("properties.textStyle.outlineStroke") })} className="w-5 h-5 bg-transparent border-0 cursor-pointer" />
                    </div>
                  </div>
                  <PropertySlider label={t("properties.textStyle.thickness")} value={textClip.stroke.width} min={1} max={15} step={1} suffix="px" onChange={(v) => handleCustomStyleUpdate("stroke", { ...textClip.stroke, width: v })} compact />
                </div>
              )}
            </div>

            {/* Shadow / Outer Glow */}
            <div className="border-t border-border/30 pt-3 space-y-2">
              <div className="flex items-center justify-between select-none">
                <span className="text-[10px] font-medium text-text-primary">{t("properties.textStyle.outerGlowShadow")}</span>
                <button
                  onClick={() => {
                    if (textClip.shadow) {
                      handleCustomStyleUpdate("shadow", null);
                    } else {
                      handleCustomStyleUpdate("shadow", { color: "#ff0000", blur: 15, offsetX: 0, offsetY: 0 });
                    }
                  }}
                  className={`px-2 py-0.5 text-[9px] font-medium rounded-full transition-all cursor-pointer ${textClip.shadow ? "bg-accent/15 text-accent border border-accent/30" : "bg-surface-raised text-text-muted border border-border/60 hover:text-text-primary"}`}
                >
                  {textClip.shadow ? t("properties.textStyle.enabled") : t("properties.textStyle.disabled")}
                </button>
              </div>

              {textClip.shadow && (
                <div className="space-y-2.5 p-2.5 bg-surface-raised/30 border border-border/30 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-text-muted">{t("properties.textStyle.color")}</span>
                    <div className="flex items-center gap-1.5">
                      {["#ff0000", "#ff007f", "#00f0ff", "#ffe066"].map((c, idx) => (
                        <button key={idx} onClick={() => handleCustomStyleUpdate("shadow", { ...textClip.shadow, color: c })} aria-label={t("properties.textStyle.colorValue", { label: t("properties.textStyle.outerGlowShadow"), value: c })} title={t("properties.textStyle.colorValue", { label: t("properties.textStyle.outerGlowShadow"), value: c })} className={`w-4 h-4 rounded-full border cursor-pointer transition-all ${textClip.shadow?.color === c ? "ring-2 ring-accent/40 border-accent" : "border-border/60"}`} style={{ backgroundColor: c }} />
                      ))}
                      <input type="color" value={textClip.shadow.color} onChange={(e) => handleCustomStyleUpdate("shadow", { ...textClip.shadow, color: e.target.value })} aria-label={t("properties.textStyle.customColor", { label: t("properties.textStyle.outerGlowShadow") })} title={t("properties.textStyle.customColor", { label: t("properties.textStyle.outerGlowShadow") })} className="w-5 h-5 bg-transparent border-0 cursor-pointer" />
                    </div>
                  </div>
                  <PropertySlider label={t("properties.textStyle.blurRadius")} value={textClip.shadow.blur} min={1} max={30} step={1} suffix="px" onChange={(v) => handleCustomStyleUpdate("shadow", { ...textClip.shadow, blur: v })} compact />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] text-text-muted block mb-0.5 select-none">{t("properties.textStyle.offsetX")}</label>
                      <input type="number" value={textClip.shadow.offsetX} onChange={(e) => handleCustomStyleUpdate("shadow", { ...textClip.shadow, offsetX: Number(e.target.value) })} className="w-full bg-surface-raised border border-border/60 text-center rounded-md py-0.5 text-xs text-text-primary outline-none focus:border-accent tabular-nums selectable" />
                    </div>
                    <div>
                      <label className="text-[9px] text-text-muted block mb-0.5 select-none">{t("properties.textStyle.offsetY")}</label>
                      <input type="number" value={textClip.shadow.offsetY} onChange={(e) => handleCustomStyleUpdate("shadow", { ...textClip.shadow, offsetY: Number(e.target.value) })} className="w-full bg-surface-raised border border-border/60 text-center rounded-md py-0.5 text-xs text-text-primary outline-none focus:border-accent tabular-nums selectable" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Background Box */}
            <div className="border-t border-border/30 pt-3 space-y-2">
              <div className="flex items-center justify-between select-none">
                <span className="text-[10px] font-medium text-text-primary">{t("properties.textStyle.backgroundBox")}</span>
                <button
                  onClick={() => {
                    if (textClip.background) {
                      handleCustomStyleUpdate("background", null);
                    } else {
                      handleCustomStyleUpdate("background", { color: "rgba(0,0,0,0.6)", padding: 12, borderRadius: 6 });
                    }
                  }}
                  className={`px-2 py-0.5 text-[9px] font-medium rounded-full transition-all cursor-pointer ${textClip.background ? "bg-accent/15 text-accent border border-accent/30" : "bg-surface-raised text-text-muted border border-border/60 hover:text-text-primary"}`}
                >
                  {textClip.background ? t("properties.textStyle.enabled") : t("properties.textStyle.disabled")}
                </button>
              </div>

              {textClip.background && (
                <div className="space-y-2.5 p-2.5 bg-surface-raised/30 border border-border/30 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-text-muted">{t("properties.textStyle.boxColor")}</span>
                    <div className="flex items-center gap-1.5">
                      {["rgba(0,0,0,0.6)", "rgba(255,255,255,0.2)", "rgba(0,122,255,0.3)", "rgba(255,59,48,0.3)"].map((c, idx) => (
                        <button key={idx} onClick={() => handleCustomStyleUpdate("background", { ...textClip.background, color: c })} aria-label={t("properties.textStyle.colorValue", { label: t("properties.textStyle.backgroundBox"), value: c })} title={t("properties.textStyle.colorValue", { label: t("properties.textStyle.backgroundBox"), value: c })} className={`w-4 h-4 rounded-full border cursor-pointer transition-all ${textClip.background?.color === c ? "ring-2 ring-accent/40 border-accent" : "border-border/60"}`} style={{ backgroundColor: c }} />
                      ))}
                      <input type="color" value={textClip.background.color.startsWith("rgba") ? "#000000" : textClip.background.color} onChange={(e) => handleCustomStyleUpdate("background", { ...textClip.background, color: e.target.value })} aria-label={t("properties.textStyle.customColor", { label: t("properties.textStyle.backgroundBox") })} title={t("properties.textStyle.customColor", { label: t("properties.textStyle.backgroundBox") })} className="w-5 h-5 bg-transparent border-0 cursor-pointer" />
                    </div>
                  </div>
                  <PropertySlider label={t("properties.textStyle.padding")} value={textClip.background.padding} min={0} max={30} step={1} suffix="px" onChange={(v) => handleCustomStyleUpdate("background", { ...textClip.background, padding: v })} compact />
                  <PropertySlider label={t("properties.textStyle.borderRadius")} value={textClip.background.borderRadius} min={0} max={25} step={1} suffix="px" onChange={(v) => handleCustomStyleUpdate("background", { ...textClip.background, borderRadius: v })} compact />
                </div>
              )}
            </div>
          </div>
        </PropertySection>
      )}

      {/* Section E: Quick Presets (Plain & Effect mode) OR Template Gallery (Template mode) */}
      {mode !== "template" ? (
        <div id="quick-presets-section">
          <PropertySection title={t("properties.textStyle.presetEffects")} icon={<PaintBucket className="w-3.5 h-3.5" />} defaultCollapsed={mode === "plain"}>
            <div className="space-y-3 select-none">
              {/* Search filter */}
              <input type="text" placeholder={t("properties.textStyle.searchEffects")} value={effectSearchQuery} onChange={(e) => setEffectSearchQuery(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-md py-1 px-2 text-xs text-white outline-none focus:border-violet-500" />

              {filteredEffects.length === 0 ? (
                <p className="text-[10px] text-text-muted text-center py-2">{t("properties.textStyle.noMatchingEffects")}</p>
              ) : (
                <div className="grid grid-cols-3 gap-1.5 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                  {filteredEffects.map((effect) => (
                    <button
                      key={effect.id}
                      onClick={() => applyEffectPreset(effect)}
                      className={`p-2 rounded-lg border text-center truncate text-[10px] font-bold shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all cursor-pointer max-w-full ${textClip.styleId === effect.id ? "bg-violet-600/20 text-violet-400 border-violet-500" : "bg-surface-raised border-border/60 hover:border-violet-500/50"}`}
                      style={{
                        fontFamily: effect.font.family,
                        color: effect.fills?.[0]?.color ?? "#ffffff",
                        textShadow: effect.shadows?.[0] ? `0 0 4px ${effect.shadows[0].color}` : effect.glows?.[0] ? `0 0 4px ${effect.glows[0].color}` : "none",
                      }}
                    >
                      {effect.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </PropertySection>
        </div>
      ) : (
        <PropertySection title={t("properties.textStyle.templateGallery")} icon={<PaintBucket className="w-3.5 h-3.5" />}>
          <div className="space-y-3 select-none">
            {/* Category selection */}
            <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
              {TEMPLATE_CATEGORIES.map((cat) => (
                <button key={cat} onClick={() => setTemplateCategory(cat)} className={`px-2 py-1 rounded text-[10px] capitalize font-medium transition-all shrink-0 ${templateCategory === cat ? "bg-amber-600/20 text-amber-400 border border-amber-500/30" : "bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200"}`}>
                  {t(TEMPLATE_CATEGORY_LABEL_KEYS[cat])}
                </button>
              ))}
            </div>

            {/* Search filter */}
            <input type="text" placeholder={t("properties.textStyle.searchTemplates")} value={templateSearchQuery} onChange={(e) => setTemplateSearchQuery(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-md py-1 px-2 text-xs text-white outline-none focus:border-amber-500" />

            {filteredTemplates.length === 0 ? (
              <p className="text-[10px] text-text-muted text-center py-2">{t("properties.textStyle.noMatchingTemplates")}</p>
            ) : (
              <div className="grid grid-cols-3 gap-1.5 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                {filteredTemplates.map((tpl) => {
                  const isSelected = textClip.templateId === tpl.id;
                  return (
                    <button key={tpl.id} onClick={() => handleApplyTemplate(tpl)} className={`p-1.5 rounded-lg border text-center transition-all cursor-pointer flex flex-col items-center justify-between ${isSelected ? "bg-amber-500/10 border-amber-500 text-amber-400" : "bg-surface-raised border-border/60 hover:border-amber-500/50 hover:text-text-primary"}`}>
                      <div className="w-full aspect-video rounded bg-zinc-950 flex items-center justify-center overflow-hidden mb-1 relative border border-border/30">{tpl.thumbnail ? <img src={tpl.thumbnail} alt={tpl.label} className="w-full h-full object-cover" /> : <Layout className="w-4 h-4 text-zinc-600" />}</div>
                      <span className="block truncate text-[9px] w-full text-center leading-tight">{tpl.label || tpl.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </PropertySection>
      )}

      {/* Section F: Batch Styling (for captions) */}
      {textClip.textRole === "caption" && (
        <div className="flex items-center justify-between p-2.5 bg-surface-raised/35 border border-border/30 rounded-lg select-none">
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-text-primary">{t("properties.textStyle.applyAllCaptions")}</span>
            <span className="text-[9px] text-text-muted">{t("properties.textStyle.applyAllCaptionsTip")}</span>
          </div>
          <button onClick={() => setApplyToAll(!applyToAll)} className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${applyToAll ? "bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25" : "bg-surface-raised border border-border/60 text-text-muted hover:text-text-primary hover:bg-white/[0.04]"}`}>
            {applyToAll ? t("properties.textStyle.active") : t("properties.textStyle.inactive")}
          </button>
        </div>
      )}
    </div>
  );
};
