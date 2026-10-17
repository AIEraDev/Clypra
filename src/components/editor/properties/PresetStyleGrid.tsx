/**
 * PresetStyleGrid.tsx
 *
 * Professional CapCut-parity "PRESET STYLE" grid with visual "Aa" preview cards,
 * collapsible drawer, 23 styled presets, and instant style application.
 */

import React, { useState } from "react";
import { ChevronDown, ChevronUp, Ban } from "lucide-react";
import { useTranslation } from "@/i18n";
import type { TextClip } from "@/types";
import {
  TEXT_STYLE_PRESETS,
  isPresetActive,
  type TextStylePreset,
} from "./data/textStylePresets";

interface PresetStyleGridProps {
  textClip: TextClip;
  onApplyPreset: (preset: TextStylePreset) => void;
}

export const PresetStyleGrid: React.FC<PresetStyleGridProps> = ({
  textClip,
  onApplyPreset,
}) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="space-y-2">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[#8e8e93] uppercase font-semibold tracking-wider select-none">
          {t("properties.text.presetStyle") || "PRESET STYLE"}
        </span>
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="text-[#8e8e93] hover:text-white transition-colors cursor-pointer p-0.5 rounded flex items-center gap-1 text-[11px]"
          title={
            isExpanded
              ? t("properties.text.collapsePresets") || "Collapse preset styles"
              : t("properties.text.expandPresets") || "Expand preset styles"
          }
          aria-expanded={isExpanded}
        >
          {isExpanded ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Preset Cards Container */}
      <div className="bg-[#1c1c1f] border border-white/5 rounded-xl p-2.5 transition-all">
        {isExpanded ? (
          /* Expanded Full Grid: 3 authentic rows matching CapCut */
          <div className="space-y-2.5">
            {/* Row 1: Reset + Outlines / Shadows (10 items) */}
            <div className="grid grid-cols-10 gap-1.5 sm:gap-2">
              {TEXT_STYLE_PRESETS.slice(0, 10).map((preset) => {
                const active = isPresetActive(preset, textClip);
                return (
                  <PresetButton
                    key={preset.id}
                    preset={preset}
                    active={active}
                    onClick={() => onApplyPreset(preset)}
                  />
                );
              })}
            </div>

            {/* Row 2: Badges & 3D Extrusions (10 items) */}
            <div className="grid grid-cols-10 gap-1.5 sm:gap-2">
              {TEXT_STYLE_PRESETS.slice(10, 20).map((preset) => {
                const active = isPresetActive(preset, textClip);
                return (
                  <PresetButton
                    key={preset.id}
                    preset={preset}
                    active={active}
                    onClick={() => onApplyPreset(preset)}
                  />
                );
              })}
            </div>

            {/* Row 3: Neon Glows (3 items) */}
            <div className="grid grid-cols-10 gap-1.5 sm:gap-2">
              {TEXT_STYLE_PRESETS.slice(20, 23).map((preset) => {
                const active = isPresetActive(preset, textClip);
                return (
                  <PresetButton
                    key={preset.id}
                    preset={preset}
                    active={active}
                    onClick={() => onApplyPreset(preset)}
                  />
                );
              })}
            </div>

            {/* Bottom Centered Collapse Caret (identical to CapCut screenshot) */}
            <div className="flex justify-center pt-1">
              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                className="text-[#8e8e93] hover:text-white transition-colors cursor-pointer py-1 px-4 flex items-center justify-center rounded hover:bg-white/5"
                title="Collapse"
                aria-label="Collapse"
              >
                <div className="w-0 h-0 border-x-4 border-x-transparent border-b-4 border-b-[#8e8e93] hover:border-b-white transition-colors" />
              </button>
            </div>
          </div>
        ) : (
          /* Collapsed View: First row of top presets with horizontal scroll */
          <div className="space-y-1">
            <div className="flex gap-2 overflow-x-auto scrollbar-none py-0.5">
              {TEXT_STYLE_PRESETS.map((preset) => {
                const active = isPresetActive(preset, textClip);
                return (
                  <PresetButton
                    key={preset.id}
                    preset={preset}
                    active={active}
                    onClick={() => onApplyPreset(preset)}
                  />
                );
              })}
            </div>

            {/* Bottom Centered Expand Caret */}
            <div className="flex justify-center pt-0.5">
              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className="text-[#8e8e93] hover:text-white transition-colors cursor-pointer py-0.5 px-4 flex items-center justify-center rounded hover:bg-white/5"
                title="Expand"
                aria-label="Expand"
              >
                <div className="w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-[#8e8e93] hover:border-t-white transition-colors" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface PresetButtonProps {
  preset: TextStylePreset;
  active: boolean;
  onClick: () => void;
}

const PresetButton: React.FC<PresetButtonProps> = ({
  preset,
  active,
  onClick,
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      title={preset.name}
      style={preset.containerStyle}
      className={`aspect-square w-full min-w-[28px] max-w-[36px] sm:min-w-[32px] sm:max-w-[40px] rounded-lg flex items-center justify-center transition-all cursor-pointer relative shrink-0 ${
        active
          ? "border-2 border-[#f3b584] shadow-[0_0_10px_rgba(243,181,132,0.3)] scale-[1.04]"
          : "border border-white/5 bg-[#242426] hover:border-white/20 hover:scale-[1.02]"
      }`}
    >
      {preset.isReset ? (
        <Ban className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#8e8e93]" />
      ) : (
        <span
          className="text-xs sm:text-sm font-black select-none pointer-events-none"
          style={preset.textStyle}
        >
          Aa
        </span>
      )}
    </button>
  );
};
