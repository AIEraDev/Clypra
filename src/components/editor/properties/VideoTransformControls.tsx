/**
 * VideoTransformControls.tsx
 *
 * Flat, inline transform controls for video clips.
 * Matches TextBasicTab's design pattern - no collapsible sections.
 */

import React, { useCallback } from "react";
import { Lock, Unlock } from "lucide-react";
import type { Clip } from "@/types";
import { type ClipFitModeExtended } from "@/lib/timeline/timelineClip";

interface VideoTransformControlsProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
  handleUpdateMultiple: (fields: Record<string, any>) => void;
  handleApplyFit: (fitMode: ClipFitModeExtended) => void;
}

const FIT_OPTIONS = [
  { value: "contain", label: "Contain" },
  { value: "cover", label: "Cover" },
  { value: "fill", label: "Fill" },
  { value: "stretch", label: "Stretch" },
  { value: "original", label: "Original" },
];

export const VideoTransformControls: React.FC<VideoTransformControlsProps> = ({
  selectedClip,
  handleUpdate,
  handleUpdateMultiple,
  handleApplyFit,
}) => {
  const isAspectLocked = selectedClip.aspectRatioLocked ?? true;
  const aspectRatio =
    selectedClip.sourceAspectRatio ??
    (selectedClip.width && selectedClip.height
      ? Math.abs(selectedClip.width) / Math.abs(selectedClip.height)
      : 16 / 9);

  // Calculate scale based on current dimensions
  const scale = 100; // Default to 100% if we can't calculate

  const handleScaleChange = useCallback(
    (val: number) => {
      const scaleFactor = val / 100;
      const currentWidth = Math.abs(selectedClip.width);
      const currentHeight = Math.abs(selectedClip.height);

      // Maintain current aspect ratio
      const newWidth = currentWidth * scaleFactor;
      const newHeight = currentHeight * scaleFactor;

      handleUpdateMultiple({
        width: selectedClip.width < 0 ? -newWidth : newWidth,
        height: selectedClip.height < 0 ? -newHeight : newHeight,
      });
    },
    [selectedClip, handleUpdateMultiple],
  );

  const toggleAspectLock = useCallback(() => {
    handleUpdate("aspectRatioLocked", !isAspectLocked);
  }, [isAspectLocked, handleUpdate]);

  return (
    <div className="space-y-3.5 relative">
      {/* Fit Mode */}
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs text-[#a1a1aa] shrink-0 w-20">Fit</label>
        <select
          value={(selectedClip as any).fit || "contain"}
          onChange={(e) =>
            handleApplyFit(e.target.value as ClipFitModeExtended)
          }
          className="flex-1 bg-[#27272a] hover:bg-[#323238] border border-white/5 rounded-md px-3 py-1.5 text-xs text-white outline-none focus:border-cyan-400/50 cursor-pointer appearance-none transition-colors"
        >
          {FIT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Scale */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-[#a1a1aa] shrink-0 w-20">Scale</label>
        <div className="flex-1 flex items-center">
          <input
            type="range"
            min={10}
            max={200}
            value={Math.round(scale)}
            onChange={(e) => handleScaleChange(Number(e.target.value))}
            className="w-full h-1 bg-[#3f3f46] rounded-full appearance-none outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
          />
        </div>
        <div className="w-16 shrink-0 bg-[#27272a] border border-white/5 rounded-md px-2 py-1 flex items-center">
          <input
            type="number"
            min={1}
            max={500}
            value={Math.round(scale)}
            onChange={(e) => handleScaleChange(Number(e.target.value))}
            className="w-full bg-transparent text-xs text-white text-center outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-xs text-text-muted ml-0.5">%</span>
        </div>
      </div>

      {/* Uniform Scale Toggle */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-[#a1a1aa] shrink-0 w-20">
          Lock ratio
        </label>
        <button
          type="button"
          onClick={toggleAspectLock}
          className={`flex items-center justify-center gap-2 px-3 py-1.5 rounded-md border transition-all cursor-pointer ${
            isAspectLocked
              ? "bg-[#3e3e44] text-white border-white/20 shadow-sm"
              : "bg-[#242428] text-text-muted border-white/5 hover:text-white hover:bg-[#2c2c32]"
          }`}
        >
          {isAspectLocked ? (
            <Lock className="w-3.5 h-3.5" />
          ) : (
            <Unlock className="w-3.5 h-3.5" />
          )}
          <span className="text-xs">
            {isAspectLocked ? "Locked" : "Unlocked"}
          </span>
        </button>
      </div>

      {/* Position X */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-[#a1a1aa] shrink-0 w-20">
          Position X
        </label>
        <div className="flex-1 flex items-center">
          <input
            type="range"
            min={-1920}
            max={1920}
            value={selectedClip.x || 0}
            onChange={(e) => handleUpdate("x", Number(e.target.value))}
            className="w-full h-1 bg-[#3f3f46] rounded-full appearance-none outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
          />
        </div>
        <div className="w-20 shrink-0 bg-[#27272a] border border-white/5 rounded-md px-2 py-1">
          <input
            type="number"
            value={Math.round(selectedClip.x || 0)}
            onChange={(e) => handleUpdate("x", Number(e.target.value))}
            className="w-full bg-transparent text-xs text-white text-center outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
      </div>

      {/* Position Y */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-[#a1a1aa] shrink-0 w-20">
          Position Y
        </label>
        <div className="flex-1 flex items-center">
          <input
            type="range"
            min={-1080}
            max={1080}
            value={selectedClip.y || 0}
            onChange={(e) => handleUpdate("y", Number(e.target.value))}
            className="w-full h-1 bg-[#3f3f46] rounded-full appearance-none outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
          />
        </div>
        <div className="w-20 shrink-0 bg-[#27272a] border border-white/5 rounded-md px-2 py-1">
          <input
            type="number"
            value={Math.round(selectedClip.y || 0)}
            onChange={(e) => handleUpdate("y", Number(e.target.value))}
            className="w-full bg-transparent text-xs text-white text-center outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
      </div>

      {/* Rotation */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-[#a1a1aa] shrink-0 w-20">Rotate</label>
        <div className="flex-1 flex items-center">
          <input
            type="range"
            min={-180}
            max={180}
            value={selectedClip.rotation || 0}
            onChange={(e) => handleUpdate("rotation", Number(e.target.value))}
            className="w-full h-1 bg-[#3f3f46] rounded-full appearance-none outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
          />
        </div>
        <div className="w-20 shrink-0 bg-[#27272a] border border-white/5 rounded-md px-2 py-1 flex items-center">
          <input
            type="number"
            min={-180}
            max={180}
            value={Math.round(selectedClip.rotation || 0)}
            onChange={(e) => handleUpdate("rotation", Number(e.target.value))}
            className="w-full bg-transparent text-xs text-white text-center outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-xs text-text-muted ml-0.5">°</span>
        </div>
      </div>

      {/* Opacity */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-[#a1a1aa] shrink-0 w-20">Opacity</label>
        <div className="flex-1 flex items-center">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round((selectedClip.opacity || 1) * 100)}
            onChange={(e) =>
              handleUpdate("opacity", Number(e.target.value) / 100)
            }
            className="w-full h-1 bg-[#3f3f46] rounded-full appearance-none outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
          />
        </div>
        <div className="w-20 shrink-0 bg-[#27272a] border border-white/5 rounded-md px-2 py-1 flex items-center">
          <input
            type="number"
            min={0}
            max={100}
            value={Math.round((selectedClip.opacity || 1) * 100)}
            onChange={(e) =>
              handleUpdate("opacity", Number(e.target.value) / 100)
            }
            className="w-full bg-transparent text-xs text-white text-center outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-xs text-text-muted ml-0.5">%</span>
        </div>
      </div>
    </div>
  );
};
