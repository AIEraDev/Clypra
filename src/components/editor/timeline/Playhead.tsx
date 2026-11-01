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
import {
  snapToFrameBoundary,
  getFrameIndexAtTime,
} from "@/lib/utils/frameTime";
import { clampAndSnapProgramTime } from "@/lib/timeline/programTimelineBridge";
import { findKeyframeSnap } from "@/lib/timeline/snapTargets";
import {
  collectPlayheadSnapTargets,
  evaluatePlayheadSnap,
  type PlayheadSnapTarget,
} from "@/lib/timeline/playheadSnapEngine";
import {
  timelineTimeToPixel,
  timelinePixelToTime,
  TIMELINE_CLIP_START_OFFSET_PX,
  TIMELINE_TRACK_LABEL_WIDTH_PX,
} from "@/lib/timeline/timelineViewport";
import {
  recordPlayheadPaint,
  recordSeekResolved,
  resetPlayheadPaintTracking,
} from "@/lib/playback/syncMetrics";
import { timelineZoomTelemetry } from "@/lib/timeline/timelineZoomTelemetry";
import {
  getPreviewInteractionCoordinator,
  type PreviewInteractionToken,
} from "@/core/interactions";

interface PlayheadProps {
  pixelsPerSecond: number;
  duration: number;
  containerRef: RefObject<HTMLDivElement | null>;
  rulerHeight?: number;
  startOffset?: number;
}

/** Threshold in CSS px per frame above which the current-frame cell in the ruler becomes visible. */
export const PLAYHEAD_FRAME_CELL_MIN_PX_PER_FRAME = 75;

export interface PlayheadFrameCellLayout {
  left: number;
  width: number;
  currentFrame: number;
}

/**
 * Compute current frame cell bounds for the ruler header row.
 * Uses Clypra's canonical getFrameIndexAtTime() to ensure 100% frame ownership parity
 * with NativeProgramPreview and the video compositing pipeline.
 */
export function getPlayheadFrameCellLayout(
  time: number,
  pixelsPerSecond: number,
  frameRate: number,
  startOffset: number = TIMELINE_CLIP_START_OFFSET_PX,
): PlayheadFrameCellLayout {
  const isTelemetryActive = timelineZoomTelemetry.isEnabled();
  const t0 = isTelemetryActive ? performance.now() : 0;
  const safeFps = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  const safePps =
    Number.isFinite(pixelsPerSecond) && pixelsPerSecond > 0 ? pixelsPerSecond : 50;
  const safeTime = Number.isFinite(time) && !isNaN(time) ? Math.max(0, time) : 0;
  const currentFrame = getFrameIndexAtTime(safeTime, safeFps);
  const frameLeft = Math.round((currentFrame * safePps) / safeFps) + startOffset;
  const frameRight =
    Math.round(((currentFrame + 1) * safePps) / safeFps) + startOffset;
  const layout = {
    left: Math.max(0, frameLeft),
    width: Math.max(1, frameRight - frameLeft),
    currentFrame,
  };
  if (isTelemetryActive) {
    const durationUs = Math.round((performance.now() - t0) * 1000);
    const expectedFrame = getFrameIndexAtTime(safeTime, safeFps);
    const mismatch = currentFrame !== expectedFrame;
    timelineZoomTelemetry.recordFrameCellUpdate(durationUs, mismatch);
  }
  return layout;
}

