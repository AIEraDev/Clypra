import React, { useCallback } from "react";
import {
  Move,
  Timer,
  RotateCcw,
  FlipHorizontal2,
  FlipVertical2,
  Lock,
  Unlock,
  Crosshair,
  TrendingUp,
  Route,
  Aperture,
} from "lucide-react";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
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

export const TransformSection: React.FC<TransformSectionProps> = ({
  selectedClip,
  isVisualClip,
  handleUpdate,
  handleUpdateMultiple,
  handleApplyFit,
  canvasWidth = 1920,
  canvasHeight = 1080,
}) => {
  const isAspectLocked = selectedClip.aspectRatioLocked ?? true;
  const aspectRatio =
    selectedClip.sourceAspectRatio ??
    (selectedClip.width && selectedClip.height
      ? Math.abs(selectedClip.width) / Math.abs(selectedClip.height)
      : 16 / 9);
  const isFlippedH = selectedClip.width < 0;
  const isFlippedV = selectedClip.height < 0;
  const opacityPercent = getOpacityPercent(selectedClip.opacity);

  const isRotationKeyframed =
    (selectedClip.visualKeyframes?.rotation?.length || 0) > 0;
  const isOpacityKeyframed =
    (selectedClip.visualKeyframes?.opacity?.length || 0) > 0;
  const hasPositionKeyframes =
    (selectedClip.visualKeyframes?.x?.length || 0) >= 2 ||
    (selectedClip.visualKeyframes?.y?.length || 0) >= 2;

  const isKeyframeExpanded = useUIStore((s) =>
    s.expandedKeyframeClipIds.includes(selectedClip.id),
  );
  const toggleKeyframeLane = useUIStore((s) => s.toggleKeyframeLane);
  const openCurveEditor = useUIStore((s) => s.openCurveEditor);

  const handleToggleVisualKeyframe = useCallback(
    (
      prop: "x" | "y" | "width" | "height" | "rotation" | "opacity",
      value: number,
    ) => {
      const currentKfs = selectedClip.visualKeyframes?.[prop] || [];
      const currentTime = getPlaybackClock().time;
      const localTime = Math.max(
        0,
        Math.min(selectedClip.duration, currentTime - selectedClip.startTime),
      );
      const existingIdx = currentKfs.findIndex(
        (kf) => Math.abs(kf.time - localTime) < 0.08,
      );

      let nextKfs: any[];
      if (existingIdx >= 0) {
        nextKfs = currentKfs.filter((_, idx) => idx !== existingIdx);
      } else {
        nextKfs = [
          ...currentKfs,
          {
            id: `kf-${Date.now()}`,
            time: Math.round(localTime * 100) / 100,
            value,
            easing: "easeInOut",
          },
        ].sort((a, b) => a.time - b.time);
      }

      handleUpdate("visualKeyframes", {
        ...(selectedClip.visualKeyframes || {}),
        [prop]: nextKfs,
      });
    },
    [
      selectedClip.visualKeyframes,
      selectedClip.duration,
      selectedClip.startTime,
      handleUpdate,
    ],
  );

  const handleCenterOnCanvas = useCallback(() => {
    const w = Math.abs(selectedClip.width);
    const h = Math.abs(selectedClip.height);
    handleUpdateMultiple({
      x: Math.round((canvasWidth - w) / 2),
      y: Math.round((canvasHeight - h) / 2),
    });
  }, [
    selectedClip.width,
    selectedClip.height,
    canvasWidth,
    canvasHeight,
    handleUpdateMultiple,
  ]);

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
    [
      handleUpdate,
      handleUpdateMultiple,
      isAspectLocked,
      aspectRatio,
      isFlippedH,
      isFlippedV,
    ],
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
    [
      handleUpdate,
      handleUpdateMultiple,
      isAspectLocked,
      aspectRatio,
      isFlippedH,
      isFlippedV,
    ],
  );

  return (
    <div className="space-y-3">
      {/* Transform Section */}
      <PropertySection
        title="Transform"
        icon={<Move className="w-3.5 h-3.5" />}
      >
        <div className="space-y-3">
          {/* Conform Mode (visual clips only) */}
          {isVisualClip && (
            <div className="space-y-3 border-b border-border/40 pb-3 mb-1">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <PropertySelect
                    label="Conform Mode"
                    value={selectedClip.conform?.mode ?? "fit"}
                    options={[
                      { value: "fit", label: "Fit" },
                      { value: "fill", label: "Fill" },
                      { value: "none", label: "None" },
                    ]}
                    onChange={(v) => {
                      const existing = selectedClip.conform || {
                        mode: "fit",
                        sourceWidth: selectedClip.width || 0,
                        sourceHeight: selectedClip.height || 0,
                        userScale: 1,
                        userOffsetX: 0,
                        userOffsetY: 0,
                      };
                      handleUpdate("conform", { ...existing, mode: v as any });
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    handleUpdate("conform", {
                      mode: "fit",
                      sourceWidth:
                        selectedClip.conform?.sourceWidth ||
                        selectedClip.width ||
                        0,
                      sourceHeight:
                        selectedClip.conform?.sourceHeight ||
                        selectedClip.height ||
                        0,
                      userScale: 1,
                      userOffsetX: 0,
                      userOffsetY: 0,
                    });
                  }}
                  className="px-2.5 py-1.5 text-[10px] font-medium bg-surface-raised border border-border/60 rounded-md text-text-muted hover:text-text-primary hover:bg-white/[0.06] transition-all active:scale-[0.97] cursor-pointer"
                >
                  Reset
                </button>
              </div>

              {/* Conform Scale Slider */}
              <PropertySlider
                label="Conform Scale"
                value={Math.round((selectedClip.conform?.userScale ?? 1) * 100)}
                min={0}
                max={400}
                step={1}
                suffix="%"
                onChange={(v) => {
                  const existing = selectedClip.conform || {
                    mode: "fit",
                    sourceWidth: selectedClip.width || 0,
                    sourceHeight: selectedClip.height || 0,
                    userScale: 1,
                    userOffsetX: 0,
                    userOffsetY: 0,
                  };
                  handleUpdate("conform", { ...existing, userScale: v / 100 });
                }}
              />

              {/* Conform Offset X Slider */}
              <PropertySlider
                label="Conform Offset X"
                value={Math.round(selectedClip.conform?.userOffsetX ?? 0)}
                min={-1000}
                max={1000}
                step={1}
                suffix="px"
                onChange={(v) => {
                  const existing = selectedClip.conform || {
                    mode: "fit",
                    sourceWidth: selectedClip.width || 0,
                    sourceHeight: selectedClip.height || 0,
                    userScale: 1,
                    userOffsetX: 0,
                    userOffsetY: 0,
                  };
                  handleUpdate("conform", { ...existing, userOffsetX: v });
                }}
              />

              {/* Conform Offset Y Slider */}
              <PropertySlider
                label="Conform Offset Y"
                value={Math.round(selectedClip.conform?.userOffsetY ?? 0)}
                min={-1000}
                max={1000}
                step={1}
                suffix="px"
                onChange={(v) => {
                  const existing = selectedClip.conform || {
                    mode: "fit",
                    sourceWidth: selectedClip.width || 0,
                    sourceHeight: selectedClip.height || 0,
                    userScale: 1,
                    userOffsetX: 0,
                    userOffsetY: 0,
                  };
                  handleUpdate("conform", { ...existing, userOffsetY: v });
                }}
              />
            </div>
          )}

          {/* Position: X / Y */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-medium text-text-muted select-none">
                Position
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => toggleKeyframeLane(selectedClip.id)}
                  className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded transition-all cursor-pointer ${
                    isKeyframeExpanded
                      ? "bg-accent text-white"
                      : "text-text-muted hover:text-accent hover:bg-accent/10"
                  }`}
                  title="Toggle Timeline Keyframe Lanes"
                >
                  <span>◆</span>
                  <span>Lanes</span>
                </button>
                {hasPositionKeyframes && (
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdate(
                        "showMotionPath",
                        selectedClip.showMotionPath === false ? undefined : false,
                      )
                    }
                    className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded transition-all cursor-pointer ${
                      selectedClip.showMotionPath === false
                        ? "text-text-muted hover:text-accent hover:bg-accent/10"
                        : "text-accent bg-accent/10"
                    }`}
                    title={selectedClip.showMotionPath === false ? "Show motion path" : "Hide motion path"}
                  >
                    <Route className="w-3 h-3" />
                    Path
                  </button>
                )}
                {isVisualClip && (
                  <div className="flex items-center gap-0.5 bg-surface-base/80 p-0.5 rounded border border-border/50">
                    <button
                      type="button"
                      onClick={() => handleApplyFit("contain")}
                      className={`px-1.5 py-0.5 text-[9px] rounded transition-all cursor-pointer ${
                        (selectedClip.conform?.mode === "fit" || (!selectedClip.conform && selectedClip.fitMode === "contain"))
                          ? "bg-accent/20 text-accent font-semibold"
                          : "text-text-muted hover:text-text-primary hover:bg-surface-raised"
                      }`}
                      title="Fit: Preserve full frame (Letterbox/Pillarbox)"
                    >
                      Fit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyFit("cover")}
                      className={`px-1.5 py-0.5 text-[9px] rounded transition-all cursor-pointer ${
                        (selectedClip.conform?.mode === "fill" || (!selectedClip.conform && selectedClip.fitMode === "cover"))
                          ? "bg-accent/20 text-accent font-semibold"
                          : "text-text-muted hover:text-text-primary hover:bg-surface-raised"
                      }`}
                      title="Fill: Scale to fill canvas and crop overflow"
                    >
                      Fill
                    </button>
                  </div>
                )}
                <button
                  onClick={handleCenterOnCanvas}
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-text-muted hover:text-accent hover:bg-accent/10 rounded transition-all cursor-pointer"
                  title="Center on canvas"
                >
                  <Crosshair className="w-3 h-3" />
                  Center
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-text-muted/60 block mb-0.5 select-none">
                  X
                </label>
                <input
                  type="number"
                  value={Math.round(selectedClip.x)}
                  onChange={(e) => handleUpdate("x", Number(e.target.value))}
                  className="w-full bg-surface-raised border border-border/60 rounded-md px-2 py-1 text-xs text-text-primary outline-none focus:border-accent tabular-nums selectable"
                />
              </div>
              <div>
                <label className="text-[9px] text-text-muted/60 block mb-0.5 select-none">
                  Y
                </label>
                <input
                  type="number"
                  value={Math.round(selectedClip.y)}
                  onChange={(e) => handleUpdate("y", Number(e.target.value))}
                  className="w-full bg-surface-raised border border-border/60 rounded-md px-2 py-1 text-xs text-text-primary outline-none focus:border-accent tabular-nums selectable"
                />
              </div>
            </div>
          </div>

          {/* Size: W / H + Aspect Lock */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-medium text-text-muted select-none">
                Size
              </span>
              <button
                onClick={() =>
                  handleUpdate("aspectRatioLocked", !isAspectLocked)
                }
                className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded transition-all cursor-pointer ${isAspectLocked ? "text-accent bg-accent/10" : "text-text-muted hover:text-text-primary hover:bg-surface-raised"}`}
                title={
                  isAspectLocked ? "Unlock aspect ratio" : "Lock aspect ratio"
                }
              >
                {isAspectLocked ? (
                  <Lock className="w-3 h-3" />
                ) : (
                  <Unlock className="w-3 h-3" />
                )}
                {isAspectLocked ? "Locked" : "Free"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-text-muted/60 block mb-0.5 select-none">
                  W
                </label>
                <input
                  type="number"
                  value={Math.round(Math.abs(selectedClip.width))}
                  onChange={(e) => handleWidthChange(Number(e.target.value))}
                  className="w-full bg-surface-raised border border-border/60 rounded-md px-2 py-1 text-xs text-text-primary outline-none focus:border-accent tabular-nums selectable"
                />
              </div>
              <div>
                <label className="text-[9px] text-text-muted/60 block mb-0.5 select-none">
                  H
                </label>
                <input
                  type="number"
                  value={Math.round(Math.abs(selectedClip.height))}
                  onChange={(e) => handleHeightChange(Number(e.target.value))}
                  className="w-full bg-surface-raised border border-border/60 rounded-md px-2 py-1 text-xs text-text-primary outline-none focus:border-accent tabular-nums selectable"
                />
              </div>
            </div>
          </div>

          {/* Rotation */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <PropertySlider
                label="Rotation"
                value={selectedClip.rotation}
                min={-180}
                max={180}
                step={1}
                suffix="°"
                onChange={(v) => handleUpdate("rotation", v)}
                keyframeActive={isRotationKeyframed}
                onToggleKeyframe={() =>
                  handleToggleVisualKeyframe("rotation", selectedClip.rotation)
                }
              />
            </div>
            {isRotationKeyframed && (
              <button
                type="button"
                onClick={() => openCurveEditor(selectedClip.id, "rotation")}
                className="p-1 text-accent hover:text-accent/80 hover:bg-accent/10 rounded transition-all cursor-pointer mb-0.5"
                title="Open Speed & Curve Editor for Rotation"
              >
                <TrendingUp className="w-3.5 h-3.5" />
              </button>
            )}
            {selectedClip.rotation !== 0 && (
              <button
                onClick={() => handleUpdate("rotation", 0)}
                className="p-1 text-text-muted hover:text-accent hover:bg-accent/10 rounded transition-all cursor-pointer mb-0.5"
                title="Reset rotation"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Opacity */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <PropertySlider
                label="Opacity"
                value={opacityPercent}
                min={0}
                max={100}
                step={1}
                suffix="%"
                onChange={(v) => handleUpdate("opacity", v / 100)}
                keyframeActive={isOpacityKeyframed}
                onToggleKeyframe={() =>
                  handleToggleVisualKeyframe("opacity", opacityPercent / 100)
                }
              />
            </div>
            {isOpacityKeyframed && (
              <button
                type="button"
                onClick={() => openCurveEditor(selectedClip.id, "opacity")}
                className="p-1 text-accent hover:text-accent/80 hover:bg-accent/10 rounded transition-all cursor-pointer mb-0.5"
                title="Open Speed & Curve Editor for Opacity"
              >
                <TrendingUp className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Blend Mode */}
          <PropertySelect
            label="Blend Mode"
            value={selectedClip.blendMode || "normal"}
            options={[
              { value: "normal", label: "Normal" },
              { value: "screen", label: "Screen (Light / Flares)" },
              { value: "multiply", label: "Multiply (Shadows / Burn)" },
              { value: "overlay", label: "Overlay (Contrast)" },
              { value: "additive", label: "Additive (Glow)" },
              { value: "difference", label: "Difference (Inversion)" },
            ]}
            onChange={(v) => handleUpdate("blendMode", v)}
          />

          {/* Flip buttons */}
          <div>
            <span className="text-[10px] font-medium text-text-muted select-none block mb-1.5">
              Flip
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => handleUpdate("width", -selectedClip.width)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium rounded-md border transition-all cursor-pointer ${isFlippedH ? "bg-accent/15 text-accent border-accent/30" : "bg-surface-raised text-text-muted border-border/60 hover:text-text-primary hover:bg-surface-raised/80"}`}
                title="Flip Horizontal"
              >
                <FlipHorizontal2 className="w-3.5 h-3.5" />
                Horizontal
              </button>
              <button
                onClick={() => handleUpdate("height", -selectedClip.height)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium rounded-md border transition-all cursor-pointer ${isFlippedV ? "bg-accent/15 text-accent border-accent/30" : "bg-surface-raised text-text-muted border-border/60 hover:text-text-primary hover:bg-surface-raised/80"}`}
                title="Flip Vertical"
              >
                <FlipVertical2 className="w-3.5 h-3.5" />
                Vertical
              </button>
            </div>
          </div>

          {/* Cinematic Motion Blur */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-text-muted select-none flex items-center gap-1.5">
                <Aperture className="w-3 h-3" />
                Cinematic Motion Blur
              </span>
              <button
                type="button"
                onClick={() =>
                  handleUpdate("motionBlur", {
                    ...selectedClip.motionBlur,
                    enabled: !selectedClip.motionBlur?.enabled,
                  })
                }
                className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${
                  selectedClip.motionBlur?.enabled
                    ? "bg-accent"
                    : "bg-surface-raised border border-border/60"
                }`}
                title="Toggle cinematic motion blur"
              >
                <span
                  className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
                    selectedClip.motionBlur?.enabled ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            {selectedClip.motionBlur?.enabled && (
              <div className="space-y-2 pl-1">
                <PropertySlider
                  label="Shutter Angle"
                  value={selectedClip.motionBlur?.shutterAngle ?? 180}
                  min={0}
                  max={360}
                  step={5}
                  suffix="°"
                  onChange={(v) =>
                    handleUpdate("motionBlur", {
                      ...selectedClip.motionBlur,
                      enabled: true,
                      shutterAngle: v,
                    })
                  }
                />
                <div>
                  <span className="text-[9px] text-text-muted/60 block mb-1 select-none">Quality</span>
                  <div className="flex gap-1.5">
                    {[8, 16, 32].map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() =>
                          handleUpdate("motionBlur", {
                            ...selectedClip.motionBlur,
                            enabled: true,
                            samples: q,
                          })
                        }
                        className={`flex-1 py-1 text-[9px] font-medium rounded-md border transition-all cursor-pointer ${
                          (selectedClip.motionBlur?.samples ?? 16) === q
                            ? "bg-accent/15 text-accent border-accent/30"
                            : "bg-surface-raised text-text-muted border-border/60 hover:text-text-primary"
                        }`}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </PropertySection>

      {/* <PropertySection title="Timing" icon={<Timer className="w-3.5 h-3.5" />} defaultCollapsed>
        <div className="space-y-2.5">
          <PropertySlider label="Trim In" value={selectedClip.trimIn} min={0} max={Math.max(selectedClip.trimOut - 0.1, 0)} step={0.01} suffix="s" onChange={(v) => handleUpdate("trimIn", v)} />
          <PropertySlider label="Trim Out" value={selectedClip.trimOut} min={selectedClip.trimIn + 0.1} max={selectedClip.trimIn + selectedClip.duration + 30} step={0.01} suffix="s" onChange={(v) => handleUpdate("trimOut", v)} />
        </div>
      </PropertySection> */}
    </div>
  );
};
