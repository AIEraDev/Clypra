/**
 * useClipPropertyHandlers.ts
 *
 * Provides stable handler callbacks for all property panel update paths:
 * single-field, multi-field, immediate (bypass text streaming), fit-mode,
 * preset, unlink-audio, and relink-audio.
 *
 * Depends on `usePropertyEditCoordinator` for the underlying transport
 * pause/resume and text-streaming logic. The coordinator is consumed via
 * the `executePreviewCommand` / `queueTextPropertyUpdate` callables passed in,
 * keeping this hook free of coordinator internals.
 */

import React from "react";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import {
  RelinkAudioCommand,
  UnlinkAudioCommand,
} from "@/core/history/commands/UnlinkAudioCommand";
import {
  calculateClipDimensions,
  type ClipFitModeExtended,
} from "@/lib/timeline/timelineClip";
import { buildClipPropertyTransform } from "@/lib/timeline/clipPropertyTransform";
import type { Clip, TextClip } from "@/types";
import type { MediaAsset } from "@/types";
import type { ClipConform } from "@clypra-studio/engine";
import type { Command } from "@/core/history/Command";
import type { TextPreset } from "@/store/presetStore";
import type { PropertyEditCoordinator } from "./usePropertyEditCoordinator";

export interface ClipPropertyHandlers {
  /** Update a single property, routing through text streaming when needed. */
  handleUpdate: (key: string, value: any) => void;
  /** Update multiple properties atomically, routing through text streaming when needed. */
  handleUpdateMultiple: (fields: Record<string, any>) => void;
  /** Update a single property bypassing text streaming (for immediate discrete commands). */
  handleUpdateImmediate: (key: string, value: any) => void;
  /** Update multiple properties bypassing text streaming. */
  handleUpdateMultipleImmediate: (fields: Record<string, any>) => void;
  /** Apply a full text style preset. */
  handleApplyPreset: (preset: TextPreset) => void;
  /** Apply a fit/fill/cover mode and recalculate clip dimensions. */
  handleApplyFit: (fitMode: ClipFitModeExtended) => void;
  /** Unlink the embedded audio track from a video clip. */
  handleUnlinkAudio: () => void;
  /** Relink a previously unlinked audio track. */
  handleRelinkAudio: () => void;
}

interface UseClipPropertyHandlersInput {
  selectedClip: Clip | undefined;
  selectedClipId: string | null;
  selectedAsset: MediaAsset | undefined;
  textClip: TextClip | undefined;
  isTextClip: boolean;
  isVisualClip: boolean;
  isVideoClip: boolean;
  canvasWidth: number;
  canvasHeight: number;
  linkedAudio: Clip | undefined;
  sourceVideo: Clip | undefined;
  coordinator: PropertyEditCoordinator;
}

