/**
 * HSLSection.tsx
 *
 * HSL (Hue, Saturation, Lightness) color adjustment section
 * with color picker presets and adjustment sliders.
 */

import React, { useState } from "react";
import type { Clip } from "@/types";
import type { ColorAdjustments } from "@clypra-studio/engine";
import { PropertySectionHeader } from "../../primitives/PropertySectionHeader";
import { GradientSliderControl } from "../../primitives/GradientSliderControl";

interface HSLSectionProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
}

const COLOR_PRESETS = [
  { color: "#1a1a1a", label: "Black" },
  { color: "#ff4444", label: "Red" },
  { color: "#ff8800", label: "Orange" },
  { color: "#ffee00", label: "Yellow" },
  { color: "#44ff44", label: "Green" },
  { color: "#00ddff", label: "Cyan" },
  { color: "#4488ff", label: "Blue" },
  { color: "#aa44ff", label: "Purple" },
  { color: "#ff44dd", label: "Magenta" },
];

export const HSLSection: React.FC<HSLSectionProps> = ({
  selectedClip,
  handleUpdate,
}) => {
  const [basicOpen, setBasicOpen] = useState(true);
  const adjustments = selectedClip.adjustments ?? {};

  const updateField = (key: keyof ColorAdjustments, value: any) => {
    const nextAdjustments = { ...adjustments, [key]: value };
    handleUpdate("adjustments", nextAdjustments);
  };

  const getVal = (key: keyof ColorAdjustments, defaultVal: number): number => {
    if (key in adjustments) {
      return adjustments[key] as number;
    }
    return defaultVal;
  };

  const handleColorPresetClick = (color: string) => {
    // TODO: Implement color preset application logic
    console.log(`Selected color preset: ${color}`);
  };

  const handleEyedropperClick = () => {
    // TODO: Implement eyedropper tool to pick color from video
    console.log("Eyedropper tool activated");
  };

  return (
    <div className="p-3 space-y-3">
      {/* Basic Section */}
      <div className="space-y-2">
        <PropertySectionHeader
          title="BASIC"
          isCollapsed={!basicOpen}
          onToggleCollapse={() => setBasicOpen(!basicOpen)}
        />

        {basicOpen && (
          <div className="pt-2 space-y-4">
            {/* Color Picker Row */}
            <div className="flex items-center gap-2">
              {/* Eyedropper Tool */}
              <button
                className="w-8 h-8 flex items-center justify-center bg-[#2c2c2e] border border-white/10 rounded cursor-pointer hover:bg-[#3a3a3c] transition-colors"
                title="Pick color from video"
                onClick={handleEyedropperClick}
              >
                {/* prettier-ignore */}
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l-3-3Z"/></svg>
              </button>

              {/* Color Preset Circles */}
              <div className="flex gap-2">
                {COLOR_PRESETS.map(({ color, label }) => (
                  <button
                    key={color}
                    className="w-8 h-8 rounded-full border-2 border-white/20 hover:border-white/40 cursor-pointer transition-all hover:scale-110"
                    style={{ backgroundColor: color }}
                    title={label}
                    onClick={() => handleColorPresetClick(color)}
                  />
                ))}
              </div>
            </div>

            {/* Hue Slider */}
            <GradientSliderControl
              label="Hue"
              value={getVal("hue", 0)}
              min={-180}
              max={180}
              onChange={(val) => updateField("hue", val)}
            />

            {/* Saturation Slider */}
            <GradientSliderControl
              label="Saturation"
              value={getVal("saturation", 0)}
              min={-100}
              max={100}
              gradient="saturation"
              onChange={(val) => updateField("saturation", val)}
            />

            {/* Brightness Slider */}
            <GradientSliderControl
              label="Brightness"
              value={getVal("brightness", 0)}
              min={-100}
              max={100}
              onChange={(val) => updateField("brightness", val)}
            />
          </div>
        )}
      </div>
    </div>
  );
};
