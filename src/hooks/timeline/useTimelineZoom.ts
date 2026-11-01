import { useEffect, useRef, RefObject } from "react";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import {
  calculateDiscreteWheelZoomTarget,
  clampTimelinePixelsPerSecond,
  getTimelineMaxPps,
  TIMELINE_MAX_PPS,
  TIMELINE_MIN_PPS,
} from "@/lib/timeline/timelineZoom";
import {
  TIMELINE_CLIP_START_OFFSET_PX,
  getAnchoredZoomScrollLeft,
  getTimelineLaneClientX,
  getTimelineViewportEndForDuration,
} from "@/lib/timeline/timelineViewport";
import { TimelineZoomSpring, type ZoomAnchor } from "./useTimelineZoomSpring";
import { filmstripTelemetry } from "@/lib/filmstrip/filmstripTelemetry";
import { timelineZoomTelemetry } from "@/lib/timeline/timelineZoomTelemetry";

const WHEEL_ZOOM_SENSITIVITY = 0.006;
const WHEEL_ZOOM_SPEED_MULTIPLIER = 2.5;

function normalizeWheelDeltaY(
  e: WheelEvent,
  viewportClientHeight: number,
): number {
  switch (e.deltaMode) {
    case WheelEvent.DOM_DELTA_LINE:
      return e.deltaY * 16;
    case WheelEvent.DOM_DELTA_PAGE:
      return e.deltaY * Math.max(1, viewportClientHeight);
    default:
      return e.deltaY;
  }
}

