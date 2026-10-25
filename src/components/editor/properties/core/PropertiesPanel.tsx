import React, { useState } from "react";
import { clipHasAudio } from "@/core/media/mediaAudioDetection";
import { useUIStore } from "@/store/uiStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { usePresetStore } from "@/store/presetStore";
import { useI18n } from "@/i18n";
import { UnlinkAudioCommand } from "@/core/history/commands/UnlinkAudioCommand";
import { supportsVisualAnimation } from "@/lib/timeline/timelineClip";
import { getClipTypeInfo } from "@/lib/timeline/clipPropertyTransform";
import type { TextClip, MediaAsset } from "@/types";

import { usePropertyEditCoordinator } from "@/hooks/usePropertyEditCoordinator";
import { useClipPropertyHandlers } from "@/hooks/useClipPropertyHandlers";

import { EmptyPropertiesState } from "./EmptyPropertiesState";
import PropertyPanelHeader from "./PropertyPanelHeader";
import type {
  TextPropertyTab,
  VideoPropertyTab,
  AudioPropertyTab,
} from "../types";
import PropertyPanelBody from "./PropertyPanelBody";
import PropertyPanelCollapsed from "./PropertyPanelCollapsed";

export interface PropertiesPanelProps {
  width?: number;
  fillWidth?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  className?: string;
}

