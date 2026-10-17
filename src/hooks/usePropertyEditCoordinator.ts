/**
 * usePropertyEditCoordinator.ts
 *
 * Manages the preview interaction lifecycle for property panel edits.
 *
 * Responsibilities:
 * - Owns the `InteractiveTextRenderCoordinator` instance for high-frequency
 *   text property streaming (avoids per-keystroke bounds recalculation).
 * - Coordinates the preview pause/resume window so the transport only
 *   restarts once a burst of property changes settles (120 ms debounce).
 * - Exposes `executePreviewCommand` for discrete undoable edits and
 *   `queueTextPropertyUpdate` for streaming text/style changes.
 * - Flushes and disposes correctly on unmount.
 */

import React from "react";
import { useHistoryStore } from "@/store/historyStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import {
  getPreviewInteractionCoordinator,
  type PreviewInteractionToken,
} from "@/core/interactions";
import { traceTextInteraction } from "@/core/render/textRenderTrace";
import { InteractiveTextRenderCoordinator } from "@/core/interactions/InteractiveTextRenderCoordinator";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import { buildClipPropertyTransform } from "@/lib/timeline/clipPropertyTransform";
import type { Command } from "@/core/history/Command";
import type { Clip } from "@/types";

export interface PropertyEditCoordinator {
  /** Execute a discrete undoable command, pausing the transport during the burst. */
  executePreviewCommand: (command: Command) => void;
  /** Stream high-frequency text/style field updates without per-tick bounds recalculation. */
  queueTextPropertyUpdate: (
    fields: Record<string, any>,
    selectedClipId: string | null,
    isTextClip: boolean,
  ) => void;
}

/**
 * @param isTextClip - Pass the current value so `executePreviewCommand`
 *   can mark text commands as no-autoplay without needing a ref.
 */
