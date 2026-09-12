import React from "react";
import { PLATFORM_PRESETS } from "./platformPresets";
import type { ThumbnailPlatformPreset } from "@/types";

interface ThumbnailPlatformPickerProps {
  currentPreset: ThumbnailPlatformPreset;
  onSelectPreset: (preset: ThumbnailPlatformPreset) => void;
}

export const ThumbnailPlatformPicker: React.FC<ThumbnailPlatformPickerProps> = ({
  currentPreset,
  onSelectPreset,
}) => {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
        Platform & Dimensions
      </label>
      <div className="grid grid-cols-2 gap-2">
        {PLATFORM_PRESETS.map((preset) => {
          const isSelected =
            preset.kind === currentPreset.kind &&
            preset.width === currentPreset.width &&
            preset.height === currentPreset.height;

          return (
            <button
              key={`${preset.kind}-${preset.width}x${preset.height}`}
              onClick={() => onSelectPreset(preset)}
              type="button"
              className={`flex flex-col items-start p-2.5 rounded-lg border text-left transition-all ${
                isSelected
                  ? "bg-sky-500/15 border-sky-500 text-sky-200 shadow-sm"
                  : "bg-neutral-800/60 border-neutral-700/60 text-neutral-300 hover:bg-neutral-800 hover:border-neutral-600"
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-xs font-medium truncate">{preset.label}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-700/60 text-neutral-400 font-mono">
                  {preset.aspectRatioLabel}
                </span>
              </div>
              <span className="text-[11px] text-neutral-400 mt-1 font-mono">
                {preset.width} × {preset.height}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
