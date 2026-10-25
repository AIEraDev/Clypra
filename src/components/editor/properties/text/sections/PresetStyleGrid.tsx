/**
 * PresetStyleGrid.tsx
 *
 * Professional CapCut-parity "PRESET STYLE" grid with visual "Aa" preview cards,
 * collapsible drawer, 23 styled presets, and instant style application.
 */

import React from "react";
import { Ban } from "lucide-react";
import { useTranslation } from "@/i18n";
import type { TextClip } from "@/types";
import {
  TEXT_STYLE_PRESETS,
  isPresetActive,
  type TextStylePreset,
} from "../../data/textStylePresets";

interface PresetStyleGridProps {
  textClip: TextClip;
  onApplyPreset: (preset: TextStylePreset) => void;
}

export const PresetStyleGrid: React.FC<PresetStyleGridProps> = ({
  textClip,
  onApplyPreset,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[#8e8e93] uppercase font-semibold tracking-wider select-none">
          {t("properties.text.presetStyle") || "PRESET STYLE"}
        </span>
      </div>

      {/* Preset Cards Container */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-2">
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
      className={`aspect-square w-11 rounded-lg flex items-center justify-center transition-all cursor-pointer relative shrink-0 ${
        active
          ? "border-2 border-[#f3b584]"
          : "border border-white/5 bg-[#242426a0]"
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