export function useClipPropertyHandlers({
  selectedClip,
  selectedClipId,
  selectedAsset,
  isTextClip,
  isVisualClip,
  isVideoClip,
  canvasWidth,
  canvasHeight,
  linkedAudio,
  sourceVideo,
  coordinator,
}: UseClipPropertyHandlersInput): ClipPropertyHandlers {
  const { executePreviewCommand, queueTextPropertyUpdate } = coordinator;
  const tracks = useTimelineStore((s) => s.tracks);
  const project = useProjectStore((s) => s.project);

  const handleUpdate = React.useCallback(
    (key: string, value: any) => {
      if (!selectedClip || !selectedClipId) return;
      if (isTextClip) {
        queueTextPropertyUpdate({ [key]: value }, selectedClipId, isTextClip);
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
    },
    [
      canvasHeight,
      canvasWidth,
      executePreviewCommand,
      isTextClip,
      queueTextPropertyUpdate,
      selectedClip,
      selectedClipId,
    ],
  );

  const handleUpdateMultiple = React.useCallback(
    (fields: Record<string, any>) => {
      if (!selectedClip || !selectedClipId) return;
      if (isTextClip) {
        queueTextPropertyUpdate(fields, selectedClipId, isTextClip);
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
    },
    [
      canvasHeight,
      canvasWidth,
      executePreviewCommand,
      isTextClip,
      queueTextPropertyUpdate,
      selectedClip,
      selectedClipId,
    ],
  );

  const handleUpdateImmediate = React.useCallback(
    (key: string, value: any) => {
      if (!selectedClip || !selectedClipId) return;
      const { oldTransform, newTransform } = buildClipPropertyTransform(
        selectedClip,
        { [key]: value },
        canvasWidth,
        canvasHeight,
      );
      executePreviewCommand(
        new TransformClipCommand(selectedClipId, oldTransform, newTransform),
      );
    },
    [
      canvasHeight,
      canvasWidth,
      executePreviewCommand,
      selectedClip,
      selectedClipId,
    ],
  );

  const handleUpdateMultipleImmediate = React.useCallback(
    (fields: Record<string, any>) => {
      if (!selectedClip || !selectedClipId) return;
      const { oldTransform, newTransform } = buildClipPropertyTransform(
        selectedClip,
        fields,
        canvasWidth,
        canvasHeight,
      );
      executePreviewCommand(
        new TransformClipCommand(selectedClipId, oldTransform, newTransform),
      );
    },
    [
      canvasHeight,
      canvasWidth,
      executePreviewCommand,
      selectedClip,
      selectedClipId,
    ],
  );

  const handleApplyPreset = React.useCallback(
    (preset: TextPreset) => {
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
        styleId: undefined, // Clear any applied effect styleId
      });
    },
    [handleUpdateMultiple],
  );

  const handleApplyFit = React.useCallback(
    (fitMode: ClipFitModeExtended) => {
      if (!selectedClip || !selectedAsset || !project || !isVisualClip) return;
      const rect = calculateClipDimensions(
        selectedAsset,
        project.canvasWidth,
        project.canvasHeight,
        fitMode,
      );
      const conformMode: ClipConform["mode"] =
        fitMode === "cover" || fitMode === "fill"
          ? "fill"
          : fitMode === "stretch"
            ? "stretch"
            : fitMode === "original"
              ? "none"
              : "fit";
      const nextConform = selectedClip.conform
        ? {
            ...selectedClip.conform,
            mode: conformMode,
            sourceWidth:
              selectedClip.conform.sourceWidth || selectedAsset.width || 0,
            sourceHeight:
              selectedClip.conform.sourceHeight || selectedAsset.height || 0,
            userOffsetX: 0,
            userOffsetY: 0,
            userScale: 1,
          }
        : undefined;
      executePreviewCommand(
        new TransformClipCommand(
          selectedClip.id,
          {
            x: selectedClip.x,
            y: selectedClip.y,
            width: selectedClip.width,
            height: selectedClip.height,
            fitMode: selectedClip.fitMode,
            ...(selectedClip.conform ? { conform: selectedClip.conform } : {}),
          },
          {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            fitMode,
            ...(nextConform ? { conform: nextConform } : {}),
          },
        ),
      );
    },
    [executePreviewCommand, isVisualClip, project, selectedAsset, selectedClip],
  );

  const handleUnlinkAudio = React.useCallback(() => {
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
  }, [executePreviewCommand, linkedAudio, selectedAsset, selectedClip, tracks]);

  const handleRelinkAudio = React.useCallback(() => {
    if (!selectedClip || !sourceVideo) return;
    executePreviewCommand(new RelinkAudioCommand(sourceVideo, selectedClip));
  }, [executePreviewCommand, selectedClip, sourceVideo]);

  return {
    handleUpdate,
    handleUpdateMultiple,
    handleUpdateImmediate,
    handleUpdateMultipleImmediate,
    handleApplyPreset,
    handleApplyFit,
    handleUnlinkAudio,
    handleRelinkAudio,
  };
}
