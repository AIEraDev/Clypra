/**
 * VideoBlendControls.tsx
 *
 * Blend mode and opacity controls for video clips.
 * Uses reusable primitives (PropertySectionHeader, PropertySelect, SliderTrack, NumericControl)
 * with full keyframe support for opacity.
 *
 * Opacity live-evaluates keyframes at localTime so the displayed value tracks
 * the animated curve during scrubbing — identical pattern to VideoTransformControls.
 */

import React, { useCallback, useMemo, useState } from "react";
import type { Clip } from "@/types";
import { PropertySectionHeader } from "../../primitives/PropertySectionHeader";
import { PropertySelect } from "../../primitives/PropertySelect";
import { SliderTrack } from "../../primitives/SliderTrack";
import { NumericControl } from "../../primitives/NumericControl";
import { KeyframeNavControls } from "../../primitives/KeyframeNavControls";
import { getPlaybackClock, usePlaybackClock } from "@/hooks/usePlaybackClock";
import { useUIStore } from "@/store/uiStore";
import { propertyEditTelemetry } from "@/lib/properties/propertyEditTelemetry";
import { evaluateVisualPropertyKeyframes } from "@/core/evaluation/animation";

interface VideoBlendControlsProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
  handleUpdateMultiple?: (fields: Record<string, any>) => void;
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
  handleUpdateMultiple,
}) => {
  const [isBlendCollapsed, setIsBlendCollapsed] = useState(false);

  const blendMode = (selectedClip as any).blendMode || "normal";

  // ── Keyframe state for opacity ────────────────────────────────────────────
  const openCurveEditor = useUIStore((s) => s.openCurveEditor);

  // Subscribe to the playback clock so displayed opacity tracks scrubbing live
  const clockState =
    typeof usePlaybackClock === "function" ? usePlaybackClock() : null;
  const currentTime = clockState?.time ?? getPlaybackClock().time;
  const localTime = Math.max(
    0,
    Math.min(selectedClip.duration, currentTime - selectedClip.startTime),
  );

  const opacityKeyframes = selectedClip.visualKeyframes?.opacity || [];

  // Live-evaluated opacity — reflects animated value at current playhead position
  const currentOpacity = useMemo(() => {
    if (opacityKeyframes.length > 0) {
      return evaluateVisualPropertyKeyframes(
        opacityKeyframes,
        localTime,
        selectedClip.opacity ?? 1,
        selectedClip.duration,
      );
    }
    return selectedClip.opacity ?? 1;
  }, [opacityKeyframes, localTime, selectedClip.opacity, selectedClip.duration]);

  const opacityPercent = Math.round(
    Math.max(0, Math.min(1, currentOpacity)) * 100,
  );

  const opacityKfState = {
    hasKeyframes: opacityKeyframes.length > 0,
    isAtKeyframe: opacityKeyframes.some(
      (k) => Math.abs(k.time - localTime) < 0.08,
    ),
    hasPrev: opacityKeyframes.some((k) => k.time < localTime - 0.05),
    hasNext: opacityKeyframes.some((k) => k.time > localTime + 0.05),
  };

  /**
   * Opacity change handler — keyframe-aware.
   *
   * If opacity keyframes exist on the clip, the slider/numeric update is applied
   * to the keyframe at the current playhead position (create new if none exists
   * there). Without keyframes it falls back to a plain clip property update.
   */
  const handleOpacityChange = useCallback(
    (val: number) => {
      const clamped = Math.max(0, Math.min(1, val / 100));
      if (opacityKeyframes.length === 0) {
        // No keyframes — simple property update
        handleUpdate("opacity", clamped);
        return;
      }
      const existingIdx = opacityKeyframes.findIndex(
        (kf) => Math.abs(kf.time - localTime) < 0.08,
      );
      if (existingIdx >= 0) {
        // Update the existing keyframe's value at playhead
        const nextKfs = [...opacityKeyframes];
        nextKfs[existingIdx] = { ...nextKfs[existingIdx], value: clamped };
        if (handleUpdateMultiple) {
          handleUpdateMultiple({
            opacity: clamped,
            visualKeyframes: {
              ...(selectedClip.visualKeyframes || {}),
              opacity: nextKfs,
            },
          });
        } else {
          handleUpdate("opacity", clamped);
          handleUpdate("visualKeyframes", {
            ...(selectedClip.visualKeyframes || {}),
            opacity: nextKfs,
          });
        }
      } else {
        // Keyframes exist but not at current time — insert new keyframe
        const t = Math.round(localTime * 100) / 100;
        const nextKfs = [
          ...opacityKeyframes,
          {
            id: `opacity-${Date.now()}`,
            time: t,
            value: clamped,
            easing: "easeInOut" as const,
          },
        ].sort((a, b) => a.time - b.time);
        if (handleUpdateMultiple) {
          handleUpdateMultiple({
            opacity: clamped,
            visualKeyframes: {
              ...(selectedClip.visualKeyframes || {}),
              opacity: nextKfs,
            },
          });
        } else {
          handleUpdate("opacity", clamped);
          handleUpdate("visualKeyframes", {
            ...(selectedClip.visualKeyframes || {}),
            opacity: nextKfs,
          });
        }
      }
    },
    [
      opacityKeyframes,
      localTime,
      handleUpdate,
      handleUpdateMultiple,
      selectedClip.visualKeyframes,
    ],
  );

  const handleToggleOpacityKeyframe = useCallback(() => {
    const existing = opacityKeyframes.find(
      (k) => Math.abs(k.time - localTime) < 0.08,
    );
    if (existing) {
      // Remove keyframe at current position
      const updated = opacityKeyframes.filter((k) => k.id !== existing.id);
      handleUpdate("visualKeyframes", {
        ...selectedClip.visualKeyframes,
        opacity: updated,
      });
    } else {
      // Add keyframe with the live-evaluated opacity value
      const newKf = {
        id: `opacity-${Date.now()}`,
        time: Math.round(localTime * 100) / 100,
        value: currentOpacity,
        easing: "easeInOut" as const,
      };
      handleUpdate("visualKeyframes", {
        ...selectedClip.visualKeyframes,
        opacity: [...opacityKeyframes, newKf].sort((a, b) => a.time - b.time),
      });
    }
  }, [
    opacityKeyframes,
    localTime,
    currentOpacity,
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

  const handleReset = useCallback(() => {
    propertyEditTelemetry.recordButtonAction({ action: "reset-blend", category: "video", property: "blend" });
    handleUpdate("blendMode", "normal");
    handleUpdate("opacity", 1);
  }, [handleUpdate]);

  return (
    <div className="space-y-3">
      <PropertySectionHeader
        title="Blend"
        isCollapsed={isBlendCollapsed}
        onToggleCollapse={() => setIsBlendCollapsed(!isBlendCollapsed)}
        onReset={handleReset}
        resetTitle="Reset blend"
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
                propertyId="opacity"
                category="video"
                snapPoints={[
                  { value: 100, threshold: 4 },
                  { value: 0, threshold: 4 },
                ]}
                onChange={handleOpacityChange}
              />
              <NumericControl
                value={opacityPercent}
                onChange={handleOpacityChange}
                step={1}
                suffix="%"
                ariaLabel="Opacity"
                propertyId="opacity"
                category="video"
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
