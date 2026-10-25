/**
 * TextBasicTab.tsx
 *
 * The "Basic" sub-tab of TextStyleSection.
 * Covers: font family, font size, weight/style/decoration, case, colour +
 * keyframe stepper, character/line spacing, stroke, shadow, background box,
 * "behind subject" AI cutout toggle, caption batch-apply toggle, and the
 * "save as preset" action.
 */

import React, { useMemo } from "react";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  User,
  ChevronsUpDown,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { ClypraColorPicker } from "@clypra/ui-color-picker";
import { isTauriRuntime } from "@/lib/platform/tauri";
import {
  getBundledNativeFontIds,
  prewarmNativeFontsOnIdle,
} from "@/core/fonts/nativeFontRegistry";
import { getFontLoader } from "@/core/fonts/FontLoader";
import { getPlaybackClock } from "@/core/playback/PlaybackClock";
import type { TextClip } from "@/types";
import { PropertySlider } from "../../primitives/PropertySlider";
import { KeyframeNavControls } from "../../primitives/KeyframeNavControls";
import {
  GOOGLE_FONTS,
  SYSTEM_FONTS,
  SOLID_COLOR_SWATCHES,
  resolveFontPickerValue,
} from "../../data/fontData";
import { PresetStyleGrid } from "../sections/PresetStyleGrid";
import { TextTransformSection } from "../sections/TextTransformSection";
import { TextStrokeSection } from "../sections/TextStrokeSection";
import { TextBackgroundSection } from "../sections/TextBackgroundSection";
import type { TextStylePreset } from "../../data/textStylePresets";

interface TextBasicTabProps {
  textClip: TextClip;
  newPresetName: string;
  /** Effective font weight resolved from clip + active effect font */
  currentWeight: number;
  /** Effective font style resolved from clip + active effect font */
  effectiveFontStyle: string;
  /** Effective letter spacing resolved from clip + active effect font */
  effectiveLetterSpacing: number;
  /** Effective line height resolved from clip + active effect font */
  effectiveLineHeight: number;
  applyToAll: boolean;
  setApplyToAll: (v: boolean) => void;
  alignExpanded: boolean;
  setAlignExpanded: (v: boolean) => void;
  strokeExpanded: boolean;
  setStrokeExpanded: (v: boolean) => void;
  shadowExpanded: boolean;
  setShadowExpanded: (v: boolean) => void;
  backgroundExpanded: boolean;
  setBackgroundExpanded: (v: boolean) => void;
  handleUpdate: (key: string, value: any) => void;
  handleCustomStyleUpdate: (key: string, value: any) => void;
  handleUpdateMultiple?: (fields: Record<string, any>) => void;
  savePreset: (name: string, style: any) => void;
}

