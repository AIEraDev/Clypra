import React, { useState } from "react";
import { Type, Layout, Sparkles, Film, Music, Image, FileText, Clock, Shuffle, Smile } from "lucide-react";
import { useUIStore } from "@/store/uiStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useHistoryStore } from "@/store/historyStore";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import { calculateClipDimensions, isFilterClip, isStickerClip, type ClipFitModeExtended } from "@/lib/timeline/timelineClip";
import { resolveTextClipStyleUpdate } from "@/lib/text/textClip";
import type { Clip, TextClip } from "@/types";
import { usePresetStore } from "@/store/presetStore";
import { t } from "@/i18n";

import { EmptyPropertiesState } from "./properties/EmptyPropertiesState";
import { TextStyleSection } from "./properties/TextStyleSection";
import { TransformSection } from "./properties/TransformSection";
import { AudioSection } from "./properties/AudioSection";
import { TextAnimationControls } from "./properties/TextAnimationControls";
import { EffectsFiltersSection } from "./properties/EffectsFiltersSection";
import { TransitionSection } from "./properties/TransitionSection";
import { StickerSettingsSection } from "./properties/StickerSettingsSection";
import { TimelineEffectSection } from "./properties/TimelineEffectSection";

export function buildClipPropertyTransform(clip: Clip, updates: Record<string, unknown>, canvasWidth: number, canvasHeight: number): { oldTransform: Record<string, unknown>; newTransform: Record<string, unknown> } {
  let newTransform = { ...updates };

  if ("trimIn" in newTransform || "trimOut" in newTransform) {
    const nextTrimIn = typeof newTransform.trimIn === "number" && Number.isFinite(newTransform.trimIn) ? newTransform.trimIn : clip.trimIn;
    const nextTrimOut = typeof newTransform.trimOut === "number" && Number.isFinite(newTransform.trimOut) ? newTransform.trimOut : clip.trimOut;
    newTransform = {
      ...newTransform,
      duration: Math.max(0, nextTrimOut - nextTrimIn),
    };
  }

  if ("text" in clip) {
    newTransform = resolveTextClipStyleUpdate(clip as TextClip, newTransform as Partial<TextClip>, canvasWidth, canvasHeight) as Record<string, unknown>;
  }

  const oldTransform: Record<string, unknown> = {};
  for (const key of Object.keys(newTransform)) {
    oldTransform[key] = (clip as unknown as Record<string, unknown>)[key];
  }

  return { oldTransform, newTransform };
}

/** Clip type display info */
function getClipTypeInfo(assetType: string | undefined, clipKind: Clip["kind"] | undefined, isText: boolean, isSticker?: boolean) {
  if (isText) return { icon: FileText, label: t("editor.properties.clipType.text"), color: "text-purple-400" };
  if (isSticker) return { icon: Smile, label: t("editor.properties.clipType.sticker"), color: "text-pink-400" };
  if (clipKind === "filter") return { icon: Sparkles, label: t("editor.properties.clipType.filter"), color: "text-violet-400" };
  if (clipKind === "video-effect") return { icon: Sparkles, label: t("editor.properties.clipType.videoEffect"), color: "text-violet-400" };
  if (clipKind === "body-effect") return { icon: Sparkles, label: t("editor.properties.clipType.bodyEffect"), color: "text-violet-400" };
  if (clipKind === "animated-overlay") return { icon: Sparkles, label: t("editor.properties.clipType.animatedOverlay"), color: "text-violet-400" };
  switch (assetType) {
    case "video":
      return { icon: Film, label: t("editor.properties.clipType.video"), color: "text-blue-400" };
    case "audio":
      return { icon: Music, label: t("editor.properties.clipType.audio"), color: "text-green-400" };
    case "image":
      return { icon: Image, label: t("editor.properties.clipType.image"), color: "text-amber-400" };
    default:
      return { icon: Film, label: t("editor.properties.clipType.clip"), color: "text-text-muted" };
  }
}

type TextPropertyTab = "text" | "animation" | "transform";

