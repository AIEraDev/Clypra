import React from "react";
import { ColorWheel, type ColorWheelValue } from "./primitives/ColorWheel";
import type { Clip } from "@/types";

interface ColorWheelsSectionProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
}

export const ColorWheelsSection: React.FC<ColorWheelsSectionProps> = ({
  selectedClip,
  handleUpdate,
}) => {
  const adjustments = selectedClip.adjustments ?? {};
  const wheels = (adjustments as any).wheels ?? {};

  const defaultWheelVal: ColorWheelValue = { r: 0, g: 0, b: 0, y: 0 };

  const lift = wheels.lift ?? defaultWheelVal;
  const gamma = wheels.gamma ?? defaultWheelVal;
  const gain = wheels.gain ?? defaultWheelVal;

  const updateWheel = (wheelKey: "lift" | "gamma" | "gain", newVal: ColorWheelValue) => {
    const nextWheels = { ...wheels, [wheelKey]: newVal };
    const nextAdjustments = { ...adjustments, wheels: nextWheels };
    handleUpdate("adjustments", nextAdjustments);
  };

  const resetWheel = (wheelKey: "lift" | "gamma" | "gain") => {
    updateWheel(wheelKey, defaultWheelVal);
  };

  return (
    <div className="space-y-2 pt-2 border-t border-white/5">
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">3-Way Color Wheels</span>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <ColorWheel
          label="Lift"
          value={lift}
          onChange={(val) => updateWheel("lift", val)}
          onReset={() => resetWheel("lift")}
        />
        <ColorWheel
          label="Gamma"
          value={gamma}
          onChange={(val) => updateWheel("gamma", val)}
          onReset={() => resetWheel("gamma")}
        />
        <ColorWheel
          label="Gain"
          value={gain}
          onChange={(val) => updateWheel("gain", val)}
          onReset={() => resetWheel("gain")}
        />
      </div>
    </div>
  );
};
