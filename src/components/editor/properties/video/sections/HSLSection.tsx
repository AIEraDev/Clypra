/**
 * HSLSection.tsx
 *
 * HSL (Hue, Saturation, Lightness) color adjustment section.
 *
 * Channel selector (All + 8 color chips) drives which channel the
 * Hue/Saturation/Brightness sliders target:
 *  - "all"   → flat adjustments.hue/saturation/brightness (processed by GPU)
 *  - named   → adjustments.hslChannels[channel].{hue,saturation,brightness}
 *               (persisted for future per-channel GPU support; currently
 *                stored but not yet applied by the shader — renders correctly
 *                once Task 5 GPU work lands)
 */

import React, { useState } from "react";
import type { Clip } from "@/types";
import { useI18n } from "@/i18n";
import type { ColorAdjustments } from "@clypra-studio/engine";
import { PropertySectionHeader } from "../../primitives/PropertySectionHeader";
import { GradientSliderControl } from "../../primitives/GradientSliderControl";

interface HSLSectionProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
}

type HslChannel =
  | "all"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "cyan"
  | "blue"
  | "purple"
  | "magenta";

const COLOR_PRESETS: Array<{ color: string; label: HslChannel }> = [
  { color: "#1a1a1a", label: "all" },
  { color: "#ff4444", label: "red" },
  { color: "#ff8800", label: "orange" },
  { color: "#ffee00", label: "yellow" },
  { color: "#44ff44", label: "green" },
  { color: "#00ddff", label: "cyan" },
  { color: "#4488ff", label: "blue" },
  { color: "#aa44ff", label: "purple" },
  { color: "#ff44dd", label: "magenta" },
];

export const HSLSection: React.FC<HSLSectionProps> = ({
  selectedClip,
  handleUpdate,
}) => {
  const { t } = useI18n();
  const [basicOpen, setBasicOpen] = useState(true);
  const [selectedChannel, setSelectedChannel] = useState<HslChannel>("all");

  const adjustments = (selectedClip.adjustments ?? {}) as Record<string, any>;

  // ── Read / write helpers ────────────────────────────────────────────────────

  const getChannelVal = (
    field: "hue" | "saturation" | "brightness",
    defaultVal: number,
  ): number => {
    if (selectedChannel === "all") {
      const val = adjustments[field];
      return typeof val === "number" ? val : defaultVal;
    }
    const channels = adjustments.hslChannels as
      | Record<string, Record<string, number>>
      | undefined;
    return channels?.[selectedChannel]?.[field] ?? defaultVal;
  };

  const updateChannelVal = (
    field: "hue" | "saturation" | "brightness",
    value: number,
  ) => {
    if (selectedChannel === "all") {
      handleUpdate("adjustments", { ...adjustments, [field]: value });
      return;
    }
    const prevChannels =
      (adjustments.hslChannels as Record<string, Record<string, number>>) ?? {};
    const prevChannel = prevChannels[selectedChannel] ?? {
      hue: 0,
      saturation: 0,
      brightness: 0,
    };
    handleUpdate("adjustments", {
      ...adjustments,
      hslChannels: {
        ...prevChannels,
        [selectedChannel]: { ...prevChannel, [field]: value },
      },
    });
  };

  const resetChannel = () => {
    if (selectedChannel === "all") {
      const { hue, saturation, brightness, ...rest } = adjustments;
      void hue;
      void saturation;
      void brightness;
      handleUpdate("adjustments", rest);
      return;
    }
    const prevChannels =
      (adjustments.hslChannels as Record<string, Record<string, number>>) ?? {};
    const { [selectedChannel]: _removed, ...restChannels } = prevChannels;
    void _removed;
    const next = { ...adjustments, hslChannels: restChannels };
    if (Object.keys(restChannels).length === 0) {
      const { hslChannels: _unused, ...withoutChannels } = next;
      void _unused;
      handleUpdate("adjustments", withoutChannels);
      return;
    }
    handleUpdate("adjustments", next);
  };

  const hasChannelValues =
    selectedChannel === "all"
      ? adjustments.hue !== undefined ||
        adjustments.saturation !== undefined ||
        adjustments.brightness !== undefined
      : !!(
          adjustments.hslChannels as
            | Record<string, Record<string, number>>
            | undefined
        )?.[selectedChannel];

  return (
    <div className="p-3 space-y-3">
      <div className="space-y-2">
        <PropertySectionHeader
          title={t("properties.subtabs.basic").toUpperCase()}
          isCollapsed={!basicOpen}
          onToggleCollapse={() => setBasicOpen(!basicOpen)}
          onReset={hasChannelValues ? resetChannel : undefined}
          resetTitle={t("properties.adjust.resetChannel", {
            channel:
              selectedChannel === "all"
                ? t("properties.adjust.allChannels")
                : selectedChannel,
          })}
          isKeyframe={hasChannelValues}
        />

        {basicOpen && (
          <div className="pt-2 space-y-4">
            {/* Channel selector row */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {COLOR_PRESETS.map(({ color, label }) => {
                const isActive = selectedChannel === label;
                const isAll = label === "all";
                return (
                  <button
                    key={label}
                    type="button"
                    title={
                      isAll
                        ? t("properties.adjust.allChannels")
                        : label.charAt(0).toUpperCase() + label.slice(1)
                    }
                    aria-label={
                      isAll ? t("properties.adjust.allChannels") : label
                    }
                    aria-pressed={isActive}
                    onClick={() => setSelectedChannel(label)}
                    className={[
                      "transition-all cursor-pointer",
                      isAll
                        ? // Eyedropper-style "All" button
                          `w-8 h-8 flex items-center justify-center rounded border-2 ${
                            isActive
                              ? "border-accent-primary bg-accent-primary/20"
                              : "border-border-default bg-surface-elevated hover:border-border-hover"
                          }`
                        : // Color chip
                          `w-7 h-7 rounded-full border-2 hover:scale-110 ${
                            isActive
                              ? "border-white/90 scale-110 shadow-[0_0_0_2px_rgba(255,255,255,0.25)]"
                              : "border-white/20 hover:border-white/50"
                          }`,
                    ].join(" ")}
                    style={isAll ? undefined : { backgroundColor: color }}
                  >
                    {isAll && (
                      // Star / all icon
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={isActive ? "text-accent-primary font-semibold" : "text-text-muted"}
                      >
                        <circle cx="12" cy="12" r="4" />
                        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Per-channel label */}
            {selectedChannel !== "all" && (
              <div className="text-[10px] text-text-muted tracking-wider capitalize">
                {selectedChannel} {t("properties.adjust.channelSuffix")}
              </div>
            )}

            {/* Hue */}
            <GradientSliderControl
              label={t("properties.adjust.hue")}
              value={getChannelVal("hue", 0)}
              min={-180}
              max={180}
              onChange={(val) => updateChannelVal("hue", val)}
            />

            {/* Saturation */}
            <GradientSliderControl
              label={t("properties.adjust.saturation")}
              value={getChannelVal("saturation", 0)}
              min={-100}
              max={100}
              gradient="saturation"
              onChange={(val) => updateChannelVal("saturation", val)}
            />

            {/* Brightness */}
            <GradientSliderControl
              label={t("properties.adjust.brightness")}
              value={getChannelVal("brightness", 0)}
              min={-100}
              max={100}
              onChange={(val) => updateChannelVal("brightness", val)}
            />
          </div>
        )}
      </div>
    </div>
  );
};
