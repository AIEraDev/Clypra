import React, { useCallback, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useHistoryStore } from "@/store/historyStore";
import { useUIStore } from "@/store/uiStore";
import { useTimelineStore } from "@/store/timelineStore";
import { getTransformController } from "@/core/interactions";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import { calculateTransform, getDefaultConstraints } from "./calculator";
import { isClipActiveAtTime } from "@/lib/timeline/timelineClip";
import { resolveClipVisualBounds } from "@/lib/transform/transformUtils";
import type { Clip, TransformHandle } from "@/types";
import { useI18n } from "@/i18n";
import { tracePlayback } from "@/core/playback/playbackTrace";
import { applyNativeTransformSnapping } from "./nativeSnap";

interface NativeInteractionOverlayProps {
  canvasWidth: number;
  canvasHeight: number;
  scale: number;
  zoom: number;
  displayWidth: number;
  displayHeight: number;
  currentTime: number;
  visible: boolean;
}

export const isNativeResizeHandle = (handle: TransformHandle): boolean =>
  handle !== "move";

/**
 * Transparent WebView hit layer for the native preview surface.
 *
 * The video and selection pixels remain fully native. This layer exists only
 * because the native child surface is intentionally click-through on all
 * supported desktop platforms; it translates pointer intent into the shared
 * TransformController and commits one history command on pointer-up.
 */
export const NativeInteractionOverlay: React.FC<
  NativeInteractionOverlayProps
> = ({
  canvasWidth,
  canvasHeight,
  scale,
  zoom,
  displayWidth,
  displayHeight,
  currentTime,
  visible,
}) => {
  const { t } = useI18n();
  const selectedClipId = useUIStore((state) => state.selectedClipIds[0]);
  const clip = useTimelineStore((state) =>
    state.clips.find((candidate) => candidate.id === selectedClipId),
  );
  const activeClips = useTimelineStore(
    useShallow((state) =>
      state.clips.filter((candidate) =>
        isClipActiveAtTime(candidate, currentTime),
      ),
    ),
  );
  const execute = useHistoryStore((state) => state.execute);
  const sessionRef = useRef<{
    pointerId: number;
    handle: TransformHandle;
    clip: Clip;
    start: { x: number; y: number };
    startedAt: number;
  } | null>(null);
  const controller = getTransformController();

  const geometry = useMemo(() => {
    if (
      !clip ||
      (clip.kind !== "video" && clip.kind !== "image") ||
      !isClipActiveAtTime(clip, currentTime)
    )
      return null;
    const visual = resolveClipVisualBounds(
      clip,
      canvasWidth,
      canvasHeight,
      "native-surface",
      currentTime,
    );
    return {
      x: visual.x ?? clip.x,
      y: visual.y ?? clip.y,
      width: Math.max(1, visual.width || clip.width),
      height: Math.max(1, visual.height || clip.height),
      rotation: clip.rotation ?? 0,
    };
  }, [canvasHeight, canvasWidth, clip, currentTime]);

  const toCanvasPoint = useCallback(
    (event: React.PointerEvent) => {
      const overlay = (event.currentTarget as HTMLElement).closest(
        "[data-transform-overlay]",
      ) as HTMLElement | null;
      const target =
        overlay?.getBoundingClientRect() ??
        (event.currentTarget as HTMLElement).getBoundingClientRect();
      return {
        x: (event.clientX - target.left) / Math.max(0.001, scale * zoom),
        y: (event.clientY - target.top) / Math.max(0.001, scale * zoom),
      };
    },
    [scale, zoom],
  );

  const begin = useCallback(
    (event: React.PointerEvent, handle: TransformHandle) => {
      if (!visible || !clip || !geometry || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const start = toCanvasPoint(event);
      sessionRef.current = {
        pointerId: event.pointerId,
        handle,
        clip,
        start,
        startedAt: performance.now(),
      };
      tracePlayback("native-transform-pointer-down", { handle });
      if (isNativeResizeHandle(handle)) {
        tracePlayback("native-transform-resize-start", { handle });
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      controller.startTransform({
        clipId: clip.id,
        handle,
        startTransform: geometry,
        startMousePos: start,
        aspectRatioLocked: clip.aspectRatioLocked ?? true,
        sourceAspectRatio:
          clip.sourceAspectRatio ||
          geometry.width / Math.max(1, geometry.height),
      });
    },
    [clip, controller, geometry, toCanvasPoint, visible],
  );

  const move = useCallback(
    (event: React.PointerEvent) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      event.preventDefault();
      const next = calculateTransform(
        session.clip,
        session.handle,
        session.start,
        toCanvasPoint(event),
        getDefaultConstraints(
          canvasWidth,
          canvasHeight,
          session.clip.aspectRatioLocked ?? true,
        ),
      );
      const nextGeometry = {
        x: next.x ?? session.clip.x,
        y: next.y ?? session.clip.y,
        width: next.width ?? session.clip.width,
        height: next.height ?? session.clip.height,
        rotation: next.rotation ?? session.clip.rotation ?? 0,
      };
      const snapped = applyNativeTransformSnapping({
        geometry: nextGeometry,
        clip: session.clip,
        activeClips,
        canvasWidth,
        canvasHeight,
        scale,
        handle: session.handle,
      });
      controller.setActiveGuides(snapped.guides);
      controller.updateDragGeometry(snapped.geometry, snapped.guides ?? undefined);
    },
    [activeClips, canvasHeight, canvasWidth, controller, scale, toCanvasPoint],
  );

  const end = useCallback(
    (event: React.PointerEvent) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      event.preventDefault();
      const finalGeometry = controller.getCurrentDragGeometry();
      if (finalGeometry) {
        execute(
          new TransformClipCommand(session.clip.id, session.clip, {
            ...finalGeometry,
          }),
        );
      }
      tracePlayback("native-transform-commit", {
        handle: session.handle,
        durationMs: Math.round(performance.now() - session.startedAt),
        changed: Boolean(finalGeometry),
      });
      if (isNativeResizeHandle(session.handle)) {
        tracePlayback("native-transform-resize-commit", {
          handle: session.handle,
          changed: Boolean(finalGeometry),
        });
      }
      controller.endTransform();
      sessionRef.current = null;
    },
    [controller, execute],
  );

  if (!visible || !geometry) return null;
  const factor = scale * zoom;
  const left = geometry.x * factor;
  const top = geometry.y * factor;
  const width = geometry.width * factor;
  const height = geometry.height * factor;
  const handles: Array<{ name: TransformHandle; x: string; y: string }> = [
    { name: "nw", x: "0%", y: "0%" },
    { name: "ne", x: "100%", y: "0%" },
    { name: "sw", x: "0%", y: "100%" },
    { name: "se", x: "100%", y: "100%" },
  ];

  return (
    <div
      data-transform-overlay="native-interaction"
      className="absolute inset-0 z-[10001] pointer-events-none"
      style={{ width: displayWidth, height: displayHeight }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div
        data-transform-handle="move"
        className="absolute pointer-events-auto cursor-move border border-transparent"
        style={{
          left,
          top,
          width,
          height,
          transform: `rotate(${geometry.rotation}deg)`,
        }}
        onPointerDown={(event) => begin(event, "move")}
      >
        {handles.map((handle) => (
          <button
            key={handle.name}
            type="button"
            aria-label={t("properties.transform.title")}
            data-transform-handle={handle.name}
            className="absolute pointer-events-auto h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-transparent"
            style={{ left: handle.x, top: handle.y }}
            onPointerDown={(event) => begin(event, handle.name)}
          />
        ))}
      </div>
    </div>
  );
};
