/**
 * TextBackgroundSection.tsx
 *
 * CapCut-parity dedicated Background section for text clips.
 * Replicates the exact layout, controls, and behavior from CapCut's desktop inspector:
 * - Checkbox (pill rounded square) to toggle background on/off
 * - Collapsible "Background ▲" header with reset ⟲ and group keyframe < ◇ >
 * - Two visual shape selector cards: Rectangle (solid box) vs Split lines (wrapped badge)
 * - Color row with color swatch dropdown
 * - Opacity row with slider + percentage stepper 100% ↕ + keyframe < ◇ >
 * - Rounded rectangle row with slider + percentage stepper 0% ↕ + keyframe < ◇ >
 * - Height row with slider + percentage stepper 14% ↕ + keyframe < ◇ >
 * - Width row with slider + percentage stepper 14% ↕ + keyframe < ◇ >
 * - Y-offset row with slider + percentage stepper 50% ↕ + keyframe < ◇ >
 */

import React, { useState, useCallback } from "react";
import { RotateCcw, Check } from "lucide-react";
import { ClypraColorPicker } from "@clypra/ui-color-picker";
import { useTranslation } from "@/i18n";
import { getPlaybackClock } from "@/core/playback/PlaybackClock";
import type { TextClip } from "@/types";
import { InlineKeyframeNav } from "../../primitives/InlineKeyframeNav";
import { SOLID_COLOR_SWATCHES } from "../../data/fontData";
import { resolveTextBackgroundGeometry } from "@/lib/text/backgroundGeometry";

interface TextBackgroundSectionProps {
  textClip: TextClip;
  handleCustomStyleUpdate: (key: string, value: any) => void;
  handleUpdate: (key: string, value: any) => void;
}

