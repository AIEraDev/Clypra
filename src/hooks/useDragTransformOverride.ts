/**
 * useDragTransformOverride
 *
 * SINGLE authoritative bridge between TransformController and the property panel.
 *
 * Architecture:
 * - Subscribes to TransformController's fast-path drag geometry stream.
 * - Throttles React state updates to one per RAF to avoid render storms.
 * - Returns null when no drag is active (property panel reads from store).
 * - Returns live DragGeometry during a drag (property panel shows real-time values).
 *
 * This hook is the only place that translates imperative transform signals into
 * React state for the property panel. There must be no other such bridge.
 */
import { useState, useEffect, useRef } from "react";
import {
  getTransformController,
  type DragGeometry,
} from "@/core/interactions/TransformController";

export function useDragTransformOverride(clipId: string): {
  dragOverride: DragGeometry | null;
} {
  const [dragOverride, setDragOverride] = useState<DragGeometry | null>(null);
  const pendingGeometryRef = useRef<DragGeometry | null>(null);
  const rafScheduledRef = useRef<boolean>(false);
  const rafHandleRef = useRef<number | null>(null);
  // Track which clipId's drag we latched onto so onDragEnd doesn't clear a
  // different clip's override (e.g. when compare-view renders multiple panels).
  const activeDragClipIdRef = useRef<string | null>(null);

  useEffect(() => {
    const controller = getTransformController();

    const unsubGeometry = controller.onDragGeometry(
      (geometry, _sessionId, _revision) => {
        const active = controller.getActiveTransform();
        if (!active || active.clipId !== clipId) return;
        // Record which clip's drag this hook has latched onto.
        activeDragClipIdRef.current = clipId;
        pendingGeometryRef.current = geometry;
        if (!rafScheduledRef.current) {
          rafScheduledRef.current = true;
          rafHandleRef.current = requestAnimationFrame(() => {
            rafScheduledRef.current = false;
            rafHandleRef.current = null;
            const geo = pendingGeometryRef.current;
            if (geo !== null) {
              setDragOverride(geo);
            }
          });
        }
      },
    );

    const unsubEnd = controller.onDragEnd((_sessionId, _finalGeometry) => {
      // Only clear the override if this hook was tracking the drag that just ended.
      // Guards against a drag on a different clip clearing this hook's state when
      // multiple property panels are mounted simultaneously (e.g. compare view).
      if (
        activeDragClipIdRef.current !== null &&
        activeDragClipIdRef.current !== clipId
      ) {
        return;
      }
      // Guard: skip the state update when this instance never tracked a drag
      // (dragOverride is already null), avoiding unnecessary React reconciliation
      // on idle panel instances for every drag-end event.
      const wasTracking = activeDragClipIdRef.current !== null;
      activeDragClipIdRef.current = null;
      if (rafHandleRef.current !== null) {
        cancelAnimationFrame(rafHandleRef.current);
        rafHandleRef.current = null;
      }
      rafScheduledRef.current = false;
      pendingGeometryRef.current = null;
      if (wasTracking) {
        setDragOverride(null);
      }
    });

    return () => {
      unsubGeometry();
      unsubEnd();
      if (rafHandleRef.current !== null) {
        cancelAnimationFrame(rafHandleRef.current);
        rafHandleRef.current = null;
      }
      rafScheduledRef.current = false;
      pendingGeometryRef.current = null;
      activeDragClipIdRef.current = null;
    };
  }, [clipId]);

  return { dragOverride };
}
