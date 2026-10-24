/**
 * VideoBlendControls.tsx
 *
 * Flat, inline blend mode and opacity controls for video clips.
 * Matches TextBasicTab's design pattern - no collapsible sections.
 */

import React, { useCallback } from "react";
import type { Clip } from "@/types";

interface VideoBlendControlsProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
}

const BLEND_MODE_OPTIONS = [
  { value: "normal", label: "Default" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "darken", label: "Darken" },
  { value: "lighten", label: "Lighten" },
  { value: "color-dodge", label: "Color Dodge" },
  { value: "color-burn", label: "Color Burn" },
  { value: "hard-light", label: "Hard Light" },
  { value: "soft-light", label: "Soft Light" },
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
  { value: "hue", label: "Hue" },
  { value: "saturation", label: "Saturation" },
  { value: "color", label: "Color" },
  { value: "luminosity", label: "Luminosity" },
];

export const VideoBlendControls: React.FC<VideoBlendControlsProps> = ({
  selectedClip,
  handleUpdate,
}) => {
  const blendMode = (selectedClip as any).blendMode || "normal";
  const opacity = selectedClip.opacity ?? 1;
  const opacityPercent = Math.round(opacity * 100);

  const handleOpacityChange = useCallback(
    (val: number) => {
      handleUpdate("opacity", val / 100);
    },
    [handleUpdate],
  );

  return (
    <div className="space-y-3.5 relative">
      {/* Blend Mode */}
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs text-[#a1a1aa] shrink-0 w-20">Mode</label>
        <select
          value={blendMode}
          onChange={(e) => handleUpdate("blendMode", e.target.value)}
          className="flex-1 bg-[#27272a] hover:bg-[#323238] border border-white/5 rounded-md px-3 py-1.5 text-xs text-white outline-none focus:border-cyan-400/50 cursor-pointer appearance-none transition-colors"
        >
          {BLEND_MODE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Opacity */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-[#a1a1aa] shrink-0 w-20">Opacity</label>
        <div className="flex-1 flex items-center">
          <input
            type="range"
            min={0}
            max={100}
            value={opacityPercent}
            onChange={(e) => handleOpacityChange(Number(e.target.value))}
            className="w-full h-1 bg-[#3f3f46] rounded-full appearance-none outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
          />
        </div>
        <div className="w-20 shrink-0 bg-[#27272a] border border-white/5 rounded-md px-2 py-1 flex items-center">
          <input
            type="number"
            min={0}
            max={100}
            value={opacityPercent}
            onChange={(e) => handleOpacityChange(Number(e.target.value))}
            className="w-full bg-transparent text-xs text-white text-center outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-xs text-text-muted ml-0.5">%</span>
        </div>
      </div>
    </div>
  );
};
