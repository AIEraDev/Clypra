import React, { useCallback } from "react";
import { Shuffle, Trash2, Sliders } from "lucide-react";
import type { TransitionTimelineItem, TransitionType, TransitionEasing } from "@/types";
import { t, useLanguage, type MessageKey } from "@/i18n";
import { PropertySection } from "./primitives/PropertySection";
import { PropertySlider } from "./primitives/PropertySlider";
import { PropertySelect } from "./primitives/PropertySelect";

interface TransitionSectionProps {
  selectedTransition: TransitionTimelineItem;
  updateTransition: (id: string, updates: Partial<TransitionTimelineItem>) => void;
  removeTransition: (id: string) => void;
  clearSelection: () => void;
}

const TRANSITION_TYPE_OPTIONS = [
  { value: "fade", labelKey: "properties.transition.type.fade" },
  { value: "dissolve", labelKey: "properties.transition.type.dissolve" },
] satisfies { value: string; labelKey: MessageKey }[];

const EASING_OPTIONS = [
  { value: "linear", labelKey: "properties.transition.easing.linear" },
  { value: "easeInOut", labelKey: "properties.transition.easing.easeInOut" },
] satisfies { value: string; labelKey: MessageKey }[];

export const TransitionSection: React.FC<TransitionSectionProps> = ({
  selectedTransition,
  updateTransition,
  removeTransition,
  clearSelection,
}) => {
  useLanguage();
  const transitionTypeOptions = TRANSITION_TYPE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }));
  const easingOptions = EASING_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }));

  const handleTypeChange = useCallback(
    (val: string) => {
      updateTransition(selectedTransition.id, { type: val as TransitionType });
    },
    [selectedTransition.id, updateTransition]
  );

  const handleEasingChange = useCallback(
    (val: string) => {
      updateTransition(selectedTransition.id, { easing: val as TransitionEasing });
    },
    [selectedTransition.id, updateTransition]
  );

  const handleDurationChange = useCallback(
    (val: number) => {
      const currentStart = selectedTransition.placement.startTime;
      const currentDuration = selectedTransition.placement.duration;
      const cutTime = currentStart + currentDuration / 2; // Midpoint
      
      // Calculate new start time based on new duration centered on cut
      const nextStart = cutTime - val / 2;

      updateTransition(selectedTransition.id, {
        placement: {
          ...selectedTransition.placement,
          startTime: nextStart,
          duration: val,
        },
      });
    },
    [selectedTransition, updateTransition]
  );

  const handleDelete = useCallback(() => {
    removeTransition(selectedTransition.id);
    clearSelection();
  }, [selectedTransition.id, removeTransition, clearSelection]);

  return (
    <div className="space-y-3">
      <PropertySection title={t("properties.transition.settings")} icon={<Shuffle className="w-3.5 h-3.5" />}>
        <div className="space-y-3">
          {/* Transition Type */}
          <PropertySelect
            label={t("properties.transition.type")}
            value={selectedTransition.type}
            options={transitionTypeOptions}
            onChange={handleTypeChange}
          />

          {/* Easing */}
          <PropertySelect
            label={t("properties.transition.easing")}
            value={selectedTransition.easing}
            options={easingOptions}
            onChange={handleEasingChange}
          />

          {/* Duration */}
          <PropertySlider
            label={t("properties.transition.duration")}
            value={selectedTransition.placement.duration}
            min={0.1}
            max={2.0}
            step={0.1}
            suffix="s"
            onChange={handleDurationChange}
          />
        </div>
      </PropertySection>

      {/* Delete Transition Action */}
      <div className="pt-2">
        <button
          onClick={handleDelete}
          className="w-full flex items-center justify-center gap-2 py-2 text-xs font-semibold bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/30 text-red-400 rounded-lg transition-all active:scale-[0.98] cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {t("properties.transition.remove")}
        </button>
      </div>
    </div>
  );
};
