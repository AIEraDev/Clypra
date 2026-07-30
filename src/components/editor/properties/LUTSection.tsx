import React, { useRef } from "react";
import { Sliders, Upload, Trash2 } from "lucide-react";
import type { Clip } from "@/types";
import { PropertySlider } from "./primitives/PropertySlider";

interface LUTSectionProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
}

const PRESET_LUTS = [
  { id: "teal-orange", name: "Teal & Orange (Blockbuster)" },
  { id: "cinematic-warm", name: "Cinematic Golden Hour" },
  { id: "bw-contrast", name: "B&W Noir High Contrast" },
  { id: "vintage-film", name: "Kodak 35mm Vintage" },
];

export const LUTSection: React.FC<LUTSectionProps> = ({
  selectedClip,
  handleUpdate,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const adjustments = selectedClip.adjustments ?? {};
  const lut = (adjustments as any).lut ?? null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const lutName = file.name.replace(/\.[^/.]+$/, "");
    const nextLut = {
      name: lutName,
      path: file.name,
      intensity: lut?.intensity ?? 1.0,
    };

    const nextAdjustments = { ...adjustments, lut: nextLut };
    handleUpdate("adjustments", nextAdjustments);
  };

  const handleSelectPresetLut = (lutId: string) => {
    if (!lutId) {
      removeLut();
      return;
    }

    const preset = PRESET_LUTS.find((l) => l.id === lutId);
    const nextLut = {
      name: preset?.name || lutId,
      presetId: lutId,
      intensity: lut?.intensity ?? 1.0,
    };

    const nextAdjustments = { ...adjustments, lut: nextLut };
    handleUpdate("adjustments", nextAdjustments);
  };

  const updateIntensity = (intensity: number) => {
    if (!lut) return;
    const nextLut = { ...lut, intensity };
    const nextAdjustments = { ...adjustments, lut: nextLut };
    handleUpdate("adjustments", nextAdjustments);
  };

  const removeLut = () => {
    const nextAdjustments = { ...adjustments } as any;
    delete nextAdjustments.lut;
    handleUpdate("adjustments", nextAdjustments);
  };

  return (
    <div className="space-y-3 pt-2 border-t border-white/5">
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">3D LUT (.cube) Profile</span>
        {lut && (
          <button
            onClick={removeLut}
            className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors cursor-pointer"
            title="Remove LUT"
          >
            <Trash2 className="w-3 h-3" />
            Remove
          </button>
        )}
      </div>

      {/* Preset LUT selector */}
      <div className="space-y-1.5">
        <select
          value={lut?.presetId || ""}
          onChange={(e) => handleSelectPresetLut(e.target.value)}
          className="w-full bg-surface-raised border border-white/10 rounded px-2 py-1 text-[11px] text-text-primary outline-none focus:border-accent cursor-pointer"
        >
          <option value="">No LUT Preset Applied</option>
          {PRESET_LUTS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </div>

      {/* Import custom .cube file button */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".cube"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 py-1.5 px-3 text-[11px] font-medium rounded bg-surface-raised hover:bg-white/10 border border-white/10 text-text-secondary hover:text-text-primary transition-all cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5" />
          {lut?.name ? `Active LUT: ${lut.name}` : "Import .cube LUT File..."}
        </button>
      </div>

      {/* LUT Intensity Slider */}
      {lut && (
        <PropertySlider
          label="LUT Intensity"
          value={Math.round((lut.intensity ?? 1.0) * 100)}
          min={0}
          max={100}
          step={5}
          suffix="%"
          onChange={(v) => updateIntensity(v / 100)}
        />
      )}
    </div>
  );
};
