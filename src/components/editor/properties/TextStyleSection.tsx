import React from "react";
import { Type, Palette, AlignLeft, AlignCenter, AlignRight, AlignStartVertical, AlignCenterVertical, AlignEndVertical, Save, Trash2, PaintBucket, Layers } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { normalizeFontFamily } from "@/core/evaluation/evaluator";
import { allTextEffects } from "@/features/text-effects/registry";
import type { TextEffectDefinition } from "@/features/text-effects/types/types";
import type { TextClip } from "@/types";
import { PropertySlider } from "./primitives/PropertySlider";
import { PropertySection } from "./primitives/PropertySection";
import { useTemplateStore } from "@/features/text-templates/templateStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";

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
  const { templates } = useTemplateStore();
  const templateDef = templates.find((t) => t.id === textClip.templateId);
  const effectFont = textClip.styleId ? useEffectsStore.getState().definitions[textClip.styleId]?.font : undefined;

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
    if (applyToAll && textClip.textRole === "caption" && CAPTION_STYLE_KEYS.includes(key)) {
      const { clips } = useTimelineStore.getState();
      const trackCaptions = clips.filter(
        (c) => c.trackId === textClip.trackId && (c as any).textRole === "caption"
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
    const hasStyleField = Object.keys(fields).some(k => CAPTION_STYLE_KEYS.includes(k));
    if (applyToAll && textClip.textRole === "caption" && hasStyleField) {
      const { clips } = useTimelineStore.getState();
      const trackCaptions = clips.filter(
        (c) => c.trackId === textClip.trackId && (c as any).textRole === "caption"
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
  };

  const updateCustomizationField = (key: string, value: any) => {
    const nextCustomization = {
      ...customization,
      [key]: value
    };
    const updates: Record<string, any> = {
      customization: nextCustomization
    };
    if (key === "primaryText") {
      updates.text = value;
    }
    handleUpdateMultiple(updates);
  };

  const textLayers = templateDef?.textLayers || [
    { role: "primary", defaultText: "Title", layerName: "Primary" },
    { role: "secondary", defaultText: "Subtitle", layerName: "Secondary" },
    { role: "accent", defaultText: "Accent", layerName: "Accent" }
  ];

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
  const weightLabel = FONT_WEIGHTS.find((w) => w.value === currentWeight)?.label || "Regular";
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

  return (
    <div className="space-y-3">
      {/* Text Content */}
      {textClip.templateId ? (
        <div className="space-y-3 p-3 bg-surface-raised/20 border border-border/40 rounded-xl">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold text-accent uppercase tracking-wider block select-none">
              Template Customization
            </span>
          </div>

          {/* Text Inputs */}
          {textLayers.map((layer) => {
            const roleKey = layer.role === "primary" ? "primaryText" : layer.role === "secondary" ? "secondaryText" : "accentText";
            const label = layer.role === "primary" ? "Primary Text" : layer.role === "secondary" ? "Secondary Text" : "Accent Text";
            const val = customization[roleKey] || "";

            return (
              <div key={layer.role} className="space-y-1">
                <label className="text-[9px] font-medium text-text-muted select-none">
                  {label} ({layer.layerName})
                </label>
                <input
                  type="text"
                  value={val}
                  onChange={(e) => updateCustomizationField(roleKey, e.target.value)}
                  className="w-full bg-surface-raised border border-border/60 rounded-md px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent selectable"
                  placeholder={layer.defaultText}
                />
              </div>
            );
          })}

          <hr className="border-border/40 my-2" />

          {/* Color Inputs */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] font-medium text-text-muted select-none block mb-1">
                Primary Color
              </label>
              <div className="flex items-center gap-1.5 font-mono">
                <input
                  type="color"
                  value={customization.primaryColor || "#ffffff"}
                  onChange={(e) => updateCustomizationField("primaryColor", e.target.value)}
                  className="w-8 h-8 bg-transparent border-0 cursor-pointer rounded overflow-hidden"
                />
                <span className="text-[10px] text-text-muted">
                  {customization.primaryColor || "#ffffff"}
                </span>
              </div>
            </div>
            <div>
              <label className="text-[9px] font-medium text-text-muted select-none block mb-1">
                Secondary Color
              </label>
              <div className="flex items-center gap-1.5 font-mono">
                <input
                  type="color"
                  value={customization.secondaryColor || "#ffffff"}
                  onChange={(e) => updateCustomizationField("secondaryColor", e.target.value)}
                  className="w-8 h-8 bg-transparent border-0 cursor-pointer rounded overflow-hidden"
                />
                <span className="text-[10px] text-text-muted">
                  {customization.secondaryColor || "#ffffff"}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider block mb-1.5 select-none">Text Content</label>
          <textarea value={textClip.text || ""} onChange={(e) => handleUpdate("text", e.target.value)} rows={3} placeholder="CLYPRA" className="w-full bg-surface-raised border border-border/60 rounded-lg p-2.5 text-xs text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 resize-none selectable transition-colors" />
        </div>
      )}

      {/* Style Presets */}
      <PropertySection title="Style Presets" icon={<Layers className="w-3.5 h-3.5" />} defaultCollapsed>
        <div className="space-y-3">
          {/* Horizontal preset carousel */}
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
                    className="absolute -top-1.5 -right-1.5 p-0.5 bg-destructive text-white rounded-full opacity-0 group-hover/preset:opacity-100 transition-opacity hover:bg-destructive/80 cursor-pointer"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Save Current Style */}
          <div className="flex items-center gap-2 pt-2 border-t border-border/30">
            <input type="text" value={newPresetName} onChange={(e) => setNewPresetName(e.target.value)} placeholder="Custom style name..." className="flex-1 min-w-0 bg-surface-raised border border-border/60 rounded-md px-2 py-1 text-xs text-text-primary outline-none focus:border-accent selectable" />
            <Button
              size="sm"
              variant="secondary"
              className="flex items-center gap-1 shrink-0"
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
              Save
            </Button>
          </div>
        </div>
      </PropertySection>

      {/* Typography */}
      <PropertySection title="Typography" icon={<Type className="w-3.5 h-3.5" />}>
        <div className="space-y-3">
          {/* Font Family */}
          <div>
            <label className="text-[10px] font-medium text-text-muted block mb-1 select-none">Font Family</label>
            <select value={normalizeFontFamily(textClip.fontFamily || effectFont?.family || "Inter Variable")} onChange={(e) => handleCustomStyleUpdate("fontFamily", e.target.value)} className="w-full bg-surface-raised border border-border/60 rounded-md px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_8px_center] pr-7">
              <optgroup label="System Fonts">
                {SYSTEM_FONTS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Google Web Fonts">
                {GOOGLE_FONTS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Font Size */}
          <PropertySlider label="Font Size" value={textClip.fontSize || 48} min={10} max={150} step={1} suffix="px" onChange={(v) => handleCustomStyleUpdate("fontSize", v)} />

          {/* Font Weight (numeric slider instead of just Bold toggle) */}
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
              onChange={(e) => handleCustomStyleUpdate("fontWeight", Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(var(--color-accent-raw),0.35)] [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
              style={{
                background: `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${((currentWeight - 100) / 800) * 100}%, var(--color-border) ${((currentWeight - 100) / 800) * 100}%, var(--color-border) 100%)`,
              }}
            />
          </div>

          {/* Font Style + Alignment */}
          <div className="grid grid-cols-2 gap-3">
            {/* Italic toggle */}
            <div className="space-y-1">
              <label className="text-[9px] text-text-muted block select-none">Style</label>
              <button onClick={() => handleCustomStyleUpdate("fontStyle", effectiveFontStyle === "italic" ? "normal" : "italic")} className={`w-full py-1.5 rounded-md text-xs italic font-medium transition-all cursor-pointer border ${effectiveFontStyle === "italic" ? "bg-accent/15 text-accent border-accent/30" : "bg-surface-raised text-text-muted border-border/60 hover:text-text-primary hover:bg-white/[0.06]"}`}>
                Italic
              </button>
            </div>

            {/* Horizontal Align */}
            <div className="space-y-1">
              <label className="text-[9px] text-text-muted block select-none">Horizontal Align</label>
              <div className="flex gap-0.5 bg-surface-raised border border-border/60 p-0.5 rounded-md">
                {(
                  [
                    ["left", AlignLeft],
                    ["center", AlignCenter],
                    ["right", AlignRight],
                  ] as const
                ).map(([align, Icon]) => (
                  <button key={align} onClick={() => handleUpdate("align", align)} className={`flex-1 py-1.5 rounded flex items-center justify-center transition-all cursor-pointer ${(textClip.align || "center") === align ? "bg-accent text-white" : "text-text-muted hover:text-text-primary"}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Vertical align + letter spacing */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[9px] text-text-muted block select-none">Vertical Align</label>
              <div className="flex gap-0.5 bg-surface-raised border border-border/60 p-0.5 rounded-md">
                {(
                  [
                    ["top", AlignStartVertical],
                    ["middle", AlignCenterVertical],
                    ["bottom", AlignEndVertical],
                  ] as const
                ).map(([valign, Icon]) => (
                  <button key={valign} onClick={() => handleUpdate("valign", valign)} className={`flex-1 py-1.5 rounded flex items-center justify-center transition-all cursor-pointer ${(textClip.valign || "middle") === valign ? "bg-accent text-white" : "text-text-muted hover:text-text-primary"}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[9px] text-text-muted block select-none">Letter Spacing</label>
              <input type="number" value={effectiveLetterSpacing} onChange={(e) => handleCustomStyleUpdate("letterSpacing", Number(e.target.value))} className="w-full bg-surface-raised border border-border/60 rounded-md py-1.5 px-2 text-center text-xs text-text-primary outline-none focus:border-accent tabular-nums selectable" />
            </div>
          </div>

          {/* Line Height — was missing from UI! */}
          <PropertySlider label="Line Height" value={effectiveLineHeight} min={0.5} max={3.0} step={0.1} onChange={(v) => handleCustomStyleUpdate("lineHeight", v)} />
        </div>
      </PropertySection>

      {/* Color & Style Customizers */}
      <PropertySection title="Colors & Effects" icon={<Palette className="w-3.5 h-3.5" />}>
        <div className="space-y-3.5">
          {/* Text Color */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-text-primary select-none">Text Color</span>
              <div className="flex items-center gap-2">
                <select
                  value={(textClip.color || "#ffffff").includes(",") ? textClip.color : "solid"}
                  onChange={(e) => {
                    if (e.target.value !== "solid") {
                      handleCustomStyleUpdate("color", e.target.value);
                    }
                  }}
                  className="bg-surface-raised border border-border/60 rounded text-[10px] py-1 px-1.5 text-text-muted outline-none cursor-pointer"
                >
                  <option value="solid">Solid Color</option>
                  <option value="#ffe066, #b38600">Gold Gradient</option>
                  <option value="#ff3e00, #ff0077, #aa00ff">Sunset Gradient</option>
                  <option value="#ff007f, #aa00ff, #00c8ff, #00ff66">Rainbow Gradient</option>
                </select>
                <input type="color" value={(textClip.color || "#ffffff").includes(",") ? "#ffffff" : textClip.color || "#ffffff"} onChange={(e) => handleCustomStyleUpdate("color", e.target.value)} className="w-7 h-7 bg-transparent border-0 cursor-pointer rounded overflow-hidden" />
              </div>
            </div>

            {/* Quick Color Palette */}
            <div className="flex flex-wrap gap-1.5 pt-1 justify-start">
              {COLOR_PALETTE.map((p, idx) => {
                const isGrad = p.value.includes(",");
                const style: React.CSSProperties = isGrad ? { background: `linear-gradient(135deg, ${p.value})` } : { backgroundColor: p.value };
                const isSelected = textClip.color === p.value;

                return <button key={idx} onClick={() => handleCustomStyleUpdate("color", p.value)} className={`w-6 h-6 rounded-full border cursor-pointer hover:scale-110 active:scale-95 transition-all focus:outline-none ${isSelected ? "border-accent ring-2 ring-accent/30 scale-105" : "border-border/60 hover:border-text-primary"}`} style={style} title={p.label} />;
              })}
            </div>
          </div>

          {/* Stroke / Outline */}
          <div className="border-t border-border/30 pt-3 space-y-2">
            <div className="flex items-center justify-between select-none">
              <span className="text-[10px] font-medium text-text-primary">Outline / Stroke</span>
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
                {textClip.stroke ? "ON" : "OFF"}
              </button>
            </div>

            {textClip.stroke && (
              <div className="space-y-2.5 p-2.5 bg-surface-raised/30 border border-border/30 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-muted">Color</span>
                  <div className="flex items-center gap-1.5">
                    {["#000000", "#ffffff", "#ff3b30", "#ffcc00"].map((c, idx) => (
                      <button key={idx} onClick={() => handleCustomStyleUpdate("stroke", { ...textClip.stroke, color: c })} className={`w-4 h-4 rounded-full border cursor-pointer transition-all ${textClip.stroke?.color === c ? "ring-2 ring-accent/40 border-accent" : "border-border/60"}`} style={{ backgroundColor: c }} />
                    ))}
                    <input type="color" value={textClip.stroke.color} onChange={(e) => handleCustomStyleUpdate("stroke", { ...textClip.stroke, color: e.target.value })} className="w-5 h-5 bg-transparent border-0 cursor-pointer" />
                  </div>
                </div>
                <PropertySlider label="Thickness" value={textClip.stroke.width} min={1} max={15} step={1} suffix="px" onChange={(v) => handleCustomStyleUpdate("stroke", { ...textClip.stroke, width: v })} compact />
              </div>
            )}
          </div>

          {/* Shadow / Outer Glow */}
          <div className="border-t border-border/30 pt-3 space-y-2">
            <div className="flex items-center justify-between select-none">
              <span className="text-[10px] font-medium text-text-primary">Outer Glow / Shadow</span>
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
                {textClip.shadow ? "ON" : "OFF"}
              </button>
            </div>

            {textClip.shadow && (
              <div className="space-y-2.5 p-2.5 bg-surface-raised/30 border border-border/30 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-muted">Color</span>
                  <div className="flex items-center gap-1.5">
                    {["#ff0000", "#ff007f", "#00f0ff", "#ffe066"].map((c, idx) => (
                      <button key={idx} onClick={() => handleCustomStyleUpdate("shadow", { ...textClip.shadow, color: c })} className={`w-4 h-4 rounded-full border cursor-pointer transition-all ${textClip.shadow?.color === c ? "ring-2 ring-accent/40 border-accent" : "border-border/60"}`} style={{ backgroundColor: c }} />
                    ))}
                    <input type="color" value={textClip.shadow.color} onChange={(e) => handleCustomStyleUpdate("shadow", { ...textClip.shadow, color: e.target.value })} className="w-5 h-5 bg-transparent border-0 cursor-pointer" />
                  </div>
                </div>
                <PropertySlider label="Blur Radius" value={textClip.shadow.blur} min={1} max={30} step={1} suffix="px" onChange={(v) => handleCustomStyleUpdate("shadow", { ...textClip.shadow, blur: v })} compact />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] text-text-muted block mb-0.5 select-none">Offset X</label>
                    <input type="number" value={textClip.shadow.offsetX} onChange={(e) => handleCustomStyleUpdate("shadow", { ...textClip.shadow, offsetX: Number(e.target.value) })} className="w-full bg-surface-raised border border-border/60 text-center rounded-md py-0.5 text-xs text-text-primary outline-none focus:border-accent tabular-nums selectable" />
                  </div>
                  <div>
                    <label className="text-[9px] text-text-muted block mb-0.5 select-none">Offset Y</label>
                    <input type="number" value={textClip.shadow.offsetY} onChange={(e) => handleCustomStyleUpdate("shadow", { ...textClip.shadow, offsetY: Number(e.target.value) })} className="w-full bg-surface-raised border border-border/60 text-center rounded-md py-0.5 text-xs text-text-primary outline-none focus:border-accent tabular-nums selectable" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Background Box */}
          <div className="border-t border-border/30 pt-3 space-y-2">
            <div className="flex items-center justify-between select-none">
              <span className="text-[10px] font-medium text-text-primary">Background Box</span>
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
                {textClip.background ? "ON" : "OFF"}
              </button>
            </div>

            {textClip.background && (
              <div className="space-y-2.5 p-2.5 bg-surface-raised/30 border border-border/30 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-muted">Box Color</span>
                  <div className="flex items-center gap-1.5">
                    {["rgba(0,0,0,0.6)", "rgba(255,255,255,0.2)", "rgba(0,122,255,0.3)", "rgba(255,59,48,0.3)"].map((c, idx) => (
                      <button key={idx} onClick={() => handleCustomStyleUpdate("background", { ...textClip.background, color: c })} className={`w-4 h-4 rounded-full border cursor-pointer transition-all ${textClip.background?.color === c ? "ring-2 ring-accent/40 border-accent" : "border-border/60"}`} style={{ backgroundColor: c }} />
                    ))}
                    <input type="color" value={textClip.background.color.startsWith("rgba") ? "#000000" : textClip.background.color} onChange={(e) => handleCustomStyleUpdate("background", { ...textClip.background, color: e.target.value })} className="w-5 h-5 bg-transparent border-0 cursor-pointer" />
                  </div>
                </div>
                <PropertySlider label="Padding" value={textClip.background.padding} min={0} max={30} step={1} suffix="px" onChange={(v) => handleCustomStyleUpdate("background", { ...textClip.background, padding: v })} compact />
                <PropertySlider label="Border Radius" value={textClip.background.borderRadius} min={0} max={25} step={1} suffix="px" onChange={(v) => handleCustomStyleUpdate("background", { ...textClip.background, borderRadius: v })} compact />
              </div>
            )}
          </div>
        </div>
      </PropertySection>

      {/* Quick Effect Presets */}
      <PropertySection title="Quick Presets" icon={<PaintBucket className="w-3.5 h-3.5" />} defaultCollapsed>
        <div className="grid grid-cols-3 gap-1.5">
          {allTextEffects.slice(0, 9).map((effect) => (
            <button
              key={effect.id}
              onClick={() => applyEffectPreset(effect)}
              className={`p-2 rounded-lg border text-center truncate text-[10px] font-bold shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all cursor-pointer max-w-full ${textClip.styleId === effect.id ? "bg-accent/15 border-accent/40" : "bg-surface-raised border-border/60 hover:border-accent"}`}
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
      </PropertySection>

      {/* Batch Styling for captions */}
      {textClip.textRole === "caption" && (
        <div className="flex items-center justify-between p-2.5 bg-surface-raised/35 border border-border/30 rounded-lg select-none">
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-text-primary">Apply to all captions</span>
            <span className="text-[9px] text-text-muted">Broadcast styles to all clips on this track</span>
          </div>
          <button
            onClick={() => setApplyToAll(!applyToAll)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
              applyToAll
                ? "bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25"
                : "bg-surface-raised border border-border/60 text-text-muted hover:text-text-primary hover:bg-white/[0.04]"
            }`}
          >
            {applyToAll ? "Active" : "Inactive"}
          </button>
        </div>
      )}
    </div>
  );
};
