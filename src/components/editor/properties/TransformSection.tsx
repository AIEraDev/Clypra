import React, { useCallback } from "react";
import { Move, Timer, RotateCcw, FlipHorizontal2, FlipVertical2, Lock, Unlock, Crosshair } from "lucide-react";
import type { Clip } from "@/types";
import { type ClipFitModeExtended } from "@/lib/timeline/timelineClip";
import { PropertySlider } from "./primitives/PropertySlider";
import { PropertySelect } from "./primitives/PropertySelect";
import { PropertySection } from "./primitives/PropertySection";

interface TransformSectionProps {
  selectedClip: Clip;
  isVisualClip: boolean;
  handleUpdate: (key: string, value: any) => void;
  handleUpdateMultiple: (fields: Record<string, any>) => void;
  handleApplyFit: (fitMode: ClipFitModeExtended) => void;
  canvasWidth?: number;
  canvasHeight?: number;
}

const FIT_OPTIONS = [
  { value: "contain", label: "Contain" },
  { value: "cover", label: "Cover" },
  { value: "fill", label: "Fill" },
  { value: "stretch", label: "Stretch" },
  { value: "original", label: "Original" },
];

function getOpacityPercent(opacity: number): number {
  const value = Number.isFinite(opacity) ? opacity : 1;
  const normalized = value > 1 ? value / 100 : value;
  return Math.round(Math.max(0, Math.min(1, normalized)) * 100);
}

