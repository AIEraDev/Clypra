import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings, Type, Layout } from "lucide-react";
import { useUIStore } from "@/store/uiStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useHistoryStore } from "@/store/historyStore";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import { calculateClipDimensions, type ClipFitModeExtended } from "@/lib/timelineClip";
import { recalculateTextClipBounds } from "@/lib/textClip";
import type { Clip, TextClip } from "@/types";
import { usePresetStore } from "@/store/presetStore";

import { EmptyPropertiesState } from "./properties/EmptyPropertiesState";
import { TextStyleSection } from "./properties/TextStyleSection";
import { TransformSection } from "./properties/TransformSection";

const TEXT_BOUNDS_STYLE_KEYS: (keyof TextClip)[] = ["text", "fontSize", "fontFamily", "fontWeight", "fontStyle", "styleId", "stroke", "shadow", "background", "letterSpacing", "lineHeight"];
const MANUAL_BOUNDS_KEYS: (keyof Clip)[] = ["x", "y", "width", "height"];

export function shouldRecalculateTextBoundsForPropertyUpdate(updates: Record<string, unknown>): boolean {
  const hasManualBounds = MANUAL_BOUNDS_KEYS.some((key) => key in updates);
  const hasStyleChange = TEXT_BOUNDS_STYLE_KEYS.some((key) => key in updates);
  return hasStyleChange && !hasManualBounds;
}

export function buildClipPropertyTransform(
  clip: Clip,
  updates: Record<string, unknown>,
  canvasWidth: number,
  canvasHeight: number,
): { oldTransform: Record<string, unknown>; newTransform: Record<string, unknown> } {
  let newTransform = { ...updates };

  if ("text" in clip && shouldRecalculateTextBoundsForPropertyUpdate(updates)) {
    const recalculated = recalculateTextClipBounds(clip as TextClip, updates as Partial<TextClip>, canvasWidth, canvasHeight);
    newTransform = {
      ...newTransform,
      x: recalculated.x,
      y: recalculated.y,
      width: recalculated.width,
      height: recalculated.height,
    };
  }

  const oldTransform: Record<string, unknown> = {};
  for (const key of Object.keys(newTransform)) {
    oldTransform[key] = (clip as unknown as Record<string, unknown>)[key];
  }

  return { oldTransform, newTransform };
}

