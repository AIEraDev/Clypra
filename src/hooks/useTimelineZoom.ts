import { useEffect, RefObject } from "react";
import { useTimelineStore } from "@/store/timelineStore";
import { TIMELINE_MAX_PPS, TIMELINE_MIN_PPS } from "@/lib/timeline/timelineZoom";
import { getAnchoredZoomScrollLeft, getTimelineLaneClientX, getTimelineViewportEndForDuration } from "@/lib/timeline/timelineViewport";

const WHEEL_ZOOM_SENSITIVITY = 0.006;
const WHEEL_ZOOM_SPEED_MULTIPLIER = 2.5;

function normalizeWheelDeltaY(e: WheelEvent, viewportClientHeight: number): number {
  switch (e.deltaMode) {
    case WheelEvent.DOM_DELTA_LINE:
      return e.deltaY * 16;
    case WheelEvent.DOM_DELTA_PAGE:
      return e.deltaY * Math.max(1, viewportClientHeight);
    default:
      return e.deltaY;
  }
}

export function useTimelineZoom(containerRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let pendingDy = 0;
    let pendingClientX = 0;
    let rafId = 0;

    const flush = () => {
      rafId = 0;
      if (pendingDy === 0) return;

      const dy = pendingDy * WHEEL_ZOOM_SPEED_MULTIPLIER;
      pendingDy = 0;

      const oldPps = useTimelineStore.getState().pixelsPerSecond;
      const nextPps = Math.max(TIMELINE_MIN_PPS, Math.min(TIMELINE_MAX_PPS, oldPps * Math.exp(-dy * WHEEL_ZOOM_SENSITIVITY)));
      if (Math.abs(nextPps - oldPps) < 0.05) return;

      const rect = container.getBoundingClientRect();
      const state = useTimelineStore.getState();
      const hasClips = state.clips.length > 0;
      const localTimelineX = getTimelineLaneClientX(pendingClientX, rect.left, hasClips);
      const scrollLeftDom = container.scrollLeft;

      const currentDuration = state.getTimelineEndTime();
      const currentViewportEnd = getTimelineViewportEndForDuration(currentDuration);
      let anchorTime = (scrollLeftDom + localTimelineX) / oldPps;
      anchorTime = Math.max(0, Math.min(anchorTime, currentViewportEnd));

      state.setPixelsPerSecond(nextPps);

      const nextScrollLeft = getAnchoredZoomScrollLeft({
        anchorTime,
        localTimelineX,
        containerWidth: container.clientWidth,
        viewportEndSeconds: currentViewportEnd,
        nextPixelsPerSecond: nextPps,
        hasClips,
      });

      container.scrollLeft = nextScrollLeft;
      state.setScrollLeft(nextScrollLeft);
    };

    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();

      pendingDy += normalizeWheelDeltaY(e, container.clientHeight);
      pendingClientX = e.clientX;
      if (!rafId) {
        rafId = requestAnimationFrame(flush);
      }
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", onWheel);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [containerRef]);
}
