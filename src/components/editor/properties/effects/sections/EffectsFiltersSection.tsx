import React, { useCallback } from "react";
import { Sparkles, SlidersHorizontal, Trash2, Filter } from "lucide-react";
import type { Clip } from "@/types";
import { SliderTrack } from "../../primitives/SliderTrack";
import { NumericControl } from "../../primitives/NumericControl";
import { PropertySection } from "../../primitives/PropertySection";

interface EffectsFiltersSectionProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
}

export const EffectsFiltersSection: React.FC<EffectsFiltersSectionProps> = ({
  selectedClip,
  handleUpdate,
}) => {
  const appliedFilter = selectedClip.filter;
  const appliedEffects = selectedClip.effects || [];

  const handleFilterIntensityChange = useCallback(
    (value: number) => {
      if (!appliedFilter) return;
      handleUpdate("filter", {
        ...appliedFilter,
        intensity: value / 100,
      });
    },
    [appliedFilter, handleUpdate],
  );

  const removeFilter = useCallback(() => {
    handleUpdate("filter", undefined);
  }, [handleUpdate]);

  const handleEffectIntensityChange = useCallback(
    (effectId: string, value: number) => {
      const updated = appliedEffects.map((fx) =>
        fx.id === effectId ? { ...fx, intensity: value / 100 } : fx,
      );
      handleUpdate("effects", updated);
    },
    [appliedEffects, handleUpdate],
  );

  const removeEffect = useCallback(
    (effectId: string) => {
      const updated = appliedEffects.filter((fx) => fx.id !== effectId);
      handleUpdate("effects", updated.length > 0 ? updated : undefined);
    },
    [appliedEffects, handleUpdate],
  );

  const hasFilter = !!appliedFilter;
  const hasEffects = appliedEffects.length > 0;

  if (!hasFilter && !hasEffects) {
    return null;
  }

  return (
    <div className="space-y-3">
      {/* Filters Section */}
      {hasFilter && (
        <PropertySection
          title="Applied Filter"
          icon={<Filter className="w-3.5 h-3.5 text-accent-soft" />}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between bg-surface-raised/40 border border-border/30 rounded-lg p-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-text-primary truncate">
                  {appliedFilter.name}
                </p>
                <p className="text-[10px] text-text-muted mt-0.5">
                  Color Filter
                </p>
              </div>
              <button
                onClick={removeFilter}
                className="w-7 h-7 rounded-md bg-surface-raised hover:bg-red-500/10 text-text-muted hover:text-red-400 flex items-center justify-center transition-all cursor-pointer border border-transparent hover:border-red-500/20"
                title="Remove Filter"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Compact inline intensity control */}
            <div className="flex items-center gap-2.5">
              <span className="text-[10px] text-text-muted select-none shrink-0 min-w-[52px]">
                Intensity
              </span>
              <SliderTrack
                value={Math.round(appliedFilter.intensity * 100)}
                min={0}
                max={100}
                step={1}
                onChange={handleFilterIntensityChange}
              />
              <NumericControl
                value={Math.round(appliedFilter.intensity * 100)}
                onChange={handleFilterIntensityChange}
                step={1}
                suffix="%"
                ariaLabel="Filter Intensity"
                min={0}
                max={100}
                inputPosition="text-right"
              />
            </div>
          </div>
        </PropertySection>
      )}

      {/* Effects Section */}
      {hasEffects && (
        <PropertySection
          title="Video Effects"
          icon={<Sparkles className="w-3.5 h-3.5 text-accent-soft" />}
        >
          <div className="space-y-4">
            {appliedEffects.map((effect) => (
              <div
                key={effect.id}
                className="space-y-2 border-b border-border/30 pb-3 last:border-0 last:pb-0"
              >
                <div className="flex items-center justify-between bg-surface-raised/40 border border-border/30 rounded-lg p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-text-primary truncate">
                      {effect.name}
                    </p>
                    <p className="text-[10px] text-text-muted mt-0.5">
                      Render Effect
                    </p>
                  </div>
                  <button
                    onClick={() => removeEffect(effect.id)}
                    className="w-7 h-7 rounded-md bg-surface-raised hover:bg-red-500/10 text-text-muted hover:text-red-400 flex items-center justify-center transition-all cursor-pointer border border-transparent hover:border-red-500/20"
                    title="Remove Effect"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Compact inline intensity control */}
                <div className="flex items-center gap-2.5">
                  <span className="text-[10px] text-text-muted select-none shrink-0 min-w-[52px]">
                    Intensity
                  </span>
                  <SliderTrack
                    value={Math.round(effect.intensity * 100)}
                    min={0}
                    max={100}
                    step={1}
                    onChange={(val) =>
                      handleEffectIntensityChange(effect.id, val)
                    }
                  />
                  <NumericControl
                    value={Math.round(effect.intensity * 100)}
                    onChange={(val) =>
                      handleEffectIntensityChange(effect.id, val)
                    }
                    step={1}
                    suffix="%"
                    ariaLabel="Effect Intensity"
                    min={0}
                    max={100}
                    inputPosition="text-right"
                  />
                </div>
              </div>
            ))}
          </div>
        </PropertySection>
      )}
    </div>
  );
};
