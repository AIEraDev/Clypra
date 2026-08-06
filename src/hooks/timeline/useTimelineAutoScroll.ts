import { useEffect, useRef, RefObject } from "react";
// @ts-ignore - react-dnd types issue
import { useDragLayer } from "react-dnd";
import { useTimelineStore } from "@/store/timelineStore";

export function useTimelineAutoScroll(containerRef: RefObject<HTMLDivElement | null>) {
  const rafRef = useRef<number | null>(null);
  const speedRef = useRef(0);
  const clientXRef = useRef<number | null>(null);
  const hasDndContext = useRef(true);

  let isDragging = false;

  try {
    // useDragLayer requires DndProvider context - wrap in try/catch for tests
    const dragState = useDragLayer((monitor: any) => ({
      isDragging: monitor.isDragging(),
      clientOffset: monitor.getClientOffset(),
    }));
    isDragging = dragState.isDragging;
    // Store client X as a stable primitive instead of object reference
    clientXRef.current = dragState.clientOffset?.x ?? null;
  } catch (e) {
    // No DndProvider context (e.g., in tests) - mark as unavailable
    hasDndContext.current = false;
  }

  // Bug 2 fix: useEffect always runs (no conditional return before hooks)
  // Bug 3 fix: removed clientOffset from deps — we read from clientXRef instead
  useEffect(() => {
    // Skip if no DndProvider or not dragging
    if (!hasDndContext.current || !isDragging || clientXRef.current === null) {
      speedRef.current = 0;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const ZONE = 80; // px from edge triggers scroll
    const MAX = 16; // px/frame max speed
    const MIN = 2; // px/frame min speed

    const rect = container.getBoundingClientRect();
    const distRight = rect.right - (clientXRef.current ?? 0);
    const distLeft = (clientXRef.current ?? 0) - rect.left;

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

    // BUG-5 fix: only start loop when speed is non-zero, stop when speed drops to 0
    if (speedRef.current === 0) return;

    function loop() {
      if (speedRef.current !== 0 && containerRef.current) {
        containerRef.current.scrollLeft += speedRef.current;
        useTimelineStore.getState().setScrollLeft(containerRef.current.scrollLeft);
        rafRef.current = requestAnimationFrame(loop);
      } else {
        // Stop loop when speed is 0 (cursor in safe zone)
        rafRef.current = null;
      }
    }

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isDragging, containerRef]);
}