export const Playhead: React.FC<PlayheadProps> = ({
  pixelsPerSecond,
  duration,
  containerRef,
  rulerHeight = 24,
  startOffset = TIMELINE_CLIP_START_OFFSET_PX,
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
  const projectFrameRate = useProjectStore((state) => state.project?.frameRate);
  const frameRate =
    projectFrameRate && projectFrameRate > 0 ? projectFrameRate : 30;

  const showFrameCell =
    pixelsPerSecond / frameRate >= PLAYHEAD_FRAME_CELL_MIN_PX_PER_FRAME;

  useEffect(() => {
    timelineZoomTelemetry.recordFrameCellMount(showFrameCell);
  }, [showFrameCell]);

  const [isDragging, setIsDragging] = useState(false);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const frameCellRef = useRef<HTMLDivElement | null>(null);
  const showFrameCellRef = useRef(showFrameCell);
  showFrameCellRef.current = showFrameCell;
  const frameRateRef = useRef(frameRate);
  frameRateRef.current = frameRate;
  const startOffsetRef = useRef(startOffset);
  startOffsetRef.current = startOffset;
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
  const lastSnapGuideTimeRef = useRef<number | null>(null);
  const lastSnapGuideTypeRef = useRef<string | null>(null);
  const cachedSnapTargetsRef = useRef<PlayheadSnapTarget[]>([]);
  const currentSnappedTargetRef = useRef<PlayheadSnapTarget | null>(null);
  const anchorPointerPxRef = useRef<number | null>(null);
  const bypassModifierRef = useRef<boolean>(false);
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
  const frameCellLayout = getPlayheadFrameCellLayout(
    currentTime,
    pixelsPerSecond,
    frameRate,
    startOffset,
  );

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

      const cellEl = frameCellRef.current;
      if (cellEl && showFrameCellRef.current) {
        const cellLayout = getPlayheadFrameCellLayout(
          clock.time,
          pixelsPerSecondRef.current,
          frameRateRef.current,
          startOffsetRef.current,
        );
        cellEl.style.left = `${cellLayout.left}px`;
        cellEl.style.width = `${cellLayout.width}px`;
      }

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

    const cellEl = frameCellRef.current;
    if (cellEl && showFrameCell) {
      const cellLayout = getPlayheadFrameCellLayout(
        currentTime,
        pixelsPerSecond,
        frameRate,
        startOffset,
      );
      cellEl.style.left = `${cellLayout.left}px`;
      cellEl.style.width = `${cellLayout.width}px`;
    }

    resetPlayheadPaintTracking();
    recordSeekResolved();
  }, [
    left,
    pixelsPerSecond,
    clockState.state,
    isDragging,
    showFrameCell,
    currentTime,
    frameRate,
    startOffset,
  ]);

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

      // Convert to time and evaluate magnetic snapping across all timeline features
      const rawTime = timelinePixelToTime(playheadX, pixelsPerSecond);

      // Get frameRate from project store directly, not clock state
      const frameRate = useProjectStore.getState().project?.frameRate ?? 30;
      const timelineState = useTimelineStore.getState();
      const snapEnabled = timelineState.snapEnabled;

      const snapResult = evaluatePlayheadSnap({
        candidateTime: rawTime,
        pointerPx: playheadX,
        currentSnappedTarget: currentSnappedTargetRef.current,
        anchorPointerPx: anchorPointerPxRef.current,
        snapTargets: cachedSnapTargetsRef.current,
        pixelsPerSecond,
        snapEnabled,
        bypassModifier: bypassModifierRef.current,
      });

      let newTime: number;
      if (snapResult.snapped && snapResult.activeTarget) {
        currentSnappedTargetRef.current = snapResult.activeTarget;
        anchorPointerPxRef.current = snapResult.anchorPointerPx;
        newTime = Math.max(0, Math.min(snapResult.time, duration));

        if (
          lastSnapGuideTimeRef.current !== snapResult.time ||
          lastSnapGuideTypeRef.current !== snapResult.guide?.type
        ) {
          lastSnapGuideTimeRef.current = snapResult.time;
          lastSnapGuideTypeRef.current = snapResult.guide?.type ?? "clip-start";
          timelineState.setSnapGuides(
            snapResult.guide ? [snapResult.guide] : [],
          );
        }
      } else {
        currentSnappedTargetRef.current = null;
        anchorPointerPxRef.current = null;
        if (lastSnapGuideTimeRef.current !== null) {
          lastSnapGuideTimeRef.current = null;
          lastSnapGuideTypeRef.current = null;
          timelineState.clearSnapGuides();
        }
        // Only snap if frames are visually distinguishable (> 3px apart)
        // Prevents "sticky" playhead at extreme zoom-out levels
        const pixelsPerFrame = pixelsPerSecond / frameRate;
        const snappedTime =
          pixelsPerFrame > 3 ? snapToFrameBoundary(rawTime, frameRate) : rawTime;
        newTime = clampAndSnapProgramTime(snappedTime, duration, frameRate);
      }

      // Direct DOM update for 60fps responsive visual needle tracking while dragging
      const el = playheadRef.current;
      if (el) {
        const visualPos = Math.max(0, timelineTimeToPixel(newTime, pixelsPerSecond));
        el.style.left = `${visualPos}px`;
      }

      const cellEl = frameCellRef.current;
      if (cellEl && showFrameCellRef.current) {
        const cellLayout = getPlayheadFrameCellLayout(
          newTime,
          pixelsPerSecond,
          frameRate,
          startOffsetRef.current,
        );
        cellEl.style.left = `${cellLayout.left}px`;
        cellEl.style.width = `${cellLayout.width}px`;
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
      if (lastSnapGuideTimeRef.current !== null) {
        lastSnapGuideTimeRef.current = null;
        useTimelineStore.getState().clearSnapGuides();
      }
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

      // ✅ Store pointer position in viewport space & update modifier bypass state
      const viewportRect = container.getBoundingClientRect();
      pointerXRef.current = e.clientX - viewportRect.left;
      bypassModifierRef.current = e.metaKey || e.ctrlKey;
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
      const hasClips = useTimelineStore.getState().clips.length > 0;
      const leftBoundary = hasClips ? TIMELINE_TRACK_LABEL_WIDTH_PX : 0;
      const leftThreshold = leftBoundary + EDGE_THRESHOLD;

      // Calculate velocity even when pointer is OUTSIDE viewport bounds
      if (
        pointerXRef.current > viewportWidth - EDGE_THRESHOLD &&
        scrollLeft < maxScrollLeft
      ) {
        // Near or beyond right edge → scroll right
        const distance = pointerXRef.current - (viewportWidth - EDGE_THRESHOLD);
        scrollVelocityRef.current = distance * VELOCITY_MULTIPLIER;
      } else if (pointerXRef.current < leftThreshold && scrollLeft > 0) {
        // Near or beyond left edge of clips lane → scroll left
        const distance = leftThreshold - pointerXRef.current;
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
        currentSnappedTargetRef.current = null;
        anchorPointerPxRef.current = null;
        cachedSnapTargetsRef.current = [];
        bypassModifierRef.current = false;
        if (lastSnapGuideTimeRef.current !== null) {
          lastSnapGuideTimeRef.current = null;
          lastSnapGuideTypeRef.current = null;
          useTimelineStore.getState().clearSnapGuides();
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
        currentSnappedTargetRef.current = null;
        anchorPointerPxRef.current = null;
        cachedSnapTargetsRef.current = [];
        bypassModifierRef.current = false;
        if (lastSnapGuideTimeRef.current !== null) {
          lastSnapGuideTimeRef.current = null;
          lastSnapGuideTypeRef.current = null;
          useTimelineStore.getState().clearSnapGuides();
        }
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
    const timelineState = useTimelineStore.getState();
    const snapEnabled = timelineState.snapEnabled;

    bypassModifierRef.current = e.metaKey || e.ctrlKey;
    cachedSnapTargetsRef.current = collectPlayheadSnapTargets({
      clips: timelineState.clips,
      tracks: timelineState.tracks,
      markers: timelineState.markers,
      transitions: timelineState.transitions,
      gaps: timelineState.gaps,
      captionTracks: timelineState.captionTracks,
      duration,
    });
    currentSnappedTargetRef.current = null;
    anchorPointerPxRef.current = null;

    const snapResult = evaluatePlayheadSnap({
      candidateTime: rawTime,
      pointerPx: playheadX,
      currentSnappedTarget: null,
      anchorPointerPx: null,
      snapTargets: cachedSnapTargetsRef.current,
      pixelsPerSecond,
      snapEnabled,
      bypassModifier: bypassModifierRef.current,
    });

    let newTime: number;
    if (snapResult.snapped && snapResult.activeTarget) {
      currentSnappedTargetRef.current = snapResult.activeTarget;
      anchorPointerPxRef.current = snapResult.anchorPointerPx;
      newTime = Math.max(0, Math.min(snapResult.time, duration));
      lastSnapGuideTimeRef.current = snapResult.time;
      lastSnapGuideTypeRef.current = snapResult.guide?.type ?? "clip-start";
      timelineState.setSnapGuides(
        snapResult.guide ? [snapResult.guide] : [],
      );
    } else {
      currentSnappedTargetRef.current = null;
      anchorPointerPxRef.current = null;
      lastSnapGuideTimeRef.current = null;
      lastSnapGuideTypeRef.current = null;
      timelineState.clearSnapGuides();
      // Only snap if frames are visually distinguishable (> 3px apart)
      const pixelsPerFrame = pixelsPerSecond / frameRate;
      const snappedTime =
        pixelsPerFrame > 3 ? snapToFrameBoundary(rawTime, frameRate) : rawTime;
      newTime = clampAndSnapProgramTime(snappedTime, duration, frameRate);
    }
    beginScrub(newTime, "playhead");

    setIsDragging(true);

    const cellEl = frameCellRef.current;
    if (cellEl && showFrameCellRef.current) {
      const cellLayout = getPlayheadFrameCellLayout(
        newTime,
        pixelsPerSecond,
        frameRate,
        startOffsetRef.current,
      );
      cellEl.style.left = `${cellLayout.left}px`;
      cellEl.style.width = `${cellLayout.width}px`;
    }
  };

  return (
    <>
      {showFrameCell && (
        <div
          ref={frameCellRef}
          data-playhead-frame-cell="true"
          className="absolute select-none pointer-events-none bg-white/10 border border-white/20 rounded-[2px]"
          style={{
            top: 0,
            height: `${rulerHeight}px`,
            left: `${frameCellLayout.left}px`,
            width: `${frameCellLayout.width}px`,
            zIndex: 35,
            boxSizing: "border-box",
          }}
        />
      )}
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
        currentSnappedTargetRef.current = null;
        anchorPointerPxRef.current = null;
        cachedSnapTargetsRef.current = [];
        bypassModifierRef.current = false;
        if (lastSnapGuideTimeRef.current !== null) {
          lastSnapGuideTimeRef.current = null;
          lastSnapGuideTypeRef.current = null;
          useTimelineStore.getState().clearSnapGuides();
        }
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
  </>
  );
};
