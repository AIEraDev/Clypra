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
import type { TextClip, MediaAsset, ClipMotionConfig } from "@/types";
import { compileClipMotionKeyframes } from "@/core/animation/motionPresets";
import { getCatalogSnapshot } from "@/features/media-animations/mediaAnimationCatalog";
import { getTextAnimationCatalogSnapshot } from "@/features/text-animations/animationCatalog";
import { usePropertyEditCoordinator } from "@/hooks/usePropertyEditCoordinator";
import { useClipPropertyHandlers } from "@/hooks/useClipPropertyHandlers";
import { EmptyPropertiesState } from "./EmptyPropertiesState";
import PropertyPanelHeader from "./PropertyPanelHeader";
import type {
  TextPropertyTab,
  VideoPropertyTab,
  ImagePropertyTab,
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
    | TextPropertyTab
    | VideoPropertyTab
    | ImagePropertyTab
    | AudioPropertyTab
    | null
  >(null);
  const [animationSubTab, setAnimationSubTab] = useState<string>("in");
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
    selectedAsset?.type === "video" ||
    selectedAsset?.type === "image" ||
    selectedClip?.kind === "video" ||
    selectedClip?.kind === "image";
  const supportsAnimation = supportsVisualAnimation(
    selectedClip,
    selectedAsset,
  );
  // Audio library clips have kind="audio" and audioPath on the clip but no mediaAsset entry
  const isAudioClip =
    selectedAsset?.type === "audio" ||
    selectedClip?.kind === "audio" ||
    !!(selectedClip as any)?.audioPath;
  const isVideoClip =
    (selectedAsset?.type === "video" || selectedClip?.kind === "video") &&
    !isSticker;
  const isImageClip =
    (selectedAsset?.type === "image" || selectedClip?.kind === "image") &&
    !isSticker;
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
    (selectedClip.kind === "audio"
      ? "audio"
      : selectedClip.kind === "image"
        ? "image"
        : selectedClip.kind === "video"
          ? "video"
          : undefined);
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
          isImageClip={isImageClip}
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
          animationSubTab={animationSubTab}
          onAnimationSubTabChange={setAnimationSubTab}
        />
      )}
      {/* ── Properties panel footer ─────────────────────────────────────
           When on the animation tab with an active In/Out animation preset
           (media or text), show the duration control instead of Save as Preset.
           Otherwise show the standard Reset / Save as Preset buttons. ── */}
      {(() => {
        const isAnimationTab = activePropertyTab === "animation";
        const isAnimatableClip = !!isVideoClip || !!isImageClip || !!isTextClip;
        const motion = selectedClip?.motion;
        const activeInPreset = motion?.inPreset && motion.inPreset !== "none";
        const activeOutPreset =
          motion?.outPreset && motion.outPreset !== "none";
        // Determine whether to target in or out preset based on active animation sub-tab.
        // Fall back to whichever preset is active if user hasn't explicitly picked a sub-tab yet.
        const tab =
          animationSubTab === "out"
            ? (activeOutPreset ? "out" : activeInPreset ? "in" : "out")
            : (activeInPreset ? "in" : activeOutPreset ? "out" : "in");
        const hasActivePreset = tab === "out" ? activeOutPreset : activeInPreset;
        const showDurationControl =
          isAnimationTab &&
          isAnimatableClip &&
          (animationSubTab === "in" || animationSubTab === "out" || !animationSubTab) &&
          hasActivePreset;

        if (showDurationControl && selectedClip) {
          const currentDuration =
            tab === "in"
              ? (motion?.inDuration ?? 0.5)
              : (motion?.outDuration ?? 0.5);
          const maxDuration = Math.max(
            0.5,
            Math.min(5.0, selectedClip.duration),
          );

          const updateDuration = (nextDuration: number) => {
            const nextMotion: ClipMotionConfig =
              tab === "in"
                ? { ...motion, inDuration: nextDuration }
                : { ...motion, outDuration: nextDuration };
            const catalog = isTextClip
              ? getTextAnimationCatalogSnapshot().presets
              : getCatalogSnapshot().presets;
            const compiledKeyframes = compileClipMotionKeyframes(
              selectedClip,
              nextMotion,
              canvasWidth,
              canvasHeight,
              catalog,
            );
            const updateFn = isTextClip
              ? handlers.handleUpdateMultipleImmediate
              : handlers.handleUpdateMultiple;
            updateFn({
              motion: nextMotion,
              visualKeyframes: compiledKeyframes,
              ...(isTextClip
                ? { entranceAnimation: undefined, exitAnimation: undefined }
                : {}),
            });
          };

          const step = (delta: number) => {
            const next = Math.max(
              0.1,
              Math.min(maxDuration, +(currentDuration + delta).toFixed(2)),
            );
            updateDuration(next);
          };

          const handleTrackPointerDown = (
            e: React.PointerEvent<HTMLDivElement>,
          ) => {
            const track = e.currentTarget;
            track.setPointerCapture(e.pointerId);
            const updateFromPointer = (clientX: number) => {
              const rect = track.getBoundingClientRect();
              if (rect.width <= 0) return;
              const ratio = Math.max(
                0,
                Math.min(1, (clientX - rect.left) / rect.width),
              );
              const val = Math.max(
                0.1,
                Math.min(maxDuration, +(ratio * maxDuration).toFixed(2)),
              );
              updateDuration(val);
            };
            updateFromPointer(e.clientX);

            const onPointerMove = (moveEvent: PointerEvent) => {
              updateFromPointer(moveEvent.clientX);
            };
            const onPointerUp = (upEvent: PointerEvent) => {
              try {
                track.releasePointerCapture(upEvent.pointerId);
              } catch {}
              window.removeEventListener("pointermove", onPointerMove);
              window.removeEventListener("pointerup", onPointerUp);
              window.removeEventListener("pointercancel", onPointerUp);
            };
            window.addEventListener("pointermove", onPointerMove);
            window.addEventListener("pointerup", onPointerUp);
            window.addEventListener("pointercancel", onPointerUp);
          };

          return (
            <div className="sticky bottom-0 left-0 right-0 bg-panel border-t border-white/5 px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-text-muted">
                  {t("properties.animation.duration")}
                </span>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    aria-label="Decrease duration"
                    onClick={() => step(-0.1)}
                    className="p-0.5 rounded hover:bg-white/10 text-text-muted hover:text-white transition-colors cursor-pointer"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      className="stroke-current stroke-[1.5]"
                    >
                      <path d="M3 7h8" strokeLinecap="round" />
                    </svg>
                  </button>
                  <span className="min-w-[44px] text-center text-[11px] font-mono text-white bg-[#2a2a2a] rounded px-1.5 py-0.5">
                    {currentDuration.toFixed(1)}s
                  </span>
                  <button
                    type="button"
                    aria-label="Increase duration"
                    onClick={() => step(0.1)}
                    className="p-0.5 rounded hover:bg-white/10 text-text-muted hover:text-white transition-colors cursor-pointer"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      className="stroke-current stroke-[1.5]"
                    >
                      <path d="M7 3v8M3 7h8" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>
              {/* Slider track with click & drag scrubbing */}
              <div
                className="relative h-1.5 rounded-full bg-white/10 cursor-pointer select-none touch-none"
                onPointerDown={handleTrackPointerDown}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-[#00E5FF]/70 pointer-events-none"
                  style={{ width: `${(currentDuration / maxDuration) * 100}%` }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow border border-white/20 pointer-events-none"
                  style={{
                    left: `calc(${(currentDuration / maxDuration) * 100}% - 6px)`,
                  }}
                />
              </div>
            </div>
          );
        }

        return (
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
        );
      })()}
    </div>
  );
};
