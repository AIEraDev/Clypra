/**
 * TextTransformSection.tsx
 *
 * CapCut-parity dedicated Transform section for text clips.
 * Replicates the exact layout, controls, and behavior from CapCut's desktop inspector:
 * - Collapsible "Transform" header with reset ⟲ and group keyframe < ◇ >
 * - Scale slider + percentage stepper 140% ↕ + keyframe < ◇ >
 * - Uniform scale toggle switch
 * - Position X / Y steppers (relative to center 0,0) + keyframe < ◇ >
 * - Plane rotation stepper 0.00° ↕ + circular dial knob widget + keyframe < ◇ >
 * - Docked canvas alignment toolbar: |←  ┼  →|  ╤  +  ┴  |  ╪  ≡
 */

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { RotateCcw } from "lucide-react";
import { useTranslation } from "@/i18n";
import { useProjectStore } from "@/store/projectStore";
import { getPlaybackClock } from "@/core/playback/PlaybackClock";
import type { TextClip } from "@/types";
import { InlineKeyframeNav } from "../../primitives/InlineKeyframeNav";

interface TextTransformSectionProps {
  textClip: TextClip;
  handleUpdate: (key: string, value: any) => void;
  handleCustomStyleUpdate: (key: string, value: any) => void;
  handleUpdateMultiple?: (fields: Record<string, any>) => void;
}

