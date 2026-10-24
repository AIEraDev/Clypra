import React, { useMemo, useState } from "react";
import { ChevronDown, Undo2 } from "lucide-react";
import type { Clip } from "@/types";
import { filterCacheManager } from "@/features/filters/cache/filterCache";
import type { ColorAdjustments } from "@clypra-studio/engine";
import { ColorWheelsSection } from "./ColorWheelsSection";
import { LUTSection } from "./LUTSection";
import { ClypraColorPicker } from "@clypra/ui-color-picker";

type AdjustSubTab = "basic" | "hsl" | "curves" | "color-wheel" | "mask";

interface VideoAdjustTabProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
}

interface SliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  isOverridden: boolean;
  isAuto: boolean;
  onChange: (val: number) => void;
  onReset: () => void;
}

const SliderControl: React.FC<SliderControlProps> = ({
  label,
  value,
  min,
  max,
  step = 0.05,
  isOverridden,
  isAuto,
  onChange,
  onReset,
}) => {
  const range = max - min;
  const fillPercent =
    range > 0 ? Math.min(100, Math.max(0, ((value - min) / range) * 100)) : 0;

  return (
    <div className="flex items-center gap-3">
      <label
        className="text-xs text-white/60 min-w-[100px] cursor-pointer"
        onDoubleClick={onReset}
        title="Double-click to reset"
      >
        {label}
        {isAuto && <span className="opacity-60 text-[10px] ml-1">(auto)</span>}
      </label>
      <div className="flex-1 flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={onReset}
          className="flex-1 h-1 rounded-full appearance-none outline-none cursor-pointer bg-white/5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
          style={{
            background: isOverridden
              ? `linear-gradient(to right, #a855f7 0%, #a855f7 ${fillPercent}%, rgba(255,255,255,0.05) ${fillPercent}%, rgba(255,255,255,0.05) 100%)`
              : isAuto
                ? `linear-gradient(to right, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.3) ${fillPercent}%, rgba(255,255,255,0.05) ${fillPercent}%, rgba(255,255,255,0.05) 100%)`
                : `linear-gradient(to right, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.2) ${fillPercent}%, rgba(255,255,255,0.05) ${fillPercent}%, rgba(255,255,255,0.05) 100%)`,
          }}
        />
        <input
          type="number"
          value={value.toFixed(step < 0.1 ? 2 : step === 1 ? 0 : 1)}
          onChange={(e) => onChange(Number(e.target.value))}
          step={step}
          min={min}
          max={max}
          className={`w-16 px-2 py-1 text-xs rounded border bg-[#1c1c1e] text-center tabular-nums ${
            isOverridden
              ? "border-purple-500/30 text-purple-400"
              : "border-white/10 text-white/80"
          } focus:outline-none focus:border-white/30`}
        />
        {isOverridden && (
          <button
            onClick={onReset}
            className="text-purple-400 hover:text-purple-300 transition-colors p-1 shrink-0 cursor-pointer"
            title="Reset override"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};

export const VideoAdjustTab: React.FC<VideoAdjustTabProps> = ({
  selectedClip,
  handleUpdate,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<AdjustSubTab>("basic");
  const [colorCorrectionOpen, setColorCorrectionOpen] = useState(true);
  const [lutOpen, setLutOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const [colorCorrectionEnabled, setColorCorrectionEnabled] = useState(true);
  const [lutEnabled, setLutEnabled] = useState(true);
  const [adjustEnabled, setAdjustEnabled] = useState(true);

  // Resolve preset parameters
  const presetParams = useMemo(() => {
    if (!selectedClip.filter) return undefined;
    return filterCacheManager.getCached(selectedClip.filter.id)?.filter
      ?.gradingParams;
  }, [selectedClip.filter]);

  const adjustments = selectedClip.adjustments ?? {};

  const updateField = (key: keyof ColorAdjustments, value: any) => {
    const nextAdjustments = { ...adjustments, [key]: value };
    handleUpdate("adjustments", nextAdjustments);
  };

  const updateStructuredField = (
    key: "vibrance" | "grain" | "crossProcess",
    subFields: Record<string, any>,
  ) => {
    const current = adjustments[key] || {};
    const nextAdjustments = {
      ...adjustments,
      [key]: { ...current, ...subFields },
    };
    handleUpdate("adjustments", nextAdjustments);
  };

  const resetAdjustment = (key: keyof ColorAdjustments) => {
    const nextAdjustments = { ...adjustments };
    delete nextAdjustments[key];
    handleUpdate("adjustments", nextAdjustments);
  };

  // Resolve values defensively
  const getVal = (key: keyof ColorAdjustments, defaultVal: number): number => {
    if (key in adjustments) {
      return adjustments[key] as number;
    }
    if (presetParams) {
      if (key === "hue") {
        return presetParams.hueRotate !== undefined
          ? (presetParams.hueRotate * 180) / Math.PI
          : defaultVal;
      }
      if (key in presetParams) {
        return (presetParams as any)[key] as number;
      }
    }
    return defaultVal;
  };

  const isOverridden = (key: keyof ColorAdjustments) => key in adjustments;
  const isAuto = (key: keyof ColorAdjustments) => {
    if (isOverridden(key)) return false;
    if (!presetParams) return false;
    if (key === "hue") return presetParams.hueRotate !== undefined;
    return (presetParams as any)[key] !== undefined;
  };

  return (
    <div className="space-y-1.5 select-none text-white relative p-2 pt-0">
      {/* Sticky header: sub-tab switcher */}
      <div className="bg-(--color-gray-900) pt-2 sticky top-0 z-10 space-y-1.5">
        <div className="bg-panel p-0.5 rounded-sm flex gap-1 border border-white/5">
          {(["basic", "hsl", "curves", "color-wheel", "mask"] as const).map(
            (tab) => {
              const isLocked = tab !== "basic";
              const labels = {
                basic: "Basic",
                hsl: "HSL",
                curves: "Curves",
                "color-wheel": "Color wheel",
                mask: "Mask",
              };

              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => !isLocked && setActiveSubTab(tab)}
                  disabled={isLocked}
                  title={isLocked ? "Coming soon" : undefined}
                  className={`flex-1 py-0.5 text-xs rounded-sm transition-all text-center flex items-center justify-center gap-1 ${
                    isLocked
                      ? "text-[#8e8e93]/50 cursor-not-allowed"
                      : activeSubTab === tab
                        ? "bg-[#38383e] text-white shadow-sm font-semibold cursor-pointer"
                        : "text-[#8e8e93] hover:text-white cursor-pointer"
                  }`}
                >
                  {labels[tab]}
                  {isLocked && (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-2.5 h-2.5 shrink-0"
                    >
                      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  )}
                </button>
              );
            },
          )}
        </div>
      </div>

      {/* Basic Sub-tab Content */}
      {activeSubTab === "basic" && (
        <div className="p-3 space-y-3">
          {/* Color Correction Section */}
          <div className="space-y-2">
            <button
              onClick={() => setColorCorrectionOpen(!colorCorrectionOpen)}
              className="w-full flex items-center justify-between text-sm text-white/80 hover:text-white transition-colors"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={colorCorrectionEnabled}
                  onChange={(e) => {
                    e.stopPropagation();
                    setColorCorrectionEnabled(e.target.checked);
                  }}
                  className="w-3.5 h-3.5 rounded border border-white/20 bg-[#1c1c1e] checked:bg-cyan-500 text-cyan-500 accent-cyan-500 focus:outline-none cursor-pointer"
                />
                <span className="font-medium">Color correction</span>
              </div>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${colorCorrectionOpen ? "" : "-rotate-90"}`}
              />
            </button>

            {colorCorrectionOpen && (
              <div className="pl-6 pt-2 space-y-3">
                {/* Basic Adjustments */}
                <SliderControl
                  label="Exposure"
                  value={getVal("exposure", 0.0)}
                  min={-2.0}
                  max={2.0}
                  isOverridden={isOverridden("exposure")}
                  isAuto={isAuto("exposure")}
                  onChange={(val) => updateField("exposure", val)}
                  onReset={() => resetAdjustment("exposure")}
                />
                <SliderControl
                  label="Brightness"
                  value={getVal("brightness", 0.0)}
                  min={-1.0}
                  max={1.0}
                  isOverridden={isOverridden("brightness")}
                  isAuto={isAuto("brightness")}
                  onChange={(val) => updateField("brightness", val)}
                  onReset={() => resetAdjustment("brightness")}
                />
                <SliderControl
                  label="Contrast"
                  value={getVal("contrast", 0.0)}
                  min={-1.0}
                  max={1.0}
                  isOverridden={isOverridden("contrast")}
                  isAuto={isAuto("contrast")}
                  onChange={(val) => updateField("contrast", val)}
                  onReset={() => resetAdjustment("contrast")}
                />
                <SliderControl
                  label="Saturation"
                  value={getVal("saturation", 0.0)}
                  min={-1.0}
                  max={1.0}
                  isOverridden={isOverridden("saturation")}
                  isAuto={isAuto("saturation")}
                  onChange={(val) => updateField("saturation", val)}
                  onReset={() => resetAdjustment("saturation")}
                />

                <div className="h-px bg-white/5 my-3" />

                {/* Color & White Balance */}
                <SliderControl
                  label="Temperature"
                  value={getVal("temperature", 0.0)}
                  min={-1.0}
                  max={1.0}
                  isOverridden={isOverridden("temperature")}
                  isAuto={isAuto("temperature")}
                  onChange={(val) => updateField("temperature", val)}
                  onReset={() => resetAdjustment("temperature")}
                />
                <SliderControl
                  label="Tint"
                  value={getVal("tint", 0.0)}
                  min={-1.0}
                  max={1.0}
                  isOverridden={isOverridden("tint")}
                  isAuto={isAuto("tint")}
                  onChange={(val) => updateField("tint", val)}
                  onReset={() => resetAdjustment("tint")}
                />
                <SliderControl
                  label="Sepia"
                  value={getVal("sepia", 0.0)}
                  min={0.0}
                  max={1.0}
                  isOverridden={isOverridden("sepia")}
                  isAuto={isAuto("sepia")}
                  onChange={(val) => updateField("sepia", val)}
                  onReset={() => resetAdjustment("sepia")}
                />
                <SliderControl
                  label="Grayscale"
                  value={getVal("grayscale", 0.0)}
                  min={0.0}
                  max={1.0}
                  isOverridden={isOverridden("grayscale")}
                  isAuto={isAuto("grayscale")}
                  onChange={(val) => updateField("grayscale", val)}
                  onReset={() => resetAdjustment("grayscale")}
                />
                <SliderControl
                  label="Hue"
                  value={getVal("hue", 0.0)}
                  min={0.0}
                  max={360.0}
                  step={1.0}
                  isOverridden={isOverridden("hue")}
                  isAuto={isAuto("hue")}
                  onChange={(val) => updateField("hue", val)}
                  onReset={() => resetAdjustment("hue")}
                />

                <div className="h-px bg-white/5 my-3" />

                {/* Creative */}
                <SliderControl
                  label="Vignette"
                  value={getVal("vignette", 0.0)}
                  min={0.0}
                  max={1.0}
                  isOverridden={isOverridden("vignette")}
                  isAuto={isAuto("vignette")}
                  onChange={(val) => updateField("vignette", val)}
                  onReset={() => resetAdjustment("vignette")}
                />
                <div className="flex items-center gap-3">
                  <label className="text-xs text-white/60 min-w-[100px]">
                    Invert Color
                    {isAuto("invert") && (
                      <span className="opacity-60 text-[10px] ml-1">
                        (auto)
                      </span>
                    )}
                  </label>
                  <div className="flex-1 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={
                        isOverridden("invert")
                          ? !!adjustments.invert
                          : presetParams?.invert !== undefined
                            ? presetParams.invert > 0.5
                            : false
                      }
                      onChange={(e) => updateField("invert", e.target.checked)}
                      className="w-4 h-4 rounded border border-white/20 bg-[#1c1c1e] checked:bg-purple-500 text-purple-500 accent-purple-500 focus:outline-none cursor-pointer"
                    />
                    {isOverridden("invert") && (
                      <button
                        onClick={() => resetAdjustment("invert")}
                        className="text-purple-400 hover:text-purple-300 transition-colors p-1 ml-auto"
                        title="Reset override"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="h-px bg-white/5 my-3" />

                {/* 3-Way Color Wheels */}
                <ColorWheelsSection
                  selectedClip={selectedClip}
                  handleUpdate={handleUpdate}
                />
              </div>
            )}
          </div>

          <div className="h-px bg-white/5" />

          {/* LUT Section */}
          <div className="space-y-2">
            <button
              onClick={() => setLutOpen(!lutOpen)}
              className="w-full flex items-center justify-between text-sm text-white/80 hover:text-white transition-colors"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={lutEnabled}
                  onChange={(e) => {
                    e.stopPropagation();
                    setLutEnabled(e.target.checked);
                  }}
                  className="w-3.5 h-3.5 rounded border border-white/20 bg-[#1c1c1e] checked:bg-cyan-500 text-cyan-500 accent-cyan-500 focus:outline-none cursor-pointer"
                />
                <span className="font-medium">LUT</span>
              </div>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${lutOpen ? "" : "-rotate-90"}`}
              />
            </button>

            {lutOpen && (
              <div className="pl-6 pt-2">
                <LUTSection
                  selectedClip={selectedClip}
                  handleUpdate={handleUpdate}
                />
              </div>
            )}
          </div>

          <div className="h-px bg-white/5" />

          {/* Adjust Section */}
          <div className="space-y-2">
            <button
              onClick={() => setAdjustOpen(!adjustOpen)}
              className="w-full flex items-center justify-between text-sm text-white/80 hover:text-white transition-colors"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={adjustEnabled}
                  onChange={(e) => {
                    e.stopPropagation();
                    setAdjustEnabled(e.target.checked);
                  }}
                  className="w-3.5 h-3.5 rounded border border-white/20 bg-[#1c1c1e] checked:bg-cyan-500 text-cyan-500 accent-cyan-500 focus:outline-none cursor-pointer"
                />
                <span className="font-medium">Adjust</span>
              </div>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${adjustOpen ? "" : "-rotate-90"}`}
              />
            </button>

            {adjustOpen && (
              <div className="pl-6 pt-2 space-y-3">
                <SliderControl
                  label="Lift"
                  value={getVal("lift", 0.0)}
                  min={-1.0}
                  max={1.0}
                  isOverridden={isOverridden("lift")}
                  isAuto={isAuto("lift")}
                  onChange={(val) => updateField("lift", val)}
                  onReset={() => resetAdjustment("lift")}
                />

                {/* Vibrance */}
                <div
                  className={`p-3 rounded-lg border space-y-3 ${
                    isOverridden("vibrance")
                      ? "border-purple-500/30 bg-purple-500/5"
                      : "border-white/10 bg-white/2"
                  }`}
                >
                  <SliderControl
                    label="Vibrance Amount"
                    value={
                      isOverridden("vibrance")
                        ? (adjustments.vibrance?.amount ?? 0.0)
                        : (presetParams?.vibrance?.amount ?? 0.0)
                    }
                    min={-1.0}
                    max={1.0}
                    isOverridden={isOverridden("vibrance")}
                    isAuto={
                      !isOverridden("vibrance") && !!presetParams?.vibrance
                    }
                    onChange={(val) =>
                      updateStructuredField("vibrance", { amount: val })
                    }
                    onReset={() => resetAdjustment("vibrance")}
                  />
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-white/60 min-w-[100px]">
                      Skin Tone Hue
                    </label>
                    <div className="flex-1 flex items-center gap-2">
                      <ClypraColorPicker
                        value={
                          isOverridden("vibrance")
                            ? (adjustments.vibrance?.protectedHue ?? "#E8B08C")
                            : (presetParams?.vibrance?.protectedHue ??
                              "#E8B08C")
                        }
                        onChange={(c: string) =>
                          updateStructuredField("vibrance", { protectedHue: c })
                        }
                        onChangeComplete={(c: string) =>
                          updateStructuredField("vibrance", { protectedHue: c })
                        }
                        format="hex"
                        showAlpha={false}
                        size="sm"
                        triggerClassName="w-20 h-7 bg-[#1c1c1e] border-white/10 hover:border-white/20 shrink-0"
                        popoverClassName="right-0 left-auto mt-1 z-[100]"
                      />
                      {isOverridden("vibrance") && (
                        <button
                          onClick={() => resetAdjustment("vibrance")}
                          className="text-purple-400 hover:text-purple-300 transition-colors p-1 ml-auto"
                          title="Reset override"
                        >
                          <Undo2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Film Grain */}
                <div
                  className={`p-3 rounded-lg border space-y-3 ${
                    isOverridden("grain")
                      ? "border-purple-500/30 bg-purple-500/5"
                      : "border-white/10 bg-white/2"
                  }`}
                >
                  <SliderControl
                    label="Grain Intensity"
                    value={
                      isOverridden("grain")
                        ? (adjustments.grain?.intensity ?? 0.0)
                        : (presetParams?.grain?.intensity ?? 0.0)
                    }
                    min={0.0}
                    max={1.0}
                    isOverridden={isOverridden("grain")}
                    isAuto={!isOverridden("grain") && !!presetParams?.grain}
                    onChange={(val) =>
                      updateStructuredField("grain", { intensity: val })
                    }
                    onReset={() => resetAdjustment("grain")}
                  />
                  <SliderControl
                    label="Grain Size"
                    value={
                      isOverridden("grain")
                        ? (adjustments.grain?.size ?? 1.0)
                        : (presetParams?.grain?.size ?? 1.0)
                    }
                    min={0.5}
                    max={5.0}
                    step={0.1}
                    isOverridden={isOverridden("grain")}
                    isAuto={!isOverridden("grain") && !!presetParams?.grain}
                    onChange={(val) =>
                      updateStructuredField("grain", { size: val })
                    }
                    onReset={() => resetAdjustment("grain")}
                  />
                </div>

                {/* Cross Process */}
                <div
                  className={`p-3 rounded-lg border space-y-3 ${
                    isOverridden("crossProcess")
                      ? "border-purple-500/30 bg-purple-500/5"
                      : "border-white/10 bg-white/2"
                  }`}
                >
                  <SliderControl
                    label="Cross Process"
                    value={
                      isOverridden("crossProcess")
                        ? (adjustments.crossProcess?.amount ?? 0.0)
                        : (presetParams?.crossProcess?.amount ?? 0.0)
                    }
                    min={0.0}
                    max={1.0}
                    isOverridden={isOverridden("crossProcess")}
                    isAuto={
                      !isOverridden("crossProcess") &&
                      !!presetParams?.crossProcess
                    }
                    onChange={(val) =>
                      updateStructuredField("crossProcess", { amount: val })
                    }
                    onReset={() => resetAdjustment("crossProcess")}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="pt-3 space-y-2">
            <button
              className="w-full px-3 py-2 text-sm text-white/80 bg-white/5 hover:bg-white/10 rounded transition-colors cursor-pointer"
              onClick={() => {
                console.log("Apply to all clips");
                // TODO: Implement apply to all
              }}
            >
              Apply to all
            </button>
            <button
              className="w-full px-3 py-2 text-sm text-white/80 bg-white/5 hover:bg-white/10 rounded transition-colors cursor-pointer"
              onClick={() => {
                console.log("Save as preset");
                // TODO: Implement save as preset
              }}
            >
              Save as preset
            </button>
          </div>
        </div>
      )}

      {/* HSL Sub-tab (Locked) */}
      {activeSubTab === "hsl" && (
        <div className="p-4 text-center text-text-muted text-sm">
          HSL feature coming soon
        </div>
      )}

      {/* Curves Sub-tab (Locked) */}
      {activeSubTab === "curves" && (
        <div className="p-4 text-center text-text-muted text-sm">
          Curves feature coming soon
        </div>
      )}

      {/* Color Wheel Sub-tab (Locked) */}
      {activeSubTab === "color-wheel" && (
        <div className="p-4 text-center text-text-muted text-sm">
          Color Wheel feature coming soon
        </div>
      )}

      {/* Mask Sub-tab (Locked) */}
      {activeSubTab === "mask" && (
        <div className="p-4 text-center text-text-muted text-sm">
          Mask feature coming soon
        </div>
      )}
    </div>
  );
};
