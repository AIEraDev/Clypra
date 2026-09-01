import React, { useState } from "react";
import {
  Type,
  Layout,
  Sparkles,
  Film,
  Music,
  Image,
  FileText,
  Clock,
  Shuffle,
  Smile,
  ChevronRight,
  ChevronLeft,
  Sliders,
} from "lucide-react";
import { useUIStore } from "@/store/uiStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useHistoryStore } from "@/store/historyStore";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import {
  RelinkAudioCommand,
  UnlinkAudioCommand,
} from "@/core/history/commands/UnlinkAudioCommand";
import {
  calculateClipDimensions,
  type ClipFitModeExtended,
} from "@/lib/timeline/timelineClip";
import { resolveTextClipStyleUpdate } from "@/lib/text/textClip";
import type { Clip, TextClip } from "@/types";
import { usePresetStore } from "@/store/presetStore";

import { EmptyPropertiesState } from "./properties/EmptyPropertiesState";
import { TextStyleSection } from "./properties/TextStyleSection";
import { TransformSection } from "./properties/TransformSection";
import { AudioSection } from "./properties/AudioSection";
import { TextAnimationControls } from "./properties/TextAnimationControls";
import { EffectsFiltersSection } from "./properties/EffectsFiltersSection";
import { TransitionSection } from "./properties/TransitionSection";
import { StickerSettingsSection } from "./properties/StickerSettingsSection";
import { TimelineEffectSection } from "./properties/TimelineEffectSection";
import { AdjustmentsSection } from "./properties/AdjustmentsSection";
import { ChromaKeySection } from "./properties/ChromaKeySection";
import {
  getPreviewInteractionCoordinator,
  type PreviewInteractionToken,
} from "@/core/interactions";
import { traceTextInteraction } from "@/core/render/textRenderTrace";
import { InteractiveTextRenderCoordinator } from "@/core/interactions/InteractiveTextRenderCoordinator";

export interface PropertiesPanelProps {
  width?: number;
  fillWidth?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  className?: string;
}

export function buildClipPropertyTransform(
  clip: Clip,
  updates: Record<string, unknown>,
  canvasWidth: number,
  canvasHeight: number,
): {
  oldTransform: Record<string, unknown>;
  newTransform: Record<string, unknown>;
} {
  let newTransform = { ...updates };

  if ("trimIn" in newTransform || "trimOut" in newTransform) {
    const nextTrimIn =
      typeof newTransform.trimIn === "number" &&
      Number.isFinite(newTransform.trimIn)
        ? newTransform.trimIn
        : clip.trimIn;
    const nextTrimOut =
      typeof newTransform.trimOut === "number" &&
      Number.isFinite(newTransform.trimOut)
        ? newTransform.trimOut
        : clip.trimOut;
    newTransform = {
      ...newTransform,
      duration: Math.max(0, nextTrimOut - nextTrimIn),
    };
  }

  if ("text" in clip) {
    newTransform = resolveTextClipStyleUpdate(
      clip as TextClip,
      newTransform as Partial<TextClip>,
      canvasWidth,
      canvasHeight,
    ) as Record<string, unknown>;
  }

  const oldTransform: Record<string, unknown> = {};
  for (const key of Object.keys(newTransform)) {
    oldTransform[key] = (clip as unknown as Record<string, unknown>)[key];
  }

  if ("adjustments" in newTransform) {
    oldTransform.adjustments = clip.adjustments
      ? JSON.parse(JSON.stringify(clip.adjustments))
      : undefined;
    newTransform.adjustments = newTransform.adjustments
      ? JSON.parse(JSON.stringify(newTransform.adjustments))
      : undefined;
  }

  if ("stickerSettings" in newTransform) {
    oldTransform.stickerSettings = clip.stickerSettings
      ? JSON.parse(JSON.stringify(clip.stickerSettings))
      : undefined;
    newTransform.stickerSettings = newTransform.stickerSettings
      ? JSON.parse(JSON.stringify(newTransform.stickerSettings))
      : undefined;
  }

  return { oldTransform, newTransform };
}