export const TextTransformSection: React.FC<TextTransformSectionProps> = ({
  textClip,
  handleUpdate,
  handleCustomStyleUpdate,
  handleUpdateMultiple,
}) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);
  const [uniformScale, setUniformScale] = useState(
    textClip.aspectRatioLocked ?? true,
  );

  // Undo/redo and canvas transforms replace the clip snapshot. Keep this
  // ephemeral control in sync with the persisted transform rather than
  // displaying the value from the previously selected snapshot.
  useEffect(() => {
    setUniformScale(textClip.aspectRatioLocked ?? true);
  }, [textClip.id, textClip.aspectRatioLocked]);

  const project = useProjectStore((s) => s.project);
  const canvasWidth = project?.canvasWidth ?? 1920;
  const canvasHeight = project?.canvasHeight ?? 1080;

  // ── Dimensions & Scale ───────────────────────────────────────────────────
  const baseWidth = textClip.baseWidth ?? textClip.width ?? 400;
  const baseHeight = textClip.baseHeight ?? textClip.height ?? 120;
  const currentWidth = textClip.width ?? baseWidth;
  const currentHeight = textClip.height ?? baseHeight;

  const scalePercent = useMemo(() => {
    if (baseWidth > 0 && currentWidth > 0) {
      return Math.round((currentWidth / baseWidth) * 100);
    }
    return 100;
  }, [baseWidth, currentWidth]);

  // ── Coordinates (CapCut displays relative to canvas center: 0, 0) ─────────
  const centerX = (textClip.x ?? 0) + currentWidth / 2;
  const centerY = (textClip.y ?? 0) + currentHeight / 2;
  const displayX = Math.round(centerX - canvasWidth / 2);
  const displayY = Math.round(canvasHeight / 2 - centerY);

  // ── Keyframe Navigation & State ──────────────────────────────────────────
  const currentTime = getPlaybackClock().time;
  const localTime = Math.max(
    0,
    Math.min(textClip.duration || 5, currentTime - (textClip.startTime || 0)),
  );

  const getKeyframeState = useCallback(
    (props: ("x" | "y" | "width" | "height" | "rotation")[]) => {
      const allTimes: number[] = [];
      let isAt = false;

      for (const p of props) {
        const kfs = textClip.visualKeyframes?.[p] || [];
        for (const k of kfs) {
          allTimes.push(k.time);
          if (Math.abs(k.time - localTime) < 0.08) {
            isAt = true;
          }
        }
      }

      const uniqueSorted = Array.from(new Set(allTimes)).sort((a, b) => a - b);
      const hasPrev = uniqueSorted.some((time) => time < localTime - 0.05);
      const hasNext = uniqueSorted.some((time) => time > localTime + 0.05);

      return {
        hasKeyframes: uniqueSorted.length > 0,
        isAtKeyframe: isAt,
        hasPrev,
        hasNext,
      };
    },
    [textClip.visualKeyframes, localTime],
  );

  const allKfState = getKeyframeState([
    "x",
    "y",
    "width",
    "height",
    "rotation",
  ]);
  const scaleKfState = getKeyframeState(["width", "height"]);
  const posKfState = getKeyframeState(["x", "y"]);
  const rotKfState = getKeyframeState(["rotation"]);

  const handleJumpToKeyframe = useCallback(
    (
      props: ("x" | "y" | "width" | "height" | "rotation")[],
      direction: "prev" | "next",
    ) => {
      const allTimes: number[] = [];
      for (const p of props) {
        const kfs = textClip.visualKeyframes?.[p] || [];
        for (const k of kfs) allTimes.push(k.time);
      }
      const sorted = Array.from(new Set(allTimes)).sort((a, b) => a - b);
      let targetTime: number | null = null;

      if (direction === "prev") {
        for (let i = sorted.length - 1; i >= 0; i--) {
          if (sorted[i] < localTime - 0.05) {
            targetTime = sorted[i];
            break;
          }
        }
      } else {
        for (let i = 0; i < sorted.length; i++) {
          if (sorted[i] > localTime + 0.05) {
            targetTime = sorted[i];
            break;
          }
        }
      }

      if (targetTime !== null) {
        getPlaybackClock().seek(textClip.startTime + targetTime);
      }
    },
    [textClip.visualKeyframes, textClip.startTime, localTime],
  );

  const handleToggleMultiKeyframe = useCallback(
    (
      pairs: {
        prop: "x" | "y" | "width" | "height" | "rotation";
        value: number;
      }[],
    ) => {
      const roundedTime = Math.round(localTime * 100) / 100;
      const hasAnyAtTime = pairs.some(({ prop }) => {
        const kfs = textClip.visualKeyframes?.[prop] || [];
        return kfs.some((kf) => Math.abs(kf.time - localTime) < 0.08);
      });

      const nextVisual = { ...(textClip.visualKeyframes || {}) };

      for (const { prop, value } of pairs) {
        const currentKfs = nextVisual[prop] || [];
        if (hasAnyAtTime) {
          nextVisual[prop] = currentKfs.filter(
            (kf) => Math.abs(kf.time - localTime) >= 0.08,
          );
        } else {
          nextVisual[prop] = [
            ...currentKfs,
            {
              id: `kf-${prop}-${Date.now()}`,
              time: roundedTime,
              value,
              easing: "easeInOut" as const,
            },
          ].sort((a, b) => a.time - b.time);
        }
      }

      handleUpdate("visualKeyframes", nextVisual);
    },
    [textClip.visualKeyframes, localTime, handleUpdate],
  );

  const handleUpdatePropertyWithKeyframe = useCallback(
    (prop: "x" | "y" | "width" | "height" | "rotation", value: number) => {
      const currentKfs = textClip.visualKeyframes?.[prop] || [];
      const existingIdx = currentKfs.findIndex(
        (kf) => Math.abs(kf.time - localTime) < 0.08,
      );

      if (existingIdx >= 0) {
        const nextKfs = [...currentKfs];
        nextKfs[existingIdx] = {
          ...nextKfs[existingIdx],
          value,
        };
        const updates = {
          [prop]: value,
          visualKeyframes: {
            ...(textClip.visualKeyframes || {}),
            [prop]: nextKfs,
          },
        };
        if (handleUpdateMultiple) {
          handleUpdateMultiple(updates);
        } else {
          handleUpdate(prop, value);
          handleUpdate("visualKeyframes", updates.visualKeyframes);
        }
      } else {
        handleUpdate(prop, value);
      }
    },
    [textClip.visualKeyframes, localTime, handleUpdate, handleUpdateMultiple],
  );

  // ── Scale Handler (scales proportionally from center) ────────────────────
  const handleScaleChange = useCallback(
    (newScalePercent: number) => {
      const clamped = Math.max(10, Math.min(500, newScalePercent));
      const scaleMultiplier = clamped / 100;
      const newWidth = Math.round(baseWidth * scaleMultiplier);
      const newHeight = uniformScale
        ? Math.round(baseHeight * scaleMultiplier)
        : currentHeight;

      const newX = Math.round(centerX - newWidth / 2);
      const newY = Math.round(centerY - newHeight / 2);

      const updates: Record<string, any> = {
        width: newWidth,
        height: newHeight,
        x: newX,
        y: newY,
        baseWidth,
        baseHeight,
        scale: scaleMultiplier,
      };

      if (handleUpdateMultiple) {
        handleUpdateMultiple(updates);
      } else {
        Object.entries(updates).forEach(([k, v]) => handleUpdate(k, v));
      }
    },
    [
      baseWidth,
      baseHeight,
      uniformScale,
      currentHeight,
      centerX,
      centerY,
      handleUpdateMultiple,
      handleUpdate,
    ],
  );

  // ── Position Handlers (X / Y relative to center) ─────────────────────────
  const handleDisplayXChange = useCallback(
    (nextDisplayX: number) => {
      const nextCenterX = canvasWidth / 2 + nextDisplayX;
      const nextX = Math.round(nextCenterX - currentWidth / 2);
      handleUpdatePropertyWithKeyframe("x", nextX);
    },
    [canvasWidth, currentWidth, handleUpdatePropertyWithKeyframe],
  );

  const handleDisplayYChange = useCallback(
    (nextDisplayY: number) => {
      const nextCenterY = canvasHeight / 2 - nextDisplayY;
      const nextY = Math.round(nextCenterY - currentHeight / 2);
      handleUpdatePropertyWithKeyframe("y", nextY);
    },
    [canvasHeight, currentHeight, handleUpdatePropertyWithKeyframe],
  );

  // ── Plane Rotation Dial Widget ───────────────────────────────────────────
  const handleDialPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dial = e.currentTarget;
    const rect = dial.getBoundingClientRect();
    const dialCenterX = rect.left + rect.width / 2;
    const dialCenterY = rect.top + rect.height / 2;

    const updateAngle = (clientX: number, clientY: number) => {
      const dx = clientX - dialCenterX;
      const dy = clientY - dialCenterY;
      let deg = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
      if (deg > 180) deg -= 360;
      if (deg < -180) deg += 360;
      handleUpdatePropertyWithKeyframe("rotation", deg);
    };

    updateAngle(e.clientX, e.clientY);

    const onPointerMove = (moveEvent: PointerEvent) => {
      updateAngle(moveEvent.clientX, moveEvent.clientY);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  // ── Canvas Alignment Handlers ────────────────────────────────────────────
  const alignLeft = () => handleUpdatePropertyWithKeyframe("x", 0);
  const alignCenterX = () =>
    handleUpdatePropertyWithKeyframe(
      "x",
      Math.round((canvasWidth - currentWidth) / 2),
    );
  const alignRight = () =>
    handleUpdatePropertyWithKeyframe(
      "x",
      Math.round(canvasWidth - currentWidth),
    );

  const alignTop = () => handleUpdatePropertyWithKeyframe("y", 0);
  const alignCenterY = () =>
    handleUpdatePropertyWithKeyframe(
      "y",
      Math.round((canvasHeight - currentHeight) / 2),
    );
  const alignBottom = () =>
    handleUpdatePropertyWithKeyframe(
      "y",
      Math.round(canvasHeight - currentHeight),
    );

  // ── Reset Handler (Resets scale, position to center, and rotation) ────────
  const handleReset = () => {
    const defaultX = Math.round((canvasWidth - baseWidth) / 2);
    const defaultY = Math.round((canvasHeight - baseHeight) / 2);
    const updates: Record<string, any> = {
      x: defaultX,
      y: defaultY,
      width: baseWidth,
      height: baseHeight,
      rotation: 0,
      scale: 1.0,
      aspectRatioLocked: true,
    };
    if (handleUpdateMultiple) {
      handleUpdateMultiple(updates);
    } else {
      Object.entries(updates).forEach(([k, v]) => handleUpdate(k, v));
    }
  };

  return (
    <div className="space-y-3.5 select-none text-white">
      {/* ── Transform Header ── */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="flex items-center gap-1.5 text-xs font-semibold text-white hover:text-white/80 transition-colors cursor-pointer"
        >
          <span>{t("properties.transform.title") || "Transform"}</span>
          <span className="text-[10px] text-[#8e8e93]">
            {isExpanded ? "▲" : "▼"}
          </span>
        </button>

        <div className="flex items-center gap-2">
          {/* Reset button ⟲ */}
          <button
            type="button"
            onClick={handleReset}
            className="text-[#8e8e93] hover:text-white transition-colors cursor-pointer p-0.5 rounded"
            title={t("properties.transform.reset") || "Reset transform"}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* Group Keyframe Controls < ◇ > */}
          {/* <InlineKeyframeNav
            state={allKfState}
            onToggle={() =>
              handleToggleMultiKeyframe([
                { prop: "x", value: Math.round(textClip.x) },
                { prop: "y", value: Math.round(textClip.y) },
                { prop: "width", value: currentWidth },
                { prop: "height", value: currentHeight },
                { prop: "rotation", value: textClip.rotation || 0 },
              ])
            }
            onPrev={() =>
              handleJumpToKeyframe(
                ["x", "y", "width", "height", "rotation"],
                "prev",
              )
            }
            onNext={() =>
              handleJumpToKeyframe(
                ["x", "y", "width", "height", "rotation"],
                "next",
              )
            }
            label="Transform"
          /> */}
        </div>
      </div>

      {isExpanded && (
        <div className="space-y-3.5">
          {/* ── Row 1: Scale ── */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#a1a1aa] shrink-0 w-24">
              {t("properties.transform.scale") || "Scale"}
            </span>

            <div className="flex-1 flex items-center gap-2.5">
              <input
                type="range"
                min={10}
                max={400}
                value={scalePercent}
                onChange={(e) => handleScaleChange(Number(e.target.value))}
                className="w-full h-1 bg-[#3f3f46] rounded-full appearance-none outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer"
              />

              {/* Percentage Stepper */}
              <div className="flex items-center bg-[#242426] border border-white/5 rounded-md px-2 py-1 text-xs text-white shrink-0">
                <input
                  type="text"
                  value={`${scalePercent}%`}
                  onChange={(e) => {
                    const parsed = Number.parseInt(
                      e.target.value.replace(/[^0-9]/g, ""),
                      10,
                    );
                    if (!Number.isNaN(parsed)) handleScaleChange(parsed);
                  }}
                  className="w-10 bg-transparent text-right outline-none pr-1"
                />
                <div className="flex flex-col ml-1 text-[8px] text-[#8e8e93] leading-[6px]">
                  <button
                    type="button"
                    onClick={() => handleScaleChange(scalePercent + 1)}
                    className="hover:text-white cursor-pointer"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => handleScaleChange(scalePercent - 1)}
                    className="hover:text-white cursor-pointer"
                  >
                    ▼
                  </button>
                </div>
              </div>

              {/* Scale Keyframe < ◇ > */}
              {/* <InlineKeyframeNav
                state={scaleKfState}
                onToggle={() =>
                  handleToggleMultiKeyframe([
                    { prop: "width", value: currentWidth },
                    { prop: "height", value: currentHeight },
                  ])
                }
                onPrev={() => handleJumpToKeyframe(["width", "height"], "prev")}
                onNext={() => handleJumpToKeyframe(["width", "height"], "next")}
                label="Scale"
              /> */}
            </div>
          </div>

          {/* ── Row 2: Uniform Scale ── */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#a1a1aa]">
              {t("properties.transform.uniformScale") || "Uniform scale"}
            </span>
            <button
              type="button"
              onClick={() => {
                const next = !uniformScale;
                setUniformScale(next);
                handleUpdate("aspectRatioLocked", next);
              }}
              className={`w-9 h-5 rounded-full transition-colors cursor-pointer relative p-0.5 ${
                uniformScale ? "bg-cyan-400" : "bg-[#3f3f46]"
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white shadow-md transition-transform ${
                  uniformScale ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* ── Row 3: Position ── */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#a1a1aa] shrink-0 w-24">
              {t("properties.transform.position") || "Position"}
            </span>

            <div className="flex-1 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-1">
                {/* X Coordinate */}
                <div className="flex-1 flex items-center bg-[#242426] border border-white/5 rounded-md px-2 py-1 text-xs">
                  <span className="text-[#8e8e93] mr-2 text-[11px] font-medium">
                    X
                  </span>
                  <input
                    type="number"
                    value={displayX}
                    onChange={(e) =>
                      handleDisplayXChange(Number(e.target.value))
                    }
                    className="w-full bg-transparent text-center text-white outline-none"
                  />
                  <div className="flex flex-col text-[8px] text-[#8e8e93] leading-[6px]">
                    <button
                      type="button"
                      onClick={() => handleDisplayXChange(displayX + 1)}
                      className="hover:text-white cursor-pointer"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDisplayXChange(displayX - 1)}
                      className="hover:text-white cursor-pointer"
                    >
                      ▼
                    </button>
                  </div>
                </div>

                {/* Y Coordinate */}
                <div className="flex-1 flex items-center bg-[#242426] border border-white/5 rounded-md px-2 py-1 text-xs">
                  <span className="text-[#8e8e93] mr-2 text-[11px] font-medium">
                    Y
                  </span>
                  <input
                    type="number"
                    value={displayY}
                    onChange={(e) =>
                      handleDisplayYChange(Number(e.target.value))
                    }
                    className="w-full bg-transparent text-center text-white outline-none"
                  />
                  <div className="flex flex-col text-[8px] text-[#8e8e93] leading-[6px]">
                    <button
                      type="button"
                      onClick={() => handleDisplayYChange(displayY + 1)}
                      className="hover:text-white cursor-pointer"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDisplayYChange(displayY - 1)}
                      className="hover:text-white cursor-pointer"
                    >
                      ▼
                    </button>
                  </div>
                </div>
              </div>

              {/* Position Keyframe < ◇ > */}
              {/* <InlineKeyframeNav
                state={posKfState}
                onToggle={() =>
                  handleToggleMultiKeyframe([
                    { prop: "x", value: Math.round(textClip.x) },
                    { prop: "y", value: Math.round(textClip.y) },
                  ])
                }
                onPrev={() => handleJumpToKeyframe(["x", "y"], "prev")}
                onNext={() => handleJumpToKeyframe(["x", "y"], "next")}
                label="Position"
              /> */}
            </div>
          </div>

          {/* ── Row 4: Plane Rotation ── */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#a1a1aa] shrink-0 w-24">
              {t("properties.transform.planeRotation") || "Plane rotation"}
            </span>

            <div className="flex-1 flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                {/* Degrees Stepper */}
                <div className="flex items-center bg-[#242426] border border-white/5 rounded-md px-2 py-1 text-xs w-24">
                  <input
                    type="text"
                    value={`${(textClip.rotation || 0).toFixed(2)}°`}
                    onChange={(e) => {
                      const num = Number.parseFloat(
                        e.target.value.replace(/[^0-9.-]/g, ""),
                      );
                      if (!Number.isNaN(num))
                        handleUpdatePropertyWithKeyframe("rotation", num);
                    }}
                    className="w-full bg-transparent text-right text-white outline-none pr-1"
                  />
                  <div className="flex flex-col text-[8px] text-[#8e8e93] leading-[6px]">
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdatePropertyWithKeyframe(
                          "rotation",
                          Math.round((textClip.rotation || 0) + 1),
                        )
                      }
                      className="hover:text-white cursor-pointer"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdatePropertyWithKeyframe(
                          "rotation",
                          Math.round((textClip.rotation || 0) - 1),
                        )
                      }
                      className="hover:text-white cursor-pointer"
                    >
                      ▼
                    </button>
                  </div>
                </div>

                {/* Circular Dial Knob Widget */}
                <div
                  onPointerDown={handleDialPointerDown}
                  className="w-5 h-5 rounded-full bg-[#1e1e22] border border-white/20 relative cursor-pointer flex items-center justify-center hover:border-cyan-400 transition-colors shadow-sm shrink-0"
                  title="Drag to rotate"
                >
                  <div
                    className="absolute w-2 h-0.5 bg-cyan-400 rounded-full origin-left"
                    style={{
                      transform: `rotate(${textClip.rotation || 0}deg)`,
                      left: "50%",
                    }}
                  />
                  <div className="w-1 h-1 rounded-full bg-white/60" />
                </div>
              </div>

              {/* Rotation Keyframe < ◇ > */}
              {/* <InlineKeyframeNav
                state={rotKfState}
                onToggle={() =>
                  handleUpdatePropertyWithKeyframe(
                    "rotation",
                    textClip.rotation || 0,
                  )
                }
                onPrev={() => handleJumpToKeyframe(["rotation"], "prev")}
                onNext={() => handleJumpToKeyframe(["rotation"], "next")}
                label="Plane rotation"
              /> */}
            </div>
          </div>

          {/* ── Row 5: Alignment Toolbar ── */}
          <div className="bg-[#1c1c1f] border border-white/5 rounded-lg p-1 flex items-center justify-between text-[#8e8e93]">
            {/* Align Left |← */}
            <button
              type="button"
              onClick={alignLeft}
              className="p-1 rounded hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              title={t("properties.transform.alignLeft") || "Align left"}
            >
              <svg
                viewBox="0 0 16 16"
                className="w-3.5 h-3.5 fill-none stroke-current"
                strokeWidth="1.5"
              >
                <path d="M2 2v12M14 8H6M9 5l-3 3 3 3" />
              </svg>
            </button>

            {/* Align Center X ┼ */}
            <button
              type="button"
              onClick={alignCenterX}
              className="p-1 rounded hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              title={
                t("properties.transform.alignCenterX") ||
                "Align center horizontally"
              }
            >
              <svg
                viewBox="0 0 16 16"
                className="w-3.5 h-3.5 fill-none stroke-current"
                strokeWidth="1.5"
              >
                <path d="M8 2v12M3 8h10M5 6l-2 2 2 2M11 6l2 2-2 2" />
              </svg>
            </button>

            {/* Align Right →| */}
            <button
              type="button"
              onClick={alignRight}
              className="p-1 rounded hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              title={t("properties.transform.alignRight") || "Align right"}
            >
              <svg
                viewBox="0 0 16 16"
                className="w-3.5 h-3.5 fill-none stroke-current"
                strokeWidth="1.5"
              >
                <path d="M14 2v12M2 8h8M7 5l3 3-3 3" />
              </svg>
            </button>

            {/* Align Top ╤ */}
            <button
              type="button"
              onClick={alignTop}
              className="p-1 rounded hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              title={t("properties.transform.alignTop") || "Align top"}
            >
              <svg
                viewBox="0 0 16 16"
                className="w-3.5 h-3.5 fill-none stroke-current"
                strokeWidth="1.5"
              >
                <path d="M2 2h12M8 14V6M5 9l3-3 3 3" />
              </svg>
            </button>

            {/* Align Center Y + */}
            <button
              type="button"
              onClick={alignCenterY}
              className="p-1 rounded hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              title={
                t("properties.transform.alignCenterY") ||
                "Align center vertically"
              }
            >
              <svg
                viewBox="0 0 16 16"
                className="w-3.5 h-3.5 fill-none stroke-current"
                strokeWidth="1.5"
              >
                <path d="M2 8h12M8 3v10M6 5l2-2 2 2M6 11l2 2 2-2" />
              </svg>
            </button>

            {/* Align Bottom ┴ */}
            <button
              type="button"
              onClick={alignBottom}
              className="p-1 rounded hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              title={t("properties.transform.alignBottom") || "Align bottom"}
            >
              <svg
                viewBox="0 0 16 16"
                className="w-3.5 h-3.5 fill-none stroke-current"
                strokeWidth="1.5"
              >
                <path d="M2 14h12M8 2v8M5 7l3 3 3-3" />
              </svg>
            </button>

            {/* Divider */}
            <div className="w-px h-3.5 bg-white/10 mx-0.5" />

            {/* Distribute Horizontally ╪ */}
            <button
              type="button"
              disabled
              className="p-1 rounded opacity-25 cursor-not-allowed"
              title={
                t("properties.transform.distributeX") ||
                "Distribute horizontally"
              }
            >
              <svg
                viewBox="0 0 16 16"
                className="w-3.5 h-3.5 fill-none stroke-current"
                strokeWidth="1.5"
              >
                <path d="M3 2v12M13 2v12M8 5v6" />
              </svg>
            </button>

            {/* Distribute Vertically ≡ */}
            <button
              type="button"
              disabled
              className="p-1 rounded opacity-25 cursor-not-allowed"
              title={
                t("properties.transform.distributeY") || "Distribute vertically"
              }
            >
              <svg
                viewBox="0 0 16 16"
                className="w-3.5 h-3.5 fill-none stroke-current"
                strokeWidth="1.5"
              >
                <path d="M2 3h12M2 13h12M5 8h6" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