export const PropertiesPanel: React.FC = () => {
  const { t } = useTranslation();
  const { selectedClipIds } = useUIStore();
  const { clips } = useTimelineStore();
  const { mediaAssets, project } = useProjectStore();
  const { execute } = useHistoryStore();

  const [activePropertyTab, setActivePropertyTab] = useState<"text" | "transform">("text");
  const [newPresetName, setNewPresetName] = useState("");
  const { presets, savePreset, deletePreset } = usePresetStore();

  const selectedClipId = selectedClipIds[0] ?? null;
  const selectedClip = clips.find((c) => c.id === selectedClipId);
  const selectedAsset = mediaAssets.find((a) => a.id === selectedClip?.mediaId);
  const isVisualClip = selectedAsset?.type === "video" || selectedAsset?.type === "image";
  const isTextClip = selectedClip && "text" in selectedClip;

  if (!selectedClipId || !selectedClip) {
    return <EmptyPropertiesState />;
  }

  // Cast selected clip to TextClip when it is a text layer
  const textClip = selectedClip as unknown as TextClip;

  const handleUpdate = (key: string, value: any) => {
    const { oldTransform, newTransform } = buildClipPropertyTransform(selectedClip, { [key]: value }, project?.canvasWidth ?? 1920, project?.canvasHeight ?? 1080);

    // Clear styleId when user manually customizes styling properties
    // Commented out to support programmatic API style overrides without losing preset association
    /*
    const stylingKeys = ["color", "fontFamily", "fontWeight", "fontStyle", "stroke", "shadow", "background", "align", "valign", "letterSpacing"];
    if (stylingKeys.includes(key) && (selectedClip as any).styleId) {
      oldTransform.styleId = (selectedClip as any).styleId;
      newTransform.styleId = undefined;
    }
    */

    execute(new TransformClipCommand(selectedClipId, oldTransform, newTransform));
  };

  const handleUpdateMultiple = (fields: Record<string, any>) => {
    const { oldTransform: oldFields, newTransform: newFields } = buildClipPropertyTransform(selectedClip, fields, project?.canvasWidth ?? 1920, project?.canvasHeight ?? 1080);

    // Clear styleId when styling properties are modified in batch, unless styleId is explicitly being set
    // Commented out to support programmatic API style overrides without losing preset association
    /*
    const stylingKeys = ["color", "fontFamily", "fontWeight", "fontStyle", "stroke", "shadow", "background", "align", "valign", "letterSpacing"];
    const hasStylingKey = Object.keys(fields).some((k) => stylingKeys.includes(k));
    if (hasStylingKey && (selectedClip as any).styleId && !("styleId" in fields)) {
      oldFields.styleId = (selectedClip as any).styleId;
      newFields.styleId = undefined;
    }
    */

    execute(new TransformClipCommand(selectedClipId, oldFields, newFields));
  };

  const handleApplyPreset = (preset: any) => {
    handleUpdateMultiple({
      fontFamily: preset.fontFamily,
      fontSize: preset.fontSize,
      fontWeight: preset.fontWeight || "normal",
      fontStyle: preset.fontStyle || "normal",
      color: preset.color,
      align: preset.align || "center",
      valign: preset.valign || "middle",
      lineHeight: preset.lineHeight || 1.2,
      letterSpacing: preset.letterSpacing || 0,
      stroke: preset.stroke,
      shadow: preset.shadow,
      background: preset.background,
      keyframes: preset.keyframes,
      styleId: undefined, // Clear the preset styleId
    });
  };

  const handleApplyFit = (fitMode: ClipFitModeExtended) => {
    if (!selectedClip || !selectedAsset || !project || !isVisualClip) return;
    const rect = calculateClipDimensions(selectedAsset, project.canvasWidth, project.canvasHeight, fitMode);
    execute(
      new TransformClipCommand(
        selectedClip.id,
        {
          x: selectedClip.x,
          y: selectedClip.y,
          width: selectedClip.width,
          height: selectedClip.height,
          fitMode: selectedClip.fitMode,
        },
        {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          fitMode,
        },
      ),
    );
  };

  return (
    <div className="w-full md:w-92 min-h-0 panel-shell flex flex-col overflow-hidden shrink-0">
      {/* Header Panel Tabs */}
      <div className="panel-head flex items-center justify-between border-b border-border select-none">
        {isTextClip ? (
          <div className="flex w-full">
            <button
              onClick={() => setActivePropertyTab("text")}
              className={`flex-1 py-3 text-xs font-semibold tracking-wide border-b-2 text-center transition-all cursor-pointer ${
                activePropertyTab === "text"
                  ? "text-accent border-accent bg-accent/5"
                  : "text-text-muted border-transparent hover:text-text-primary"
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                <Type className="w-3.5 h-3.5" />
                {t("properties.tabs.textStyle")}
              </span>
            </button>
            <button
              onClick={() => setActivePropertyTab("transform")}
              className={`flex-1 py-3 text-xs font-semibold tracking-wide border-b-2 text-center transition-all cursor-pointer ${
                activePropertyTab === "transform"
                  ? "text-accent border-accent bg-accent/5"
                  : "text-text-muted border-transparent hover:text-text-primary"
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                <Layout className="w-3.5 h-3.5" />
                {t("properties.tabs.transform")}
              </span>
            </button>
          </div>
        ) : (
          <div className="p-4 flex items-center gap-2">
            <Settings className="w-4 h-4 text-accent" />
            <h3 className="font-semibold text-text-primary text-sm">{t("properties.clipProperties")}</h3>
          </div>
        )}
      </div>

      {/* Property Contents */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-6">
        {/* Render Text Styling studio if text clip is selected and active tab is text */}
        {isTextClip && activePropertyTab === "text" && (
          <TextStyleSection
            textClip={textClip}
            presets={presets}
            newPresetName={newPresetName}
            setNewPresetName={setNewPresetName}
            handleUpdate={handleUpdate}
            handleUpdateMultiple={handleUpdateMultiple}
            handleApplyPreset={handleApplyPreset}
            savePreset={savePreset}
            deletePreset={deletePreset}
          />
        )}

        {/* Video Transform properties (rendered for non-text or if transform tab is selected) */}
        {(!isTextClip || activePropertyTab === "transform") && (
          <TransformSection
            selectedClip={selectedClip}
            isVisualClip={isVisualClip}
            handleUpdate={handleUpdate}
            handleApplyFit={handleApplyFit}
          />
        )}
      </div>
    </div>
  );
};
