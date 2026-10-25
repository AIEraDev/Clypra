/**
 * TextStrokeSection.tsx
 *
 * CapCut-parity dedicated Stroke section for text clips.
 * Replicates the exact layout, controls, and behavior from CapCut's desktop inspector:
 * - Checkbox (pill rounded square) to toggle stroke on/off
 * - Collapsible "Stroke ▲" header with reset ⟲ and group keyframe < ◇ >
 * - Color row with color swatch dropdown
 * - Thickness row with slider + stepper input 40 ↕ + keyframe < ◇ >
 */

import React, { useState, useCallback } from "react";
import { RotateCcw, Check } from "lucide-react";
import { ClypraColorPicker } from "@clypra/ui-color-picker";
import { useTranslation } from "@/i18n";
import { getPlaybackClock } from "@/core/playback/PlaybackClock";
import type { TextClip } from "@/types";
import { InlineKeyframeNav } from "../../primitives/InlineKeyframeNav";
import { SOLID_COLOR_SWATCHES } from "../../data/fontData";

interface TextStrokeSectionProps {
  textClip: TextClip;
  handleCustomStyleUpdate: (key: string, value: any) => void;
  handleUpdate: (key: string, value: any) => void;
}

export const TextStrokeSection: React.FC<TextStrokeSectionProps> = ({
  textClip,
  handleCustomStyleUpdate,
  handleUpdate,
}) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);

  const isEnabled = Boolean(
    textClip.stroke && (textClip.stroke.width ?? 0) > 0,
  );
  const strokeColor = textClip.stroke?.color || "#000000";
  const strokeWidth = textClip.stroke?.width ?? 40;

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

  const strokeKfState = getKeyframeState("strokeWidth");

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

  // ── Toggle Stroke Enable/Disable ─────────────────────────────────────────
  const handleToggleEnable = () => {
    if (isEnabled) {
      handleCustomStyleUpdate("stroke", undefined);
    } else {
      handleCustomStyleUpdate("stroke", {
        color: strokeColor,
        width: strokeWidth > 0 ? strokeWidth : 40,
      });
      setIsExpanded(true);
    }
  };

  // ── Reset Stroke ─────────────────────────────────────────────────────────
  const handleReset = () => {
    handleCustomStyleUpdate("stroke", {
      color: "#000000",
      width: 40,
    });
  };

  // ── Change Color ─────────────────────────────────────────────────────────
  const handleColorChange = (newColor: string) => {
    handleCustomStyleUpdate("stroke", {
      color: newColor,
      width: strokeWidth > 0 ? strokeWidth : 40,
    });
  };

  // ── Change Thickness ─────────────────────────────────────────────────────
  const handleThicknessChange = (newWidth: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(newWidth)));
    handleCustomStyleUpdate("stroke", {
      color: strokeColor,
      width: clamped,
    });
  };

  return (
    <div className="space-y-3.5 select-none text-white">
      {/* ── Stroke Header ── */}
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
            title={t("properties.stroke.enable") || "Enable stroke"}
          >
            {isEnabled && <Check className="w-3 h-3 stroke-[3]" />}
          </button>

          {/* Accordion title toggle */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1.5 text-xs font-semibold text-white hover:text-cyan-400 transition-colors cursor-pointer"
          >
            <span>{t("properties.stroke.title") || "Stroke"}</span>
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
            title={t("properties.stroke.reset") || "Reset stroke"}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* <InlineKeyframeNav
            state={strokeKfState}
            onToggle={() => handleToggleKeyframe("strokeWidth", strokeWidth)}
            onPrev={() => handleJumpToKeyframe("strokeWidth", "prev")}
            onNext={() => handleJumpToKeyframe("strokeWidth", "next")}
            label="Stroke"
          /> */}
        </div>
      </div>

      {/* ── Stroke Controls (when expanded) ── */}
      {isExpanded && (
        <div
          className={`space-y-3 transition-opacity ${
            isEnabled ? "opacity-100" : "opacity-40 pointer-events-none"
          }`}
        >
          {/* Row 1: Color */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-[#a1a1aa] shrink-0 w-24">
              {t("properties.stroke.color") || "Color"}
            </span>

            <div className="flex-1 flex justify-start">
              <ClypraColorPicker
                value={strokeColor}
                onChange={handleColorChange}
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

          {/* Row 2: Thickness */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#a1a1aa] shrink-0 w-24">
              {t("properties.stroke.thickness") || "Thickness"}
            </span>

            <div className="flex-1 flex items-center gap-3">
              {/* Slider */}
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={strokeWidth}
                onChange={(e) => handleThicknessChange(Number(e.target.value))}
                className="flex-1 h-1 bg-[#242426] rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />

              {/* Stepper Input: [ 40 ▲▼ ] */}
              <div className="flex items-center bg-[#242426] border border-white/5 rounded-md px-2 py-1 text-xs w-16">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={strokeWidth}
                  onChange={(e) =>
                    handleThicknessChange(Number(e.target.value))
                  }
                  className="w-full bg-transparent text-right text-white outline-none pr-1"
                />
                <div className="flex flex-col text-[8px] text-[#8e8e93] leading-[6px]">
                  <button
                    type="button"
                    onClick={() => handleThicknessChange(strokeWidth + 1)}
                    className="hover:text-white cursor-pointer"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => handleThicknessChange(strokeWidth - 1)}
                    className="hover:text-white cursor-pointer"
                  >
                    ▼
                  </button>
                </div>
              </div>

              {/* Thickness Keyframe < ◇ > */}
              {/* <InlineKeyframeNav
                state={strokeKfState}
                onToggle={() =>
                  handleToggleKeyframe("strokeWidth", strokeWidth)
                }
                onPrev={() => handleJumpToKeyframe("strokeWidth", "prev")}
                onNext={() => handleJumpToKeyframe("strokeWidth", "next")}
                label="Thickness"
              /> */}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
