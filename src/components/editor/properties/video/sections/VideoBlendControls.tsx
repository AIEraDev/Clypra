/**
 * VideoBlendControls.tsx
 *
 * Blend mode and opacity controls for video clips.
 * Uses reusable primitives (PropertySectionHeader, PropertySelect, SliderTrack, NumericControl)
 * with full keyframe support for opacity.
 */

import React, { useCallback, useState } from "react";
import type { Clip } from "@/types";
import { PropertySectionHeader } from "../../primitives/PropertySectionHeader";
import { PropertySelect } from "../../primitives/PropertySelect";
import { SliderTrack } from "../../primitives/SliderTrack";
import { NumericControl } from "../../primitives/NumericControl";
import { KeyframeNavControls } from "../../primitives/KeyframeNavControls";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import { useUIStore } from "@/store/uiStore";

interface VideoBlendControlsProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
}

const BLEND_MODE_OPTIONS = [
  { value: "normal", label: "Default" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "darken", label: "Darken" },
  { value: "lighten", label: "Lighten" },
  { value: "color-dodge", label: "Color Dodge" },
  { value: "color-burn", label: "Color Burn" },
  { value: "hard-light", label: "Hard Light" },
  { value: "soft-light", label: "Soft Light" },
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
  { value: "hue", label: "Hue" },
  { value: "saturation", label: "Saturation" },
  { value: "color", label: "Color" },
  { value: "luminosity", label: "Luminosity" },
];

export const VideoBlendControls: React.FC<VideoBlendControlsProps> = ({
  selectedClip,
  handleUpdate,
}) => {
  const [isBlendCollapsed, setIsBlendCollapsed] = useState(false);

  const blendMode = (selectedClip as any).blendMode || "normal";
  const opacity = selectedClip.opacity ?? 1;
  const opacityPercent = opacity * 100;

  // ── Keyframe state for opacity ────────────────────────────────────────────
  const openCurveEditor = useUIStore((s) => s.openCurveEditor);

  const currentTime = getPlaybackClock().time;
  const localTime = Math.max(
    0,
    Math.min(selectedClip.duration, currentTime - selectedClip.startTime),
  );

  const opacityKeyframes = selectedClip.visualKeyframes?.opacity || [];
  const opacityKfState = {
    hasKeyframes: opacityKeyframes.length > 0,
    isAtKeyframe: opacityKeyframes.some(
      (k) => Math.abs(k.time - localTime) < 0.08,
    ),
    hasPrev: opacityKeyframes.some((k) => k.time < localTime - 0.05),
    hasNext: opacityKeyframes.some((k) => k.time > localTime + 0.05),
  };

  const handleOpacityChange = useCallback(
    (val: number) => {
      handleUpdate("opacity", val / 100);
    },
    [handleUpdate],
  );

  const handleToggleOpacityKeyframe = useCallback(() => {
    const existing = opacityKeyframes.find(
      (k) => Math.abs(k.time - localTime) < 0.08,
    );
    if (existing) {
      // Remove keyframe
      const updated = opacityKeyframes.filter((k) => k.id !== existing.id);
      handleUpdate("visualKeyframes", {
        ...selectedClip.visualKeyframes,
        opacity: updated,
      });
    } else {
      // Add keyframe
      const newKf = {
        id: `opacity-${Date.now()}`,
        time: localTime,
        value: opacity,
      };
      handleUpdate("visualKeyframes", {
        ...selectedClip.visualKeyframes,
        opacity: [...opacityKeyframes, newKf].sort((a, b) => a.time - b.time),
      });
    }
  }, [
    opacityKeyframes,
    localTime,
    opacity,
    handleUpdate,
    selectedClip.visualKeyframes,
  ]);

  const handleJumpToOpacityKeyframe = useCallback(
    (direction: "prev" | "next") => {
      const sorted = [...opacityKeyframes].sort((a, b) => a.time - b.time);
      let target: number | undefined;
      if (direction === "prev") {
        const candidates = sorted.filter((k) => k.time < localTime - 0.05);
        target =
          candidates.length > 0
            ? candidates[candidates.length - 1].time
            : undefined;
      } else {
        const candidates = sorted.filter((k) => k.time > localTime + 0.05);
        target = candidates.length > 0 ? candidates[0].time : undefined;
      }
      if (target !== undefined) {
        getPlaybackClock().seek(selectedClip.startTime + target);
      }
    },
    [opacityKeyframes, localTime, selectedClip.startTime],
  );

  const handleOpenOpacityCurveEditor = useCallback(() => {
    openCurveEditor(selectedClip.id, "opacity");
  }, [openCurveEditor, selectedClip.id]);

  return (
    <div className="space-y-3">
      <PropertySectionHeader
        title="Blend"
        isCollapsed={isBlendCollapsed}
        onToggleCollapse={() => setIsBlendCollapsed(!isBlendCollapsed)}
      />

      {!isBlendCollapsed && (
        <div className="space-y-4">
          {/* Blend Mode */}
          <PropertySelect
            label="Mode"
            value={blendMode}
            options={BLEND_MODE_OPTIONS}
            onChange={(val) => handleUpdate("blendMode", val)}
            className="flex items-center gap-36"
          />

          {/* Opacity with Keyframe Support */}
          <div className="space-y-1">
            <span className="text-[11px] text-white select-none block">
              Opacity
            </span>
            <div className="flex items-center gap-2">
              <SliderTrack
                value={opacityPercent}
                min={0}
                max={100}
                step={1}
                onChange={handleOpacityChange}
              />
              <NumericControl
                value={opacityPercent}
                onChange={handleOpacityChange}
                step={1}
                suffix="%"
                ariaLabel="Opacity"
                min={0}
                max={100}
                inputPosition="text-right"
              />
              <KeyframeNavControls
                hasKeyframes={opacityKfState.hasKeyframes}
                isAtKeyframe={opacityKfState.isAtKeyframe}
                onToggleKeyframe={handleToggleOpacityKeyframe}
                onPrevKeyframe={() => handleJumpToOpacityKeyframe("prev")}
                onNextKeyframe={() => handleJumpToOpacityKeyframe("next")}
                hasPrev={opacityKfState.hasPrev}
                hasNext={opacityKfState.hasNext}
                onOpenCurveEditor={handleOpenOpacityCurveEditor}
                label="Opacity"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