// Re-export so existing consumers that import from here continue to work
export { buildClipPropertyTransform } from "@/lib/timeline/clipPropertyTransform";

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  width,
  fillWidth = false,
  collapsed = false,
  onToggleCollapse,
  className = "",
}) => {
  const { t } = useI18n();

  // ── Store subscriptions ──────────────────────────────────────────────────
  const selectedClipIds = useUIStore((s) => s.selectedClipIds);
  const clips = useTimelineStore((s) => s.clips);
  const tracks = useTimelineStore((s) => s.tracks);
  const mediaAssets = useProjectStore((s) => s.mediaAssets);
  const project = useProjectStore((s) => s.project);
  const presets = usePresetStore((s) => s.presets);
  const savePreset = usePresetStore((s) => s.savePreset);
  const deletePreset = usePresetStore((s) => s.deletePreset);

  // ── Local UI state ───────────────────────────────────────────────────────
  const [activePropertyTab, setActivePropertyTab] = useState<
    TextPropertyTab | VideoPropertyTab | AudioPropertyTab | null
  >(null);
  const [newPresetName, setNewPresetName] = useState("");

  // ── Clip resolution ──────────────────────────────────────────────────────
  const selectedClipId = selectedClipIds[0] ?? null;
  const selectedClip = clips.find((c) => c.id === selectedClipId);

  let selectedAsset: MediaAsset | undefined = mediaAssets.find(
    (a) => a.id === selectedClip?.mediaId,
  );
  // Synthesise a minimal asset entry for stickers that have no mediaAsset row
  if (
    !selectedAsset &&
    selectedClip &&
    (selectedClip.kind === "sticker" ||
      selectedClip.mediaId.startsWith("sticker-"))
  ) {
    selectedAsset = {
      id: selectedClip.mediaId,
      name: selectedClip.name || "Sticker",
      path:
        (selectedClip as any).stickerImagePath ||
        selectedClip.stickerAnimationPath ||
        "",
      type: "image",
      duration: selectedClip.duration,
      size: 0,
      stickerFormat: selectedClip.stickerFormat,
      stickerAnimationPath: selectedClip.stickerAnimationPath,
      stickerSourceId: selectedClip.stickerSourceId,
    };
  }

  // ── Clip-type booleans ───────────────────────────────────────────────────
  const isSticker =
    selectedClip?.kind === "sticker" ||
    Boolean(selectedClip?.mediaId?.startsWith("sticker-"));
  const isVisualClip =
    selectedAsset?.type === "video" || selectedAsset?.type === "image";
  const supportsAnimation = supportsVisualAnimation(
    selectedClip,
    selectedAsset,
  );
  // Audio library clips have kind="audio" and audioPath on the clip but no mediaAsset entry
  const isAudioClip =
    selectedAsset?.type === "audio" ||
    selectedClip?.kind === "audio" ||
    !!(selectedClip as any)?.audioPath;
  const isVideoClip = selectedAsset?.type === "video";
  const isTextClip =
    selectedClip &&
    (selectedClip.kind === "text" ||
      selectedClip.kind === "text-template" ||
      "text" in selectedClip);
  const hasAudioTrack =
    !isTextClip && !isSticker && clipHasAudio(selectedClip, selectedAsset);

  const isFilter =
    selectedClip?.kind === "filter" ||
    selectedClip?.id.startsWith("filter-clip-");
  const isTimelineEffectClip =
    isFilter ||
    selectedClip?.kind === "video-effect" ||
    selectedClip?.kind === "body-effect";

  // ── Coordinator & handlers — must be unconditional (Rules of Hooks) ─────
  const coordinator = usePropertyEditCoordinator(!!isTextClip);
  const handlers = useClipPropertyHandlers({
    selectedClip,
    selectedClipId,
    selectedAsset,
    textClip: selectedClip as unknown as TextClip,
    isTextClip: !!isTextClip,
    isVisualClip,
    isVideoClip: !!isVideoClip,
    canvasWidth: project?.canvasWidth ?? 1920,
    canvasHeight: project?.canvasHeight ?? 1080,
    linkedAudio: selectedClip
      ? UnlinkAudioCommand.findLinkedAudio(selectedClip.id, clips)
      : undefined,
    sourceVideo:
      selectedClip?.audio?.linkState === "unlinked"
        ? clips.find((c) => c.id === selectedClip.audio?.linkedClipId)
        : undefined,
    coordinator,
  });

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!selectedClipId || !selectedClip) {
    return (
      <EmptyPropertiesState
        width={width}
        fillWidth={fillWidth}
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
        className={className}
      />
    );
  }

  // ── Derived values used for display (only used past the empty-state guard) ─
  const textClip = selectedClip as unknown as TextClip;
  const canvasWidth = project?.canvasWidth ?? 1920;
  const canvasHeight = project?.canvasHeight ?? 1080;

  const linkedAudio = UnlinkAudioCommand.findLinkedAudio(
    selectedClip.id,
    clips,
  );
  const sourceVideo =
    selectedClip?.audio?.linkState === "unlinked"
      ? clips.find((clip) => clip.id === selectedClip.audio?.linkedClipId)
      : undefined;

  // ── Clip type header info ────────────────────────────────────────────────
  const effectiveAssetType =
    selectedAsset?.type ??
    (selectedClip.kind === "audio" ? "audio" : undefined);
  const typeInfo = getClipTypeInfo(
    effectiveAssetType,
    selectedClip.kind,
    !!isTextClip,
    isSticker,
  );
  const TypeIcon = typeInfo.icon;
  const clipName = isTextClip
    ? selectedClip.kind === "text-template"
      ? (
          selectedClip.name ||
          (selectedClip as any).templateSnapshot?.metadata?.label ||
          "Text Template"
        ).slice(0, 24)
      : (textClip.text || "Text").slice(0, 24)
    : isTimelineEffectClip
      ? selectedClip.name || typeInfo.label
      : selectedAsset?.name ||
        (selectedClip as any)?.audioPath?.split("/").pop() ||
        "Clip";
  return (
    <div
      data-properties-panel="true"
      className={`min-h-0 panel-shell flex flex-col overflow-hidden transition-[width] duration-150 ${
        fillWidth && !collapsed ? "w-full flex-1" : "shrink-0"
      } ${className}`}
      style={{
        width: collapsed ? 44 : fillWidth ? "100%" : (width ?? 400),
      }}
    >
      <PropertyPanelHeader
        collapsed={collapsed}
        clipKind={selectedClip.kind}
        onToggleCollapse={onToggleCollapse}
        activePropertyTab={activePropertyTab}
        setActivePropertyTab={setActivePropertyTab}
        hasAudioTrack={hasAudioTrack}
      />

      {collapsed ? (
        <PropertyPanelCollapsed
          onToggleCollapse={onToggleCollapse}
          typeInfo={typeInfo}
          TypeIcon={TypeIcon}
          clipName={clipName}
          isTextClip={!!isTextClip}
          isVisualClip={isVisualClip}
          hasAudioTrack={hasAudioTrack}
          supportsAnimation={supportsAnimation}
          activePropertyTab={activePropertyTab}
          setActivePropertyTab={setActivePropertyTab}
        />
      ) : (
        <PropertyPanelBody
          selectedClip={selectedClip}
          textClip={textClip}
          activePropertyTab={activePropertyTab}
          isSticker={isSticker}
          isTextClip={!!isTextClip}
          isVisualClip={isVisualClip}
          isVideoClip={!!isVideoClip}
          isAudioClip={isAudioClip}
          isTimelineEffectClip={isTimelineEffectClip}
          hasAudioTrack={hasAudioTrack}
          supportsAnimation={supportsAnimation}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          linkedAudio={linkedAudio}
          sourceVideo={sourceVideo}
          presets={presets}
          newPresetName={newPresetName}
          setNewPresetName={setNewPresetName}
          handleUpdate={handlers.handleUpdate}
          handleUpdateMultiple={handlers.handleUpdateMultiple}
          handleUpdateImmediate={handlers.handleUpdateImmediate}
          handleUpdateMultipleImmediate={handlers.handleUpdateMultipleImmediate}
          handleApplyPreset={handlers.handleApplyPreset}
          handleApplyFit={handlers.handleApplyFit}
          handleUnlinkAudio={handlers.handleUnlinkAudio}
          handleRelinkAudio={handlers.handleRelinkAudio}
          executePreviewCommand={coordinator.executePreviewCommand}
          savePreset={savePreset}
          deletePreset={deletePreset}
        />
      )}

      {/* Save as preset & Reset */}
      <div className="sticky bottom-0 left-0 right-0 bg-panel flex justify-end items-center gap-2 p-1.5 border-t border-white/5">
        <button
          type="button"
          onClick={() => {
            if (isTextClip) {
              handlers.handleUpdateMultiple({
                background: undefined,
              });
            }
          }}
          className="bg-[#38383e] hover:bg-[#4a4a52] text-white font-medium text-xs px-3.5 py-1.5 rounded-md transition-colors cursor-pointer shadow-sm"
        >
          {t("common.actions.reset")}
        </button>
        <button
          type="button"
          onClick={() => {}}
          className="bg-cyan-400 hover:bg-cyan-300 text-black font-semibold text-xs px-4 py-1.5 rounded-md transition-colors cursor-pointer shadow-sm"
        >
          {t("properties.text.saveAsPreset")}
        </button>
      </div>
    </div>
  );
};
