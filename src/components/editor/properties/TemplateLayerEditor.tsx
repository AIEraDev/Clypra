import React, { useState } from "react";
import { Type, Square, Image, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TextTemplate } from "@/features/text-templates/types";
import { PropertySlider } from "./primitives/PropertySlider";

interface TemplateLayerEditorProps {
  template: TextTemplate;
  customization: any;
  onChange: (customization: any) => void;
}

export const TemplateLayerEditor: React.FC<TemplateLayerEditorProps> = ({
  template,
  customization = {},
  onChange,
}) => {
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null);

  const handleLayerTextChange = (layerId: string, text: string, role?: string) => {
    const nextCustomization = { ...customization };
    
    // Update role-based mapping for compatibility
    if (role === "primary") {
      nextCustomization.primaryText = text;
    } else if (role === "secondary") {
      nextCustomization.secondaryText = text;
    } else if (role === "accent") {
      nextCustomization.accentText = text;
    }

    // Update arbitrary map
    nextCustomization.layerTexts = {
      ...(nextCustomization.layerTexts || {}),
      [layerId]: text,
    };

    onChange(nextCustomization);
  };

  const handleLayerColorChange = (layerId: string, color: string, role?: string) => {
    const nextCustomization = { ...customization };

    // Update role-based mapping for compatibility
    if (role === "primary") {
      nextCustomization.primaryColor = color;
    } else if (role === "secondary") {
      nextCustomization.secondaryColor = color;
    }

    // Update arbitrary map
    nextCustomization.layerColors = {
      ...(nextCustomization.layerColors || {}),
      [layerId]: color,
    };

    onChange(nextCustomization);
  };

  const handleLayerFontPropertyChange = (layerId: string, key: "fontSize" | "fontWeight", value: any) => {
    const nextCustomization = { ...customization };
    
    if (key === "fontSize") {
      nextCustomization.layerFontSizes = {
        ...(nextCustomization.layerFontSizes || {}),
        [layerId]: value,
      };
    } else if (key === "fontWeight") {
      nextCustomization.layerFontWeights = {
        ...(nextCustomization.layerFontWeights || {}),
        [layerId]: value,
      };
    }

    onChange(nextCustomization);
  };

  const toggleExpand = (layerId: string) => {
    setExpandedLayerId(expandedLayerId === layerId ? null : layerId);
  };

  // Render layers in reverse order (top layers first)
  const sortedLayers = [...(template.layers || [])].reverse();

  return (
    <div className="space-y-2 select-none">
      <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">
        Template Layers
      </div>

      {sortedLayers.map((layer) => {
        const isExpanded = expandedLayerId === layer.id;
        const iconClass = "w-3.5 h-3.5 shrink-0";
        
        // Retrieve current values
        let currentText = "";
        let currentColor = "#ffffff";
        let currentFontSize = 24;
        let currentFontWeight = 400;

        if (layer.kind === "text") {
          currentText = customization.layerTexts?.[layer.id] !== undefined
            ? customization.layerTexts[layer.id]
            : (layer.role === "primary" ? customization.primaryText : layer.role === "secondary" ? customization.secondaryText : layer.role === "accent" ? customization.accentText : null) ?? layer.content ?? "";
            
          currentColor = customization.layerColors?.[layer.id] !== undefined
            ? customization.layerColors[layer.id]
            : (layer.role === "primary" ? customization.primaryColor : layer.role === "secondary" ? customization.secondaryColor : null) ?? layer.color ?? "#ffffff";

          currentFontSize = customization.layerFontSizes?.[layer.id] !== undefined
            ? customization.layerFontSizes[layer.id]
            : layer.fontSize || 24;

          currentFontWeight = customization.layerFontWeights?.[layer.id] !== undefined
            ? customization.layerFontWeights[layer.id]
            : layer.fontWeight || 400;
        } else if (layer.kind === "shape") {
          currentColor = customization.layerColors?.[layer.id] !== undefined
            ? customization.layerColors[layer.id]
            : (layer.id === "primary-fill-layer" ? customization.primaryColor : layer.id === "secondary-fill-layer" ? customization.secondaryColor : null) ?? layer.fill ?? "#ffffff";
        }

        return (
          <div
            key={layer.id}
            className={cn(
              "border border-zinc-800 rounded-md overflow-hidden transition-all duration-200",
              isExpanded ? "bg-zinc-900" : "bg-zinc-900/60 hover:bg-zinc-900/80"
            )}
          >
            {/* Header */}
            <div
              onClick={() => toggleExpand(layer.id)}
              className="flex items-center justify-between p-2.5 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                {layer.kind === "text" && <Type className={cn(iconClass, "text-sky-400")} />}
                {layer.kind === "shape" && <Square className={cn(iconClass, "text-emerald-400")} />}
                {layer.kind === "image" && <Image className={cn(iconClass, "text-amber-400")} />}
                
                <div>
                  <span className="text-xs font-medium text-white capitalize">
                    {layer.id.replace(/-layer|-fill/g, " ").replace(/-/g, " ")}
                  </span>
                  {layer.kind === "text" && layer.role && (
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
                    <div className="space-y-1">
                      <label className="text-[9px] text-zinc-400 block font-medium">Text Content</label>
                      <textarea
                        value={currentText}
                        onChange={(e) => handleLayerTextChange(layer.id, e.target.value, layer.role)}
                        rows={2}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-md py-1.5 px-2 text-xs text-white outline-none focus:border-sky-500 resize-none selectable"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-zinc-400 font-medium">Text Color</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-zinc-500 tabular-nums uppercase">
                          {currentColor}
                        </span>
                        <input
                          type="color"
                          value={currentColor}
                          onChange={(e) => handleLayerColorChange(layer.id, e.target.value, layer.role)}
                          className="w-6 h-6 bg-transparent border-0 cursor-pointer rounded overflow-hidden"
                        />
                      </div>
                    </div>

                    <PropertySlider
                      label="Font Size"
                      value={currentFontSize}
                      min={10}
                      max={150}
                      step={1}
                      onChange={(v) => handleLayerFontPropertyChange(layer.id, "fontSize", v)}
                    />

                    <div className="space-y-1">
                      <label className="text-[9px] text-zinc-400 block font-medium">Font Weight</label>
                      <select
                        value={currentFontWeight}
                        onChange={(e) => handleLayerFontPropertyChange(layer.id, "fontWeight", Number(e.target.value))}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-md py-1.5 px-2 text-xs text-white outline-none focus:border-sky-500"
                      >
                        <option value={100}>Thin (100)</option>
                        <option value={200}>Extra Light (200)</option>
                        <option value={300}>Light (300)</option>
                        <option value={400}>Regular (400)</option>
                        <option value={500}>Medium (500)</option>
                        <option value={600}>Semi Bold (600)</option>
                        <option value={700}>Bold (700)</option>
                        <option value={800}>Extra Bold (800)</option>
                        <option value={900}>Black (900)</option>
                      </select>
                    </div>
                  </>
                )}

                {layer.kind === "shape" && (
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-zinc-400 font-medium">Fill Color</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-zinc-500 tabular-nums uppercase">
                        {currentColor}
                      </span>
                      <input
                        type="color"
                        value={currentColor}
                        onChange={(e) => handleLayerColorChange(layer.id, e.target.value)}
                        className="w-6 h-6 bg-transparent border-0 cursor-pointer rounded overflow-hidden"
                      />
                    </div>
                  </div>
                )}

                {layer.kind === "image" && (
                  <div className="text-[10px] text-zinc-500 break-all select-all">
                    URL: {layer.url || "default"}
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
