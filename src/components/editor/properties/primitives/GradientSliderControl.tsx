/**
 * GradientSliderControl.tsx
 *
 * Complete slider control with label, gradient slider track, numeric input, and keyframe controls.
 * Used for color adjustment controls (Temp, Tint, Saturation, etc.)
 */

import React, { useState } from "react";
import { GradientSliderTrack } from "./GradientSliderTrack";
import { NumericControl } from "./NumericControl";
import { KeyframeNavControls } from "./KeyframeNavControls";

type GradientType = "temp" | "tint" | "saturation" | "none";

interface GradientSliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  gradient?: GradientType;
  onChange: (val: number) => void;
}

export const GradientSliderControl: React.FC<GradientSliderControlProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  gradient = "none",
  onChange,
}) => {
  const [keyframe, setKeyframe] = useState(false);

  return (
    <div className="flex items-center gap-3">
      <label className="text-sm text-white/80 min-w-[80px]">{label}</label>
      <div className="flex-1 flex items-center gap-2">
        <GradientSliderTrack
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={onChange}
          gradient={gradient}
        />
        <NumericControl
          value={value}
          onChange={onChange}
          step={step}
          min={min}
          max={max}
          inputWidth="w-16"
        />
        <KeyframeNavControls
          hasKeyframes={keyframe}
          isAtKeyframe={keyframe}
          onToggleKeyframe={() => setKeyframe(!keyframe)}
          onPrevKeyframe={() => {}}
          onNextKeyframe={() => {}}
          label={label}
        />
      </div>
    </div>
  );
};
