/**
 * VideoTransformControls.tsx
 *
 * Flat, inline transform controls for video clips.
 * Uses composable primitives (SliderTrack, NumericControl, KeyframeNavControls) for consistency.
 *
 * Coordinate conventions (matching TextTransformSection / NLE spec):
 *   - Clip stores top-left corner (x, y) in canvas-space pixels.
 *   - displayX = centerX - canvasWidth/2   (0 = horizontal center)
 *   - displayY = canvasHeight/2 - centerY  (0 = vertical center, +Y = up)
 *   - Scale is derived from currentWidth / baseWidth × 100.
 *   - Opacity is stored 0.0–1.0, displayed as 0–100.
 */

import React, { useCallback, useMemo, useState } from "react";
import type { Clip } from "@/types";
import { useI18n } from "@/i18n";
import { type ClipFitModeExtended } from "@/lib/timeline/timelineClip";
import { PropertySectionHeader } from "../../primitives/PropertySectionHeader";
import { NumericControl } from "../../primitives/NumericControl";
import { SliderTrack } from "../../primitives/SliderTrack";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import { useUIStore } from "@/store/uiStore";
import { KeyframeNavControls } from "../../primitives/KeyframeNavControls";
import { propertyEditTelemetry } from "@/lib/properties/propertyEditTelemetry";

interface VideoTransformControlsProps {
  selectedClip: Clip;
  canvasWidth: number;
  canvasHeight: number;
  handleUpdate: (key: string, value: any) => void;
  handleUpdateMultiple: (fields: Record<string, any>) => void;
  handleApplyFit: (fitMode: ClipFitModeExtended) => void;
}

