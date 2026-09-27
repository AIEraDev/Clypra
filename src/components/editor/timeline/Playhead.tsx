import React, {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  RefObject,
} from "react";
import {
  usePlaybackClock,
  useTransportControls,
  getPlaybackClock,
} from "@/hooks/usePlaybackClock";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { snapToFrameBoundary } from "@/lib/utils/frameTime";
import { clampAndSnapProgramTime } from "@/lib/timeline/programTimelineBridge";
import {
  timelineTimeToPixel,
  timelinePixelToTime,
} from "@/lib/timeline/timelineViewport";
import {
  recordPlayheadPaint,
  recordSeekResolved,
} from "@/lib/playback/syncMetrics";
import {
  getPreviewInteractionCoordinator,
  type PreviewInteractionToken,
} from "@/core/interactions";

interface PlayheadProps {
  pixelsPerSecond: number;
  duration: number;
  containerRef: RefObject<HTMLDivElement | null>;
  rulerHeight?: number;
}

export const Playhead: React.FC<PlayheadProps> = ({
  pixelsPerSecond,
  duration,
  containerRef,
  rulerHeight = 24,
}) => {
  const clockState = usePlaybackClock();
  const {
    seek: transportSeek,
    beginScrub,
    updateScrub,
    endScrub,
  } = useTransportControls();
  const previewInteractionCoordinator = getPreviewInteractionCoordinator();
  const { setScrollLeft } = useTimelineStore();
  const [isDragging, setIsDragging] = useState(false);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const scrollVelocityRef = useRef(0);
  const pointerIdRef = useRef<number | null>(null);
  const scrubInteractionRef = useRef<PreviewInteractionToken | null>(null);
  const pointerXRef = useRef(0); // Pointer position in viewport space
  const pointerVelocityRef = useRef(0);
  const lastPointerSampleRef = useRef<{ x: number; timeMs: number } | null>(
    null,
  );
  const dragOffsetRef = useRef(0); // Offset captured at drag start for smooth anchor
  // Cached for the rAF playback-animation loop — stays current without causing re-mounts.
  const pixelsPerSecondRef = useRef(pixelsPerSecond);
  pixelsPerSecondRef.current = pixelsPerSecond;
  const clearDragCursorLock = () => {
    document.body.style.userSelect = "";
    document.body.classList.remove("cursor-lock-col");
  };

  const currentTime = clockState.time;

  // ✅ Use canonical timeToPixel helper for playhead left calculation.
  // This value drives the paused / scrub position via React state.
  const left = Math.max(0, timelineTimeToPixel(currentTime, pixelsPerSecond));

  // ── Playback animation: rAF loop at up to 60 fps ────────────────────────
  // During playback the clock subscription is deliberately throttled to 10fps
  // to avoid React render storms. The useLayoutEffect below would therefore
  // only fire ~10×/s, producing the 113ms paint-jitter observed on M1.
  // Instead, while playing, we read `getPlaybackClock().time` imperatively
  // every rAF and write `el.style.left` directly — no React re-render needed.
  useEffect(() => {
    if (clockState.state !== "playing" || isDragging) return;

    let animRafId: number;
    const loop = () => {
      const el = playheadRef.current;
      if (!el) {
        animRafId = requestAnimationFrame(loop);
        return;
      }
      const clock = getPlaybackClock();
      if (clock.state !== "playing") {
        // Playback stopped — React layoutEffect resumes position ownership.
        return;
      }
      const pos = Math.max(0, timelineTimeToPixel(clock.time, pixelsPerSecondRef.current));
      el.style.left = `${pos}px`;
      recordPlayheadPaint();
      recordSeekResolved();
      animRafId = requestAnimationFrame(loop);
    };

    animRafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRafId);
  }, [clockState.state, isDragging]);

  // ── Paused / scrub: keep DOM position in sync via React ─────────────────
  // At 10fps this is perfectly acceptable; the user cannot perceive jitter
  // when the playhead is stationary or being dragged (separate rAF loop below).
  useLayoutEffect(() => {
    if (clockState.state === "playing" && !isDragging) return;
    const el = playheadRef.current;
    if (el) el.style.left = `${left}px`;
    recordPlayheadPaint();
    recordSeekResolved();
  }, [left, pixelsPerSecond, clockState.state, isDragging]);

  // ✅ PERFORMANCE OPTIMIZED: Throttled state updates to reduce React render storms
  const lastScrollUpdateRef = useRef(0);
  const lastSeekUpdateRef = useRef(0);
  const stationaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SCROLL_THROTTLE = 33; // ~30fps (acceptable for scroll UI sync)
  const SEEK_THROTTLE = 33; // ~30fps (halves IPC/decoder interrupts on low-end GPUs)

  // ✅ Continuous loop: scroll FIRST, then derive playhead from pointer
  useEffect(() => {
    if (!isDragging) {
      scrollVelocityRef.current = 0;
      if (stationaryTimerRef.current) {
        clearTimeout(stationaryTimerRef.current);
        stationaryTimerRef.current = null;
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const tick = () => {
      const container = containerRef.current;
      if (!container) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const now = performance.now();

      // ✅ 1. Update scroll FIRST (direct DOM manipulation, throttled state update)
      const velocity = scrollVelocityRef.current;
      if (velocity !== 0) {
        const viewportWidth = container.clientWidth;
        const maxScrollLeft = Math.max(
          0,
          container.scrollWidth - viewportWidth,
        );
        const newScrollLeft = Math.max(
          0,
          Math.min(container.scrollLeft + velocity, maxScrollLeft),
        );

        // Direct DOM update (always immediate)
        container.scrollLeft = newScrollLeft;

        // Throttled state update (reduce React re-renders)
        if (now - lastScrollUpdateRef.current >= SCROLL_THROTTLE) {
          setScrollLeft(newScrollLeft);
          lastScrollUpdateRef.current = now;
        }
      }

      // ✅ 2. THEN derive playhead from pointer
      // playheadX - scrollX === pointerX (+ offset)
      const scrollX = container.scrollLeft;
      const playheadX = scrollX + pointerXRef.current + dragOffsetRef.current;

      // Convert to time and snap to frame boundary
      const rawTime = timelinePixelToTime(playheadX, pixelsPerSecond);

      // Get frameRate from project store directly, not clock state
      const frameRate = useProjectStore.getState().project?.frameRate ?? 30;

      // Only snap if frames are visually distinguishable (> 3px apart)
      // Prevents "sticky" playhead at extreme zoom-out levels
      const pixelsPerFrame = pixelsPerSecond / frameRate;
      const snappedTime =
        pixelsPerFrame > 3 ? snapToFrameBoundary(rawTime, frameRate) : rawTime;
      const newTime = clampAndSnapProgramTime(snappedTime, duration, frameRate);

      // Direct DOM update for 60fps responsive visual needle tracking while dragging
      const el = playheadRef.current;
      if (el) {
        const visualPos = Math.max(0, timelineTimeToPixel(newTime, pixelsPerSecond));
        el.style.left = `${visualPos}px`;
      }

      // Throttled scrub calls (reduce clock update frequency)
      if (now - lastSeekUpdateRef.current >= SEEK_THROTTLE) {
        updateScrub(newTime, pointerVelocityRef.current);
        lastSeekUpdateRef.current = now;

        if (stationaryTimerRef.current) {
          clearTimeout(stationaryTimerRef.current);
        }
        stationaryTimerRef.current = setTimeout(() => {
          updateScrub(newTime, 0);
        }, 150);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (stationaryTimerRef.current) {
        clearTimeout(stationaryTimerRef.current);
        stationaryTimerRef.current = null;
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [
    isDragging,
    containerRef,
    setScrollLeft,
    pixelsPerSecond,
    duration,
    transportSeek,
  ]);

  // ✅ Global pointer tracking - only updates pointer position and velocity
  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e: PointerEvent) => {
      e.preventDefault();

      const container = containerRef.current;
      if (!container) return;

      // ✅ Store pointer position in viewport space
      const viewportRect = container.getBoundingClientRect();
      pointerXRef.current = e.clientX - viewportRect.left;
      const now = performance.now();
      const previous = lastPointerSampleRef.current;
      if (previous) {
        const elapsedMs = Math.max(1, now - previous.timeMs);
        pointerVelocityRef.current =
          ((pointerXRef.current - previous.x) / elapsedMs) * 1000;
      }
      lastPointerSampleRef.current = { x: pointerXRef.current, timeMs: now };

      // ✅ Calculate auto-scroll velocity based on pointer position
      const viewportWidth = container.clientWidth;
      const scrollLeft = container.scrollLeft;
      const maxScrollLeft = Math.max(0, container.scrollWidth - viewportWidth);

      const EDGE_THRESHOLD = 80; // px from edge where auto-scroll starts
      const VELOCITY_MULTIPLIER = 0.3; // Acceleration factor

      // Calculate velocity even when pointer is OUTSIDE viewport bounds
      if (
        pointerXRef.current > viewportWidth - EDGE_THRESHOLD &&
        scrollLeft < maxScrollLeft
      ) {
        // Near or beyond right edge → scroll right
        const distance = pointerXRef.current - (viewportWidth - EDGE_THRESHOLD);
        scrollVelocityRef.current = distance * VELOCITY_MULTIPLIER;
      } else if (pointerXRef.current < EDGE_THRESHOLD && scrollLeft > 0) {
        // Near or beyond left edge → scroll left
        const distance = EDGE_THRESHOLD - pointerXRef.current;
        scrollVelocityRef.current = -distance * VELOCITY_MULTIPLIER;
      } else {
        // In safe zone → no scroll
        scrollVelocityRef.current = 0;
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (
        pointerIdRef.current !== null &&
        e.pointerId === pointerIdRef.current
      ) {
        if (stationaryTimerRef.current) {
          clearTimeout(stationaryTimerRef.current);
          stationaryTimerRef.current = null;
        }
        // The scrub stream may have been rendered at reduced quality. Re-issue
        // the final exact target via endScrub so the released playhead always settles on a
        // full-quality frame and finishes the scrub span.
        endScrub(getPlaybackClock().time);
        if (scrubInteractionRef.current) {
          previewInteractionCoordinator.commit(
            scrubInteractionRef.current,
            false,
          );
          scrubInteractionRef.current = null;
        }
        setIsDragging(false);
        scrollVelocityRef.current = 0;
        pointerIdRef.current = null;
        clearDragCursorLock();

        // Release pointer capture if it was set
        if (playheadRef.current) {
          try {
            playheadRef.current.releasePointerCapture(e.pointerId);
          } catch (err) {
            // Ignore if capture wasn't set
          }
        }
      }
    };

    const handleWindowBlur = () => {
      if (stationaryTimerRef.current) {
        clearTimeout(stationaryTimerRef.current);
        stationaryTimerRef.current = null;
      }
      // Stop drag if window loses focus
      endScrub(getPlaybackClock().time);
      setIsDragging(false);
      scrollVelocityRef.current = 0;
      pointerIdRef.current = null;
      pointerVelocityRef.current = 0;
      lastPointerSampleRef.current = null;
      clearDragCursorLock();
      if (scrubInteractionRef.current) {
        previewInteractionCoordinator.cancel(scrubInteractionRef.current);
        scrubInteractionRef.current = null;
      }
    };

    const handlePointerCancel = (e: PointerEvent) => {
      if (pointerIdRef.current !== null && e.pointerId !== pointerIdRef.current)
        return;
      if (stationaryTimerRef.current) {
        clearTimeout(stationaryTimerRef.current);
        stationaryTimerRef.current = null;
      }
      endScrub(getPlaybackClock().time);
      setIsDragging(false);
      scrollVelocityRef.current = 0;
      pointerIdRef.current = null;
      pointerVelocityRef.current = 0;
      lastPointerSampleRef.current = null;
      clearDragCursorLock();
      if (scrubInteractionRef.current) {
        previewInteractionCoordinator.cancel(scrubInteractionRef.current);
        scrubInteractionRef.current = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        endScrub(getPlaybackClock().time);
        setIsDragging(false);
        scrollVelocityRef.current = 0;
        pointerIdRef.current = null;
        pointerVelocityRef.current = 0;
        lastPointerSampleRef.current = null;
        clearDragCursorLock();
      }
    };

    // Prevent text selection during drag
    document.body.style.userSelect = "none";
    document.body.classList.add("cursor-lock-col");

    // ✅ Use GLOBAL pointer events (not element-bound)
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearDragCursorLock();
      if (stationaryTimerRef.current) {
        clearTimeout(stationaryTimerRef.current);
        stationaryTimerRef.current = null;
      }
      if (scrubInteractionRef.current) {
        previewInteractionCoordinator.cancel(scrubInteractionRef.current);
        scrubInteractionRef.current = null;
      }
      scrollVelocityRef.current = 0;
    };
  }, [isDragging, containerRef, transportSeek, previewInteractionCoordinator]);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const container = containerRef.current;
    const parent = playheadRef.current?.parentElement;
    if (!container || !parent) return;

    scrubInteractionRef.current = previewInteractionCoordinator.begin("scrub");

    // ✅ Capture pointer to receive events even outside element
    if (playheadRef.current) {
      try {
        playheadRef.current.setPointerCapture(e.pointerId);
        pointerIdRef.current = e.pointerId;
      } catch (err) {
        // Fallback to global events if capture fails
        pointerIdRef.current = e.pointerId;
      }
    }

    // ✅ Calculate drag offset to prevent snapping
    const viewportRect = container.getBoundingClientRect();
    const pointerX = e.clientX - viewportRect.left;
    const scrollX = container.scrollLeft;
    const currentPlayheadX = timelineTimeToPixel(currentTime, pixelsPerSecond);

    // Store offset: where playhead is relative to where pointer thinks it should be
    dragOffsetRef.current = currentPlayheadX - (scrollX + pointerX);
    pointerXRef.current = pointerX;
    lastPointerSampleRef.current = { x: pointerX, timeMs: performance.now() };
    pointerVelocityRef.current = 0;

    // Seek to clicked position (with offset)
    const playheadX = scrollX + pointerX + dragOffsetRef.current;
    const rawTime = timelinePixelToTime(playheadX, pixelsPerSecond);

    const frameRate = useProjectStore.getState().project?.frameRate ?? 30;

    // Only snap if frames are visually distinguishable (> 3px apart)
    const pixelsPerFrame = pixelsPerSecond / frameRate;
    const snappedTime =
      pixelsPerFrame > 3 ? snapToFrameBoundary(rawTime, frameRate) : rawTime;
    const newTime = clampAndSnapProgramTime(snappedTime, duration, frameRate);
    beginScrub(newTime, "playhead");

    setIsDragging(true);
  };

  return (
    <div
      ref={playheadRef}
      data-playhead="true"
      data-timeline-interactive="true"
      className="absolute select-none pointer-events-none"
      style={{
        // `left` is intentionally omitted from the React style object.
        // During playback it is written imperatively by the rAF animation loop
        // above to achieve 60fps position updates without React re-renders.
        // During pause/scrub the useLayoutEffect above writes it to the DOM.
        // The initial value is set there too; React never owns this property.
        top: 0,
        bottom: 0,
        width: "8px",
        marginLeft: "-4px",
        zIndex: 40,
        touchAction: "none",
      }}
      onLostPointerCapture={() => {
        setIsDragging(false);
        scrollVelocityRef.current = 0;
        pointerIdRef.current = null;
        pointerVelocityRef.current = 0;
        lastPointerSampleRef.current = null;
        clearDragCursorLock();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Visual line spanning from immediately below ruler to bottom */}
      <div
        data-playhead-line="true"
        className="absolute pointer-events-none bg-accent"
        style={{
          left: "50%",
          top: `${rulerHeight}px`, // Start below ruler
          bottom: 0,
          transform: "translateX(-50%)",
          width: "2px",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
          cursor: "default",
        }}
      />

      {/* Sticky top container for handle and ruler hit target — remains docked in ruler during vertical scroll */}
      <div
        data-playhead-handle-dock="true"
        className="sticky top-0 w-full pointer-events-none z-50"
        style={{ height: `${rulerHeight}px` }}
      >
        {/* Circle handle at top */}
        <div
          data-playhead-handle="true"
          className="absolute rounded-full pointer-events-auto bg-accent cursor-col-resize"
          onPointerDown={handlePointerDown}
          onClick={(e) => e.stopPropagation()}
          style={{
            left: "50%",
            transform: "translateX(-50%)",
            top: `${Math.max(0, Math.round((rulerHeight - 12) / 2))}px`,
            width: "12px",
            height: "12px",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
          }}
        />

        {/* Ruler-only drag hit target so playhead never steals clip trim handles */}
        <div
          data-playhead-hit-target="true"
          className="absolute left-1/2 -translate-x-1/2 pointer-events-auto cursor-col-resize"
          onPointerDown={handlePointerDown}
          onClick={(e) => e.stopPropagation()}
          style={{
            top: 0,
            width: "16px",
            height: `${rulerHeight}px`,
            background: "transparent",
          }}
        />
      </div>
    </div>
  );
};
