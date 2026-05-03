import { useEffect, useRef, RefObject } from "react";
// @ts-ignore - react-dnd types issue
import { useDragLayer } from "react-dnd";
import { useTimelineStore } from "../store/timelineStore";

export function useTimelineAutoScroll(containerRef: RefObject<HTMLDivElement | null>) {
  const rafRef = useRef<number | null>(null);
  const speedRef = useRef(0);

  let isDragging = false;
  let clientOffset: { x: number; y: number } | null = null;

  try {
    // useDragLayer requires DndProvider context - wrap in try/catch for tests
    const dragState = useDragLayer((monitor: any) => ({
      isDragging: monitor.isDragging(),
      clientOffset: monitor.getClientOffset(),
    }));
    isDragging = dragState.isDragging;
    clientOffset = dragState.clientOffset;
  } catch (e) {
    // No DndProvider context (e.g., in tests) - skip auto-scroll
    return;
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!isDragging || !clientOffset || !container) {
      speedRef.current = 0;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const ZONE = 80; // px from edge triggers scroll
    const MAX = 16; // px/frame max speed
    const MIN = 2; // px/frame min speed

    const rect = container.getBoundingClientRect();
    const distRight = rect.right - clientOffset.x;
    const distLeft = clientOffset.x - rect.left;

    if (distRight < ZONE && distRight > 0) {
      const t = 1 - distRight / ZONE; // 0→1 as cursor approaches edge
      speedRef.current = MIN + t * (MAX - MIN);
    } else if (distLeft < ZONE && distLeft > 0) {
      const t = 1 - distLeft / ZONE;
      speedRef.current = -(MIN + t * (MAX - MIN));
    } else {
      speedRef.current = 0;
    }

    if (rafRef.current) return; // loop already running

    function loop() {
      if (speedRef.current !== 0 && containerRef.current) {
        containerRef.current.scrollLeft += speedRef.current;
        useTimelineStore.getState().setScrollLeft(containerRef.current.scrollLeft);
      }
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isDragging, clientOffset, containerRef]);
}