/** Clip type display info */
function getClipTypeInfo(
  assetType: string | undefined,
  clipKind: Clip["kind"] | undefined,
  isText: boolean,
  isSticker?: boolean,
) {
  if (isText)
    return { icon: FileText, label: "Text", color: "text-purple-400" };
  if (isSticker)
    return { icon: Smile, label: "Sticker", color: "text-pink-400" };
  if (clipKind === "filter")
    return { icon: Sparkles, label: "Filter", color: "text-violet-400" };
  if (clipKind === "video-effect")
    return { icon: Sparkles, label: "Video Effect", color: "text-violet-400" };
  if (clipKind === "body-effect")
    return { icon: Sparkles, label: "Body Effect", color: "text-violet-400" };
  if (clipKind === "animated-overlay")
    return {
      icon: Sparkles,
      label: "Animated Overlay",
      color: "text-violet-400",
    };
  switch (assetType) {
    case "video":
      return { icon: Film, label: "Video", color: "text-blue-400" };
    case "audio":
      return { icon: Music, label: "Audio", color: "text-green-400" };
    case "image":
      return { icon: Image, label: "Image", color: "text-amber-400" };
    default:
      return { icon: Film, label: "Clip", color: "text-text-muted" };
  }
}

type TextPropertyTab = "text" | "animation" | "transform";

