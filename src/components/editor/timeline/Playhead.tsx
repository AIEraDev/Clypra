import React, { useRef, useEffect, useState, RefObject } from "react";
import { usePlaybackClock, usePlaybackControls } from "@/hooks/usePlaybackClock";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { snapToFrameBoundary } from "@/lib/frameTime";

interface PlayheadProps {
  pixelsPerSecond: number;
  duration: number;
  containerRef: RefObject<HTMLDivElement | null>;
  rulerHeight?: number;
}

export const Playhead: React.FC<PlayheadProps> = ({ pixelsPerSecond, duration, containerRef, rulerHeight = 5 }) => {
  const clockState = usePlaybackClock();
  const { seek } = usePlaybackControls();
  const { setScrollLeft } = useTimelineStore();
  const [isDragging, setIsDragging] = useState(false);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const scrollVelocityRef = useRef(0);
  const pointerIdRef = useRef<number | null>(null);
  const pointerXRef = useRef(0); // Pointer position in viewport space
  const dragOffsetRef = useRef(0); // Offset captured at drag start for smooth anchor
  const clearDragCursorLock = () => {
    document.body.style.userSelect = "";
    document.body.classList.remove("cursor-lock-col");
  };

  const currentTime = clockState.time;

  // ✅ Use same pixel mapping as Timeline scroll logic (rounded to avoid subpixel issues)
  const left = Math.max(0, Math.round(currentTime * pixelsPerSecond));

  // ✅ Continuous loop: scroll FIRST, then derive playhead from pointer
  useEffect(() => {
    if (!isDragging) {
      scrollVelocityRef.current = 0;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const tick = () => {
      if (!isDragging) return;

      const container = containerRef.current;
      if (!container) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // ✅ 1. Update scroll FIRST
      const velocity = scrollVelocityRef.current;
      if (velocity !== 0) {
        const viewportWidth = container.clientWidth;
        const maxScrollLeft = Math.max(0, container.scrollWidth - viewportWidth);
        const newScrollLeft = Math.max(0, Math.min(container.scrollLeft + velocity, maxScrollLeft));

        container.scrollLeft = newScrollLeft;
        setScrollLeft(newScrollLeft);
      }

      // ✅ 2. THEN derive playhead from pointer
      // Invariant: playheadX - scrollX === pointerX (+ offset)
      const scrollX = container.scrollLeft;
      const playheadX = scrollX + pointerXRef.current + dragOffsetRef.current;

      // Convert to time and snap to frame boundary
      const rawTime = playheadX / pixelsPerSecond;
      // Get frameRate from project store directly, not clock state
      const frameRate = useProjectStore.getState().project?.frameRate ?? 30;

      // Only snap if frames are visually distinguishable (> 3px apart)
      // Prevents "sticky" playhead at extreme zoom-out levels
      const pixelsPerFrame = pixelsPerSecond / frameRate;
      const snappedTime = pixelsPerFrame > 3 ? snapToFrameBoundary(rawTime, frameRate) : rawTime;
      const newTime = Math.max(0, Math.min(snappedTime, duration));
      seek(newTime);

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isDragging, containerRef, setScrollLeft, pixelsPerSecond, duration, seek]);

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

      // ✅ Calculate auto-scroll velocity based on pointer position
      const viewportWidth = container.clientWidth;
      const scrollLeft = container.scrollLeft;
      const maxScrollLeft = Math.max(0, container.scrollWidth - viewportWidth);

      const EDGE_THRESHOLD = 80; // px from edge where auto-scroll starts
      const VELOCITY_MULTIPLIER = 0.3; // Acceleration factor

      // Calculate velocity even when pointer is OUTSIDE viewport bounds
      if (pointerXRef.current > viewportWidth - EDGE_THRESHOLD && scrollLeft < maxScrollLeft) {
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
      if (pointerIdRef.current !== null && e.pointerId === pointerIdRef.current) {
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
      // Stop drag if window loses focus
      setIsDragging(false);
      scrollVelocityRef.current = 0;
      pointerIdRef.current = null;
      clearDragCursorLock();
    };

    const handlePointerCancel = (e: PointerEvent) => {
      if (pointerIdRef.current !== null && e.pointerId !== pointerIdRef.current) return;
      setIsDragging(false);
      scrollVelocityRef.current = 0;
      pointerIdRef.current = null;
      clearDragCursorLock();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        setIsDragging(false);
        scrollVelocityRef.current = 0;
        pointerIdRef.current = null;
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
      scrollVelocityRef.current = 0;
    };
  }, [isDragging, containerRef]);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const container = containerRef.current;
    const parent = playheadRef.current?.parentElement;
    if (!container || !parent) return;

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
    const currentPlayheadX = currentTime * pixelsPerSecond;

    // Store offset: where playhead is relative to where pointer thinks it should be
    dragOffsetRef.current = currentPlayheadX - (scrollX + pointerX);
    pointerXRef.current = pointerX;

    // Seek to clicked position (with offset)
    const playheadX = scrollX + pointerX + dragOffsetRef.current;
    const rawTime = playheadX / pixelsPerSecond;
    const frameRate = useProjectStore.getState().project?.frameRate ?? 30;

    // Only snap if frames are visually distinguishable (> 3px apart)
    const pixelsPerFrame = pixelsPerSecond / frameRate;
    const snappedTime = pixelsPerFrame > 3 ? snapToFrameBoundary(rawTime, frameRate) : rawTime;
    const newTime = Math.max(0, Math.min(snappedTime, duration));
    seek(newTime);

    setIsDragging(true);
  };

  return (
    <div
      ref={playheadRef}
      data-playhead="true"
      data-timeline-interactive="true"
      className="absolute select-none pointer-events-none"
      style={{
        left: `${left}px`,
        top: 0,
        bottom: 0,
        width: "8px",
        marginLeft: "-3px",
        zIndex: 100,
        touchAction: "none",
      }}
      onLostPointerCapture={() => {
        setIsDragging(false);
        scrollVelocityRef.current = 0;
        pointerIdRef.current = null;
        clearDragCursorLock();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Visual line */}
      <div
        className="absolute pointer-events-none bg-accent"
        style={{
          left: "50%",
          top: rulerHeight, // Start below ruler
          bottom: 0,
          transform: "translateX(-50%)",
          width: "2px",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
          cursor: "default",
        }}
      />

      {/* Circle handle at top */}
      <div
        className="absolute rounded-full pointer-events-auto bg-accent cursor-col-resize"
        onPointerDown={handlePointerDown}
        onClick={(e) => e.stopPropagation()}
        style={{
          left: "50%",
          transform: "translateX(-50%)",
          top: "10px",
          width: "12px",
          height: "12px",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
        }}
      />

      {/* Ruler-only drag hit target so playhead never steals clip trim handles */}
      <div
        className="absolute left-1/2 -translate-x-1/2 pointer-events-auto cursor-col-resize"
        onPointerDown={handlePointerDown}
        onClick={(e) => e.stopPropagation()}
        style={{
          top: 0,
          width: "16px",
          height: `${Math.max(12, rulerHeight)}px`,
          background: "transparent",
        }}
      />
    </div>
  );
};