export const TransformSection: React.FC<TransformSectionProps> = ({ selectedClip, isVisualClip, handleUpdate, handleUpdateMultiple, handleApplyFit, canvasWidth = 1920, canvasHeight = 1080 }) => {
  const isAspectLocked = selectedClip.aspectRatioLocked ?? true;
  const aspectRatio = selectedClip.sourceAspectRatio ?? (selectedClip.width && selectedClip.height ? Math.abs(selectedClip.width) / Math.abs(selectedClip.height) : 16 / 9);
  const isFlippedH = selectedClip.width < 0;
  const isFlippedV = selectedClip.height < 0;
  const opacityPercent = getOpacityPercent(selectedClip.opacity);

  const handleCenterOnCanvas = useCallback(() => {
    const w = Math.abs(selectedClip.width);
    const h = Math.abs(selectedClip.height);
    handleUpdateMultiple({
      x: Math.round((canvasWidth - w) / 2),
      y: Math.round((canvasHeight - h) / 2),
    });
  }, [selectedClip.width, selectedClip.height, canvasWidth, canvasHeight, handleUpdateMultiple]);

  const handleWidthChange = useCallback(
    (newWidth: number) => {
      const width = isFlippedH ? -Math.abs(newWidth) : Math.abs(newWidth);
      if (isAspectLocked && aspectRatio) {
        const newHeight = Math.round(Math.abs(newWidth) / aspectRatio);
        handleUpdateMultiple({
          width,
          height: isFlippedV ? -newHeight : newHeight,
        });
        return;
      }
      handleUpdate("width", width);
    },
    [handleUpdate, handleUpdateMultiple, isAspectLocked, aspectRatio, isFlippedH, isFlippedV],
  );

  const handleHeightChange = useCallback(
    (newHeight: number) => {
      const height = isFlippedV ? -Math.abs(newHeight) : Math.abs(newHeight);
      if (isAspectLocked && aspectRatio) {
        const newWidth = Math.round(Math.abs(newHeight) * aspectRatio);
        handleUpdateMultiple({
          height,
          width: isFlippedH ? -newWidth : newWidth,
        });
        return;
      }
      handleUpdate("height", height);
    },
    [handleUpdate, handleUpdateMultiple, isAspectLocked, aspectRatio, isFlippedH, isFlippedV],
  );

  return (
    <div className="space-y-3">
      {/* Transform Section */}
      <PropertySection title="Transform" icon={<Move className="w-3.5 h-3.5" />}>
        <div className="space-y-3">
          {/* Fit Mode (visual clips only) */}
          {isVisualClip && (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <PropertySelect label="Fit Mode" value={selectedClip.fitMode ?? "cover"} options={FIT_OPTIONS} onChange={(v) => handleApplyFit(v as ClipFitModeExtended)} />
              </div>
              <button type="button" onClick={() => handleApplyFit(selectedClip.fitMode ?? "cover")} className="px-2.5 py-1.5 text-[10px] font-medium bg-surface-raised border border-border/60 rounded-md text-text-muted hover:text-text-primary hover:bg-white/[0.06] transition-all active:scale-[0.97] cursor-pointer">
                Reset
              </button>
            </div>
          )}

          {/* Position: X / Y */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-medium text-text-muted select-none">Position</span>
              <button onClick={handleCenterOnCanvas} className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-text-muted hover:text-accent hover:bg-accent/10 rounded transition-all cursor-pointer" title="Center on canvas">
                <Crosshair className="w-3 h-3" />
                Center
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-text-muted/60 block mb-0.5 select-none">X</label>
                <input type="number" value={Math.round(selectedClip.x)} onChange={(e) => handleUpdate("x", Number(e.target.value))} className="w-full bg-surface-raised border border-border/60 rounded-md px-2 py-1 text-xs text-text-primary outline-none focus:border-accent tabular-nums selectable" />
              </div>
              <div>
                <label className="text-[9px] text-text-muted/60 block mb-0.5 select-none">Y</label>
                <input type="number" value={Math.round(selectedClip.y)} onChange={(e) => handleUpdate("y", Number(e.target.value))} className="w-full bg-surface-raised border border-border/60 rounded-md px-2 py-1 text-xs text-text-primary outline-none focus:border-accent tabular-nums selectable" />
              </div>
            </div>
          </div>

          {/* Size: W / H + Aspect Lock */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-medium text-text-muted select-none">Size</span>
              <button onClick={() => handleUpdate("aspectRatioLocked", !isAspectLocked)} className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded transition-all cursor-pointer ${isAspectLocked ? "text-accent bg-accent/10" : "text-text-muted hover:text-text-primary hover:bg-white/[0.04]"}`} title={isAspectLocked ? "Unlock aspect ratio" : "Lock aspect ratio"}>
                {isAspectLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                {isAspectLocked ? "Locked" : "Free"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-text-muted/60 block mb-0.5 select-none">W</label>
                <input type="number" value={Math.round(Math.abs(selectedClip.width))} onChange={(e) => handleWidthChange(Number(e.target.value))} className="w-full bg-surface-raised border border-border/60 rounded-md px-2 py-1 text-xs text-text-primary outline-none focus:border-accent tabular-nums selectable" />
              </div>
              <div>
                <label className="text-[9px] text-text-muted/60 block mb-0.5 select-none">H</label>
                <input type="number" value={Math.round(Math.abs(selectedClip.height))} onChange={(e) => handleHeightChange(Number(e.target.value))} className="w-full bg-surface-raised border border-border/60 rounded-md px-2 py-1 text-xs text-text-primary outline-none focus:border-accent tabular-nums selectable" />
              </div>
            </div>
          </div>

          {/* Rotation */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <PropertySlider label="Rotation" value={selectedClip.rotation} min={-180} max={180} step={1} suffix="°" onChange={(v) => handleUpdate("rotation", v)} />
            </div>
            {selectedClip.rotation !== 0 && (
              <button onClick={() => handleUpdate("rotation", 0)} className="p-1 text-text-muted hover:text-accent hover:bg-accent/10 rounded transition-all cursor-pointer mb-0.5" title="Reset rotation">
                <RotateCcw className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Opacity */}
          <PropertySlider label="Opacity" value={opacityPercent} min={0} max={100} step={1} suffix="%" onChange={(v) => handleUpdate("opacity", v / 100)} />

          {/* Flip buttons */}
          <div>
            <span className="text-[10px] font-medium text-text-muted select-none block mb-1.5">Flip</span>
            <div className="flex gap-2">
              <button onClick={() => handleUpdate("width", -selectedClip.width)} className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium rounded-md border transition-all cursor-pointer ${isFlippedH ? "bg-accent/15 text-accent border-accent/30" : "bg-surface-raised text-text-muted border-border/60 hover:text-text-primary hover:bg-white/[0.06]"}`} title="Flip Horizontal">
                <FlipHorizontal2 className="w-3.5 h-3.5" />
                Horizontal
              </button>
              <button onClick={() => handleUpdate("height", -selectedClip.height)} className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium rounded-md border transition-all cursor-pointer ${isFlippedV ? "bg-accent/15 text-accent border-accent/30" : "bg-surface-raised text-text-muted border-border/60 hover:text-text-primary hover:bg-white/[0.06]"}`} title="Flip Vertical">
                <FlipVertical2 className="w-3.5 h-3.5" />
                Vertical
              </button>
            </div>
          </div>
        </div>
      </PropertySection>

      {/* Timing Section */}
      <PropertySection title="Timing" icon={<Timer className="w-3.5 h-3.5" />} defaultCollapsed>
        <div className="space-y-2.5">
          <PropertySlider label="Trim In" value={selectedClip.trimIn} min={0} max={Math.max(selectedClip.trimOut - 0.1, 0)} step={0.01} suffix="s" onChange={(v) => handleUpdate("trimIn", v)} />
          <PropertySlider label="Trim Out" value={selectedClip.trimOut} min={selectedClip.trimIn + 0.1} max={selectedClip.trimIn + selectedClip.duration + 30} step={0.01} suffix="s" onChange={(v) => handleUpdate("trimOut", v)} />
        </div>
      </PropertySection>
    </div>
  );
};