const TEXT_TABS: {
  id: TextPropertyTab;
  label: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  { id: "text", label: "Text Style", icon: Type },
  { id: "animation", label: "Animation", icon: Sparkles },
  { id: "transform", label: "Transform", icon: Layout },
];

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  width,
  fillWidth = false,
  collapsed = false,
  onToggleCollapse,
  className = "",
}) => {
  const selectedClipIds = useUIStore((s) => s.selectedClipIds);
  const selectedTransitionId = useUIStore((s) => s.selectedTransitionId);
  const clearSelection = useUIStore((s) => s.clearSelection);
  const clips = useTimelineStore((s) => s.clips);
  const tracks = useTimelineStore((s) => s.tracks);
  const transitions = useTimelineStore((s) => s.transitions);
  const updateTransition = useTimelineStore((s) => s.updateTransition);
  const removeTransition = useTimelineStore((s) => s.removeTransition);
  const mediaAssets = useProjectStore((s) => s.mediaAssets);
  const project = useProjectStore((s) => s.project);
  const execute = useHistoryStore((s) => s.execute);
  const previewInteractionCoordinator = getPreviewInteractionCoordinator();
  const propertyEditTokenRef = React.useRef<PreviewInteractionToken | null>(null);
  const keepTextPropertyPausedRef = React.useRef(false);
  const propertyEditTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const interactiveTextCoordinatorRef = React.useRef<InteractiveTextRenderCoordinator | null>(null);
  if (!interactiveTextCoordinatorRef.current) {
    interactiveTextCoordinatorRef.current = new InteractiveTextRenderCoordinator({
      apply: (clipId, latest) => {
        useTimelineStore.getState().updateClip(clipId, {
          ...latest,
          _skipEpochIncrement: true,
          _skipTextBoundsRecalculation: true,
        } as any);
      },
      commit: (clipId, before, latest, meta) => {
        const current = useTimelineStore.getState().clips.find((clip) => clip.id === clipId);
        const oldTransform: Record<string, unknown> = {};
        const newTransform: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(latest)) {
          const oldValue = before[key];
          if (Object.is(oldValue, value)) continue;
          oldTransform[key] = oldValue;
          newTransform[key] = value;
        }
        if (Object.keys(newTransform).length > 0) {
          useHistoryStore.getState().execute(
            new TransformClipCommand(
              clipId,
              oldTransform as Partial<Clip>,
              newTransform as Partial<Clip>,
            ),
          );
        }
        traceTextInteraction({
          kind: current?.kind === "text-template" ? "template" : (current as any)?.styleId ? "effect" : "plain",
          rendererPath: "studio-preview",
          operation: meta.operation,
          property: meta.property as any,
          durationMs: meta.durationMs,
          inputToPreviewMs: meta.inputToPreviewMs,
          interactionId: `text-property:${clipId}:${meta.interactionId}`,
          contentLength: typeof latest.text === "string" ? latest.text.length : undefined,
          lineCount: typeof latest.text === "string" ? Math.max(1, latest.text.split("\n").length) : undefined,
          layoutWidth: typeof current?.width === "number" ? current.width : undefined,
          layoutHeight: typeof current?.height === "number" ? current.height : undefined,
          stageTimings: meta.stageTimings,
          stageCoverage: meta.stageCoverage,
          renderCount: meta.renderCount,
          cacheHits: meta.cacheHits,
          cacheMisses: meta.cacheMisses,
          unattributedTimeMs: meta.unattributedTimeMs,
        });
      },
    });
  }
  const interactiveTextCoordinator = interactiveTextCoordinatorRef.current;

  const finishPropertyEdit = () => {
    if (propertyEditTimerRef.current !== null) {
      clearTimeout(propertyEditTimerRef.current);
      propertyEditTimerRef.current = null;
    }
    // Text controls are a continuous preview/editing surface. They must not
    // restart playback when their debounce window closes, including the
    // immediate apply-to-all path which has no text draft object.
    const keepPaused =
      keepTextPropertyPausedRef.current || interactiveTextCoordinator.isActive();
    interactiveTextCoordinator.finish(true);
    const token = propertyEditTokenRef.current;
    propertyEditTokenRef.current = null;
    keepTextPropertyPausedRef.current = false;
    if (token) previewInteractionCoordinator.commit(token, !keepPaused);
  };

  React.useEffect(() => () => {
    finishPropertyEdit();
    interactiveTextCoordinator.dispose();
  }, [interactiveTextCoordinator]);
  React.useEffect(
    () =>
      previewInteractionCoordinator.subscribe((snapshot) => {
        const token = propertyEditTokenRef.current;
        if (
          interactiveTextCoordinator.isActive() &&
          token &&
          snapshot.active?.interactionId !== token.interactionId
        ) {
          // Undo/redo, transport, selection, and a conflicting gesture can
          // invalidate the coordinator while the debounce timer is pending.
          // Flush the draft before that command continues, otherwise a late
          // timer could mutate the timeline after undo/redo.
          finishPropertyEdit();
        }
      }),
    [previewInteractionCoordinator],
  );

  const executePreviewCommand = (command: Parameters<typeof execute>[0]) => {
    // A discrete command must finish any pending text draft first so updates
    // cannot be reordered around selection, transport, or another property.
    if (interactiveTextCoordinator.isActive()) finishPropertyEdit();
    // Some text commands (for example caption apply-to-all and discrete
    // style changes) use the immediate command path, so mark them explicitly
    // to preserve the no-autoplay rule without adding per-control transport
    // calls.
    if (isTextClip) keepTextPropertyPausedRef.current = true;
    let token = propertyEditTokenRef.current;
    if (!token || !previewInteractionCoordinator.isCurrent(token)) {
      token = previewInteractionCoordinator.begin("property-edit");
      propertyEditTokenRef.current = token;
    }
    execute(command);
    if (propertyEditTimerRef.current !== null) {
      clearTimeout(propertyEditTimerRef.current);
    }
    // Range inputs and text entry emit many changes in one gesture. Keep the
    // transport paused across that burst, then commit/resume once. The
    // history journal still coalesces the commands into one undo operation.
    propertyEditTimerRef.current = setTimeout(finishPropertyEdit, 120);
  };

  const queueTextPropertyUpdate = (fields: Record<string, any>) => {
    const current = useTimelineStore
      .getState()
      .clips.find((clip) => clip.id === selectedClipId);
    if (!current || !("text" in current)) return;

    if (
      !propertyEditTokenRef.current ||
      !previewInteractionCoordinator.isCurrent(propertyEditTokenRef.current)
    ) {
      finishPropertyEdit();
      keepTextPropertyPausedRef.current = true;
      propertyEditTokenRef.current = previewInteractionCoordinator.begin(
        "property-edit",
      );
    }

    let textToken = interactiveTextCoordinator.getActiveToken() ?? null;
    if (textToken && textToken.clipId !== current.id) {
      finishPropertyEdit();
      keepTextPropertyPausedRef.current = true;
      propertyEditTokenRef.current = previewInteractionCoordinator.begin(
        "property-edit",
      );
      textToken = null;
    }
    if (!textToken) {
      keepTextPropertyPausedRef.current = true;
      const fieldNames = Object.keys(fields);
      const property = fieldNames.includes("text")
        ? "content"
        : fieldNames.includes("width") || fieldNames.includes("height")
          ? "resize"
          : fieldNames.includes("color")
            ? "color"
            : fieldNames.includes("fontFamily")
              ? "fontFamily"
              : fieldNames.includes("fontSize")
                ? "fontSize"
                : fieldNames.includes("fontWeight")
                  ? "fontWeight"
                  : fieldNames.includes("fontStyle")
                    ? "fontStyle"
                    : fieldNames.includes("lineHeight")
                      ? "lineHeight"
                      : fieldNames.includes("letterSpacing")
                        ? "letterSpacing"
                        : fieldNames.some((key) => key === "align" || key === "valign")
                          ? "alignment"
                          : fieldNames.some((key) => key === "styleId" || key === "styleSnapshot")
                            ? "effect"
                            : undefined;
      const previewToken = propertyEditTokenRef.current ?? previewInteractionCoordinator.begin("property-edit");
      propertyEditTokenRef.current = previewToken;
      textToken = interactiveTextCoordinator.begin({
        clipId: current.id,
        previewToken,
        operation: property === "resize" ? "resize" : property === "content" ? "content-edit" : "property-edit",
        property,
      });
    }

    // Text entry is a high-frequency input path. Do not measure text bounds
    // synchronously for every DOM input event; the RAF update below performs
    // the authoritative timeline update once per frame. The editor keeps the
    // raw latest string so fast typing cannot be rebuilt from a stale store
    // snapshot between keystrokes.
    // Bounds are an authoritative commit concern. Recomputing font metrics
    // synchronously for every typed character or slider tick is what caused
    // the 200–600 ms editor stalls. The preview keeps the existing box during
    // the draft; the single history commit recalculates final bounds once.
    const newTransform = { ...fields };
    for (const [key, value] of Object.entries(newTransform)) {
      if (textToken) interactiveTextCoordinator.update(textToken, { [key]: value }, { [key]: (current as any)[key] });
    }

    if (propertyEditTimerRef.current !== null) {
      clearTimeout(propertyEditTimerRef.current);
    }
    propertyEditTimerRef.current = setTimeout(finishPropertyEdit, 120);
  };
  const updatePreviewTransition = (
    id: string,
    updates: Parameters<typeof updateTransition>[1],
  ) => {
    const token = previewInteractionCoordinator.begin("property-edit");
    updateTransition(id, updates);
    previewInteractionCoordinator.commit(token);
  };
  const removePreviewTransition = (id: string) => {
    const token = previewInteractionCoordinator.begin("property-edit");
    removeTransition(id);
    previewInteractionCoordinator.commit(token);
  };

  const [activePropertyTab, setActivePropertyTab] =
    useState<TextPropertyTab>("text");
  const [newPresetName, setNewPresetName] = useState("");
  const presets = usePresetStore((s) => s.presets);
  const savePreset = usePresetStore((s) => s.savePreset);
  const deletePreset = usePresetStore((s) => s.deletePreset);

  const handleTabKeyDown = (e: React.KeyboardEvent, currentIdx: number) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const nextIdx = (currentIdx + 1) % TEXT_TABS.length;
      setActivePropertyTab(TEXT_TABS[nextIdx].id);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prevIdx = (currentIdx - 1 + TEXT_TABS.length) % TEXT_TABS.length;
      setActivePropertyTab(TEXT_TABS[prevIdx].id);
    }
  };

  const selectedTransition = transitions.find(
    (t) => t.id === selectedTransitionId,
  );

  if (selectedTransitionId && selectedTransition) {
    return (
      <div
        className={`min-h-0 panel-shell flex flex-col overflow-hidden transition-[width] duration-150 ${
          fillWidth && !collapsed ? "w-full flex-1" : "shrink-0"
        } ${className}`}
        style={{
          width: collapsed ? 44 : fillWidth ? "100%" : (width ?? 400),
        }}
      >
        <div className="panel-head border-b border-border">
          {collapsed ? (
            <div className="w-full flex items-center justify-center py-2.5">
              {onToggleCollapse && (
                <button
                  onClick={onToggleCollapse}
                  className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-white/5 transition-colors cursor-pointer"
                  title="Expand properties panel"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            <div className="px-4 py-2.5 flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-surface-raised border border-border/40 flex items-center justify-center shrink-0 text-accent">
                <Shuffle className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-text-primary truncate">
                  {selectedTransition.type === "dissolve" ? "Dissolve" : "Fade"}{" "}
                  Transition
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[9px] font-medium text-accent">
                    Transition
                  </span>
                </div>
              </div>
              {onToggleCollapse && (
                <button
                  onClick={onToggleCollapse}
                  className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-white/5 transition-colors cursor-pointer ml-auto shrink-0"
                  title="Collapse properties panel"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2 py-3 flex-1 overflow-y-auto scrollbar-none">
            <button
              onClick={onToggleCollapse}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-accent bg-accent/10 border border-accent/20 hover:bg-accent/20 transition-colors cursor-pointer"
              title="Expand Transition Properties"
            >
              <Shuffle className="w-4 h-4" />
            </button>
            <span className="text-[9px] font-semibold text-text-muted/60 uppercase tracking-widest [writing-mode:vertical-lr] select-none mt-2">
              Transition
            </span>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
            <TransitionSection
              selectedTransition={selectedTransition}
              updateTransition={updatePreviewTransition}
              removeTransition={removePreviewTransition}
              clearSelection={clearSelection}
            />
          </div>
        )}
      </div>
    );
  }

  const selectedClipId = selectedClipIds[0] ?? null;
  const selectedClip = clips.find((c) => c.id === selectedClipId);
  let selectedAsset = mediaAssets.find((a) => a.id === selectedClip?.mediaId);
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
  const isVisualClip =
    selectedAsset?.type === "video" || selectedAsset?.type === "image";
  // Audio library clips have kind="audio" and audioPath on the clip but no matching mediaAsset entry
  const isAudioClip =
    selectedAsset?.type === "audio" ||
    selectedClip?.kind === "audio" ||
    !!(selectedClip as any)?.audioPath;
  const isVideoClip = selectedAsset?.type === "video"; // Video clips have audio tracks
  const isTextClip = selectedClip && "text" in selectedClip;
  const hasAudioTrack =
    isAudioClip || isVideoClip || Boolean(selectedClip?.audio); // Audio-backed clips, including text with an attached audio model

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

  // Cast selected clip to TextClip when it is a text layer
  const textClip = selectedClip as unknown as TextClip;

  const canvasWidth = project?.canvasWidth ?? 1920;
  const canvasHeight = project?.canvasHeight ?? 1080;

  const handleUpdate = (key: string, value: any) => {
    if (isTextClip) {
      queueTextPropertyUpdate({ [key]: value });
      return;
    }
    const { oldTransform, newTransform } = buildClipPropertyTransform(
      selectedClip,
      { [key]: value },
      canvasWidth,
      canvasHeight,
    );
    executePreviewCommand(
      new TransformClipCommand(selectedClipId, oldTransform, newTransform),
    );
  };

  const handleUpdateMultiple = (fields: Record<string, any>) => {
    if (isTextClip) {
      queueTextPropertyUpdate(fields);
      return;
    }
    const { oldTransform: oldFields, newTransform: newFields } =
      buildClipPropertyTransform(
        selectedClip,
        fields,
        canvasWidth,
        canvasHeight,
      );
    executePreviewCommand(
      new TransformClipCommand(selectedClipId, oldFields, newFields),
    );
  };

  const handleUpdateImmediate = (key: string, value: any) => {
    const { oldTransform, newTransform } = buildClipPropertyTransform(
      selectedClip,
      { [key]: value },
      canvasWidth,
      canvasHeight,
    );
    executePreviewCommand(
      new TransformClipCommand(selectedClipId, oldTransform, newTransform),
    );
  };

  const handleUpdateMultipleImmediate = (fields: Record<string, any>) => {
    const { oldTransform, newTransform } = buildClipPropertyTransform(
      selectedClip,
      fields,
      canvasWidth,
      canvasHeight,
    );
    executePreviewCommand(
      new TransformClipCommand(selectedClipId, oldTransform, newTransform),
    );
  };

  const linkedAudio = selectedClip
    ? UnlinkAudioCommand.findLinkedAudio(selectedClip.id, clips)
    : undefined;
  const sourceVideo =
    selectedClip?.audio?.linkState === "unlinked"
      ? clips.find((clip) => clip.id === selectedClip.audio?.linkedClipId)
      : undefined;
  const handleUnlinkAudio = () => {
    if (
      !selectedClip ||
      !selectedAsset ||
      selectedClip.kind !== "video" ||
      linkedAudio
    )
      return;
    executePreviewCommand(
      new UnlinkAudioCommand(selectedClip, selectedAsset.path, tracks),
    );
  };
  const handleRelinkAudio = () => {
    if (!selectedClip || !sourceVideo) return;
    executePreviewCommand(new RelinkAudioCommand(sourceVideo, selectedClip));
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
    const rect = calculateClipDimensions(
      selectedAsset,
      project.canvasWidth,
      project.canvasHeight,
      fitMode,
    );
    executePreviewCommand(
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

  const isSticker =
    selectedClip?.kind === "sticker" ||
    selectedClip?.mediaId.startsWith("sticker-");
  const isFilter =
    selectedClip?.kind === "filter" ||
    selectedClip?.id.startsWith("filter-clip-");
  const isTimelineEffectClip =
    isFilter ||
    selectedClip?.kind === "video-effect" ||
    selectedClip?.kind === "body-effect";

  // Clip type info for the header. For audio library clips, selectedAsset is undefined; derive type from kind.
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
    ? (textClip.text || "Text").slice(0, 24)
    : isTimelineEffectClip
      ? selectedClip.name || typeInfo.label
      : selectedAsset?.name ||
        (selectedClip as any)?.audioPath?.split("/").pop() ||
        "Clip";
  const clipDuration = selectedClip.duration.toFixed(1);

  return (
    <div
      className={`min-h-0 panel-shell flex flex-col overflow-hidden transition-[width] duration-150 ${
        fillWidth && !collapsed ? "w-full flex-1" : "shrink-0"
      } ${className}`}
      style={{
        width: collapsed ? 44 : fillWidth ? "100%" : (width ?? 400),
      }}
    >
      {/* Clip Info Header */}
      <div className="panel-head border-b border-border">
        {collapsed ? (
          <div className="w-full flex items-center justify-center py-2.5">
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-white/5 transition-colors cursor-pointer"
                title="Expand properties panel"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="px-4 py-2.5 flex items-center gap-3">
              <div
                className={`w-7 h-7 rounded-lg bg-surface-raised border border-border/40 flex items-center justify-center shrink-0 ${typeInfo.color}`}
              >
                <TypeIcon className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-text-primary truncate">
                  {clipName}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`text-[9px] font-medium ${typeInfo.color}`}>
                    {typeInfo.label}
                  </span>
                  <span className="text-[9px] text-text-muted/40">•</span>
                  <span className="text-[9px] text-text-muted tabular-nums flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5" />
                    {clipDuration}s
                  </span>
                </div>
              </div>
              {onToggleCollapse && (
                <button
                  onClick={onToggleCollapse}
                  className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-white/5 transition-colors cursor-pointer ml-auto shrink-0"
                  title="Collapse properties panel"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Tabs for text clips */}
            {isTextClip && (
              <div className="flex border-t border-border/40">
                {TEXT_TABS.map((tab, idx) => {
                  const TabIcon = tab.icon;
                  const isActive = activePropertyTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActivePropertyTab(tab.id)}
                      onKeyDown={(e) => handleTabKeyDown(e, idx)}
                      className={`flex-1 py-2 text-[10px] font-semibold tracking-wide text-center transition-all cursor-pointer border-b-2 ${
                        isActive
                          ? "text-accent border-accent bg-accent/[0.04]"
                          : "text-text-muted border-transparent hover:text-text-primary hover:bg-white/2"
                      }`}
                    >
                      <span className="flex items-center justify-center gap-1.5">
                        <TabIcon className="w-3 h-3" />
                        {tab.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Property Contents or Collapsed Rail */}
      {collapsed ? (
        <div className="flex flex-col items-center gap-1.5 py-2 flex-1 overflow-y-auto scrollbar-none">
          {/* Main clip type button */}
          <button
            onClick={onToggleCollapse}
            className={`w-8 h-8 rounded-lg flex items-center justify-center bg-surface-raised border border-border/40 hover:border-accent/40 transition-colors cursor-pointer ${typeInfo.color}`}
            title={`Expand ${typeInfo.label} Properties (${clipName})`}
          >
            <TypeIcon className="w-4 h-4" />
          </button>

          {/* Context-aware section/tab shortcuts */}
          {isTextClip ? (
            <div className="flex flex-col items-center gap-1 my-1">
              {TEXT_TABS.map((tab) => {
                const TabIcon = tab.icon;
                const isActive = activePropertyTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActivePropertyTab(tab.id);
                      onToggleCollapse?.();
                    }}
                    title={`Open ${tab.label}`}
                    className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer ${
                      isActive
                        ? "text-accent bg-accent/15"
                        : "text-text-muted hover:text-accent hover:bg-white/5"
                    }`}
                  >
                    <TabIcon className="w-3.5 h-3.5" />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1 my-1">
              {isVisualClip && (
                <button
                  onClick={onToggleCollapse}
                  title="Transform & Fit"
                  className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-accent hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <Layout className="w-3.5 h-3.5" />
                </button>
              )}
              {hasAudioTrack && (
                <button
                  onClick={onToggleCollapse}
                  title="Audio Settings"
                  className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-accent hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <Music className="w-3.5 h-3.5" />
                </button>
              )}
              {isVisualClip && (
                <button
                  onClick={onToggleCollapse}
                  title="Color & Adjustments"
                  className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-accent hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <Sliders className="w-3.5 h-3.5" />
                </button>
              )}
              {isVisualClip && (
                <button
                  onClick={onToggleCollapse}
                  title="Effects & Filters"
                  className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-accent hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          <span className="text-[9px] font-semibold text-text-muted/60 uppercase tracking-widest [writing-mode:vertical-lr] select-none mt-2">
            Properties
          </span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
          {/* Sticker properties */}
          {isSticker && (
            <StickerSettingsSection
              selectedClip={selectedClip}
              handleUpdate={handleUpdate}
            />
          )}

          {/* Audio properties (audio clips or video clips) */}
          {hasAudioTrack && (
            <AudioSection
              selectedClip={selectedClip}
              handleUpdate={handleUpdate}
              onUnlink={
                isVideoClip && !linkedAudio ? handleUnlinkAudio : undefined
              }
              onRelink={
                sourceVideo
                  ? handleRelinkAudio
                  : linkedAudio
                    ? () =>
                        executePreviewCommand(
                          new RelinkAudioCommand(selectedClip, linkedAudio),
                        )
                    : undefined
              }
            />
          )}

          {/* Text Styling (text clip + text tab) */}
          {isTextClip && activePropertyTab === "text" && (
            <TextStyleSection
              textClip={textClip}
              presets={presets}
              newPresetName={newPresetName}
              setNewPresetName={setNewPresetName}
              handleUpdate={handleUpdate}
              handleUpdateMultiple={handleUpdateMultiple}
              handleUpdateImmediate={handleUpdateImmediate}
              handleUpdateMultipleImmediate={handleUpdateMultipleImmediate}
              handleApplyPreset={handleApplyPreset}
              savePreset={savePreset}
              deletePreset={deletePreset}
            />
          )}

          {/* Text Animations (text clip + animation tab) */}
          {isTextClip && activePropertyTab === "animation" && (
            <TextAnimationControls
              clip={textClip}
              handleUpdate={handleUpdate}
              handleUpdateMultiple={handleUpdateMultiple}
            />
          )}

          {/* Transform (visual clips, or text clips on transform tab) */}
          {(isVisualClip ||
            (isTextClip && activePropertyTab === "transform")) && (
            <TransformSection
              selectedClip={selectedClip}
              isVisualClip={isVisualClip}
              handleUpdate={handleUpdate}
              handleUpdateMultiple={handleUpdateMultiple}
              handleApplyFit={handleApplyFit}
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
            />
          )}

          {/* Color Adjustments */}
          {isVisualClip && (
            <AdjustmentsSection
              selectedClip={selectedClip}
              handleUpdate={handleUpdate}
            />
          )}

          {/* UltraKey (Chroma Key) */}
          {isVisualClip && <ChromaKeySection selectedClip={selectedClip} />}

          {/* Effects and Filters */}
          {isVisualClip && (
            <EffectsFiltersSection
              selectedClip={selectedClip}
              handleUpdate={handleUpdate}
            />
          )}

          {/* Timeline filter/effect clips */}
          {isTimelineEffectClip && (
            <TimelineEffectSection
              selectedClip={selectedClip}
              handleUpdate={handleUpdate}
            />
          )}
        </div>
      )}
    </div>
  );
};
