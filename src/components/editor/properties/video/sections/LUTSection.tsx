import React from "react";
import type { Clip } from "@/types";
import { SliderTrack } from "../../primitives/SliderTrack";
import { NumericControl } from "../../primitives/NumericControl";

interface LUTSectionProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
}

export const LUTSection: React.FC<LUTSectionProps> = ({
  selectedClip,
  handleUpdate,
}) => {
  const adjustments = selectedClip.adjustments ?? {};
  const lut = (adjustments as any).lut ?? null;
  const intensity = lut?.intensity ?? 100;
  const protectSkinTone = lut?.protectSkinTone ?? true;

  const updateIntensity = (newIntensity: number) => {
    const nextLut = { ...(lut || {}), intensity: newIntensity };
    handleUpdate("adjustments", { ...adjustments, lut: nextLut });
  };

  const toggleProtectSkinTone = (enabled: boolean) => {
    const nextLut = { ...(lut || {}), protectSkinTone: enabled };
    handleUpdate("adjustments", { ...adjustments, lut: nextLut });
  };

  return (
    <div className="space-y-4">
      {/* Name Dropdown */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-white/60 min-w-[100px]">Name</label>
        <select
          value=""
          className="flex-1 px-3 py-2 text-sm bg-[#2c2c2e] border border-white/10 rounded text-white/80 focus:outline-none focus:border-white/30 cursor-pointer"
        >
          <option value="">None</option>
        </select>
      </div>

      {/* Intensity Slider */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-white/60 min-w-[100px]">Intensity</label>
        <div className="flex-1 flex items-center gap-2">
          <SliderTrack
            value={intensity}
            min={0}
            max={100}
            step={1}
            onChange={updateIntensity}
          />
          <NumericControl
            value={intensity}
            onChange={updateIntensity}
            step={1}
            min={0}
            max={100}
            inputWidth="w-16"
          />
        </div>
      </div>

      {/* Protect Skin Tone Toggle */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="text-sm text-white/80 font-medium">
            Protect skin tone
          </div>
          <div className="text-xs text-white/40 mt-0.5">
            Turn it on to make skin tones more natural.
          </div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={protectSkinTone}
            onChange={(e) => toggleProtectSkinTone(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-[#48484a] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
        </label>
      </div>
    </div>
  );
};