export const VideoTransformControls: React.FC<VideoTransformControlsProps> = ({
  selectedClip,
  canvasWidth,
  canvasHeight,
  handleUpdate,
  handleUpdateMultiple,
  handleApplyFit,
}) => {
  const { t } = useI18n();
  const isAspectLocked = selectedClip.aspectRatioLocked ?? true;
  const [isTransformCollapsed, setIsTransformCollapsed] = useState(false);

  // ── Keyframe state ────────────────────────────────────────────────────────
  const openCurveEditor = useUIStore((s) => s.openCurveEditor);

  const currentTime = getPlaybackClock().time;
  const localTime = Math.max(
    0,
    Math.min(selectedClip.duration, currentTime - selectedClip.startTime),
  );

  const getKeyframeState = useCallback(
    (props: ("width" | "height" | "x" | "y" | "rotation")[]) => {
      const allTimes: number[] = [];
      let isAt = false;
      for (const p of props) {
        const kfs = selectedClip.visualKeyframes?.[p] || [];
        for (const k of kfs) {
          allTimes.push(k.time);
          if (Math.abs(k.time - localTime) < 0.08) isAt = true;
        }
      }
      const uniqueSorted = Array.from(new Set(allTimes)).sort((a, b) => a - b);
      return {
        hasKeyframes: uniqueSorted.length > 0,
        isAtKeyframe: isAt,
        hasPrev: uniqueSorted.some((t) => t < localTime - 0.05),
        hasNext: uniqueSorted.some((t) => t > localTime + 0.05),
      };
    },
    [selectedClip.visualKeyframes, localTime],
  );

  const scaleWidthKfState = getKeyframeState(["width"]);
  const scaleHeightKfState = getKeyframeState(["height"]);
  const positionXKfState = getKeyframeState(["x"]);
  const positionYKfState = getKeyframeState(["y"]);
  const rotationKfState = getKeyframeState(["rotation"]);

  const handleJumpToKeyframe = useCallback(
    (
      prop: "width" | "height" | "x" | "y" | "rotation",
      direction: "prev" | "next",
    ) => {
      const kfs = selectedClip.visualKeyframes?.[prop] || [];
      const sorted = kfs.map((k) => k.time).sort((a, b) => a - b);
      let target: number | null = null;
      if (direction === "prev") {
        for (let i = sorted.length - 1; i >= 0; i--) {
          if (sorted[i] < localTime - 0.05) {
            target = sorted[i];
            break;
          }
        }
      } else {
        for (let i = 0; i < sorted.length; i++) {
          if (sorted[i] > localTime + 0.05) {
            target = sorted[i];
            break;
          }
        }
      }
      if (target !== null)
        getPlaybackClock().seek(selectedClip.startTime + target);
    },
    [selectedClip.visualKeyframes, selectedClip.startTime, localTime],
  );

  const handleToggleKeyframe = useCallback(
    (prop: "width" | "height" | "x" | "y" | "rotation", value: number) => {
      const currentKfs = selectedClip.visualKeyframes?.[prop] || [];
      const existingIdx = currentKfs.findIndex(
        (kf) => Math.abs(kf.time - localTime) < 0.08,
      );
      const nextKfs =
        existingIdx >= 0
          ? currentKfs.filter((_, i) => i !== existingIdx)
          : [
              ...currentKfs,
              {
                id: `kf-${prop}-${Date.now()}`,
                time: Math.round(localTime * 100) / 100,
                value,
                easing: "easeInOut" as const,
              },
            ].sort((a, b) => a.time - b.time);
      handleUpdate("visualKeyframes", {
        ...(selectedClip.visualKeyframes || {}),
        [prop]: nextKfs,
      });
    },
    [selectedClip.visualKeyframes, localTime, handleUpdate],
  );

  // ── Dimensions & Scale ────────────────────────────────────────────────────
  // baseWidth/baseHeight are the unscaled source dimensions stored on the clip.
  // They are set at import time and must never change during a scale operation.
  const baseWidth =
    selectedClip.baseWidth ?? Math.abs(selectedClip.width ?? 1920);
  const baseHeight =
    selectedClip.baseHeight ?? Math.abs(selectedClip.height ?? 1080);
  const currentWidth = Math.abs(selectedClip.width ?? baseWidth);
  const currentHeight = Math.abs(selectedClip.height ?? baseHeight);

  /** Scale percentage relative to the original source dimensions. */
  const scalePercent = useMemo(() => {
    if (baseWidth > 0 && currentWidth > 0) {
      return Math.round((currentWidth / baseWidth) * 100);
    }
    return 100;
  }, [baseWidth, currentWidth]);

  // ── Position (displayed relative to canvas center) ────────────────────────
  // The clip's (x, y) is its top-left corner. We convert to a center-relative
  // offset so that (0, 0) means "perfectly centered on the canvas".
  const centerX = (selectedClip.x ?? 0) + currentWidth / 2;
  const centerY = (selectedClip.y ?? 0) + currentHeight / 2;
  /** Positive = right of center */
  const displayX = Math.round(centerX - canvasWidth / 2);
  /** Positive = above center (Y axis flipped to match screen convention) */
  const displayY = Math.round(canvasHeight / 2 - centerY);

  // ── Handlers ──────────────────────────────────────────────────────────────

  /**
   * Scale uniformly from the clip's current center point.
   * Preserves the clip's on-screen center position so it doesn't jump.
   */
  const handleScaleChange = useCallback(
    (newScalePercent: number) => {
      const clamped = Math.max(1, Math.min(500, newScalePercent));
      const multiplier = clamped / 100;
      const newWidth = Math.round(baseWidth * multiplier);
      const newHeight = isAspectLocked
        ? Math.round(baseHeight * multiplier)
        : currentHeight;

      // Keep the clip anchored to its current center
      const newX = Math.round(centerX - newWidth / 2);
      const newY = Math.round(centerY - newHeight / 2);

      handleUpdateMultiple({
        width: newWidth,
        height: newHeight,
        x: newX,
        y: newY,
        // Persist baseWidth/baseHeight so future scale operations stay accurate
        baseWidth,
        baseHeight,
      });
    },
    [
      baseWidth,
      baseHeight,
      isAspectLocked,
      currentHeight,
      centerX,
      centerY,
      handleUpdateMultiple,
    ],
  );

  /**
   * Scale width independently when uniform scaling is off.
   */
  const handleScaleWidthChange = useCallback(
    (newScalePercent: number) => {
      const clamped = Math.max(1, Math.min(500, newScalePercent));
      const multiplier = clamped / 100;
      const newWidth = Math.round(baseWidth * multiplier);

      // Keep the clip anchored to its current center
      const newX = Math.round(centerX - newWidth / 2);

      handleUpdateMultiple({
        width: newWidth,
        x: newX,
        baseWidth,
      });
    },
    [baseWidth, centerX, handleUpdateMultiple],
  );

  /**
   * Scale height independently when uniform scaling is off.
   */
  const handleScaleHeightChange = useCallback(
    (newScalePercent: number) => {
      const clamped = Math.max(1, Math.min(500, newScalePercent));
      const multiplier = clamped / 100;
      const newHeight = Math.round(baseHeight * multiplier);

      // Keep the clip anchored to its current center
      const newY = Math.round(centerY - newHeight / 2);

      handleUpdateMultiple({
        height: newHeight,
        y: newY,
        baseHeight,
      });
    },
    [baseHeight, centerY, handleUpdateMultiple],
  );

  /** Scale percentage for height */
  const scaleHeightPercent = useMemo(() => {
    if (baseHeight > 0 && currentHeight > 0) {
      return Math.round((currentHeight / baseHeight) * 100);
    }
    return 100;
  }, [baseHeight, currentHeight]);

  const handleUpdatePropertyWithKeyframe = useCallback(
    (prop: "width" | "height" | "x" | "y" | "rotation", value: number) => {
      const currentKfs = selectedClip.visualKeyframes?.[prop] || [];
      const existingIdx = currentKfs.findIndex(
        (kf) => Math.abs(kf.time - localTime) < 0.08,
      );

      if (existingIdx >= 0) {
        const nextKfs = [...currentKfs];
        nextKfs[existingIdx] = {
          ...nextKfs[existingIdx],
          value,
        };
        handleUpdateMultiple({
          [prop]: value,
          visualKeyframes: {
            ...(selectedClip.visualKeyframes || {}),
            [prop]: nextKfs,
          },
        });
      } else {
        handleUpdate(prop, value);
      }
    },
    [selectedClip.visualKeyframes, localTime, handleUpdate, handleUpdateMultiple],
  );

  // ── Alignment Handlers (respects keyframes) ──────────────────────────────
  const handleAlignLeft = useCallback(() => {
    propertyEditTelemetry.recordButtonAction({ action: "align-left", category: "video", property: "x" });
    handleUpdatePropertyWithKeyframe("x", 0);
  }, [handleUpdatePropertyWithKeyframe]);

  const handleAlignCenterX = useCallback(() => {
    propertyEditTelemetry.recordButtonAction({ action: "align-center-x", category: "video", property: "x" });
    handleUpdatePropertyWithKeyframe(
      "x",
      Math.round((canvasWidth - currentWidth) / 2),
    );
  }, [canvasWidth, currentWidth, handleUpdatePropertyWithKeyframe]);

  const handleAlignRight = useCallback(() => {
    propertyEditTelemetry.recordButtonAction({ action: "align-right", category: "video", property: "x" });
    handleUpdatePropertyWithKeyframe(
      "x",
      Math.round(canvasWidth - currentWidth),
    );
  }, [canvasWidth, currentWidth, handleUpdatePropertyWithKeyframe]);

  const handleAlignTop = useCallback(() => {
    propertyEditTelemetry.recordButtonAction({ action: "align-top", category: "video", property: "y" });
    handleUpdatePropertyWithKeyframe("y", 0);
  }, [handleUpdatePropertyWithKeyframe]);

  const handleAlignCenterY = useCallback(() => {
    propertyEditTelemetry.recordButtonAction({ action: "align-center-y", category: "video", property: "y" });
    handleUpdatePropertyWithKeyframe(
      "y",
      Math.round((canvasHeight - currentHeight) / 2),
    );
  }, [canvasHeight, currentHeight, handleUpdatePropertyWithKeyframe]);

  const handleAlignBottom = useCallback(() => {
    propertyEditTelemetry.recordButtonAction({ action: "align-bottom", category: "video", property: "y" });
    handleUpdatePropertyWithKeyframe(
      "y",
      Math.round(canvasHeight - currentHeight),
    );
  }, [canvasHeight, currentHeight, handleUpdatePropertyWithKeyframe]);

  // ── Reset Handler (Scale to 100%, center position, 0 rotation) ────────────
  const handleReset = useCallback(() => {
    propertyEditTelemetry.recordButtonAction({ action: "reset-transform", category: "video", property: "transform" });
    const defaultX = Math.round((canvasWidth - baseWidth) / 2);
    const defaultY = Math.round((canvasHeight - baseHeight) / 2);
    handleUpdateMultiple({
      x: defaultX,
      y: defaultY,
      width: baseWidth,
      height: baseHeight,
      rotation: 0,
      aspectRatioLocked: true,
    });
  }, [canvasWidth, canvasHeight, baseWidth, baseHeight, handleUpdateMultiple]);

  /**
   * Translate the clip so its center lands at the given canvas-relative offset.
   * +x = right of center, +y = above center (Y axis is inverted for storage).
   */
  const handleDisplayXChange = useCallback(
    (nextDisplayX: number) => {
      const nextCenterX = canvasWidth / 2 + nextDisplayX;
      handleUpdatePropertyWithKeyframe(
        "x",
        Math.round(nextCenterX - currentWidth / 2),
      );
    },
    [canvasWidth, currentWidth, handleUpdatePropertyWithKeyframe],
  );

  const handleDisplayYChange = useCallback(
    (nextDisplayY: number) => {
      const nextCenterY = canvasHeight / 2 - nextDisplayY;
      handleUpdatePropertyWithKeyframe(
        "y",
        Math.round(nextCenterY - currentHeight / 2),
      );
    },
    [canvasHeight, currentHeight, handleUpdatePropertyWithKeyframe],
  );

  /** Rotation in degrees, stored directly on the clip. */
  const handleRotationChange = useCallback(
    (val: number) => handleUpdatePropertyWithKeyframe("rotation", val),
    [handleUpdatePropertyWithKeyframe],
  );

  /**
   * Opacity is stored as a 0.0–1.0 float; the slider displays 0–100 integers.
   * Clamp the stored value to avoid floating-point drift beyond [0, 1].
   */
  const handleOpacityChange = useCallback(
    (val: number) =>
      handleUpdate("opacity", Math.max(0, Math.min(1, val / 100))),
    [handleUpdate],
  );

  const toggleAspectLock = useCallback(() => {
    handleUpdate("aspectRatioLocked", !isAspectLocked);
  }, [isAspectLocked, handleUpdate]);

  return (
    <div className="space-y-4">
      {/* Transform Section Header */}
      <PropertySectionHeader
        title={t("properties.transform.title") || "Transform"}
        isCollapsed={isTransformCollapsed}
        onToggleCollapse={() => setIsTransformCollapsed(!isTransformCollapsed)}
        onReset={handleReset}
        resetTitle={t("properties.transform.reset") || "Reset transform"}
      />

      {/* Transform Controls - Collapsible */}
      {!isTransformCollapsed && (
        <div className="space-y-4">
          {/* Scale - Conditional rendering based on uniform scale toggle */}
          {isAspectLocked ? (
            <div className="space-y-1">
              <span className="text-[11px] text-white select-none block">
                Scale
              </span>
              <div className="flex items-center gap-2">
                <SliderTrack
                  value={scalePercent}
                  min={1}
                  max={500}
                  step={1}
                  onChange={handleScaleChange}
                  propertyId="scale"
                  category="video"
                />
                <NumericControl
                  value={scalePercent}
                  onChange={handleScaleChange}
                  step={1}
                  suffix="%"
                  ariaLabel="Scale"
                  inputPosition="text-right"
                  propertyId="scale"
                  category="video"
                />
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <span className="text-[11px] text-white select-none block">
                  Scale width
                </span>
                <div className="flex items-center gap-2">
                  <SliderTrack
                    value={scalePercent}
                    min={1}
                    max={500}
                    step={1}
                    onChange={handleScaleWidthChange}
                    propertyId="scaleWidth"
                    category="video"
                  />
                  <NumericControl
                    value={scalePercent}
                    onChange={handleScaleWidthChange}
                    step={1}
                    suffix="%"
                    ariaLabel="Scale width"
                    min={1}
                    max={500}
                    inputPosition="text-right"
                    propertyId="scaleWidth"
                    category="video"
                  />
                  <KeyframeNavControls
                    hasKeyframes={scaleWidthKfState.hasKeyframes}
                    isAtKeyframe={scaleWidthKfState.isAtKeyframe}
                    onToggleKeyframe={() =>
                      handleToggleKeyframe(
                        "width",
                        Math.abs(selectedClip.width ?? 0),
                      )
                    }
                    onPrevKeyframe={() => handleJumpToKeyframe("width", "prev")}
                    onNextKeyframe={() => handleJumpToKeyframe("width", "next")}
                    hasPrev={scaleWidthKfState.hasPrev}
                    hasNext={scaleWidthKfState.hasNext}
                    onOpenCurveEditor={() =>
                      openCurveEditor(selectedClip.id, "width")
                    }
                    label="Scale width"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] text-white select-none block">
                  Scale height
                </span>
                <div className="flex items-center gap-2">
                  <SliderTrack
                    value={scaleHeightPercent}
                    min={1}
                    max={500}
                    step={1}
                    onChange={handleScaleHeightChange}
                    propertyId="scaleHeight"
                    category="video"
                  />
                  <NumericControl
                    value={scaleHeightPercent}
                    onChange={handleScaleHeightChange}
                    step={1}
                    suffix="%"
                    ariaLabel="Scale height"
                    inputPosition="text-right"
                    propertyId="scaleHeight"
                    category="video"
                  />
                  <KeyframeNavControls
                    hasKeyframes={scaleHeightKfState.hasKeyframes}
                    isAtKeyframe={scaleHeightKfState.isAtKeyframe}
                    onToggleKeyframe={() =>
                      handleToggleKeyframe(
                        "height",
                        Math.abs(selectedClip.height ?? 0),
                      )
                    }
                    onPrevKeyframe={() =>
                      handleJumpToKeyframe("height", "prev")
                    }
                    onNextKeyframe={() =>
                      handleJumpToKeyframe("height", "next")
                    }
                    hasPrev={scaleHeightKfState.hasPrev}
                    hasNext={scaleHeightKfState.hasNext}
                    onOpenCurveEditor={() =>
                      openCurveEditor(selectedClip.id, "height")
                    }
                    label="Scale height"
                  />
                </div>
              </div>
            </>
          )}

          {/* Uniform scale toggle */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-white select-none">
              Uniform scale
            </span>
            <button
              type="button"
              onClick={toggleAspectLock}
              className={`relative inline-flex h-5 w-9 cursor-pointer items-center rounded-full transition-colors ${
                isAspectLocked ? "bg-accent" : "bg-[#3f3f46]"
              }`}
              aria-label="Toggle uniform scale"
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isAspectLocked ? "translate-x-[18px]" : "translate-x-[2px]"
                }`}
              />
            </button>
          </div>

          {/* Position */}
          <div className="flex items-center gap-4">
            <span className="text-[11px] text-white select-none block w-[8rem]">
              Position
            </span>

            <div className="flex items-center justify-between gap-2 w-full">
              <div className="flex items-center gap-x-4">
                {/* X Position */}
                <NumericControl
                  value={Math.round(displayX)}
                  onChange={handleDisplayXChange}
                  prefix="X"
                  step={1}
                  ariaLabel="X Position"
                  propertyId="positionX"
                  category="video"
                />

                {/* Y Position */}
                <NumericControl
                  value={Math.round(displayY)}
                  onChange={handleDisplayYChange}
                  prefix="Y"
                  step={1}
                  ariaLabel="Y Position"
                  propertyId="positionY"
                  category="video"
                />
              </div>

              {/* Position Keyframe Controls */}
              <KeyframeNavControls
                hasKeyframes={
                  positionXKfState.hasKeyframes || positionYKfState.hasKeyframes
                }
                isAtKeyframe={
                  positionXKfState.isAtKeyframe || positionYKfState.isAtKeyframe
                }
                onToggleKeyframe={() => {
                  handleToggleKeyframe("x", selectedClip.x ?? 0);
                  handleToggleKeyframe("y", selectedClip.y ?? 0);
                }}
                onPrevKeyframe={() => handleJumpToKeyframe("x", "prev")}
                onNextKeyframe={() => handleJumpToKeyframe("x", "next")}
                hasPrev={positionXKfState.hasPrev || positionYKfState.hasPrev}
                hasNext={positionXKfState.hasNext || positionYKfState.hasNext}
                onOpenCurveEditor={() => openCurveEditor(selectedClip.id, "x")}
                label="Position"
              />
            </div>
          </div>

          {/* Rotate */}
          <div className="flex items-center gap-4">
            <span className="text-[11px] text-white select-none block w-[8rem]">
              Rotate
            </span>

            <div className="flex items-center gap-2 justify-between w-full">
              <NumericControl
                value={selectedClip.rotation ?? 0}
                onChange={handleRotationChange}
                step={1}
                suffix="°"
                inputPosition="text-right"
                ariaLabel="Rotation"
                inputWidth="w-6"
                propertyId="rotation"
                category="video"
              />

              {/* Rotation Keyframe Controls */}
              <KeyframeNavControls
                hasKeyframes={rotationKfState.hasKeyframes}
                isAtKeyframe={rotationKfState.isAtKeyframe}
                onToggleKeyframe={() =>
                  handleToggleKeyframe("rotation", selectedClip.rotation ?? 0)
                }
                onPrevKeyframe={() => handleJumpToKeyframe("rotation", "prev")}
                onNextKeyframe={() => handleJumpToKeyframe("rotation", "next")}
                hasPrev={rotationKfState.hasPrev}
                hasNext={rotationKfState.hasNext}
                onOpenCurveEditor={() =>
                  openCurveEditor(selectedClip.id, "rotation")
                }
                label="Rotation"
              />
            </div>
          </div>

          {/* Alignment buttons */}
          <div className="flex items-center rounded-sm">
            <button
              type="button"
              className="bg-[#27272a] hover:bg-[#3f3f46] text-zinc-300 hover:text-white w-8 h-6 flex items-center justify-center transition-colors cursor-pointer"
              title={t("properties.transform.alignLeft") || "Align left"}
              aria-label={t("properties.transform.alignLeft") || "Align left"}
              onClick={handleAlignLeft}
            >
              {/* prettier-ignore */}
              <svg xmlns="http://www.w3.org/2000/svg" width="12px" height="12px" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none" /><path fill="currentColor" d="M2 22V2h2v20zm4-5v-3h10v3zm0-7V7h16v3z" /></svg>
            </button>

            <button
              type="button"
              className="bg-[#27272a] hover:bg-[#3f3f46] text-zinc-300 hover:text-white w-8 h-6 flex items-center justify-center transition-colors cursor-pointer"
              title={t("properties.transform.alignCenterX") || "Align center horizontally"}
              aria-label={t("properties.transform.alignCenterX") || "Align center horizontally"}
              onClick={handleAlignCenterX}
            >
              {/* prettier-ignore */}
              <svg xmlns="http://www.w3.org/2000/svg" width="12px" height="12px" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none" /><path fill="currentColor" fillRule="evenodd" d="M11 13v-2H6.286C5.023 11 4 10.105 4 9s1.023-2 2.286-2H11V3a1 1 0 0 1 2 0v4h4.714C18.977 7 20 7.895 20 9s-1.023 2-2.286 2H13v2h3a2 2 0 1 1 0 4h-3v4a1 1 0 0 1-2 0v-4H8a2 2 0 1 1 0-4z" /></svg>
            </button>

            <button
              type="button"
              className="bg-[#27272a] hover:bg-[#3f3f46] text-zinc-300 hover:text-white w-8 h-6 flex items-center justify-center transition-colors cursor-pointer"
              title={t("properties.transform.alignRight") || "Align right"}
              aria-label={t("properties.transform.alignRight") || "Align right"}
              onClick={handleAlignRight}
            >
              {/* prettier-ignore */}
              <svg xmlns="http://www.w3.org/2000/svg" width="12px" height="12px" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none" /><path fill="currentColor" d="M20 22V2h2v20zM8 17v-3h10v3zm-6-7V7h16v3z" /></svg>
            </button>

            <button
              type="button"
              className="bg-[#27272a] hover:bg-[#3f3f46] text-zinc-300 hover:text-white w-8 h-6 flex items-center justify-center transition-colors cursor-pointer"
              title={t("properties.transform.alignTop") || "Align top"}
              aria-label={t("properties.transform.alignTop") || "Align top"}
              onClick={handleAlignTop}
            >
              {/* prettier-ignore */}
              <svg xmlns="http://www.w3.org/2000/svg" width="12px" height="12px" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none" /><path fill="currentColor" d="M7 22V6h3v16zm7-6V6h3v10zM2 4V2h20v2z" /></svg>
            </button>

            <button
              type="button"
              className="bg-[#27272a] hover:bg-[#3f3f46] text-zinc-300 hover:text-white w-8 h-6 flex items-center justify-center transition-colors cursor-pointer"
              title={t("properties.transform.alignCenterY") || "Align center vertically"}
              aria-label={t("properties.transform.alignCenterY") || "Align center vertically"}
              onClick={handleAlignCenterY}
            >
              {/* prettier-ignore */}
              <svg xmlns="http://www.w3.org/2000/svg" width="12px" height="12px" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none" /><path fill="currentColor" fillRule="evenodd" d="M17 13v2a2 2 0 1 1-4 0v-2h-2v4.714C11 18.977 10.105 20 9 20s-2-1.023-2-2.286V13H3a1 1 0 0 1 0-2h4V6.286C7 5.023 7.895 4 9 4s2 1.023 2 2.286V11h2V9a2 2 0 1 1 4 0v2h4a1 1 0 0 1 0 2z" /></svg>
            </button>

            <button
              type="button"
              className="bg-[#27272a] hover:bg-[#3f3f46] text-zinc-300 hover:text-white w-8 h-6 flex items-center justify-center transition-colors cursor-pointer"
              title={t("properties.transform.alignBottom") || "Align bottom"}
              aria-label={t("properties.transform.alignBottom") || "Align bottom"}
              onClick={handleAlignBottom}
            >
              {/* prettier-ignore */}
              <svg xmlns="http://www.w3.org/2000/svg" width="12px" height="12px" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none" /><path fill="currentColor" d="M2 22v-2h20v2zm5-4V2h3v16zm7 0V8h3v10z" /></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
