import React, { useMemo } from "react";
import { Filter, Sparkles } from "lucide-react";
import type { Clip } from "@/types";
import { PropertySection } from "../../primitives/PropertySection";
import { SliderTrack } from "../../primitives/SliderTrack";
import { NumericControl } from "../../primitives/NumericControl";

interface TimelineEffectSectionProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
}

export function getEffectIntensityPercent(
  intensity: unknown,
  fallback = 0.8,
): number {
  const raw =
    typeof intensity === "number" && Number.isFinite(intensity)
      ? intensity
      : fallback;
  const normalized = raw > 1 ? raw / 100 : raw;
  return Math.round(Math.min(1, Math.max(0, normalized)) * 100);
}

export const TimelineEffectSection: React.FC<TimelineEffectSectionProps> = ({
  selectedClip,
  handleUpdate,
}) => {
  const kind = selectedClip.kind;
  const isFilterClip = kind === "filter";
  const title = isFilterClip ? "Filter Settings" : "Effect Settings";
  const subtitle = isFilterClip
    ? "Timeline Filter"
    : kind === "body-effect"
      ? "Body Effect"
      : "Video Effect";
  const Icon = isFilterClip ? Filter : Sparkles;
  const intensityPercent = useMemo(
    () => getEffectIntensityPercent((selectedClip as any).intensity),
    [selectedClip],
  );

  return (
    <PropertySection
      title={title}
      icon={<Icon className="w-3.5 h-3.5 text-accent-soft" />}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between bg-surface-raised/40 border border-border/30 rounded-lg p-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-text-primary truncate">
              {selectedClip.name || subtitle}
            </p>
            <p className="text-[10px] text-text-muted mt-0.5">{subtitle}</p>
          </div>
        </div>

        {/* Compact inline intensity control */}
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] text-text-muted select-none shrink-0 min-w-[52px]">
            Intensity
          </span>
          <SliderTrack
            value={intensityPercent}
            min={0}
            max={100}
            step={1}
            onChange={(val) => handleUpdate("intensity", val / 100)}
          />
          <NumericControl
            value={intensityPercent}
            onChange={(val) => handleUpdate("intensity", val / 100)}
            step={1}
            suffix="%"
            ariaLabel="Effect Intensity"
            min={0}
            max={100}
            inputPosition="text-right"
          />
        </div>
      </div>
    </PropertySection>
  );
};
