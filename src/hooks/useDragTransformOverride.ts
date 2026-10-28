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

  useEffect(() => {
    const controller = getTransformController();

    const unsubGeometry = controller.onDragGeometry(
      (geometry, _sessionId, _revision) => {
        const active = controller.getActiveTransform();
        if (!active || active.clipId !== clipId) return;
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
      if (rafHandleRef.current !== null) {
        cancelAnimationFrame(rafHandleRef.current);
        rafHandleRef.current = null;
      }
      rafScheduledRef.current = false;
      pendingGeometryRef.current = null;
      setDragOverride(null);
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
    };
  }, [clipId]);

  return { dragOverride };
}
