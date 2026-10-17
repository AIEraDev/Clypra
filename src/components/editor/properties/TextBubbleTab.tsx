/**
 * TextBubbleTab.tsx
 *
 * The "Bubble" sub-tab of TextStyleSection.
 * Shows a grid of named background-box presets and, when one is active,
 * exposes fine-grained colour/padding/radius adjustments.
 */

import React from "react";
import { ClypraColorPicker } from "@clypra/ui-color-picker";
import type { TextClip } from "@/types";
import { PropertySlider } from "./primitives/PropertySlider";
import { BUBBLE_PRESETS } from "./data/textStyleData";
import { SOLID_COLOR_SWATCHES } from "./data/fontData";

interface TextBubbleTabProps {
  textClip: TextClip;
  handleCustomStyleUpdate: (key: string, value: any) => void;
}

export const TextBubbleTab: React.FC<TextBubbleTabProps> = ({
  textClip,
  handleCustomStyleUpdate,
}) => {
  return (
    <div className="space-y-4">
      <span className="text-xs font-medium text-[#a1a1aa] block">
        Speech Bubbles &amp; Backgrounds
      </span>

      {/* Preset grid */}
      <div className="grid grid-cols-2 gap-2">
        {BUBBLE_PRESETS.map((preset) => {
          const isActive =
            (!preset.background && !textClip.background) ||
            (preset.background &&
              textClip.background &&
              textClip.background.borderRadius === preset.background.borderRadius);
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleCustomStyleUpdate("background", preset.background)}
              className={`p-3 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center min-h-[72px] relative ${
                isActive
                  ? "bg-[#27272a] border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.15)]"
                  : "bg-[#202024] border-white/5 hover:border-white/20"
              }`}
            >
              <div
                className="px-2 py-1 text-[11px] font-bold text-white mb-1.5 flex items-center justify-center max-w-full truncate"
                style={{
                  background: preset.background?.color || "transparent",
                  borderRadius: preset.background?.borderRadius ?? 4,
                  border: preset.background ? "none" : "1px dashed rgba(255,255,255,0.2)",
                }}
              >
                CLYPRA
              </div>
              <span className="text-xs text-white font-medium">{preset.name}</span>
            </button>
          );
        })}
      </div>

      {/* Fine-grained adjustments (only when a background is active) */}
      {textClip.background && (
        <div className="space-y-3 pt-3 border-t border-border/30">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#a1a1aa]">Bubble Color</span>
            <ClypraColorPicker
              value={textClip.background.color || "rgba(0,0,0,0.6)"}
              onChange={(c: string) =>
                handleCustomStyleUpdate("background", {
                  color: c,
                  padding: textClip.background?.padding ?? 8,
                  borderRadius: textClip.background?.borderRadius ?? 4,
                })
              }
              format="hex"
              availableModes={["solid", "wheel"]}
              presetColors={SOLID_COLOR_SWATCHES}
              showAlpha={true}
              size="sm"
              triggerClassName="w-24 h-7 bg-[#27272a] border-white/10 rounded-md px-2"
            />
          </div>

          <PropertySlider
            label="Padding"
            value={textClip.background.padding ?? 8}
            min={0}
            max={40}
            step={1}
            suffix="px"
            onChange={(v) =>
              handleCustomStyleUpdate("background", {
                color: textClip.background?.color ?? "rgba(0, 0, 0, 0.6)",
                padding: v,
                borderRadius: textClip.background?.borderRadius ?? 4,
              })
            }
          />

          <PropertySlider
            label="Border Radius"
            value={textClip.background.borderRadius ?? 4}
            min={0}
            max={999}
            step={2}
            suffix="px"
            onChange={(v) =>
              handleCustomStyleUpdate("background", {
                color: textClip.background?.color ?? "rgba(0, 0, 0, 0.6)",
                padding: textClip.background?.padding ?? 8,
                borderRadius: v,
              })
            }
          />
        </div>
      )}
    </div>
  );
};
