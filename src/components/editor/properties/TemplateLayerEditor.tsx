import React, { useState, useMemo, useEffect } from "react";
import { Type, Square, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClypraColorPicker } from "@clypra/ui-color-picker";
import { resolveTextTemplateArtifact } from "@clypra-studio/engine";
import { FONT_PICKER_OPTIONS, resolveFontPickerValue } from "./TextStyleSection";

interface TemplateLayerEditorProps {
  template: any;
  customization: any;
  onChange: (customization: any) => void;
}

interface TemplateLayerItem {
  id: string;
  kind: "text" | "shape";
  role?: string;
  name: string;
  defaultText: string;
  defaultColor: string;
  defaultFontFamily: string;
}

export const TemplateLayerEditor: React.FC<TemplateLayerEditorProps> = ({
  template,
  customization = {},
  onChange,
}) => {
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null);

  // Extract layers from either modern TextTemplateArtifact (document.nodes) or legacy template.layers
  const layers: TemplateLayerItem[] = useMemo(() => {
    const artifact = resolveTextTemplateArtifact(template);
    if (artifact?.document?.nodes) {
      const textNodes = artifact.document.nodes.filter(
        (n: any) => n.type === "text",
      );
      if (textNodes.length > 0) {
        return textNodes.map((n: any) => ({
          id: n.id,
          kind: "text" as const,
          role: n.role,
          name:
            n.name ||
            n.id.replace(/-layer|-node/g, " ").replace(/-/g, " "),
          defaultText: n.text || "",
          defaultColor: n.style?.textColor || "#ffffff",
          defaultFontFamily: n.style?.fontFamily || "Inter Variable",
        }));
      }
    }

    // Fallback to legacy template.layers
    const rawLayers = (template as any)?.layers || [];
    if (Array.isArray(rawLayers) && rawLayers.length > 0) {
      return rawLayers.map((l: any) => ({
        id: l.id,
        kind: (l.kind || (l.content !== undefined ? "text" : "shape")) as
          | "text"
          | "shape",
        role: l.role,
        name:
          l.name ||
          l.id.replace(/-layer|-fill/g, " ").replace(/-/g, " "),
        defaultText: l.content || "",
        defaultColor: l.color || l.fill || "#ffffff",
        defaultFontFamily: l.fontFamily || "Inter Variable",
      }));
    }

    return [];
  }, [template]);

  // Automatically expand the first layer when loaded
  useEffect(() => {
    if (layers.length > 0 && expandedLayerId === null) {
      setExpandedLayerId(layers[0].id);
    }
  }, [layers, expandedLayerId]);

  const handleLayerTextChange = (
    layerId: string,
    text: string,
    role?: string,
  ) => {
    const nextCustomization = { ...customization };

    if (role === "primary" || layerId === layers[0]?.id) {
      nextCustomization.primaryText = text;
    } else if (role === "secondary") {
      nextCustomization.secondaryText = text;
    } else if (role === "accent") {
      nextCustomization.accentText = text;
    }

    nextCustomization.layerTexts = {
      ...(nextCustomization.layerTexts || {}),
      [layerId]: text,
    };

    onChange(nextCustomization);
  };

  const handleLayerFontChange = (
    layerId: string,
    font: string,
    role?: string,
  ) => {
    const nextCustomization = { ...customization };

    if (role === "primary" || layerId === layers[0]?.id) {
      nextCustomization.primaryFontFamily = font;
    } else if (role === "secondary") {
      nextCustomization.secondaryFontFamily = font;
    }

    nextCustomization.layerFontFamilies = {
      ...(nextCustomization.layerFontFamilies || {}),
      [layerId]: font,
    };

    onChange(nextCustomization);
  };

  const handleLayerColorChange = (
    layerId: string,
    color: string,
    role?: string,
  ) => {
    const nextCustomization = { ...customization };

    if (role === "primary" || layerId === layers[0]?.id) {
      nextCustomization.primaryColor = color;
    } else if (role === "secondary") {
      nextCustomization.secondaryColor = color;
    }

    nextCustomization.layerColors = {
      ...(nextCustomization.layerColors || {}),
      [layerId]: color,
    };

    onChange(nextCustomization);
  };

  const toggleExpand = (layerId: string) => {
    setExpandedLayerId(expandedLayerId === layerId ? null : layerId);
  };

  if (layers.length === 0) {
    return (
      <div className="text-center py-2 text-xs text-text-muted select-none">
        No editable layers found in this template.
      </div>
    );
  }

  return (
    <div className="space-y-2 select-none">
      <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">
        Template Layers
      </div>

      {layers.map((layer) => {
        const isExpanded = expandedLayerId === layer.id;
        const iconClass = "w-3.5 h-3.5 shrink-0";

        // Retrieve current values with fallback hierarchy
        const currentText =
          customization.layerTexts?.[layer.id] !== undefined
            ? customization.layerTexts[layer.id]
            : (layer.role === "primary" || layer.id === layers[0]?.id
                ? customization.primaryText
                : layer.role === "secondary"
                  ? customization.secondaryText
                  : layer.role === "accent"
                    ? customization.accentText
                    : null) ?? layer.defaultText;

        const currentFontFamily =
          customization.layerFontFamilies?.[layer.id] !== undefined
            ? customization.layerFontFamilies[layer.id]
            : (layer.role === "primary" || layer.id === layers[0]?.id
                ? customization.primaryFontFamily
                : layer.role === "secondary"
                  ? customization.secondaryFontFamily
                  : null) ?? layer.defaultFontFamily;

        const currentColor =
          customization.layerColors?.[layer.id] !== undefined
            ? customization.layerColors[layer.id]
            : (layer.role === "primary" || layer.id === layers[0]?.id
                ? customization.primaryColor
                : layer.role === "secondary"
                  ? customization.secondaryColor
                  : null) ?? layer.defaultColor;

        return (
          <div
            key={layer.id}
            className={cn(
              "border border-zinc-800 rounded-md overflow-hidden transition-all duration-200",
              isExpanded
                ? "bg-zinc-900"
                : "bg-zinc-900/60 hover:bg-zinc-900/80",
            )}
          >
            {/* Header */}
            <div
              onClick={() => toggleExpand(layer.id)}
              className="flex items-center justify-between p-2.5 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                {layer.kind === "text" ? (
                  <Type className={cn(iconClass, "text-sky-400")} />
                ) : (
                  <Square className={cn(iconClass, "text-emerald-400")} />
                )}

                <div>
                  <span className="text-xs font-medium text-white capitalize">
                    {layer.name}
                  </span>
                  {layer.role && (
                    <span className="ml-1.5 px-1 py-0.5 rounded text-[8px] bg-sky-500/10 text-sky-400 font-semibold uppercase">
                      {layer.role}
                    </span>
                  )}
                </div>
              </div>

              {isExpanded ? (
                <ChevronUp className="w-3.5 h-3.5 text-zinc-500" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
              )}
            </div>

            {/* Content body */}
            {isExpanded && (
              <div className="p-3 border-t border-zinc-800/60 space-y-3 bg-zinc-950/40">
                {layer.kind === "text" && (
                  <>
                    {/* Text Content */}
                    <div className="space-y-1">
                      <label className="text-[9px] text-zinc-400 block font-medium">
                        Text Content
                      </label>
                      <textarea
                        value={currentText}
                        onChange={(e) =>
                          handleLayerTextChange(
                            layer.id,
                            e.target.value,
                            layer.role,
                          )
                        }
                        rows={2}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-md py-1.5 px-2 text-xs text-white outline-none focus:border-sky-500 resize-none selectable"
                      />
                    </div>

                    {/* Font Family */}
                    <div className="space-y-1">
                      <label className="text-[9px] text-zinc-400 block font-medium">
                        Font Family
                      </label>
                      <select
                        value={resolveFontPickerValue(currentFontFamily)}
                        onChange={(e) =>
                          handleLayerFontChange(
                            layer.id,
                            e.target.value,
                            layer.role,
                          )
                        }
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-md py-1.5 px-2 text-xs text-white outline-none focus:border-sky-500"
                      >
                        {FONT_PICKER_OPTIONS.map((font) => (
                          <option key={font.value} value={font.value}>
                            {font.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Text Color */}
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-zinc-400 font-medium">
                        Text Color
                      </span>
                      <ClypraColorPicker
                        value={currentColor}
                        onChange={(c: string) =>
                          handleLayerColorChange(layer.id, c, layer.role)
                        }
                        onChangeComplete={(c: string) =>
                          handleLayerColorChange(layer.id, c, layer.role)
                        }
                        format="hex"
                        showAlpha={true}
                        size="sm"
                        triggerClassName="w-20 h-6.5 bg-zinc-900 border-zinc-800 hover:border-zinc-700 shrink-0"
                        popoverClassName="right-0 left-auto mt-1 z-[100]"
                      />
                    </div>
                  </>
                )}

                {layer.kind === "shape" && (
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-zinc-400 font-medium">
                      Fill Color
                    </span>
                    <ClypraColorPicker
                      value={currentColor}
                      onChange={(c: string) =>
                        handleLayerColorChange(layer.id, c)
                      }
                      onChangeComplete={(c: string) =>
                        handleLayerColorChange(layer.id, c)
                      }
                      format="hex"
                      showAlpha={true}
                      size="sm"
                      triggerClassName="w-20 h-6.5 bg-zinc-900 border-zinc-800 hover:border-zinc-700 shrink-0"
                      popoverClassName="right-0 left-auto mt-1 z-[100]"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
