import React, { useMemo } from "react";
import { Sparkles, Undo2, RotateCcw } from "lucide-react";
import type { Clip } from "@/types";
import { PropertySection } from "./primitives/PropertySection";
import { filterCacheManager } from "@/features/filters/cache/filterCache";
import type { ColorAdjustments } from "@clypra-studio/engine";
import { ColorWheelsSection } from "./ColorWheelsSection";
import { LUTSection } from "./LUTSection";
import { ClypraColorPicker } from "@clypra/ui-color-picker";

interface AdjustmentsSectionProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
}

interface SliderProps {
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

const AdjustmentSlider: React.FC<SliderProps> = ({
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
    <div className="space-y-1 group select-none">
      <div
        className="flex items-center justify-between cursor-pointer"
        onDoubleClick={onReset}
        title="Double-click to reset"
      >
        <span
          className={`text-[10px] font-medium transition-colors ${isOverridden ? "text-accent font-semibold" : "text-text-muted"}`}
        >
          {label}{" "}
          {isAuto && <span className="opacity-60 text-[8px]">(auto)</span>}
        </span>
        <span
          className={`text-[10px] tabular-nums ${isOverridden ? "text-accent font-medium" : "text-text-primary"}`}
        >
          {value.toFixed(step < 0.1 ? 2 : 0)}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={onReset}
          className="flex-1 h-1 rounded-full appearance-none outline-none cursor-pointer bg-border/60 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-text-primary [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-text-primary [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
          style={{
            background: isOverridden
              ? `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${fillPercent}%, var(--color-border) ${fillPercent}%, var(--color-border) 100%)`
              : isAuto
                ? `linear-gradient(to right, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.3) ${fillPercent}%, var(--color-border) ${fillPercent}%, var(--color-border) 100%)`
                : `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${fillPercent}%, var(--color-border) ${fillPercent}%, var(--color-border) 100%)`,
          }}
        />
        {isOverridden && (
          <button
            onClick={onReset}
            className="text-accent hover:opacity-80 transition-colors p-0.5 shrink-0 cursor-pointer"
            title="Reset override"
          >
            <Undo2 className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
};

export const AdjustmentsSection: React.FC<AdjustmentsSectionProps> = ({
  selectedClip,
  handleUpdate,
}) => {
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

  const resetAllAdjustments = () => {
    handleUpdate("adjustments", {});
  };

  const hasAnyManual = Object.keys(adjustments).length > 0;

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
    <PropertySection
      title="Color Adjustments"
      icon={<Sparkles className="w-3.5 h-3.5" />}
      action={
        hasAnyManual && (
          <button
            onClick={resetAllAdjustments}
            className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1 transition-colors font-medium px-1 cursor-pointer"
            title="Reset all manual overrides"
          >
            <RotateCcw className="w-3 h-3" />
            Reset All
          </button>
        )
      }
    >
      <div className="space-y-4 pt-1">
        {/* Category: Basic Adjustments */}
        <div className="space-y-3">
          <span className="text-[9px] font-bold uppercase tracking-wider text-text-muted select-none">
            Basic Adjustments
          </span>
          <AdjustmentSlider
            label="Exposure"
            value={getVal("exposure", 0.0)}
            min={-2.0}
            max={2.0}
            isOverridden={isOverridden("exposure")}
            isAuto={isAuto("exposure")}
            onChange={(val) => updateField("exposure", val)}
            onReset={() => resetAdjustment("exposure")}
          />
          <AdjustmentSlider
            label="Brightness"
            value={getVal("brightness", 0.0)}
            min={-1.0}
            max={1.0}
            isOverridden={isOverridden("brightness")}
            isAuto={isAuto("brightness")}
            onChange={(val) => updateField("brightness", val)}
            onReset={() => resetAdjustment("brightness")}
          />
          <AdjustmentSlider
            label="Contrast"
            value={getVal("contrast", 0.0)}
            min={-1.0}
            max={1.0}
            isOverridden={isOverridden("contrast")}
            isAuto={isAuto("contrast")}
            onChange={(val) => updateField("contrast", val)}
            onReset={() => resetAdjustment("contrast")}
          />
          <AdjustmentSlider
            label="Saturation"
            value={getVal("saturation", 0.0)}
            min={-1.0}
            max={1.0}
            isOverridden={isOverridden("saturation")}
            isAuto={isAuto("saturation")}
            onChange={(val) => updateField("saturation", val)}
            onReset={() => resetAdjustment("saturation")}
          />
        </div>

        {/* Category: Color & White Balance */}
        <div className="space-y-3 pt-1 border-t border-border/20">
          <span className="text-[9px] font-bold uppercase tracking-wider text-text-muted select-none">
            Color & White Balance
          </span>
          <AdjustmentSlider
            label="Temperature"
            value={getVal("temperature", 0.0)}
            min={-1.0}
            max={1.0}
            isOverridden={isOverridden("temperature")}
            isAuto={isAuto("temperature")}
            onChange={(val) => updateField("temperature", val)}
            onReset={() => resetAdjustment("temperature")}
          />
          <AdjustmentSlider
            label="Tint"
            value={getVal("tint", 0.0)}
            min={-1.0}
            max={1.0}
            isOverridden={isOverridden("tint")}
            isAuto={isAuto("tint")}
            onChange={(val) => updateField("tint", val)}
            onReset={() => resetAdjustment("tint")}
          />
          <AdjustmentSlider
            label="Sepia"
            value={getVal("sepia", 0.0)}
            min={0.0}
            max={1.0}
            isOverridden={isOverridden("sepia")}
            isAuto={isAuto("sepia")}
            onChange={(val) => updateField("sepia", val)}
            onReset={() => resetAdjustment("sepia")}
          />
          <AdjustmentSlider
            label="Grayscale"
            value={getVal("grayscale", 0.0)}
            min={0.0}
            max={1.0}
            isOverridden={isOverridden("grayscale")}
            isAuto={isAuto("grayscale")}
            onChange={(val) => updateField("grayscale", val)}
            onReset={() => resetAdjustment("grayscale")}
          />
          <AdjustmentSlider
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
        </div>

        {/* Category: Creative */}
        <div className="space-y-3 pt-1 border-t border-border/20">
          <span className="text-[9px] font-bold uppercase tracking-wider text-text-muted select-none">
            Creative
          </span>
          <AdjustmentSlider
            label="Vignette"
            value={getVal("vignette", 0.0)}
            min={0.0}
            max={1.0}
            isOverridden={isOverridden("vignette")}
            isAuto={isAuto("vignette")}
            onChange={(val) => updateField("vignette", val)}
            onReset={() => resetAdjustment("vignette")}
          />
          <div className="flex items-center justify-between py-1 select-none">
            <span
              className={`text-[10px] font-medium transition-colors ${isOverridden("invert") ? "text-purple-400 font-semibold" : "text-text-muted"}`}
            >
              Invert Color{" "}
              {isAuto("invert") && (
                <span className="opacity-60 text-[8px]">(auto)</span>
              )}
            </span>
            <div className="flex items-center gap-1.5">
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
                className="w-3.5 h-3.5 rounded border border-border/60 bg-surface-raised checked:bg-accent text-accent accent-accent focus:outline-none cursor-pointer"
              />
              {isOverridden("invert") && (
                <button
                  onClick={() => resetAdjustment("invert")}
                  className="text-purple-400 hover:text-purple-300 transition-colors p-0.5"
                  title="Reset override"
                >
                  <Undo2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Category: Advanced Grading */}
        <div className="space-y-3 pt-1 border-t border-border/20">
          <span className="text-[9px] font-bold uppercase tracking-wider text-text-muted select-none">
            Advanced Grading
          </span>

          {/* Lift */}
          <AdjustmentSlider
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
            className={`p-2.5 rounded-lg bg-white/2 border transition-colors space-y-2.5 ${isOverridden("vibrance") ? "border-purple-500/30" : "border-border/10"}`}
          >
            <AdjustmentSlider
              label="Vibrance Amount"
              value={
                isOverridden("vibrance")
                  ? (adjustments.vibrance?.amount ?? 0.0)
                  : (presetParams?.vibrance?.amount ?? 0.0)
              }
              min={-1.0}
              max={1.0}
              isOverridden={isOverridden("vibrance")}
              isAuto={!isOverridden("vibrance") && !!presetParams?.vibrance}
              onChange={(val) =>
                updateStructuredField("vibrance", { amount: val })
              }
              onReset={() => resetAdjustment("vibrance")}
            />
            <div className="flex items-center justify-between">
              <span
                className={`text-[10px] ${isOverridden("vibrance") ? "text-purple-400" : "text-text-muted"}`}
              >
                Protected Skin Tone Hue
              </span>
              <div className="flex items-center gap-1.5">
                <ClypraColorPicker
                  value={
                    isOverridden("vibrance")
                      ? (adjustments.vibrance?.protectedHue ?? "#E8B08C")
                      : (presetParams?.vibrance?.protectedHue ?? "#E8B08C")
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
                  triggerClassName="w-16 h-6.5 bg-surface border-border/60 hover:border-border shrink-0"
                  popoverClassName="right-0 left-auto mt-1 z-[100]"
                />
                {isOverridden("vibrance") && (
                  <button
                    onClick={() => resetAdjustment("vibrance")}
                    className="text-purple-400 hover:text-purple-300 transition-colors p-0.5"
                    title="Reset override"
                  >
                    <Undo2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Film Grain */}
          <div
            className={`p-2.5 rounded-lg bg-white/2 border transition-colors space-y-2.5 ${isOverridden("grain") ? "border-purple-500/30" : "border-border/10"}`}
          >
            <AdjustmentSlider
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
            <AdjustmentSlider
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
              onChange={(val) => updateStructuredField("grain", { size: val })}
              onReset={() => resetAdjustment("grain")}
            />
          </div>

          {/* Cross Process */}
          <div
            className={`p-2.5 rounded-lg bg-white/2 border transition-colors space-y-2.5 ${isOverridden("crossProcess") ? "border-purple-500/30" : "border-border/10"}`}
          >
            <AdjustmentSlider
              label="Cross Process Amount"
              value={
                isOverridden("crossProcess")
                  ? (adjustments.crossProcess?.amount ?? 0.0)
                  : (presetParams?.crossProcess?.amount ?? 0.0)
              }
              min={0.0}
              max={1.0}
              isOverridden={isOverridden("crossProcess")}
              isAuto={
                !isOverridden("crossProcess") && !!presetParams?.crossProcess
              }
              onChange={(val) =>
                updateStructuredField("crossProcess", { amount: val })
              }
              onReset={() => resetAdjustment("crossProcess")}
            />
          </div>

          {/* 3-Way Color Wheels */}
          <ColorWheelsSection
            selectedClip={selectedClip}
            handleUpdate={handleUpdate}
          />

          {/* 3D LUT Importer & Presets */}
          <LUTSection selectedClip={selectedClip} handleUpdate={handleUpdate} />
        </div>
      </div>
    </PropertySection>
  );
};