export function useTimelineZoom(
  containerRef: RefObject<HTMLDivElement | null>,
  enabled = true,
  sequenceDuration?: number,
) {
  const sequenceDurationRef = useRef(sequenceDuration);
  sequenceDurationRef.current = sequenceDuration;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    // Spring animator — owns currentPps and drives it toward targetPps at 60fps.
    const spring = new TimelineZoomSpring(container);

    // ── Wheel / trackpad zoom ───────────────────────────────────────────────
    let pendingDy = 0;
    let pendingNotches = 0;
    let pendingClientX = 0;
    let wheelRafId = 0;
    let zoomSettleTimer: ReturnType<typeof setTimeout> | null = null;

    const noteZoomInput = (isModifierZoom: boolean, isOverRuler: boolean) => {
      const inputKind = isOverRuler ? "wheel_ruler" : "wheel_modifier";
      const currentPps = spring.getCurrentPps();
      const gestureId = timelineZoomTelemetry.beginGesture(
        inputKind,
        currentPps,
      );
      filmstripTelemetry.beginZoomGesture(gestureId);
      if (zoomSettleTimer) clearTimeout(zoomSettleTimer);
      // The spring converges in roughly 120ms. This leaves enough room for its
      // final frames while grouping a continuous wheel/trackpad gesture once.
      zoomSettleTimer = setTimeout(() => {
        zoomSettleTimer = null;
        if (spring.isIdle()) {
          filmstripTelemetry.endZoomGesture();
          timelineZoomTelemetry.endGesture(spring.getCurrentPps());
        }
      }, 300);
    };

    const flushWheel = () => {
      wheelRafId = 0;
      if (pendingNotches === 0 && pendingDy === 0) return;

      const frameRate = useProjectStore.getState().project?.frameRate ?? 30;
      const effectiveDuration =
        sequenceDurationRef.current ??
        useProjectStore.getState().project?.duration;
      const maxPps = getTimelineMaxPps(frameRate, effectiveDuration);

      // Stack onto the spring's target PPS so rapid notches compound without loss
      const basePps = spring.getTargetPps();
      let targetPps: number;

      if (pendingNotches !== 0) {
        const notches = pendingNotches;
        pendingNotches = 0;
        pendingDy = 0;
        targetPps = calculateDiscreteWheelZoomTarget(
          basePps,
          notches,
          frameRate,
          effectiveDuration,
        );
        if (notches < 0 && targetPps > basePps + 0.01) {
          timelineZoomTelemetry.recordInvariant("zoom_out_raised_pps");
        }
      } else {
        const dy = pendingDy * WHEEL_ZOOM_SPEED_MULTIPLIER;
        pendingDy = 0;
        const exponent = Math.max(
          -0.22,
          Math.min(0.22, -dy * WHEEL_ZOOM_SENSITIVITY),
        );
        // allowOverviewFloor must stay false so continuous trackpad zoom-out
        // stops at TIMELINE_MIN_PPS, matching the zoom-button floor.
        targetPps = clampTimelinePixelsPerSecond(
          basePps * Math.exp(exponent),
          false,
          frameRate,
          effectiveDuration,
        );
      }

      if (targetPps < 0.000001 - 0.01 || targetPps > maxPps + 0.01) {
        timelineZoomTelemetry.recordInvariant("pps_out_of_bounds");
      }

      if (Math.abs(targetPps - basePps) < 0.05) return;

      const rect = container.getBoundingClientRect();
      const state = useTimelineStore.getState();
      const hasClips = state.clips.length > 0;
      const localTimelineX = getTimelineLaneClientX(
        pendingClientX,
        rect.left,
        hasClips,
      );

      const viewportEndSeconds = getTimelineViewportEndForDuration(
        state.getTimelineEndTime(),
      );
      // Anchor: the time-point currently under the cursor stays fixed
      const currentAnimatedPps = spring.getCurrentPps();
      let anchorTime =
        (container.scrollLeft +
          localTimelineX -
          TIMELINE_CLIP_START_OFFSET_PX) /
        currentAnimatedPps;
      anchorTime = Math.max(0, Math.min(anchorTime, viewportEndSeconds));

      const anchor: ZoomAnchor = {
        anchorTime,
        localTimelineX,
        containerWidth: container.clientWidth,
        viewportEndSeconds,
        hasClips,
      };

      spring.setTarget(targetPps, anchor, true);
    };

    const onWheel = (e: WheelEvent) => {
      const isModifierZoom = e.ctrlKey || e.metaKey;
      const targetElement = e.target as HTMLElement | null;
      const isOverRuler = Boolean(
        targetElement?.closest(
          "[data-timeline-ruler], [data-timeline-ruler-header]",
        ),
      );

      // Plain wheel over tracks retains native scroll; zooms if modifier is held OR over ruler (D3)
      if (!isModifierZoom && !isOverRuler) return;
      e.preventDefault();
      noteZoomInput(isModifierZoom, isOverRuler);

      const isDiscrete =
        e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || Math.abs(e.deltaY) >= 4;
      const modifier = isOverRuler ? "ruler" : "modifier";

      timelineZoomTelemetry.recordWheel(
        e.deltaY,
        e.deltaMode,
        isDiscrete,
        modifier,
      );

      if (isDiscrete) {
        pendingNotches += e.deltaY < 0 ? 1 : -1;
      } else {
        pendingDy += normalizeWheelDeltaY(e, container.clientHeight);
      }
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
        const currentPps = useTimelineStore.getState().pixelsPerSecond;
        const gestureId = timelineZoomTelemetry.beginGesture(
          "pinch",
          currentPps,
        );
        filmstripTelemetry.beginZoomGesture(gestureId);
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
      const frameRate = useProjectStore.getState().project?.frameRate ?? 30;
      const effectiveDuration =
        sequenceDurationRef.current ??
        useProjectStore.getState().project?.duration;
      const nextPps = clampTimelinePixelsPerSecond(
        initialPps * scale,
        false,
        frameRate,
        effectiveDuration,
      );

      const rect = container.getBoundingClientRect();
      const state = useTimelineStore.getState();
      const hasClips = state.clips.length > 0;
      const localTimelineX = getTimelineLaneClientX(
        initialMidpointX,
        rect.left,
        hasClips,
      );

      const viewportEndSeconds = getTimelineViewportEndForDuration(
        state.getTimelineEndTime(),
      );
      let anchorTime =
        (container.scrollLeft +
          localTimelineX -
          TIMELINE_CLIP_START_OFFSET_PX) /
        state.pixelsPerSecond;
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
      if (zoomSettleTimer) clearTimeout(zoomSettleTimer);
      filmstripTelemetry.endZoomGesture();
      timelineZoomTelemetry.endGesture(spring.getCurrentPps());
      spring.dispose();
    };
  }, [containerRef, enabled]);
}