export const TextBasicTab: React.FC<TextBasicTabProps> = ({
  textClip,
  newPresetName,
  currentWeight,
  effectiveFontStyle,
  effectiveLetterSpacing,
  effectiveLineHeight,
  applyToAll,
  setApplyToAll,
  alignExpanded,
  setAlignExpanded,
  strokeExpanded,
  setStrokeExpanded,
  shadowExpanded,
  setShadowExpanded,
  backgroundExpanded,
  setBackgroundExpanded,
  handleUpdate,
  handleCustomStyleUpdate,
  handleUpdateMultiple,
  savePreset,
}) => {
  const nativeDesktop = isTauriRuntime();
  const nativeFontIds = useMemo(
    () => new Set(getBundledNativeFontIds().map((id) => id.toLowerCase())),
    [],
  );

  const requestedFont = textClip.fontFamily || "Inter Variable";
  const selectedFont = resolveFontPickerValue(requestedFont);
  const selectedFontIsUnavailableNatively =
    nativeDesktop && !nativeFontIds.has(selectedFont.toLowerCase());
  const isMissingFont = selectedFontIsUnavailableNatively;

  const hasBidiText = useMemo(() => {
    const text = textClip.text ?? "";
    return /[\u0590-\u083F]|[\u08A0-\u08FF]|[\uFB1D-\uFDFF]|[\uFE70-\uFEFC]/.test(
      text,
    );
  }, [textClip.text]);

  const handleFontPickerPrewarm = React.useCallback(() => {
    getFontLoader().prewarmRemainingFontsOnIdle();
    prewarmNativeFontsOnIdle();
  }, []);

  // ── Keyframe state for text colour ─────────────────────────────────────
  const currentTime = getPlaybackClock().time;
  const localTime = Math.max(
    0,
    Math.min(textClip.duration, currentTime - textClip.startTime),
  );

  const colorKfState = useMemo(() => {
    const kfs = (textClip as any).keyframes?.color || [];
    const times = kfs.map((k: any) => k.time);
    return {
      hasKeyframes: times.length > 0,
      isAtKeyframe: times.some((t: number) => Math.abs(t - localTime) < 0.08),
      hasPrev: times.some((t: number) => t < localTime - 0.05),
      hasNext: times.some((t: number) => t > localTime + 0.05),
    };
  }, [textClip, localTime]);

  const handleToggleColorKeyframe = () => {
    const currentKfs = [...((textClip as any).keyframes?.color || [])];
    const existingIndex = currentKfs.findIndex(
      (k: any) => Math.abs(k.time - localTime) < 0.08,
    );
    if (existingIndex >= 0) {
      currentKfs.splice(existingIndex, 1);
    } else {
      currentKfs.push({
        id: `kf-col-${Date.now()}`,
        time: localTime,
        value: textClip.color || "#ffffff",
      });
      currentKfs.sort((a: any, b: any) => a.time - b.time);
    }
    handleUpdate("keyframes", {
      ...(textClip as any).keyframes,
      color: currentKfs,
    });
  };

  const handlePrevColorKeyframe = () => {
    const kfs = (textClip as any).keyframes?.color || [];
    const prevs = kfs.filter((k: any) => k.time < localTime - 0.05);
    if (prevs.length > 0) {
      getPlaybackClock().seek(
        textClip.startTime + prevs[prevs.length - 1].time,
      );
    }
  };

  const handleNextColorKeyframe = () => {
    const kfs = (textClip as any).keyframes?.color || [];
    const nexts = kfs.filter((k: any) => k.time > localTime + 0.05);
    if (nexts.length > 0) {
      getPlaybackClock().seek(textClip.startTime + nexts[0].time);
    }
  };

  const handleApplyPresetStyle = (preset: TextStylePreset) => {
    const updates: Record<string, any> = {
      color: preset.color ?? "#ffffff",
      fontWeight: preset.fontWeight ?? 700,
      stroke: preset.stroke,
      shadow: preset.shadow,
      background: preset.background,
      styleId: undefined,
      styleDefinition: undefined,
    };
    if (preset.isReset) {
      updates.fontStyle = "normal";
      updates.textDecoration = "none";
    }
    if (handleUpdateMultiple) {
      handleUpdateMultiple(updates);
    } else {
      Object.entries(updates).forEach(([key, val]) => {
        handleCustomStyleUpdate(key, val);
      });
    }
  };

  return (
    <div className="space-y-3.5 relative">
      {/* Font family */}
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs text-[#a1a1aa] shrink-0 w-20">Font</label>
        <div className="relative flex-1">
          <select
            value={selectedFont}
            onChange={(e) =>
              handleCustomStyleUpdate("fontFamily", e.target.value)
            }
            onFocus={handleFontPickerPrewarm}
            onPointerEnter={handleFontPickerPrewarm}
            className="w-full bg-[#27272a] hover:bg-[#323238] border border-white/5 rounded-md px-3 py-1.5 text-xs text-white outline-none focus:border-cyan-400/50 cursor-pointer appearance-none transition-colors pr-8"
          >
            {!nativeDesktop && (
              <optgroup label="System Fonts">
                {SYSTEM_FONTS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup
              label={nativeDesktop ? "Native Fonts" : "Google Web Fonts"}
            >
              {selectedFontIsUnavailableNatively && (
                <option value={selectedFont} disabled>
                  {selectedFont} (not supported natively)
                </option>
              )}
              {GOOGLE_FONTS.filter(
                (font) =>
                  !nativeDesktop || nativeFontIds.has(font.value.toLowerCase()),
              ).map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </optgroup>
          </select>
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted flex flex-col items-center">
            <ChevronsUpDown className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>

      {isMissingFont && (
        <div className="flex items-start gap-1.5 p-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] leading-tight">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            <strong>&quot;{requestedFont}&quot;</strong> is not available
            natively. Fallback used.
          </span>
        </div>
      )}

      {hasBidiText && (
        <div className="flex items-start gap-1.5 p-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] leading-tight">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>Contains right-to-left text. Ensure font supports script.</span>
        </div>
      )}

      {/* Font size */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-[#a1a1aa] shrink-0 w-20">
          Font size
        </label>
        <div className="flex-1 flex items-center">
          <input
            type="range"
            min={10}
            max={300}
            value={textClip.fontSize || 48}
            onChange={(e) =>
              handleCustomStyleUpdate("fontSize", Number(e.target.value))
            }
            className="w-full h-1 bg-[#3f3f46] rounded-full appearance-none outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
          />
        </div>
        <div className="w-16 shrink-0 bg-[#27272a] border border-white/5 rounded-md px-2 py-1 flex items-center">
          <input
            type="number"
            min={1}
            max={1000}
            value={textClip.fontSize || 48}
            onChange={(e) =>
              handleCustomStyleUpdate(
                "fontSize",
                Math.max(1, Number(e.target.value) || 1),
              )
            }
            className="w-full bg-transparent text-xs text-white text-center outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <div className="flex flex-col -mr-1">
            <button
              type="button"
              onClick={() =>
                handleCustomStyleUpdate(
                  "fontSize",
                  (textClip.fontSize || 48) + 1,
                )
              }
              className="text-text-muted hover:text-white px-0.5 leading-none text-[8px] cursor-pointer"
            >
              ▲
            </button>
            <button
              type="button"
              onClick={() =>
                handleCustomStyleUpdate(
                  "fontSize",
                  Math.max(1, (textClip.fontSize || 48) - 1),
                )
              }
              className="text-text-muted hover:text-white px-0.5 leading-none text-[8px] cursor-pointer"
            >
              ▼
            </button>
          </div>
        </div>
      </div>

      {/* Pattern: Bold / Underline / Italic */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-[#a1a1aa] shrink-0 w-20">Pattern</label>
        <div className="flex items-center gap-2 flex-1">
          {/* Bold */}
          <button
            type="button"
            onClick={() =>
              handleCustomStyleUpdate(
                "fontWeight",
                currentWeight >= 700 ? 400 : 700,
              )
            }
            className={`flex-1 w-7 h-7 rounded-md font-bold text-xs flex items-center justify-center transition-colors border cursor-pointer ${
              currentWeight >= 700
                ? "bg-[#3e3e44] text-white border-white/20 shadow-sm"
                : "bg-[#242428] text-text-muted border-white/5 hover:text-white hover:bg-[#2c2c32]"
            }`}
            title="Bold"
          >
            B
          </button>
          {/* Underline */}
          <button
            type="button"
            onClick={() =>
              handleCustomStyleUpdate(
                "textDecoration",
                (textClip as any).textDecoration === "underline"
                  ? "none"
                  : "underline",
              )
            }
            className={`flex-1 w-7 h-7 rounded-md font-semibold text-xs flex items-center justify-center underline transition-colors border cursor-pointer ${
              (textClip as any).textDecoration === "underline"
                ? "bg-[#3e3e44] text-white border-white/20 shadow-sm"
                : "bg-[#242428] text-text-muted border-white/5 hover:text-white hover:bg-[#2c2c32]"
            }`}
            title="Underline"
          >
            U
          </button>
          {/* Italic */}
          <button
            type="button"
            onClick={() =>
              handleCustomStyleUpdate(
                "fontStyle",
                effectiveFontStyle === "italic" ? "normal" : "italic",
              )
            }
            className={`flex-1 w-7 h-7 rounded-md font-semibold text-xs italic flex items-center justify-center transition-colors border cursor-pointer ${
              effectiveFontStyle === "italic"
                ? "bg-[#3e3e44] text-white border-white/20 shadow-sm"
                : "bg-[#242428] text-text-muted border-white/5 hover:text-white hover:bg-[#2c2c32]"
            }`}
            title="Italic"
          >
            I
          </button>
        </div>
      </div>

      {/* Case: TT / tt / Tt */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-[#a1a1aa] shrink-0 w-20">Case</label>
        <div className="inline-flex gap-2 flex-1">
          {(
            [
              ["uppercase", "TT", "Uppercase (ALL CAPS)"],
              ["lowercase", "tt", "Lowercase (all small)"],
              ["capitalize", "Tt", "Title Case (Capitalize Words)"],
            ] as const
          ).map(([transform, label, title]) => (
            <button
              key={transform}
              type="button"
              onClick={() =>
                handleCustomStyleUpdate(
                  "textTransform",
                  textClip.textTransform === transform ? "none" : transform,
                )
              }
              className={`flex-1 px-3 py-1 w-7 h-7 rounded text-xs font-semibold transition-colors cursor-pointer ${
                textClip.textTransform === transform
                  ? "bg-[#3e3e44] text-white border-white/20 shadow-sm"
                  : "bg-[#242428] text-text-muted border-white/5 hover:text-white hover:bg-[#2c2c32]"
              }`}
              title={title}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Colour + keyframe stepper */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <label className="text-xs text-[#a1a1aa] shrink-0 w-20">Color</label>
          <ClypraColorPicker
            value={textClip.color || "#ffffff"}
            onChange={(c: string) => handleCustomStyleUpdate("color", c)}
            format="hex"
            availableModes={["solid", "wheel"]}
            presetColors={SOLID_COLOR_SWATCHES}
            showAlpha={true}
            size="sm"
            triggerClassName="w-24 w-full h-7 bg-[#27272a] border-white/10 hover:border-white/20 rounded-md px-2 flex items-center justify-between cursor-pointer"
            popoverClassName="z-[100]"
          />
        </div>
        <KeyframeNavControls
          hasKeyframes={colorKfState.hasKeyframes}
          isAtKeyframe={colorKfState.isAtKeyframe}
          hasPrev={colorKfState.hasPrev}
          hasNext={colorKfState.hasNext}
          onToggleKeyframe={handleToggleColorKeyframe}
          onPrevKeyframe={handlePrevColorKeyframe}
          onNextKeyframe={handleNextColorKeyframe}
          label="Text Color"
        />
      </div>

      {/* Spacing: Character */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-[#a1a1aa] w-20">Character</span>
        <div className="flex-1 bg-[#27272a] border border-white/5 rounded-md px-2 py-1 flex items-center">
          <input
            type="number"
            value={effectiveLetterSpacing}
            onChange={(e) =>
              handleCustomStyleUpdate("letterSpacing", Number(e.target.value))
            }
            className="w-full bg-transparent text-xs text-white outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <div className="flex flex-col -mr-1">
            <button
              type="button"
              onClick={() =>
                handleCustomStyleUpdate(
                  "letterSpacing",
                  effectiveLetterSpacing + 1,
                )
              }
              className="text-text-muted hover:text-white px-0.5 leading-none text-[8px] cursor-pointer"
            >
              ▲
            </button>
            <button
              type="button"
              onClick={() =>
                handleCustomStyleUpdate(
                  "letterSpacing",
                  effectiveLetterSpacing - 1,
                )
              }
              className="text-text-muted hover:text-white px-0.5 leading-none text-[8px] cursor-pointer"
            >
              ▼
            </button>
          </div>
        </div>
      </div>

      {/* Spacing: Line */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-[#a1a1aa] w-20">Line</span>
        <div className="flex-1 bg-[#27272a] border border-white/5 rounded-md px-2 py-1 flex items-center">
          <input
            type="number"
            step={0.1}
            value={Math.round(effectiveLineHeight * 10) / 10}
            onChange={(e) =>
              handleCustomStyleUpdate("lineHeight", Number(e.target.value))
            }
            className="w-full bg-transparent text-xs text-white outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <div className="flex flex-col -mr-1">
            <button
              type="button"
              onClick={() =>
                handleCustomStyleUpdate(
                  "lineHeight",
                  Math.round((effectiveLineHeight + 0.1) * 10) / 10,
                )
              }
              className="text-text-muted hover:text-white px-0.5 leading-none text-[8px] cursor-pointer"
            >
              ▲
            </button>
            <button
              type="button"
              onClick={() =>
                handleCustomStyleUpdate(
                  "lineHeight",
                  Math.max(
                    0.5,
                    Math.round((effectiveLineHeight - 0.1) * 10) / 10,
                  ),
                )
              }
              className="text-text-muted hover:text-white px-0.5 leading-none text-[8px] cursor-pointer"
            >
              ▼
            </button>
          </div>
        </div>
      </div>

      {/* Alignment */}
      <div>
        <span className="text-xs text-[#a1a1aa] w-20">Alignments</span>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className="text-[8px] text-text-muted block">Horizontal</span>
            <div className="flex gap-0.5 bg-[#18181b] p-0.5 rounded-md">
              {(
                [
                  ["left", AlignLeft],
                  ["center", AlignCenter],
                  ["right", AlignRight],
                ] as const
              ).map(([align, Icon]) => (
                <button
                  key={align}
                  onClick={() => handleUpdate("align", align)}
                  className={`flex-1 py-1 rounded flex items-center justify-center transition-all cursor-pointer ${
                    (textClip.align || "center") === align
                      ? "bg-cyan-400 text-black font-semibold"
                      : "text-text-muted hover:text-black hover:bg-cyan-400"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-[8px] text-text-muted block">Vertical</span>
            <div className="flex gap-0.5 bg-[#18181b] p-0.5 rounded-md">
              {(
                [
                  ["top", AlignStartVertical],
                  ["middle", AlignCenterVertical],
                  ["bottom", AlignEndVertical],
                ] as const
              ).map(([valign, Icon]) => (
                <button
                  key={valign}
                  onClick={() => handleUpdate("valign", valign)}
                  className={`flex-1 py-1 rounded flex items-center justify-center transition-all cursor-pointer ${
                    (textClip.valign || "middle") === valign
                      ? "bg-cyan-400 text-black font-semibold"
                      : "text-text-muted hover:text-black hover:bg-cyan-400"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 my-2" />

      {/* CapCut-parity PRESET STYLE Section */}
      <PresetStyleGrid
        textClip={textClip}
        onApplyPreset={handleApplyPresetStyle}
      />

      <div className="border-t border-white/10 my-2" />

      {/* CapCut-parity TRANSFORM Section under preset */}
      <TextTransformSection
        textClip={textClip}
        handleUpdate={handleUpdate}
        handleCustomStyleUpdate={handleCustomStyleUpdate}
        handleUpdateMultiple={handleUpdateMultiple}
      />

      <div className="border-t border-white/10 my-2" />

      {/* CapCut-parity STROKE Section */}
      <TextStrokeSection
        textClip={textClip}
        handleCustomStyleUpdate={handleCustomStyleUpdate}
        handleUpdate={handleUpdate}
      />

      <div className="border-t border-white/10 my-2" />

      {/* CapCut-parity BACKGROUND Section */}
      <TextBackgroundSection
        textClip={textClip}
        handleCustomStyleUpdate={handleCustomStyleUpdate}
        handleUpdate={handleUpdate}
      />

      {/* Behind Subject (AI Cutout) */}
      {/* <div className="p-3 bg-[#202024] border border-white/5 rounded-lg space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`p-1.5 rounded-md transition-colors ${
                (textClip as any).behindSubject
                  ? "bg-purple-500/20 text-purple-400"
                  : "bg-[#27272a] text-text-muted"
              }`}
            >
              <User className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-semibold text-white block">
                Behind Subject
              </span>
              <span className="text-[10px] text-[#8e8e93] block">
                Place text behind the person using AI cutout
              </span>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={(textClip as any).behindSubject ?? false}
              onChange={(e) => handleUpdate("behindSubject", e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-8 h-4 bg-surface-raised border border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-purple-500" />
          </label>
        </div>
        {(textClip as any).behindSubject && (
          <div className="pt-2 border-t border-border/30 space-y-2">
            <PropertySlider
              label="Edge Softness"
              value={(textClip as any).subjectFeather ?? 4}
              min={0}
              max={20}
              step={1}
              suffix="px"
              onChange={(v) => handleUpdate("subjectFeather", v)}
            />
          </div>
        )}
      </div> */}

      {/* Caption batch styling */}
      {/* {textClip.textRole === "caption" && (
        <div className="flex items-center justify-between p-2.5 bg-[#202024] border border-white/5 rounded-lg">
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-white">
              Apply to all captions
            </span>
            <span className="text-[9px] text-[#8e8e93]">
              Broadcast styles to all clips on this track
            </span>
          </div>
          <button
            type="button"
            onClick={() => setApplyToAll(!applyToAll)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
              applyToAll
                ? "bg-cyan-400 text-black font-bold"
                : "bg-[#27272a] text-[#8e8e93] hover:text-white"
            }`}
          >
            {applyToAll ? "Active" : "Inactive"}
          </button>
        </div>
      )} */}
    </div>
  );
};
