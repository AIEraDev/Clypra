import React from "react";
import { useTranslation } from "react-i18next";
import { Type, AlignLeft, AlignCenter, AlignRight, AlignStartVertical, AlignCenterVertical, AlignEndVertical, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { normalizeFontFamily } from "@/core/evaluation/evaluator";
import { allTextEffects } from "@/features/text-effects/registry";
import type { TextEffectDefinition } from "@/features/text-effects/types/types";
import { _buildConfig } from "@clypra/engine";
import type { TextClip } from "@/types";

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

export const TextStyleSection: React.FC<TextStyleSectionProps> = ({ textClip, presets, newPresetName, setNewPresetName, handleUpdate, handleUpdateMultiple, handleApplyPreset, savePreset, deletePreset }) => {
  const { t } = useTranslation();
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

  // Get the selected effect's definition from allTextEffects
  const effectDefinition = allTextEffects.find((e) => e.id === textClip.styleId);

  if (effectDefinition) {
    // Resolve the definition into the exact flat config the engine constructor expects!
    const effectDefaults = _buildConfig(effectDefinition, textClip.text, textClip.fontSize, textClip.width || 640, textClip.height || 360);

    // Now you have the strict defaults defined by the studio! E.g.:
    console.log("Strict Default Fill Color:", effectDefaults.fillColor);
    console.log("Strict Default Bevel Depth:", effectDefaults.bevelDepth);
    console.log("Strict Default Scanline Toggle:", (effectDefaults as any).isGlitchEffect);
  }

  return (
    <div className="space-y-5">
      {/* Text Editor Box */}
      <div>
        <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider block mb-1.5 select-none">{t("properties.text.content")}</label>
        <textarea value={textClip.text || ""} onChange={(e) => handleUpdate("text", e.target.value)} rows={3} placeholder={effectDefinition?.text || "CLYPRA"} className="w-full bg-surface-raised border border-border/80 rounded-lg p-2.5 text-xs text-text-primary outline-none focus:border-accent resize-none selectable" />
      </div>

      {/* Style Presets Library */}
      <div>
        <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider block mb-2 select-none">{t("properties.text.stylePresets")}</label>

        <div className="space-y-3 p-3 bg-surface-raised/20 border border-border/40 rounded-xl">
          {/* Horizontal preset selection carousel */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
            {presets.map((preset) => (
              <div key={preset.id} className="relative shrink-0 group/preset">
                <button
                  onClick={() => {
                    handleApplyPreset(preset);
                  }}
                  className="px-3 py-2 bg-surface-raised hover:bg-surface-raised/80 border border-border/60 hover:border-accent rounded-lg text-xs font-semibold text-text-primary transition-all cursor-pointer whitespace-nowrap"
                  style={{ fontFamily: preset.fontFamily, color: preset.color }}
                >
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

          {/* Save Current Style as Preset */}
          <div className="flex items-center gap-2 pt-2 border-t border-border/30">
            <input type="text" value={newPresetName} onChange={(e) => setNewPresetName(e.target.value)} placeholder={t("properties.text.customStyleNamePlaceholder")} className="flex-1 min-w-0 bg-surface-raised border border-border/80 rounded px-2 py-1 text-xs text-text-primary outline-none focus:border-accent" />
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
                  keyframes: (textClip as any).keyframes,
                });
                setNewPresetName("");
              }}
            >
              <Save className="w-3.5 h-3.5" />
              {t("properties.text.save")}
            </Button>
          </div>
        </div>
      </div>

      {/* Typography Options */}
      <div>
        <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider block mb-2 select-none">{t("properties.text.typography")}</label>

        <div className="space-y-3 p-3 bg-surface-raised/20 border border-border/40 rounded-xl">
          {/* Font Family Select */}
          <div>
            <label className="text-[10px] text-text-muted block mb-1 select-none">{t("properties.text.fontFamily")}</label>
            <select value={normalizeFontFamily(textClip.fontFamily || "Inter Variable")} onChange={(e) => handleUpdate("fontFamily", e.target.value)} className="w-full bg-surface-raised border border-border rounded px-2.5 py-1.5 text-xs text-text-primary outline-none">
              <optgroup label={t("properties.text.fontGroups.system")}>
                <option value="Arial">Arial</option>
                <option value="Arial Black">Arial Black</option>
                <option value="Arial Rounded MT Bold">Arial Rounded MT Bold</option>
                <option value="Georgia">Georgia</option>
                <option value="Times New Roman">Times New Roman</option>
                <option value="Courier New">Courier New</option>
                <option value="Impact">Impact</option>
                <option value="Verdana">Verdana</option>
                <option value="Trebuchet MS">Trebuchet MS</option>
                <option value="Palatino">Palatino</option>
              </optgroup>
              <optgroup label={t("properties.text.fontGroups.google")}>
                <option value="Inter Variable">Inter</option>
                <option value="Geist Variable">Geist</option>
                <option value="Outfit Variable">Outfit</option>
                <option value="Space Grotesk Variable">Space Grotesk</option>
                <option value="Roboto Variable">Roboto</option>
                <option value="Roboto Condensed">Roboto Condensed</option>
                <option value="Open Sans">Open Sans</option>
                <option value="Lato">Lato</option>
                <option value="Montserrat Variable">Montserrat</option>
                <option value="Raleway">Raleway</option>
                <option value="Oswald">Oswald</option>
                <option value="Playfair Display">Playfair Display</option>
                <option value="Anton">Anton</option>
                <option value="Bebas Neue">Bebas Neue</option>
                <option value="Nunito">Nunito</option>
                <option value="Poppins">Poppins</option>
                <option value="Permanent Marker">Permanent Marker</option>
                <option value="Bangers">Bangers</option>
                <option value="Press Start 2P">Press Start 2P</option>
                <option value="Dancing Script">Dancing Script</option>
                <option value="Pacifico">Pacifico</option>
              </optgroup>
            </select>
          </div>

          {/* Font Size slider */}
          <div>
            <div className="flex justify-between items-center text-[10px] text-text-muted mb-1 select-none">
              <span>{t("properties.text.fontSize")}</span>
              <span className="font-mono text-text-primary">{textClip.fontSize}px</span>
            </div>
            <div className="flex items-center gap-2">
              <input type="range" min="10" max="150" value={textClip.fontSize || 48} onChange={(e) => handleUpdate("fontSize", Number(e.target.value))} className="grow accent-accent" />
              <input type="number" value={textClip.fontSize || 48} onChange={(e) => handleUpdate("fontSize", Number(e.target.value))} className="w-12 bg-surface-raised border border-border rounded text-center py-0.5 text-xs text-text-primary outline-none" />
            </div>
          </div>

          {/* Weight, Italic, Alignments */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            {/* Style buttons */}
            <div className="space-y-1">
              <label className="text-[9px] text-text-muted block select-none">{t("properties.text.fontStyle")}</label>
              <div className="flex gap-1 bg-surface-raised border border-border/60 p-0.5 rounded">
                <button onClick={() => handleUpdate("fontWeight", textClip.fontWeight === "bold" ? "normal" : "bold")} className={`flex-1 py-1 rounded text-xs font-bold transition-all ${textClip.fontWeight === "bold" ? "bg-accent text-white" : "text-text-muted hover:text-text-primary"}`}>
                  B
                </button>
                <button onClick={() => handleUpdate("fontStyle", textClip.fontStyle === "italic" ? "normal" : "italic")} className={`flex-1 py-1 rounded text-xs italic transition-all ${textClip.fontStyle === "italic" ? "bg-accent text-white font-bold" : "text-text-muted hover:text-text-primary"}`}>
                  I
                </button>
              </div>
            </div>

            {/* Alignment buttons */}
            <div className="space-y-1">
              <label className="text-[9px] text-text-muted block select-none">{t("properties.text.horizontalAlign")}</label>
              <div className="flex gap-1 bg-surface-raised border border-border/60 p-0.5 rounded">
                <button onClick={() => handleUpdate("align", "left")} className={`flex-1 py-1 rounded flex items-center justify-center transition-all ${textClip.align === "left" ? "bg-accent text-white" : "text-text-muted hover:text-text-primary"}`}>
                  <AlignLeft className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleUpdate("align", "center")} className={`flex-1 py-1 rounded flex items-center justify-center transition-all ${textClip.align === "center" || !textClip.align ? "bg-accent text-white" : "text-text-muted hover:text-text-primary"}`}>
                  <AlignCenter className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleUpdate("align", "right")} className={`flex-1 py-1 rounded flex items-center justify-center transition-all ${textClip.align === "right" ? "bg-accent text-white" : "text-text-muted hover:text-text-primary"}`}>
                  <AlignRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Vertical align and letter spacing */}
          <div className="grid grid-cols-2 gap-3">
            {/* Vertical align */}
            <div className="space-y-1">
              <label className="text-[9px] text-text-muted block select-none">{t("properties.text.verticalAlign")}</label>
              <div className="flex gap-1 bg-surface-raised border border-border/60 p-0.5 rounded">
                <button onClick={() => handleUpdate("valign", "top")} className={`flex-1 py-1 rounded flex items-center justify-center transition-all ${textClip.valign === "top" ? "bg-accent text-white" : "text-text-muted hover:text-text-primary"}`}>
                  <AlignStartVertical className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleUpdate("valign", "middle")} className={`flex-1 py-1 rounded flex items-center justify-center transition-all ${textClip.valign === "middle" || !textClip.valign ? "bg-accent text-white" : "text-text-muted hover:text-text-primary"}`}>
                  <AlignCenterVertical className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleUpdate("valign", "bottom")} className={`flex-1 py-1 rounded flex items-center justify-center transition-all ${textClip.valign === "bottom" ? "bg-accent text-white" : "text-text-muted hover:text-text-primary"}`}>
                  <AlignEndVertical className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Letter spacing */}
            <div className="space-y-1">
              <label className="text-[9px] text-text-muted block select-none">{t("properties.text.letterSpacing", { n: textClip.letterSpacing || 0 })}</label>
              <input type="number" value={textClip.letterSpacing || 0} onChange={(e) => handleUpdate("letterSpacing", Number(e.target.value))} className="w-full bg-surface-raised border border-border rounded py-1 px-2 text-center text-xs text-text-primary outline-none" />
            </div>
          </div>
        </div>
      </div>

      {/* Visual Styling Customizers */}
      <div>
        <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider block mb-2 select-none">{t("properties.text.styleCustomizers")}</label>

        <div className="space-y-3.5 p-3.5 bg-surface-raised/20 border border-border/40 rounded-xl">
          {/* Solid Text Color */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-primary select-none font-medium">{t("properties.text.textColor")}</span>
              <div className="flex items-center gap-2">
                {/* Linear Gradients Quick Selectors */}
                <select
                  value={(textClip.color || "#ffffff").includes(",") ? textClip.color : "solid"}
                  onChange={(e) => {
                    if (e.target.value !== "solid") {
                      handleUpdate("color", e.target.value);
                    }
                  }}
                  className="bg-surface-raised border border-border rounded text-[10px] py-1 px-1.5 text-text-muted outline-none"
                >
                  <option value="solid">{t("properties.text.gradients.solid")}</option>
                  <option value="#ffe066, #b38600">{t("properties.text.gradients.gold")}</option>
                  <option value="#ff3e00, #ff0077, #aa00ff">{t("properties.text.gradients.sunset")}</option>
                  <option value="#ff007f, #aa00ff, #00c8ff, #00ff66">{t("properties.text.gradients.rainbow")}</option>
                </select>
                <input type="color" value={(textClip.color || "#ffffff").includes(",") ? "#ffffff" : textClip.color || "#ffffff"} onChange={(e) => handleUpdate("color", e.target.value)} className="w-7 h-7 bg-transparent border-0 cursor-pointer rounded overflow-hidden" />
              </div>
            </div>

            {/* Quick Color Palette circles */}
            <div className="flex flex-wrap gap-1.5 pt-1 justify-start">
              {[
                { labelKey: "white", value: "#ffffff" },
                { labelKey: "black", value: "#1a1a1a" },
                { labelKey: "yellow", value: "#ffcc00" },
                { labelKey: "red", value: "#ff3b30" },
                { labelKey: "pink", value: "#ff2d55" },
                { labelKey: "purple", value: "#af52de" },
                { labelKey: "blue", value: "#007aff" },
                { labelKey: "teal", value: "#00f0ff" },
                { labelKey: "green", value: "#34c759" },
                { labelKey: "gold", value: "#ffe066, #b38600" },
                { labelKey: "sunset", value: "#ff3e00, #ff0077, #aa00ff" },
                { labelKey: "ocean", value: "#00c8ff, #00ff66" },
                { labelKey: "rainbow", value: "#ff007f, #aa00ff, #00c8ff, #00ff66" },
              ].map((p, idx) => {
                const isGrad = p.value.includes(",");
                const style: React.CSSProperties = isGrad ? { background: `linear-gradient(135deg, ${p.value})` } : { backgroundColor: p.value };

                const isSelected = textClip.color === p.value;

                return <button key={idx} onClick={() => handleUpdate("color", p.value)} className={`w-6 h-6 rounded-full border cursor-pointer hover:scale-110 active:scale-95 transition-all focus:outline-none ${isSelected ? "border-accent ring-2 ring-accent/30 scale-105" : "border-border/60 hover:border-text-primary"}`} style={style} title={t(`properties.text.colors.${p.labelKey}`)} />;
              })}
            </div>
          </div>

          {/* Stroke / Outline options */}
          <div className="border-t border-border/40 pt-3 space-y-2">
            <div className="flex items-center justify-between select-none">
              <span className="text-xs text-text-primary font-medium">{t("properties.text.outlineStroke")}</span>
              <input
                type="checkbox"
                checked={!!textClip.stroke}
                onChange={(e) => {
                  if (e.target.checked) {
                    handleUpdate("stroke", { color: "#000000", width: 4 });
                  } else {
                    handleUpdate("stroke", null); // Explicitly disable stroke
                  }
                }}
                className="rounded border-border accent-accent cursor-pointer"
              />
            </div>

            {textClip.stroke && (
              <div className="space-y-2.5 p-2.5 bg-surface-raised/40 border border-border/40 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-muted">{t("properties.text.color")}</span>
                  <div className="flex items-center gap-2">
                    {/* Quick Stroke Colors */}
                    <div className="flex gap-1">
                      {["#000000", "#ffffff", "#ff3b30", "#ffcc00"].map((c, idx) => (
                        <button key={idx} onClick={() => handleUpdate("stroke", { ...textClip.stroke, color: c })} className={`w-4 h-4 rounded-full border border-border/60 cursor-pointer ${textClip.stroke?.color === c ? "ring-2 ring-accent/40" : ""}`} style={{ backgroundColor: c }} />
                      ))}
                    </div>
                    <input type="color" value={textClip.stroke.color} onChange={(e) => handleUpdate("stroke", { ...textClip.stroke, color: e.target.value })} className="w-5 h-5 bg-transparent border-0 cursor-pointer" />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[9px] text-text-muted mb-1 select-none">
                    <span>{t("properties.text.thickness")}</span>
                    <span>{textClip.stroke.width}px</span>
                  </div>
                  <input type="range" min="1" max="15" value={textClip.stroke.width} onChange={(e) => handleUpdate("stroke", { ...textClip.stroke, width: Number(e.target.value) })} className="w-full accent-accent" />
                </div>
              </div>
            )}
          </div>

          {/* Outer Glow / Shadow */}
          <div className="border-t border-border/40 pt-3 space-y-2">
            <div className="flex items-center justify-between select-none">
              <span className="text-xs text-text-primary font-medium">{t("properties.text.outerGlowShadow")}</span>
              <input
                type="checkbox"
                checked={!!textClip.shadow}
                onChange={(e) => {
                  if (e.target.checked) {
                    handleUpdate("shadow", { color: "#ff0000", blur: 15, offsetX: 0, offsetY: 0 });
                  } else {
                    handleUpdate("shadow", null); // Explicitly disable shadow
                  }
                }}
                className="rounded border-border accent-accent cursor-pointer"
              />
            </div>

            {textClip.shadow && (
              <div className="space-y-2.5 p-2.5 bg-surface-raised/40 border border-border/40 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-muted">{t("properties.text.glowColor")}</span>
                  <div className="flex items-center gap-2">
                    {/* Quick Glow Colors */}
                    <div className="flex gap-1">
                      {["#ff0000", "#ff007f", "#00f0ff", "#ffe066"].map((c, idx) => (
                        <button key={idx} onClick={() => handleUpdate("shadow", { ...textClip.shadow, color: c })} className={`w-4 h-4 rounded-full border border-border/60 cursor-pointer ${textClip.shadow?.color === c ? "ring-2 ring-accent/40" : ""}`} style={{ backgroundColor: c }} />
                      ))}
                    </div>
                    <input type="color" value={textClip.shadow.color} onChange={(e) => handleUpdate("shadow", { ...textClip.shadow, color: e.target.value })} className="w-5 h-5 bg-transparent border-0 cursor-pointer" />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[9px] text-text-muted mb-1 select-none">
                    <span>{t("properties.text.blurRadius")}</span>
                    <span>{textClip.shadow.blur}px</span>
                  </div>
                  <input type="range" min="1" max="30" value={textClip.shadow.blur} onChange={(e) => handleUpdate("shadow", { ...textClip.shadow, blur: Number(e.target.value) })} className="w-full accent-accent" />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] text-text-muted block mb-0.5 select-none">{t("properties.text.offsetX")}</label>
                    <input type="number" value={textClip.shadow.offsetX} onChange={(e) => handleUpdate("shadow", { ...textClip.shadow, offsetX: Number(e.target.value) })} className="w-full bg-surface-raised border border-border text-center rounded py-0.5 text-xs text-text-primary outline-none" />
                  </div>
                  <div>
                    <label className="text-[9px] text-text-muted block mb-0.5 select-none">{t("properties.text.offsetY")}</label>
                    <input type="number" value={textClip.shadow.offsetY} onChange={(e) => handleUpdate("shadow", { ...textClip.shadow, offsetY: Number(e.target.value) })} className="w-full bg-surface-raised border border-border text-center rounded py-0.5 text-xs text-text-primary outline-none" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Background Box Backing */}
          <div className="border-t border-border/40 pt-3 space-y-2">
            <div className="flex items-center justify-between select-none">
              <span className="text-xs text-text-primary font-medium">{t("properties.text.backgroundBox")}</span>
              <input
                type="checkbox"
                checked={!!textClip.background}
                onChange={(e) => {
                  if (e.target.checked) {
                    handleUpdate("background", { color: "rgba(0,0,0,0.6)", padding: 12, borderRadius: 6 });
                  } else {
                    handleUpdate("background", null); // Explicitly disable background
                  }
                }}
                className="rounded border-border accent-accent cursor-pointer"
              />
            </div>

            {textClip.background && (
              <div className="space-y-2.5 p-2.5 bg-surface-raised/40 border border-border/40 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-muted">{t("properties.text.boxColor")}</span>
                  <div className="flex items-center gap-2">
                    {/* Quick Background Presets */}
                    <div className="flex gap-1">
                      {["rgba(0,0,0,0.6)", "rgba(255,255,255,0.2)", "rgba(0,122,255,0.3)", "rgba(255,59,48,0.3)"].map((c, idx) => (
                        <button key={idx} onClick={() => handleUpdate("background", { ...textClip.background, color: c })} className={`w-4 h-4 rounded-full border border-border/60 cursor-pointer ${textClip.background?.color === c ? "ring-2 ring-accent/40" : ""}`} style={{ backgroundColor: c }} />
                      ))}
                    </div>
                    <input type="color" value={textClip.background.color.startsWith("rgba") ? "#000000" : textClip.background.color} onChange={(e) => handleUpdate("background", { ...textClip.background, color: e.target.value })} className="w-5 h-5 bg-transparent border-0 cursor-pointer" />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[9px] text-text-muted mb-1 select-none">
                    <span>{t("properties.text.boxPadding")}</span>
                    <span>{textClip.background.padding}px</span>
                  </div>
                  <input type="range" min="0" max="30" value={textClip.background.padding} onChange={(e) => handleUpdate("background", { ...textClip.background, padding: Number(e.target.value) })} className="w-full accent-accent" />
                </div>

                <div>
                  <div className="flex justify-between text-[9px] text-text-muted mb-1 select-none">
                    <span>{t("properties.text.borderRadius")}</span>
                    <span>{textClip.background.borderRadius}px</span>
                  </div>
                  <input type="range" min="0" max="25" value={textClip.background.borderRadius} onChange={(e) => handleUpdate("background", { ...textClip.background, borderRadius: Number(e.target.value) })} className="w-full accent-accent" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Presets Quick Switch */}
      <div>
        <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider block mb-2 select-none">{t("properties.text.quickPresetsSwitch")}</label>
        <div className="grid grid-cols-3 gap-2 bg-surface-raised/10 border border-border/40 p-2.5 rounded-xl">
          {allTextEffects.slice(0, 6).map((effect) => (
            <button
              key={effect.id}
              onClick={() => applyEffectPreset(effect)}
              className="p-2 rounded bg-surface-raised border border-border hover:border-accent text-center truncate text-[10px] text-text-primary font-bold shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all cursor-pointer max-w-[90px]"
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
      </div>
    </div>
  );
};