export function usePropertyEditCoordinator(
  isTextClip: boolean,
): PropertyEditCoordinator {
  const execute = useHistoryStore((s) => s.execute);
  const previewInteractionCoordinator = getPreviewInteractionCoordinator();

  const propertyEditTokenRef = React.useRef<PreviewInteractionToken | null>(
    null,
  );
  const keepTextPropertyPausedRef = React.useRef(false);
  const propertyEditTimerRef = React.useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const interactiveTextCoordinatorRef =
    React.useRef<InteractiveTextRenderCoordinator | null>(null);
  if (!interactiveTextCoordinatorRef.current) {
    interactiveTextCoordinatorRef.current =
      new InteractiveTextRenderCoordinator({
        apply: (clipId, latest) => {
          useTimelineStore.getState().updateClip(clipId, {
            ...latest,
            _skipEpochIncrement: true,
            _skipTextBoundsRecalculation: true,
          } as any);
        },
        commit: (clipId, before, latest, meta) => {
          const current = useTimelineStore
            .getState()
            .clips.find((clip) => clip.id === clipId);
          if (!current) return;

          const project = useProjectStore.getState().project;
          const currentCanvasWidth = project?.canvasWidth ?? 1920;
          const currentCanvasHeight = project?.canvasHeight ?? 1080;

          const { oldTransform, newTransform } = buildClipPropertyTransform(
            current,
            latest,
            currentCanvasWidth,
            currentCanvasHeight,
          );

          for (const [key, value] of Object.entries(before)) {
            if (key in newTransform) {
              oldTransform[key] = value;
            }
          }

          const hasChanged = Object.keys(newTransform).some(
            (key) => !Object.is(oldTransform[key], newTransform[key]),
          );

          if (hasChanged) {
            useHistoryStore
              .getState()
              .execute(
                new TransformClipCommand(
                  clipId,
                  oldTransform as Partial<Clip>,
                  newTransform as Partial<Clip>,
                ),
              );
          }

          traceTextInteraction({
            kind:
              current?.kind === "text-template"
                ? "template"
                : (current as any)?.styleId
                  ? "effect"
                  : (current as any)?.background?.bubblePresetId ||
                      (latest as any)?.background?.bubblePresetId
                    ? "bubble"
                    : "plain",
            rendererPath: "studio-preview",
            operation: meta.operation,
            property: meta.property as any,
            durationMs: meta.durationMs,
            inputToPreviewMs: meta.inputToPreviewMs,
            interactionId: `text-property:${clipId}:${meta.interactionId}`,
            contentLength:
              typeof latest.text === "string" ? latest.text.length : undefined,
            lineCount:
              typeof latest.text === "string"
                ? Math.max(1, latest.text.split("\n").length)
                : undefined,
            layoutWidth:
              typeof current?.width === "number" ? current.width : undefined,
            layoutHeight:
              typeof current?.height === "number" ? current.height : undefined,
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

  // ---------------------------------------------------------------------------
  // finishPropertyEdit — flush & commit the current interaction window
  // ---------------------------------------------------------------------------
  const finishPropertyEdit = React.useCallback(() => {
    if (propertyEditTimerRef.current !== null) {
      clearTimeout(propertyEditTimerRef.current);
      propertyEditTimerRef.current = null;
    }
    // Text controls are a continuous preview/editing surface. They must not
    // restart playback when their debounce window closes, including the
    // immediate apply-to-all path which has no text draft object.
    const keepPaused =
      keepTextPropertyPausedRef.current ||
      interactiveTextCoordinator.isActive();
    interactiveTextCoordinator.finish(true);
    const token = propertyEditTokenRef.current;
    propertyEditTokenRef.current = null;
    keepTextPropertyPausedRef.current = false;
    if (token) previewInteractionCoordinator.commit(token, !keepPaused);
  }, [interactiveTextCoordinator, previewInteractionCoordinator]);

  // Flush draft on unmount
  React.useEffect(
    () => () => {
      finishPropertyEdit();
      interactiveTextCoordinator.dispose();
    },
    [finishPropertyEdit, interactiveTextCoordinator],
  );

  // Flush draft when an external interaction (undo/redo, transport) invalidates
  // the current coordinator token
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
    [
      finishPropertyEdit,
      interactiveTextCoordinator,
      previewInteractionCoordinator,
    ],
  );

  // ---------------------------------------------------------------------------
  // executePreviewCommand
  // ---------------------------------------------------------------------------
  const executePreviewCommand = React.useCallback(
    (command: Command) => {
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
    },
    [
      execute,
      finishPropertyEdit,
      interactiveTextCoordinator,
      isTextClip,
      previewInteractionCoordinator,
    ],
  );

  // ---------------------------------------------------------------------------
  // queueTextPropertyUpdate
  // ---------------------------------------------------------------------------
  const queueTextPropertyUpdate = React.useCallback(
    (
      fields: Record<string, any>,
      selectedClipId: string | null,
      _isTextClip: boolean,
    ) => {
      const current = useTimelineStore
        .getState()
        .clips.find((clip) => clip.id === selectedClipId);
      if (
        !current ||
        !(
          current.kind === "text" ||
          current.kind === "text-template" ||
          "text" in current
        )
      )
        return;

      if (
        !propertyEditTokenRef.current ||
        !previewInteractionCoordinator.isCurrent(propertyEditTokenRef.current)
      ) {
        finishPropertyEdit();
        keepTextPropertyPausedRef.current = true;
        propertyEditTokenRef.current =
          previewInteractionCoordinator.begin("property-edit");
      }

      let textToken = interactiveTextCoordinator.getActiveToken() ?? null;
      if (textToken && textToken.clipId !== current.id) {
        finishPropertyEdit();
        keepTextPropertyPausedRef.current = true;
        propertyEditTokenRef.current =
          previewInteractionCoordinator.begin("property-edit");
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
                          : fieldNames.some(
                                (key) => key === "align" || key === "valign",
                              )
                            ? "alignment"
                            : fieldNames.some(
                                  (key) =>
                                    key === "styleId" ||
                                    key === "styleSnapshot",
                                )
                              ? "effect"
                              : fieldNames.some(
                                    (key) =>
                                      key === "bubblePresetId" ||
                                      (key === "background" &&
                                        ((fields.background as any)
                                          ?.bubblePresetId !== undefined ||
                                          (current as any)?.background
                                            ?.bubblePresetId !== undefined)),
                                  )
                                ? "bubble"
                                : undefined;
        const previewToken =
          propertyEditTokenRef.current ??
          previewInteractionCoordinator.begin("property-edit");
        propertyEditTokenRef.current = previewToken;
        textToken = interactiveTextCoordinator.begin({
          clipId: current.id,
          previewToken,
          operation:
            property === "resize"
              ? "resize"
              : property === "content"
                ? "content-edit"
                : "property-edit",
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
        if (textToken)
          interactiveTextCoordinator.update(
            textToken,
            { [key]: value },
            { [key]: (current as any)[key] },
          );
      }

      if (propertyEditTimerRef.current !== null) {
        clearTimeout(propertyEditTimerRef.current);
      }
      propertyEditTimerRef.current = setTimeout(finishPropertyEdit, 120);
    },
    [
      finishPropertyEdit,
      interactiveTextCoordinator,
      previewInteractionCoordinator,
    ],
  );

  return { executePreviewCommand, queueTextPropertyUpdate };
}