const TEXT_TABS: { id: TextPropertyTab; labelKey: "editor.properties.tabs.textStyle" | "editor.properties.tabs.animation" | "editor.properties.tabs.transform"; icon: React.FC<{ className?: string }> }[] = [
  { id: "text", labelKey: "editor.properties.tabs.textStyle", icon: Type },
  { id: "animation", labelKey: "editor.properties.tabs.animation", icon: Sparkles },
  { id: "transform", labelKey: "editor.properties.tabs.transform", icon: Layout },
];

export const PropertiesPanel: React.FC = () => {
  const { selectedClipIds, selectedTransitionId, clearSelection } = useUIStore();
  const { clips, transitions, updateTransition, removeTransition } = useTimelineStore();
  const { mediaAssets, project } = useProjectStore();
  const { execute } = useHistoryStore();

  const [activePropertyTab, setActivePropertyTab] = useState<TextPropertyTab>("text");
  const [newPresetName, setNewPresetName] = useState("");
  const { presets, savePreset, deletePreset } = usePresetStore();

  const selectedTransition = transitions.find((t) => t.id === selectedTransitionId);

  if (selectedTransitionId && selectedTransition) {
    return (
      <div className="w-full md:w-92 min-h-0 panel-shell flex flex-col overflow-hidden shrink-0">
        <div className="panel-head border-b border-border">
          <div className="px-4 py-2.5 flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-surface-raised border border-border/40 flex items-center justify-center shrink-0 text-accent">
              <Shuffle className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-text-primary truncate">
                {t(selectedTransition.type === "dissolve" ? "editor.properties.transition.dissolve" : "editor.properties.transition.fade")}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[9px] font-medium text-accent">{t("editor.properties.clipType.transition")}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
          <TransitionSection
            selectedTransition={selectedTransition}
            updateTransition={updateTransition}
            removeTransition={removeTransition}
            clearSelection={clearSelection}
          />
        </div>
      </div>
    );
  }

  const selectedClipId = selectedClipIds[0] ?? null;
  const selectedClip = clips.find((c) => c.id === selectedClipId);
  let selectedAsset = mediaAssets.find((a) => a.id === selectedClip?.mediaId);
  if (!selectedAsset && selectedClip && isStickerClip(selectedClip)) {
    selectedAsset = {
      id: selectedClip.mediaId,
      name: selectedClip.name || t("editor.fallback.sticker"),
      path: (selectedClip as any).stickerImagePath || selectedClip.stickerAnimationPath || "",
      type: "image",
      duration: selectedClip.duration,
      size: 0,
      stickerFormat: selectedClip.stickerFormat,
      stickerAnimationPath: selectedClip.stickerAnimationPath,
      stickerSourceId: selectedClip.stickerSourceId,
    };
  }
  const isVisualClip = selectedAsset?.type === "video" || selectedAsset?.type === "image";
  // Audio library clips have kind="audio" and audioPath on the clip but no matching mediaAsset entry
  const isAudioClip = selectedAsset?.type === "audio" || selectedClip?.kind === "audio" || !!(selectedClip as any)?.audioPath;
  const isVideoClip = selectedAsset?.type === "video"; // Video clips have audio tracks
  const isTextClip = selectedClip && "text" in selectedClip;
  const hasAudioTrack = isAudioClip || isVideoClip; // Both audio clips and video clips have audio

  if (!selectedClipId || !selectedClip) {
    return <EmptyPropertiesState />;
  }

  // Cast selected clip to TextClip when it is a text layer
  const textClip = selectedClip as unknown as TextClip;

  const canvasWidth = project?.canvasWidth ?? 1920;
  const canvasHeight = project?.canvasHeight ?? 1080;

  const handleUpdate = (key: string, value: any) => {
    const { oldTransform, newTransform } = buildClipPropertyTransform(selectedClip, { [key]: value }, canvasWidth, canvasHeight);
    execute(new TransformClipCommand(selectedClipId, oldTransform, newTransform));
  };

  const handleUpdateMultiple = (fields: Record<string, any>) => {
    const { oldTransform: oldFields, newTransform: newFields } = buildClipPropertyTransform(selectedClip, fields, canvasWidth, canvasHeight);
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

  const isSticker = isStickerClip(selectedClip);
  const isFilter = isFilterClip(selectedClip);
  const isTimelineEffectClip = isFilter || selectedClip?.kind === "video-effect" || selectedClip?.kind === "body-effect";

  // Clip type info for the header. For audio library clips, selectedAsset is undefined; derive type from kind.
  const effectiveAssetType = selectedAsset?.type ?? (selectedClip.kind === "audio" ? "audio" : undefined);
  const typeInfo = getClipTypeInfo(effectiveAssetType, selectedClip.kind, !!isTextClip, isSticker);
  const TypeIcon = typeInfo.icon;
  const clipName = isTextClip ? (textClip.text || t("editor.fallback.text")).slice(0, 24) : isTimelineEffectClip ? (selectedClip.name || typeInfo.label) : selectedAsset?.name || (selectedClip as any)?.audioPath?.split("/").pop() || t("editor.properties.clipType.clip");
  const clipDuration = selectedClip.duration.toFixed(1);

  return (
    <div className="w-full md:w-92 min-h-0 panel-shell flex flex-col overflow-hidden shrink-0">
      {/* Clip Info Header */}
      <div className="panel-head border-b border-border">
        <div className="px-4 py-2.5 flex items-center gap-3">
          <div className={`w-7 h-7 rounded-lg bg-surface-raised border border-border/40 flex items-center justify-center shrink-0 ${typeInfo.color}`}>
            <TypeIcon className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-text-primary truncate">{clipName}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`text-[9px] font-medium ${typeInfo.color}`}>{typeInfo.label}</span>
              <span className="text-[9px] text-text-muted/40">•</span>
              <span className="text-[9px] text-text-muted tabular-nums flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />
                {t("editor.properties.durationSeconds", { duration: clipDuration })}
              </span>
            </div>
          </div>
        </div>

        {/* Tabs for text clips */}
        {isTextClip && (
          <div className="flex border-t border-border/40">
            {TEXT_TABS.map((tab) => {
              const TabIcon = tab.icon;
              const isActive = activePropertyTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setActivePropertyTab(tab.id)} className={`flex-1 py-2 text-[10px] font-semibold tracking-wide text-center transition-all cursor-pointer border-b-2 ${isActive ? "text-accent border-accent bg-accent/[0.04]" : "text-text-muted border-transparent hover:text-text-primary hover:bg-white/[0.02]"}`}>
                  <span className="flex items-center justify-center gap-1.5">
                    <TabIcon className="w-3 h-3" />
                    {t(tab.labelKey)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Property Contents */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
        {/* Sticker properties */}
        {isSticker && <StickerSettingsSection selectedClip={selectedClip} handleUpdate={handleUpdate} />}

        {/* Audio properties (audio clips or video clips) */}
        {hasAudioTrack && <AudioSection selectedClip={selectedClip} handleUpdate={handleUpdate} />}

        {/* Text Styling (text clip + text tab) */}
        {isTextClip && activePropertyTab === "text" && <TextStyleSection textClip={textClip} presets={presets} newPresetName={newPresetName} setNewPresetName={setNewPresetName} handleUpdate={handleUpdate} handleUpdateMultiple={handleUpdateMultiple} handleApplyPreset={handleApplyPreset} savePreset={savePreset} deletePreset={deletePreset} />}

        {/* Text Animations (text clip + animation tab) */}
        {isTextClip && activePropertyTab === "animation" && <TextAnimationControls clip={textClip} handleUpdate={handleUpdate} handleUpdateMultiple={handleUpdateMultiple} />}

        {/* Transform (visual clips, or text clips on transform tab) */}
        {(isVisualClip || (isTextClip && activePropertyTab === "transform")) && <TransformSection selectedClip={selectedClip} isVisualClip={isVisualClip} handleUpdate={handleUpdate} handleUpdateMultiple={handleUpdateMultiple} handleApplyFit={handleApplyFit} canvasWidth={canvasWidth} canvasHeight={canvasHeight} />}

        {/* Effects and Filters */}
        {isVisualClip && <EffectsFiltersSection selectedClip={selectedClip} handleUpdate={handleUpdate} />}

        {/* Timeline filter/effect clips */}
        {isTimelineEffectClip && <TimelineEffectSection selectedClip={selectedClip} handleUpdate={handleUpdate} />}
      </div>
    </div>
  );
};
