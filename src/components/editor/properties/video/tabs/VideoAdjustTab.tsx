import React, { useMemo, useState } from "react";
import type { Clip } from "@/types";
import { filterCacheManager } from "@/features/filters/cache/filterCache";
import type { ColorAdjustments } from "@clypra-studio/engine";
import { LUTSection } from "../sections/LUTSection";
import { PropertySectionHeader } from "../../primitives/PropertySectionHeader";
import { GradientSliderControl } from "../../primitives/GradientSliderControl";
import { HSLSection } from "../sections/HSLSection";

type AdjustSubTab = "basic" | "hsl" | "curves" | "color-wheel" | "mask";

interface VideoAdjustTabProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
}

export const VideoAdjustTab: React.FC<VideoAdjustTabProps> = ({
  selectedClip,
  handleUpdate,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<AdjustSubTab>("basic");
  const [lutOpen, setLutOpen] = useState(true);
  const [adjustOpen, setAdjustOpen] = useState(true);

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

  return (
    <div className="space-y-1.5 select-none text-white relative p-2 pt-0">
      {/* Sticky header: sub-tab switcher */}
      <div className="bg-(--color-gray-900) pt-2 sticky top-0 z-10 space-y-1.5">
        <div className="bg-panel p-0.5 rounded-sm flex gap-1 border border-white/5">
          {(["basic", "hsl", "curves", "color-wheel", "mask"] as const).map(
            (tab) => {
              const isLocked = tab !== "basic" && tab !== "hsl";
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
          {/* LUT Section */}
          <div className="space-y-2">
            <PropertySectionHeader
              title="LUT"
              isCollapsed={!lutOpen}
              onToggleCollapse={() => setLutOpen(!lutOpen)}
            />

            {lutOpen && (
              <LUTSection
                selectedClip={selectedClip}
                handleUpdate={handleUpdate}
              />
            )}
          </div>

          <div className="h-px bg-white/5" />

          {/* Adjust Section */}
          <div className="space-y-2">
            <PropertySectionHeader
              title="ADJUST"
              isCollapsed={!adjustOpen}
              onToggleCollapse={() => setAdjustOpen(!adjustOpen)}
            />

            {adjustOpen && (
              <div className="pt-2 space-y-4">
                {/* Color Section */}
                <div className="space-y-3">
                  <div className="text-[10px] text-white/40 tracking-wider">
                    Color
                  </div>
                  <GradientSliderControl
                    label="Temp"
                    value={getVal("temperature", 0)}
                    min={-100}
                    max={100}
                    gradient="temp"
                    onChange={(val) => updateField("temperature", val)}
                  />
                  <GradientSliderControl
                    label="Tint"
                    value={getVal("tint", 0)}
                    min={-100}
                    max={100}
                    gradient="tint"
                    onChange={(val) => updateField("tint", val)}
                  />
                  <GradientSliderControl
                    label="Saturation"
                    value={getVal("saturation", 0)}
                    min={-100}
                    max={100}
                    gradient="saturation"
                    onChange={(val) => updateField("saturation", val)}
                  />
                </div>

                {/* Lightness Section */}
                <div className="space-y-3">
                  <div className="text-[10px] text-white/40 tracking-wider">
                    Lightness
                  </div>
                  <GradientSliderControl
                    label="Exposure"
                    value={getVal("exposure", 0)}
                    min={-100}
                    max={100}
                    onChange={(val) => updateField("exposure", val)}
                  />
                  <GradientSliderControl
                    label="Contrast"
                    value={getVal("contrast", 0)}
                    min={-100}
                    max={100}
                    onChange={(val) => updateField("contrast", val)}
                  />
                  <GradientSliderControl
                    label="Highlight"
                    value={getVal("highlight", 0)}
                    min={-100}
                    max={100}
                    onChange={(val) => updateField("highlight", val)}
                  />
                  <GradientSliderControl
                    label="Shadow"
                    value={getVal("shadow", 0)}
                    min={-100}
                    max={100}
                    onChange={(val) => updateField("shadow", val)}
                  />
                  <GradientSliderControl
                    label="Whites"
                    value={getVal("whites", 0)}
                    min={-100}
                    max={100}
                    onChange={(val) => updateField("whites", val)}
                  />
                  <GradientSliderControl
                    label="Blacks"
                    value={getVal("blacks", 0)}
                    min={-100}
                    max={100}
                    onChange={(val) => updateField("blacks", val)}
                  />
                  <GradientSliderControl
                    label="Brilliance"
                    value={getVal("brilliance", 0)}
                    min={-100}
                    max={100}
                    onChange={(val) => updateField("brilliance", val)}
                  />
                </div>

                {/* Effects Section */}
                <div className="space-y-3">
                  <div className="text-[10px] text-white/40 tracking-wider">
                    Effects
                  </div>
                  <GradientSliderControl
                    label="Sharpen"
                    value={getVal("sharpen", 0)}
                    min={0}
                    max={100}
                    onChange={(val) => updateField("sharpen", val)}
                  />
                  <GradientSliderControl
                    label="Clarity"
                    value={getVal("clarity", 0)}
                    min={-100}
                    max={100}
                    onChange={(val) => updateField("clarity", val)}
                  />
                  <GradientSliderControl
                    label="Particles"
                    value={getVal("particles", 0)}
                    min={0}
                    max={100}
                    onChange={(val) => updateField("particles", val)}
                  />
                  <GradientSliderControl
                    label="Fade"
                    value={getVal("fade", 0)}
                    min={0}
                    max={100}
                    onChange={(val) => updateField("fade", val)}
                  />
                  <GradientSliderControl
                    label="Vignette"
                    value={getVal("vignette", 0)}
                    min={0}
                    max={100}
                    onChange={(val) => updateField("vignette", val)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* HSL Sub-tab */}
      {activeSubTab === "hsl" && (
        <HSLSection selectedClip={selectedClip} handleUpdate={handleUpdate} />
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
