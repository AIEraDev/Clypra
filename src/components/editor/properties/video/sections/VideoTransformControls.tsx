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
import { getPlaybackClock, usePlaybackClock } from "@/hooks/usePlaybackClock";
import { useUIStore } from "@/store/uiStore";
import { KeyframeNavControls } from "../../primitives/KeyframeNavControls";
import { propertyEditTelemetry } from "@/lib/properties/propertyEditTelemetry";
import { evaluateVisualPropertyKeyframes } from "@/core/evaluation/animation";
import { useDragTransformOverride } from "@/hooks/useDragTransformOverride";

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

  // ── Authoritative drag override ───────────────────────────────────────────
  // During a canvas drag, TransformController publishes live geometry without
  // writing to the Zustand store. useDragTransformOverride subscribes to that
  // signal and surfaces it as React state so the property panel stays in sync.
  // dragOverride is null when no drag is active; the panel falls back to the
  // clip's stored values (the normal path).
  const { dragOverride } = useDragTransformOverride(selectedClip.id);

  // ── Keyframe state ────────────────────────────────────────────────────────
  const openCurveEditor = useUIStore((s) => s.openCurveEditor);

  const clock = getPlaybackClock();
  const clockState =
    typeof usePlaybackClock === "function" ? usePlaybackClock() : null;
  const currentTime = clockState?.time ?? clock.time;
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

  const scaleKfState = getKeyframeState(["width", "height"]);
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

  const handleJumpUniformScaleKeyframe = useCallback(
    (direction: "prev" | "next") => {
      const widthKfs = selectedClip.visualKeyframes?.width || [];
      const heightKfs = selectedClip.visualKeyframes?.height || [];
      const allTimes = Array.from(
        new Set([
          ...widthKfs.map((k) => k.time),
          ...heightKfs.map((k) => k.time),
        ]),
      ).sort((a, b) => a - b);

      let target: number | null = null;
      if (direction === "prev") {
        for (let i = allTimes.length - 1; i >= 0; i--) {
          if (allTimes[i] < localTime - 0.05) {
            target = allTimes[i];
            break;
          }
        }
      } else {
        for (let i = 0; i < allTimes.length; i++) {
          if (allTimes[i] > localTime + 0.05) {
            target = allTimes[i];
            break;
          }
        }
      }
      if (target !== null) {
        getPlaybackClock().seek(selectedClip.startTime + target);
      }
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

  // Live evaluated values when keyframes exist
  const currentWidth = useMemo(() => {
    if (selectedClip.visualKeyframes?.width?.length) {
      return evaluateVisualPropertyKeyframes(
        selectedClip.visualKeyframes.width,
        localTime,
        selectedClip.width ?? baseWidth,
        selectedClip.duration,
      );
    }
    return Math.abs(selectedClip.width ?? baseWidth);
  }, [
    selectedClip.visualKeyframes?.width,
    localTime,
    selectedClip.width,
    baseWidth,
    selectedClip.duration,
  ]);

  const currentHeight = useMemo(() => {
    if (selectedClip.visualKeyframes?.height?.length) {
      return evaluateVisualPropertyKeyframes(
        selectedClip.visualKeyframes.height,
        localTime,
        selectedClip.height ?? baseHeight,
        selectedClip.duration,
      );
    }
    return Math.abs(selectedClip.height ?? baseHeight);
  }, [
    selectedClip.visualKeyframes?.height,
    localTime,
    selectedClip.height,
    baseHeight,
    selectedClip.duration,
  ]);

  const currentClipX = useMemo(() => {
    if (selectedClip.visualKeyframes?.x?.length) {
      return evaluateVisualPropertyKeyframes(
        selectedClip.visualKeyframes.x,
        localTime,
        selectedClip.x ?? 0,
        selectedClip.duration,
      );
    }
    if (selectedClip.visualKeyframes?.width?.length && selectedClip.width) {
      const authoredCenterX = (selectedClip.x ?? 0) + selectedClip.width / 2;
      return authoredCenterX - currentWidth / 2;
    }
    return selectedClip.x ?? 0;
  }, [
    selectedClip.visualKeyframes?.x,
    selectedClip.visualKeyframes?.width,
    selectedClip.width,
    currentWidth,
    localTime,
    selectedClip.x,
    selectedClip.duration,
  ]);

  const currentClipY = useMemo(() => {
    if (selectedClip.visualKeyframes?.y?.length) {
      return evaluateVisualPropertyKeyframes(
        selectedClip.visualKeyframes.y,
        localTime,
        selectedClip.y ?? 0,
        selectedClip.duration,
      );
    }
    if (selectedClip.visualKeyframes?.height?.length && selectedClip.height) {
      const authoredCenterY = (selectedClip.y ?? 0) + selectedClip.height / 2;
      return authoredCenterY - currentHeight / 2;
    }
    return selectedClip.y ?? 0;
  }, [
    selectedClip.visualKeyframes?.y,
    selectedClip.visualKeyframes?.height,
    selectedClip.height,
    currentHeight,
    localTime,
    selectedClip.y,
    selectedClip.duration,
  ]);

  const currentRotation = useMemo(() => {
    if (selectedClip.visualKeyframes?.rotation?.length) {
      return evaluateVisualPropertyKeyframes(
        selectedClip.visualKeyframes.rotation,
        localTime,
        selectedClip.rotation ?? 0,
        selectedClip.duration,
      );
    }
    return selectedClip.rotation ?? 0;
  }, [
    selectedClip.visualKeyframes?.rotation,
    localTime,
    selectedClip.rotation,
    selectedClip.duration,
  ]);

  // ── Apply drag overrides (display-only, no handleUpdate calls) ────────────
  // When a canvas drag is active, replace the derived clip values with the
  // live geometry published by TransformController so the property panel and
  // the canvas handle stay in sync at 60 fps.
  const displayClipX = dragOverride !== null ? dragOverride.x : currentClipX;
  const displayClipY = dragOverride !== null ? dragOverride.y : currentClipY;
  const displayRotation =
    dragOverride !== null ? dragOverride.rotation : currentRotation;
  // Width/height used for scalePercent: override during drag so the panel
  // reflects the live canvas size, not the stale stored value.
  const displayWidth =
    dragOverride !== null ? dragOverride.width : currentWidth;
  const displayHeight =
    dragOverride !== null ? dragOverride.height : currentHeight;

  const handleToggleUniformScaleKeyframe = useCallback(() => {
    const isAt = scaleKfState.isAtKeyframe;
    const currentWidthKfs = selectedClip.visualKeyframes?.width || [];
    const currentHeightKfs = selectedClip.visualKeyframes?.height || [];

    if (isAt) {
      const nextWidthKfs = currentWidthKfs.filter(
        (kf) => Math.abs(kf.time - localTime) >= 0.08,
      );
      const nextHeightKfs = currentHeightKfs.filter(
        (kf) => Math.abs(kf.time - localTime) >= 0.08,
      );
      handleUpdateMultiple({
        visualKeyframes: {
          ...(selectedClip.visualKeyframes || {}),
          width: nextWidthKfs,
          height: nextHeightKfs,
        },
      });
    } else {
      const t = Math.round(localTime * 100) / 100;

      const nextWidthKfs = [
        ...currentWidthKfs.filter(
          (kf) => Math.abs(kf.time - localTime) >= 0.08,
        ),
        {
          id: `kf-width-${Date.now()}`,
          time: t,
          value: currentWidth,
          easing: "easeInOut" as const,
        },
      ].sort((a, b) => a.time - b.time);

      const nextHeightKfs = [
        ...currentHeightKfs.filter(
          (kf) => Math.abs(kf.time - localTime) >= 0.08,
        ),
        {
          id: `kf-height-${Date.now()}`,
          time: t,
          value: currentHeight,
          easing: "easeInOut" as const,
        },
      ].sort((a, b) => a.time - b.time);

      handleUpdateMultiple({
        visualKeyframes: {
          ...(selectedClip.visualKeyframes || {}),
          width: nextWidthKfs,
          height: nextHeightKfs,
        },
      });
    }
  }, [
    scaleKfState.isAtKeyframe,
    selectedClip.visualKeyframes,
    localTime,
    currentWidth,
    currentHeight,
    handleUpdateMultiple,
  ]);

  const handleTogglePositionKeyframe = useCallback(() => {
    const isAt = positionXKfState.isAtKeyframe || positionYKfState.isAtKeyframe;
    const currentXKfs = selectedClip.visualKeyframes?.x || [];
    const currentYKfs = selectedClip.visualKeyframes?.y || [];

    if (isAt) {
      const nextXKfs = currentXKfs.filter(
        (kf) => Math.abs(kf.time - localTime) >= 0.08,
      );
      const nextYKfs = currentYKfs.filter(
        (kf) => Math.abs(kf.time - localTime) >= 0.08,
      );
      handleUpdateMultiple({
        visualKeyframes: {
          ...(selectedClip.visualKeyframes || {}),
          x: nextXKfs,
          y: nextYKfs,
        },
      });
    } else {
      const t = Math.round(localTime * 100) / 100;
      const nextXKfs = [
        ...currentXKfs.filter((kf) => Math.abs(kf.time - localTime) >= 0.08),
        {
          id: `kf-x-${Date.now()}`,
          time: t,
          value: currentClipX,
          easing: "easeInOut" as const,
        },
      ].sort((a, b) => a.time - b.time);

      const nextYKfs = [
        ...currentYKfs.filter((kf) => Math.abs(kf.time - localTime) >= 0.08),
        {
          id: `kf-y-${Date.now()}`,
          time: t,
          value: currentClipY,
          easing: "easeInOut" as const,
        },
      ].sort((a, b) => a.time - b.time);

      handleUpdateMultiple({
        visualKeyframes: {
          ...(selectedClip.visualKeyframes || {}),
          x: nextXKfs,
          y: nextYKfs,
        },
      });
    }
  }, [
    positionXKfState.isAtKeyframe,
    positionYKfState.isAtKeyframe,
    selectedClip.visualKeyframes,
    localTime,
    currentClipX,
    currentClipY,
    handleUpdateMultiple,
  ]);

  const handleJumpPositionKeyframe = useCallback(
    (direction: "prev" | "next") => {
      const currentXKfs = selectedClip.visualKeyframes?.x || [];
      const currentYKfs = selectedClip.visualKeyframes?.y || [];
      const allTimes = Array.from(
        new Set([
          ...currentXKfs.map((k) => k.time),
          ...currentYKfs.map((k) => k.time),
        ]),
      ).sort((a, b) => a - b);

      let target: number | null = null;
      if (direction === "prev") {
        for (let i = allTimes.length - 1; i >= 0; i--) {
          if (allTimes[i] < localTime - 0.05) {
            target = allTimes[i];
            break;
          }
        }
      } else {
        for (let i = 0; i < allTimes.length; i++) {
          if (allTimes[i] > localTime + 0.05) {
            target = allTimes[i];
            break;
          }
        }
      }
      if (target !== null) {
        getPlaybackClock().seek(selectedClip.startTime + target);
      }
    },
    [selectedClip.visualKeyframes, selectedClip.startTime, localTime],
  );

  /** Scale percentage relative to the original source dimensions. */
  const scalePercent = useMemo(() => {
    if (baseWidth > 0 && displayWidth > 0) {
      return Math.round((displayWidth / baseWidth) * 100);
    }
    return 100;
  }, [baseWidth, displayWidth]);

  // ── Position (displayed relative to canvas center) ────────────────────────
  // The clip's (x, y) is its top-left corner. We convert to a center-relative
  // offset so that (0, 0) means "perfectly centered on the canvas".
  const centerX = displayClipX + displayWidth / 2;
  const centerY = displayClipY + displayHeight / 2;
  /** Positive = right of center */
  const displayX = Math.round(centerX - canvasWidth / 2);
  /** Positive = above center (Y axis flipped to match screen convention) */
  const displayY = Math.round(canvasHeight / 2 - centerY);

  // ── Handlers ──────────────────────────────────────────────────────────────

  /**
   * Scale uniformly from the clip's current center point.
   * Preserves the clip's on-screen center position so it doesn't jump.
   *
   * NOTE: newX/newY are stored as exact floats (no Math.round) so that the
   * displayed Position values (which derive center from clip.x + width/2) do
   * not drift by ±1px when the scaled width/height is odd-numbered. The render
   * pipeline and UI both tolerate sub-pixel positions; rounding is only applied
   * at the display layer (Math.round in displayX/displayY).
   */
  const handleScaleChange = useCallback(
    (newScalePercent: number) => {
      const clamped = Math.max(1, Math.min(500, newScalePercent));
      const multiplier = clamped / 100;
      const newWidth = Math.round(baseWidth * multiplier);
      const newHeight = isAspectLocked
        ? Math.round(baseHeight * multiplier)
        : currentHeight;

      // Preserve the clip's center exactly — do NOT round newX/newY here.
      // Rounding a half-pixel offset (e.g. centerX - odd/2 = N.5) causes
      // Math.round to flip ±1px, making the displayed Position appear to
      // change even though scale and position are logically independent.
      const newX = centerX - newWidth / 2;
      const newY = centerY - newHeight / 2;

      const widthKfs = selectedClip.visualKeyframes?.width || [];
      const heightKfs = selectedClip.visualKeyframes?.height || [];

      const widthIdx = widthKfs.findIndex(
        (kf) => Math.abs(kf.time - localTime) < 0.08,
      );
      const heightIdx = heightKfs.findIndex(
        (kf) => Math.abs(kf.time - localTime) < 0.08,
      );

      const hasKf =
        widthKfs.length > 0 || (isAspectLocked && heightKfs.length > 0);

      if (widthIdx >= 0 || heightIdx >= 0) {
        const nextWidthKfs = [...widthKfs];
        if (widthIdx >= 0) {
          nextWidthKfs[widthIdx] = {
            ...nextWidthKfs[widthIdx],
            value: newWidth,
          };
        } else if (widthKfs.length > 0) {
          nextWidthKfs.push({
            id: `kf-width-${Date.now()}`,
            time: Math.round(localTime * 100) / 100,
            value: newWidth,
            easing: "easeInOut" as const,
          });
          nextWidthKfs.sort((a, b) => a.time - b.time);
        }

        const nextHeightKfs = [...heightKfs];
        if (isAspectLocked) {
          if (heightIdx >= 0) {
            nextHeightKfs[heightIdx] = {
              ...nextHeightKfs[heightIdx],
              value: newHeight,
            };
          } else if (heightKfs.length > 0) {
            nextHeightKfs.push({
              id: `kf-height-${Date.now()}`,
              time: Math.round(localTime * 100) / 100,
              value: newHeight,
              easing: "easeInOut" as const,
            });
            nextHeightKfs.sort((a, b) => a.time - b.time);
          }
        }

        handleUpdateMultiple({
          width: newWidth,
          height: newHeight,
          x: newX,
          y: newY,
          baseWidth,
          baseHeight,
          visualKeyframes: {
            ...(selectedClip.visualKeyframes || {}),
            ...(widthKfs.length > 0 ? { width: nextWidthKfs } : {}),
            ...(isAspectLocked && heightKfs.length > 0
              ? { height: nextHeightKfs }
              : {}),
          },
        });
      } else if (hasKf) {
        const t = Math.round(localTime * 100) / 100;
        const nextWidthKfs =
          widthKfs.length > 0
            ? [
                ...widthKfs,
                {
                  id: `kf-width-${Date.now()}`,
                  time: t,
                  value: newWidth,
                  easing: "easeInOut" as const,
                },
              ].sort((a, b) => a.time - b.time)
            : widthKfs;

        const nextHeightKfs =
          isAspectLocked && heightKfs.length > 0
            ? [
                ...heightKfs,
                {
                  id: `kf-height-${Date.now()}`,
                  time: t,
                  value: newHeight,
                  easing: "easeInOut" as const,
                },
              ].sort((a, b) => a.time - b.time)
            : heightKfs;

        handleUpdateMultiple({
          width: newWidth,
          height: newHeight,
          x: newX,
          y: newY,
          baseWidth,
          baseHeight,
          visualKeyframes: {
            ...(selectedClip.visualKeyframes || {}),
            ...(widthKfs.length > 0 ? { width: nextWidthKfs } : {}),
            ...(isAspectLocked && heightKfs.length > 0
              ? { height: nextHeightKfs }
              : {}),
          },
        });
      } else {
        handleUpdateMultiple({
          width: newWidth,
          height: newHeight,
          x: newX,
          y: newY,
          // Persist baseWidth/baseHeight so future scale operations stay accurate
          baseWidth,
          baseHeight,
        });
      }
    },
    [
      baseWidth,
      baseHeight,
      isAspectLocked,
      currentHeight,
      centerX,
      centerY,
      localTime,
      selectedClip.visualKeyframes,
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

      // Exact float — see handleScaleChange comment on rounding rationale.
      const newX = centerX - newWidth / 2;

      const widthKfs = selectedClip.visualKeyframes?.width || [];
      const widthIdx = widthKfs.findIndex(
        (kf) => Math.abs(kf.time - localTime) < 0.08,
      );

      if (widthIdx >= 0) {
        const nextWidthKfs = [...widthKfs];
        nextWidthKfs[widthIdx] = {
          ...nextWidthKfs[widthIdx],
          value: newWidth,
        };
        handleUpdateMultiple({
          width: newWidth,
          x: newX,
          baseWidth,
          visualKeyframes: {
            ...(selectedClip.visualKeyframes || {}),
            width: nextWidthKfs,
          },
        });
      } else if (widthKfs.length > 0) {
        const nextWidthKfs = [
          ...widthKfs,
          {
            id: `kf-width-${Date.now()}`,
            time: Math.round(localTime * 100) / 100,
            value: newWidth,
            easing: "easeInOut" as const,
          },
        ].sort((a, b) => a.time - b.time);
        handleUpdateMultiple({
          width: newWidth,
          x: newX,
          baseWidth,
          visualKeyframes: {
            ...(selectedClip.visualKeyframes || {}),
            width: nextWidthKfs,
          },
        });
      } else {
        handleUpdateMultiple({
          width: newWidth,
          x: newX,
          baseWidth,
        });
      }
    },
    [
      baseWidth,
      centerX,
      localTime,
      selectedClip.visualKeyframes,
      handleUpdateMultiple,
    ],
  );

  /**
   * Scale height independently when uniform scaling is off.
   */
  const handleScaleHeightChange = useCallback(
    (newScalePercent: number) => {
      const clamped = Math.max(1, Math.min(500, newScalePercent));
      const multiplier = clamped / 100;
      const newHeight = Math.round(baseHeight * multiplier);

      // Exact float — see handleScaleChange comment on rounding rationale.
      const newY = centerY - newHeight / 2;

      const heightKfs = selectedClip.visualKeyframes?.height || [];
      const heightIdx = heightKfs.findIndex(
        (kf) => Math.abs(kf.time - localTime) < 0.08,
      );

      if (heightIdx >= 0) {
        const nextHeightKfs = [...heightKfs];
        nextHeightKfs[heightIdx] = {
          ...nextHeightKfs[heightIdx],
          value: newHeight,
        };
        handleUpdateMultiple({
          height: newHeight,
          y: newY,
          baseHeight,
          visualKeyframes: {
            ...(selectedClip.visualKeyframes || {}),
            height: nextHeightKfs,
          },
        });
      } else if (heightKfs.length > 0) {
        const nextHeightKfs = [
          ...heightKfs,
          {
            id: `kf-height-${Date.now()}`,
            time: Math.round(localTime * 100) / 100,
            value: newHeight,
            easing: "easeInOut" as const,
          },
        ].sort((a, b) => a.time - b.time);
        handleUpdateMultiple({
          height: newHeight,
          y: newY,
          baseHeight,
          visualKeyframes: {
            ...(selectedClip.visualKeyframes || {}),
            height: nextHeightKfs,
          },
        });
      } else {
        handleUpdateMultiple({
          height: newHeight,
          y: newY,
          baseHeight,
        });
      }
    },
    [
      baseHeight,
      centerY,
      localTime,
      selectedClip.visualKeyframes,
      handleUpdateMultiple,
    ],
  );

  /** Scale percentage for height */
  const scaleHeightPercent = useMemo(() => {
    if (baseHeight > 0 && displayHeight > 0) {
      return Math.round((displayHeight / baseHeight) * 100);
    }
    return 100;
  }, [baseHeight, displayHeight]);

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
      } else if (currentKfs.length > 0) {
        const nextKfs = [
          ...currentKfs,
          {
            id: `kf-${prop}-${Date.now()}`,
            time: Math.round(localTime * 100) / 100,
            value,
            easing: "easeInOut" as const,
          },
        ].sort((a, b) => a.time - b.time);
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
    [
      selectedClip.visualKeyframes,
      localTime,
      handleUpdate,
      handleUpdateMultiple,
    ],
  );

  // ── Alignment Handlers (respects keyframes) ──────────────────────────────
  const handleAlignLeft = useCallback(() => {
    propertyEditTelemetry.recordButtonAction({
      action: "align-left",
      category: "video",
      property: "x",
    });
    handleUpdatePropertyWithKeyframe("x", 0);
  }, [handleUpdatePropertyWithKeyframe]);

  const handleAlignCenterX = useCallback(() => {
    propertyEditTelemetry.recordButtonAction({
      action: "align-center-x",
      category: "video",
      property: "x",
    });
    handleUpdatePropertyWithKeyframe(
      "x",
      Math.round((canvasWidth - currentWidth) / 2),
    );
  }, [canvasWidth, currentWidth, handleUpdatePropertyWithKeyframe]);

  const handleAlignRight = useCallback(() => {
    propertyEditTelemetry.recordButtonAction({
      action: "align-right",
      category: "video",
      property: "x",
    });
    handleUpdatePropertyWithKeyframe(
      "x",
      Math.round(canvasWidth - currentWidth),
    );
  }, [canvasWidth, currentWidth, handleUpdatePropertyWithKeyframe]);

  const handleAlignTop = useCallback(() => {
    propertyEditTelemetry.recordButtonAction({
      action: "align-top",
      category: "video",
      property: "y",
    });
    handleUpdatePropertyWithKeyframe("y", 0);
  }, [handleUpdatePropertyWithKeyframe]);

  const handleAlignCenterY = useCallback(() => {
    propertyEditTelemetry.recordButtonAction({
      action: "align-center-y",
      category: "video",
      property: "y",
    });
    handleUpdatePropertyWithKeyframe(
      "y",
      Math.round((canvasHeight - currentHeight) / 2),
    );
  }, [canvasHeight, currentHeight, handleUpdatePropertyWithKeyframe]);

  const handleAlignBottom = useCallback(() => {
    propertyEditTelemetry.recordButtonAction({
      action: "align-bottom",
      category: "video",
      property: "y",
    });
    handleUpdatePropertyWithKeyframe(
      "y",
      Math.round(canvasHeight - currentHeight),
    );
  }, [canvasHeight, currentHeight, handleUpdatePropertyWithKeyframe]);

  // ── Reset Handler (Scale to 100%, center position, 0 rotation) ────────────
  const handleReset = useCallback(() => {
    propertyEditTelemetry.recordButtonAction({
      action: "reset-transform",
      category: "video",
      property: "transform",
    });
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
                {t("properties.transform.scale") || "Scale"}
              </span>
              <div className="flex items-center gap-2">
                <SliderTrack
                  value={scalePercent}
                  min={1}
                  max={500}
                  step={1}
                  onChange={handleScaleChange}
                  snapPoints={[{ value: 100, threshold: 14 }]}
                  propertyId="scale"
                  category="video"
                />
                <NumericControl
                  value={scalePercent}
                  onChange={handleScaleChange}
                  step={1}
                  min={1}
                  max={500}
                  suffix="%"
                  ariaLabel={t("properties.transform.scale") || "Scale"}
                  inputPosition="text-right"
                  propertyId="scale"
                  category="video"
                />
                <KeyframeNavControls
                  hasKeyframes={scaleKfState.hasKeyframes}
                  isAtKeyframe={scaleKfState.isAtKeyframe}
                  onToggleKeyframe={handleToggleUniformScaleKeyframe}
                  onPrevKeyframe={() => handleJumpUniformScaleKeyframe("prev")}
                  onNextKeyframe={() => handleJumpUniformScaleKeyframe("next")}
                  hasPrev={scaleKfState.hasPrev}
                  hasNext={scaleKfState.hasNext}
                  onOpenCurveEditor={() =>
                    openCurveEditor(selectedClip.id, "width")
                  }
                  label={t("properties.transform.scale") || "Scale"}
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
                    snapPoints={[{ value: 100, threshold: 14 }]}
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
                      handleToggleKeyframe("width", currentWidth)
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
                    snapPoints={[{ value: 100, threshold: 14 }]}
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
                      handleToggleKeyframe("height", currentHeight)
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
                onToggleKeyframe={handleTogglePositionKeyframe}
                onPrevKeyframe={() => handleJumpPositionKeyframe("prev")}
                onNextKeyframe={() => handleJumpPositionKeyframe("next")}
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
                value={Math.round(displayRotation)}
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
                  handleToggleKeyframe("rotation", displayRotation)
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
              title={
                t("properties.transform.alignCenterX") ||
                "Align center horizontally"
              }
              aria-label={
                t("properties.transform.alignCenterX") ||
                "Align center horizontally"
              }
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
              title={
                t("properties.transform.alignCenterY") ||
                "Align center vertically"
              }
              aria-label={
                t("properties.transform.alignCenterY") ||
                "Align center vertically"
              }
              onClick={handleAlignCenterY}
            >
              {/* prettier-ignore */}
              <svg xmlns="http://www.w3.org/2000/svg" width="12px" height="12px" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none" /><path fill="currentColor" fillRule="evenodd" d="M17 13v2a2 2 0 1 1-4 0v-2h-2v4.714C11 18.977 10.105 20 9 20s-2-1.023-2-2.286V13H3a1 1 0 0 1 0-2h4V6.286C7 5.023 7.895 4 9 4s2 1.023 2 2.286V11h2V9a2 2 0 1 1 4 0v2h4a1 1 0 0 1 0 2z" /></svg>
            </button>

            <button
              type="button"
              className="bg-[#27272a] hover:bg-[#3f3f46] text-zinc-300 hover:text-white w-8 h-6 flex items-center justify-center transition-colors cursor-pointer"
              title={t("properties.transform.alignBottom") || "Align bottom"}
              aria-label={
                t("properties.transform.alignBottom") || "Align bottom"
              }
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