export const TextBackgroundSection: React.FC<TextBackgroundSectionProps> = ({
  textClip,
  handleCustomStyleUpdate,
  handleUpdate,
}) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);

  const isEnabled = Boolean(textClip.background);
  const bg = textClip.background as any;

  const bgColor = bg?.color || "#000000";
  const geometry = resolveTextBackgroundGeometry(bg);
  const bgOpacity = geometry?.opacity ?? 100;
  const bgRadius = typeof bg?.borderRadius === "number" ? bg.borderRadius : 0;
  const bgHeight = geometry?.paddingY ?? 14;
  const bgWidth = geometry?.paddingX ?? 14;
  const bgYOffset = geometry?.yOffset ?? 50;
  const bgStyle = geometry?.style ?? "rectangle";

  // ── Keyframe Navigation & State ──────────────────────────────────────────
  const currentTime = getPlaybackClock().time;
  const localTime = Math.max(
    0,
    Math.min(textClip.duration || 5, currentTime - (textClip.startTime || 0)),
  );

  const getKeyframeState = useCallback(
    (prop: string) => {
      const kfs = (textClip as any).visualKeyframes?.[prop] || [];
      let isAt = false;
      const allTimes: number[] = [];

      for (const k of kfs) {
        allTimes.push(k.time);
        if (Math.abs(k.time - localTime) < 0.08) {
          isAt = true;
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
    [(textClip as any).visualKeyframes, localTime],
  );

  const bgKfState = getKeyframeState("backgroundOpacity");

  const handleJumpToKeyframe = useCallback(
    (prop: string, direction: "prev" | "next") => {
      const kfs = (textClip as any).visualKeyframes?.[prop] || [];
      const times: number[] = kfs.map((k: { time: number }) => k.time);
      const sorted = Array.from(new Set(times)).sort((a, b) => a - b);
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
    [(textClip as any).visualKeyframes, textClip.startTime, localTime],
  );

  const handleToggleKeyframe = useCallback(
    (prop: string, value: number) => {
      const nextVisual = { ...((textClip as any).visualKeyframes || {}) };
      const currentKfs = nextVisual[prop] || [];
      const existingIdx = currentKfs.findIndex(
        (kf: { time: number }) => Math.abs(kf.time - localTime) < 0.08,
      );

      if (existingIdx >= 0) {
        nextVisual[prop] = currentKfs.filter(
          (_: any, idx: number) => idx !== existingIdx,
        );
      } else {
        const roundedTime = Math.round(localTime * 100) / 100;
        nextVisual[prop] = [
          ...currentKfs,
          {
            id: `kf-${prop}-${Date.now()}`,
            time: roundedTime,
            value,
            easing: "easeInOut",
          },
        ].sort((a: any, b: any) => a.time - b.time);
      }

      handleUpdate("visualKeyframes", nextVisual);
    },
    [(textClip as any).visualKeyframes, localTime, handleUpdate],
  );

  // ── Update Helper ────────────────────────────────────────────────────────
  const updateBackground = (patch: Record<string, any>) => {
    const current = textClip.background || {
      color: "#000000",
      opacity: 100,
      borderRadius: 0,
      padding: 8,
      height: 14,
      width: 14,
      yOffset: 50,
      style: "rectangle",
    };
    const next = {
      ...current,
      ...patch,
      // Keep `padding` for project compatibility only. New controls are
      // independent and are resolved by the shared background geometry.
      padding: (current as any).padding ?? 8,
    };
    handleCustomStyleUpdate("background", next);
  };

  // ── Toggle Enable ────────────────────────────────────────────────────────
  const handleToggleEnable = () => {
    if (isEnabled) {
      handleCustomStyleUpdate("background", undefined);
    } else {
      handleCustomStyleUpdate("background", {
        color: bgColor,
        opacity: bgOpacity,
        borderRadius: bgRadius,
        padding: 8,
        height: bgHeight,
        width: bgWidth,
        yOffset: bgYOffset,
        style: bgStyle,
      });
      setIsExpanded(true);
    }
  };

  // ── Reset ────────────────────────────────────────────────────────────────
  const handleReset = () => {
    handleCustomStyleUpdate("background", {
      color: "#000000",
      opacity: 100,
      borderRadius: 0,
      padding: 8,
      height: 14,
      width: 14,
      yOffset: 50,
      style: "rectangle",
    });
  };

  return (
    <div className="space-y-3.5 select-none text-white">
      {/* ── Background Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Checkbox toggle */}
          <button
            type="button"
            onClick={handleToggleEnable}
            className={`w-4 h-4 rounded-[4px] border flex items-center justify-center transition-colors cursor-pointer ${
              isEnabled
                ? "bg-cyan-500 border-cyan-400 text-black"
                : "border-white/30 bg-[#242426] hover:border-white/50"
            }`}
            title={t("properties.background.enable") || "Enable background"}
          >
            {isEnabled && <Check className="w-3 h-3 stroke-[3]" />}
          </button>

          {/* Accordion title toggle */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1.5 text-xs font-semibold text-white hover:text-cyan-400 transition-colors cursor-pointer"
          >
            <span>{t("properties.background.title") || "Background"}</span>
            <span className="text-[9px] text-[#8e8e93]">
              {isExpanded ? "▲" : "▼"}
            </span>
          </button>
        </div>

        {/* Right Header Actions: Reset ⟲ + Keyframe < ◇ > */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="text-[#8e8e93] hover:text-white transition-colors cursor-pointer p-0.5"
            title={t("properties.background.reset") || "Reset background"}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* <InlineKeyframeNav
            state={bgKfState}
            onToggle={() =>
              handleToggleKeyframe("backgroundOpacity", bgOpacity)
            }
            onPrev={() => handleJumpToKeyframe("backgroundOpacity", "prev")}
            onNext={() => handleJumpToKeyframe("backgroundOpacity", "next")}
            label="Background"
          /> */}
        </div>
      </div>

      {/* ── Background Controls (when expanded) ── */}
      {isExpanded && (
        <div
          className={`space-y-3.5 transition-opacity ${
            isEnabled ? "opacity-100" : "opacity-40 pointer-events-none"
          }`}
        >
          {/* ── Style Selector: Rectangle vs Split lines ── */}
          <div className="flex items-center gap-3">
            {/* Card 1: Rectangle (Solid Box) */}
            <button
              type="button"
              onClick={() => updateBackground({ style: "rectangle" })}
              className={`w-16 h-14 rounded-lg bg-[#242426] flex items-center justify-center p-1.5 transition-all cursor-pointer relative ${
                bgStyle === "rectangle"
                  ? "border-2 border-cyan-400 shadow-sm"
                  : "border border-white/5 hover:border-white/20"
              }`}
              title={t("properties.background.styleRectangle") || "Rectangle"}
            >
              <div className="w-12 h-10 rounded bg-[#38383e] flex flex-col items-center justify-center text-[8px] font-bold text-[#8e8e93] leading-3">
                <span>ABC</span>
                <span>AB</span>
              </div>
            </button>

            {/* Card 2: Split / Wrapped Lines */}
            <button
              type="button"
              onClick={() => updateBackground({ style: "split" })}
              className={`w-16 h-14 rounded-lg bg-[#242426] flex items-center justify-center p-1.5 transition-all cursor-pointer relative ${
                bgStyle === "split"
                  ? "border-2 border-cyan-400 shadow-sm"
                  : "border border-white/5 hover:border-white/20"
              }`}
              title={t("properties.background.styleSplit") || "Split lines"}
            >
              <div className="flex flex-col items-center justify-center gap-0.5 text-[8px] font-bold text-[#8e8e93] leading-3">
                <span className="bg-[#38383e] px-1.5 py-0.5 rounded-[3px]">
                  ABC
                </span>
                <span className="bg-[#38383e] px-1 py-0.5 rounded-[3px]">
                  AB
                </span>
              </div>
            </button>
          </div>

          {/* Row 1: Color */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-[#a1a1aa] shrink-0 w-24">
              {t("properties.background.color") || "Color"}
            </span>

            <div className="flex-1 flex justify-start">
              <ClypraColorPicker
                value={bgColor}
                onChange={(c) => updateBackground({ color: c })}
                format="hex"
                availableModes={["solid", "wheel"]}
                presetColors={SOLID_COLOR_SWATCHES}
                showAlpha={true}
                size="sm"
                triggerClassName="w-24 h-7 bg-[#242426] border border-white/10 hover:border-white/20 rounded-md px-2 flex items-center justify-between"
                popoverClassName="z-[100]"
              />
            </div>
          </div>

          {/* Row 2: Opacity */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#a1a1aa] shrink-0 w-24">
              {t("properties.background.opacity") || "Opacity"}
            </span>

            <div className="flex-1 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={bgOpacity}
                onChange={(e) =>
                  updateBackground({ opacity: Number(e.target.value) })
                }
                className="flex-1 h-1 bg-[#242426] rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />

              <div className="flex items-center bg-[#242426] border border-white/5 rounded-md px-2 py-1 text-xs w-16">
                <input
                  type="text"
                  value={`${bgOpacity}%`}
                  onChange={(e) => {
                    const num = Number.parseInt(
                      e.target.value.replace(/[^0-9]/g, ""),
                      10,
                    );
                    if (!Number.isNaN(num)) {
                      updateBackground({
                        opacity: Math.max(0, Math.min(100, num)),
                      });
                    }
                  }}
                  className="w-full bg-transparent text-right text-white outline-none pr-1"
                />
                <div className="flex flex-col text-[8px] text-[#8e8e93] leading-[6px]">
                  <button
                    type="button"
                    onClick={() =>
                      updateBackground({
                        opacity: Math.min(100, bgOpacity + 1),
                      })
                    }
                    className="hover:text-white cursor-pointer"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateBackground({
                        opacity: Math.max(0, bgOpacity - 1),
                      })
                    }
                    className="hover:text-white cursor-pointer"
                  >
                    ▼
                  </button>
                </div>
              </div>

              {/* <InlineKeyframeNav
                state={bgKfState}
                onToggle={() =>
                  handleToggleKeyframe("backgroundOpacity", bgOpacity)
                }
                onPrev={() => handleJumpToKeyframe("backgroundOpacity", "prev")}
                onNext={() => handleJumpToKeyframe("backgroundOpacity", "next")}
                label="Opacity"
              /> */}
            </div>
          </div>

          {/* Row 3: Rounded rectangle */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#a1a1aa] shrink-0 w-24">
              {t("properties.background.roundedRectangle") ||
                "Rounded rectangle"}
            </span>

            <div className="flex-1 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={bgRadius}
                onChange={(e) =>
                  updateBackground({ borderRadius: Number(e.target.value) })
                }
                className="flex-1 h-1 bg-[#242426] rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />

              <div className="flex items-center bg-[#242426] border border-white/5 rounded-md px-2 py-1 text-xs w-16">
                <input
                  type="text"
                  value={`${bgRadius}%`}
                  onChange={(e) => {
                    const num = Number.parseInt(
                      e.target.value.replace(/[^0-9]/g, ""),
                      10,
                    );
                    if (!Number.isNaN(num)) {
                      updateBackground({
                        borderRadius: Math.max(0, Math.min(100, num)),
                      });
                    }
                  }}
                  className="w-full bg-transparent text-right text-white outline-none pr-1"
                />
                <div className="flex flex-col text-[8px] text-[#8e8e93] leading-[6px]">
                  <button
                    type="button"
                    onClick={() =>
                      updateBackground({
                        borderRadius: Math.min(100, bgRadius + 1),
                      })
                    }
                    className="hover:text-white cursor-pointer"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateBackground({
                        borderRadius: Math.max(0, bgRadius - 1),
                      })
                    }
                    className="hover:text-white cursor-pointer"
                  >
                    ▼
                  </button>
                </div>
              </div>

              {/* <InlineKeyframeNav
                state={getKeyframeState("backgroundRadius")}
                onToggle={() =>
                  handleToggleKeyframe("backgroundRadius", bgRadius)
                }
                onPrev={() => handleJumpToKeyframe("backgroundRadius", "prev")}
                onNext={() => handleJumpToKeyframe("backgroundRadius", "next")}
                label="Rounded rectangle"
              /> */}
            </div>
          </div>

          {/* Row 4: Height */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#a1a1aa] shrink-0 w-24">
              {t("properties.background.height") || "Height"}
            </span>

            <div className="flex-1 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={bgHeight}
                onChange={(e) =>
                  updateBackground({ height: Number(e.target.value) })
                }
                className="flex-1 h-1 bg-[#242426] rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />

              <div className="flex items-center bg-[#242426] border border-white/5 rounded-md px-2 py-1 text-xs w-16">
                <input
                  type="text"
                  value={`${bgHeight}%`}
                  onChange={(e) => {
                    const num = Number.parseInt(
                      e.target.value.replace(/[^0-9]/g, ""),
                      10,
                    );
                    if (!Number.isNaN(num)) {
                      updateBackground({
                        height: Math.max(0, Math.min(100, num)),
                      });
                    }
                  }}
                  className="w-full bg-transparent text-right text-white outline-none pr-1"
                />
                <div className="flex flex-col text-[8px] text-[#8e8e93] leading-[6px]">
                  <button
                    type="button"
                    onClick={() =>
                      updateBackground({
                        height: Math.min(100, bgHeight + 1),
                      })
                    }
                    className="hover:text-white cursor-pointer"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateBackground({
                        height: Math.max(0, bgHeight - 1),
                      })
                    }
                    className="hover:text-white cursor-pointer"
                  >
                    ▼
                  </button>
                </div>
              </div>

              {/* <InlineKeyframeNav
                state={getKeyframeState("backgroundHeight")}
                onToggle={() =>
                  handleToggleKeyframe("backgroundHeight", bgHeight)
                }
                onPrev={() =>
                  handleJumpToKeyframe("backgroundHeight", "prev")
                }
                onNext={() =>
                  handleJumpToKeyframe("backgroundHeight", "next")
                }
                label="Height"
              /> */}
            </div>
          </div>

          {/* Row 5: Width */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#a1a1aa] shrink-0 w-24">
              {t("properties.background.width") || "Width"}
            </span>

            <div className="flex-1 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={bgWidth}
                onChange={(e) =>
                  updateBackground({ width: Number(e.target.value) })
                }
                className="flex-1 h-1 bg-[#242426] rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />

              <div className="flex items-center bg-[#242426] border border-white/5 rounded-md px-2 py-1 text-xs w-16">
                <input
                  type="text"
                  value={`${bgWidth}%`}
                  onChange={(e) => {
                    const num = Number.parseInt(
                      e.target.value.replace(/[^0-9]/g, ""),
                      10,
                    );
                    if (!Number.isNaN(num)) {
                      updateBackground({
                        width: Math.max(0, Math.min(100, num)),
                      });
                    }
                  }}
                  className="w-full bg-transparent text-right text-white outline-none pr-1"
                />
                <div className="flex flex-col text-[8px] text-[#8e8e93] leading-[6px]">
                  <button
                    type="button"
                    onClick={() =>
                      updateBackground({
                        width: Math.min(100, bgWidth + 1),
                      })
                    }
                    className="hover:text-white cursor-pointer"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateBackground({
                        width: Math.max(0, bgWidth - 1),
                      })
                    }
                    className="hover:text-white cursor-pointer"
                  >
                    ▼
                  </button>
                </div>
              </div>

              {/* <InlineKeyframeNav
                state={getKeyframeState("backgroundWidth")}
                onToggle={() =>
                  handleToggleKeyframe("backgroundWidth", bgWidth)
                }
                onPrev={() =>
                  handleJumpToKeyframe("backgroundWidth", "prev")
                }
                onNext={() =>
                  handleJumpToKeyframe("backgroundWidth", "next")
                }
                label="Width"
              /> */}
            </div>
          </div>

          {/* Row 6: Y-offset */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#a1a1aa] shrink-0 w-24">
              {t("properties.background.yOffset") || "Y-offset"}
            </span>

            <div className="flex-1 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={bgYOffset}
                onChange={(e) =>
                  updateBackground({ yOffset: Number(e.target.value) })
                }
                className="flex-1 h-1 bg-[#242426] rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />

              <div className="flex items-center bg-[#242426] border border-white/5 rounded-md px-2 py-1 text-xs w-16">
                <input
                  type="text"
                  value={`${bgYOffset}%`}
                  onChange={(e) => {
                    const num = Number.parseInt(
                      e.target.value.replace(/[^0-9]/g, ""),
                      10,
                    );
                    if (!Number.isNaN(num)) {
                      updateBackground({
                        yOffset: Math.max(0, Math.min(100, num)),
                      });
                    }
                  }}
                  className="w-full bg-transparent text-right text-white outline-none pr-1"
                />
                <div className="flex flex-col text-[8px] text-[#8e8e93] leading-[6px]">
                  <button
                    type="button"
                    onClick={() =>
                      updateBackground({
                        yOffset: Math.min(100, bgYOffset + 1),
                      })
                    }
                    className="hover:text-white cursor-pointer"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateBackground({
                        yOffset: Math.max(0, bgYOffset - 1),
                      })
                    }
                    className="hover:text-white cursor-pointer"
                  >
                    ▼
                  </button>
                </div>
              </div>

              {/* <InlineKeyframeNav
                state={getKeyframeState("backgroundYOffset")}
                onToggle={() =>
                  handleToggleKeyframe("backgroundYOffset", bgYOffset)
                }
                onPrev={() =>
                  handleJumpToKeyframe("backgroundYOffset", "prev")
                }
                onNext={() =>
                  handleJumpToKeyframe("backgroundYOffset", "next")
                }
                label="Y-offset"
              /> */}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
