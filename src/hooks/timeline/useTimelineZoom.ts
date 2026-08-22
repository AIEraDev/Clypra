import { useEffect, RefObject } from "react";
import { useTimelineStore } from "@/store/timelineStore";
import { TIMELINE_MAX_PPS, TIMELINE_MIN_PPS } from "@/lib/timeline/timelineZoom";
import {
  getAnchoredZoomScrollLeft,
  getTimelineLaneClientX,
  getTimelineViewportEndForDuration,
} from "@/lib/timeline/timelineViewport";
import { TimelineZoomSpring, type ZoomAnchor } from "./useTimelineZoomSpring";

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

export function useTimelineZoom(containerRef: RefObject<HTMLDivElement | null>, enabled = true) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    // Spring animator — owns currentPps and drives it toward targetPps at 60fps.
    const spring = new TimelineZoomSpring(container);

    // ── Wheel / trackpad zoom ───────────────────────────────────────────────
    let pendingDy = 0;
    let pendingClientX = 0;
    let wheelRafId = 0;

    const flushWheel = () => {
      wheelRafId = 0;
      if (pendingDy === 0) return;

      const dy = pendingDy * WHEEL_ZOOM_SPEED_MULTIPLIER;
      pendingDy = 0;

      // Use the spring's current animated PPS as the base so rapid events
      // stack from wherever the animation currently is, not the last committed store value.
      const basePps = spring.getCurrentPps();
      const targetPps = Math.max(
        TIMELINE_MIN_PPS,
        Math.min(TIMELINE_MAX_PPS, basePps * Math.exp(-dy * WHEEL_ZOOM_SENSITIVITY)),
      );
      if (Math.abs(targetPps - basePps) < 0.05) return;

      const rect = container.getBoundingClientRect();
      const state = useTimelineStore.getState();
      const hasClips = state.clips.length > 0;
      const localTimelineX = getTimelineLaneClientX(pendingClientX, rect.left, hasClips);

      const viewportEndSeconds = getTimelineViewportEndForDuration(state.getTimelineEndTime());
      // Anchor: the time-point under the cursor stays visually fixed during animation.
      let anchorTime = (container.scrollLeft + localTimelineX) / basePps;
      anchorTime = Math.max(0, Math.min(anchorTime, viewportEndSeconds));

      const anchor: ZoomAnchor = {
        anchorTime,
        localTimelineX,
        containerWidth: container.clientWidth,
        viewportEndSeconds,
        hasClips,
      };

      spring.setTarget(targetPps, anchor);
    };

    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();

      pendingDy += normalizeWheelDeltaY(e, container.clientHeight);
      pendingClientX = e.clientX;
      if (!wheelRafId) {
        wheelRafId = requestAnimationFrame(flushWheel);
      }
    };

    // ── Pinch-to-zoom touch gesture ─────────────────────────────────────────
    let initialDist = 0;
    let initialPps = 0;
    let initialMidpointX = 0;
    let isPinching = false;
    // Track the PPS from the previous touchmove to estimate velocity for inertia.
    let prevPps = 0;
    let pinchAnchor: ZoomAnchor | null = null;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        isPinching = true;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        initialDist = Math.sqrt(dx * dx + dy * dy);
        initialPps = useTimelineStore.getState().pixelsPerSecond;
        prevPps = initialPps;
        initialMidpointX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isPinching || e.touches.length !== 2) return;
      e.preventDefault();

      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const currentDist = Math.sqrt(dx * dx + dy * dy);
      if (initialDist === 0) return;

      const scale = currentDist / initialDist;
      const nextPps = Math.max(TIMELINE_MIN_PPS, Math.min(TIMELINE_MAX_PPS, initialPps * scale));

      const rect = container.getBoundingClientRect();
      const state = useTimelineStore.getState();
      const hasClips = state.clips.length > 0;
      const localTimelineX = getTimelineLaneClientX(initialMidpointX, rect.left, hasClips);

      const viewportEndSeconds = getTimelineViewportEndForDuration(state.getTimelineEndTime());
      let anchorTime = (container.scrollLeft + localTimelineX) / state.pixelsPerSecond;
      anchorTime = Math.max(0, Math.min(anchorTime, viewportEndSeconds));

      pinchAnchor = {
        anchorTime,
        localTimelineX,
        containerWidth: container.clientWidth,
        viewportEndSeconds,
        hasClips,
      };

      // Record previous pps before applying so touchend can compute velocity.
      prevPps = state.pixelsPerSecond;

      // Pinch is applied immediately (direct gesture — no spring during active pinch).
      state.setPixelsPerSecond(nextPps);

      const nextScrollLeft = getAnchoredZoomScrollLeft({
        anchorTime,
        localTimelineX,
        containerWidth: container.clientWidth,
        viewportEndSeconds,
        nextPixelsPerSecond: nextPps,
        hasClips,
      });

      state.setScrollLeft(nextScrollLeft);
      container.scrollLeft = nextScrollLeft;
    };

    const onTouchEnd = () => {
      if (!isPinching) return;
      isPinching = false;

      // Launch inertia from the velocity observed in the last touchmove pair.
      if (pinchAnchor) {
        const currentPps = useTimelineStore.getState().pixelsPerSecond;
        // Fractional velocity: what fraction of PPS changed in the last frame?
        const velocity = prevPps > 0 ? (currentPps - prevPps) / prevPps : 0;
        spring.startInertia(velocity, pinchAnchor);
      }

      initialDist = 0;
      pinchAnchor = null;
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: true });
    container.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchEnd);
      if (wheelRafId) cancelAnimationFrame(wheelRafId);
      spring.dispose();
    };
  }, [containerRef, enabled]);
}
