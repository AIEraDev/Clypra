import React, { useRef, useEffect, useState, RefObject } from "react";
import { usePlaybackStore } from "../../../store/playbackStore";
import { useTimelineStore } from "../../../store/timelineStore";

interface PlayheadProps {
  pixelsPerSecond: number;
  duration: number;
  containerRef: RefObject<HTMLDivElement | null>;
}

export const Playhead: React.FC<PlayheadProps> = ({ pixelsPerSecond, duration, containerRef }) => {
  const { currentTime, seek } = usePlaybackStore();
  const { setScrollLeft } = useTimelineStore();
  const [isDragging, setIsDragging] = useState(false);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const scrollVelocityRef = useRef(0);
  const pointerIdRef = useRef<number | null>(null);

  // ✅ Use same pixel mapping as Timeline scroll logic (rounded to avoid subpixel issues)
  const left = Math.max(0, Math.round(currentTime * pixelsPerSecond));

  // ✅ Continuous auto-scroll loop (runs independently of pointer events)
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

      const velocity = scrollVelocityRef.current;
      if (velocity !== 0) {
        const viewportWidth = container.clientWidth;
        const maxScrollLeft = Math.max(0, container.scrollWidth - viewportWidth);
        const newScrollLeft = Math.max(0, Math.min(container.scrollLeft + velocity, maxScrollLeft));

        container.scrollLeft = newScrollLeft;
        setScrollLeft(newScrollLeft);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isDragging, containerRef, setScrollLeft]);

  // ✅ Global pointer tracking (works even when pointer leaves timeline)
  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e: PointerEvent) => {
      e.preventDefault();

      const container = containerRef.current;
      const parent = playheadRef.current?.parentElement;
      if (!parent || !container) return;

      // Update playhead position based on pointer
      const rect = parent.getBoundingClientRect();
      const x = e.clientX - rect.left + container.scrollLeft;
      const newTime = Math.max(0, Math.min(x / pixelsPerSecond, duration));
      seek(newTime);

      // ✅ Calculate auto-scroll velocity based on pointer position relative to VIEWPORT
      const viewportRect = container.getBoundingClientRect();
      const pointerXInViewport = e.clientX - viewportRect.left;
      const viewportWidth = container.clientWidth;
      const scrollLeft = container.scrollLeft;
      const maxScrollLeft = Math.max(0, container.scrollWidth - viewportWidth);

      const EDGE_THRESHOLD = 80; // px from edge where auto-scroll starts
      const VELOCITY_MULTIPLIER = 0.3; // Acceleration factor

      // ✅ Calculate velocity even when pointer is OUTSIDE viewport bounds
      if (pointerXInViewport > viewportWidth - EDGE_THRESHOLD && scrollLeft < maxScrollLeft) {
        // Near or beyond right edge → scroll right
        const distance = pointerXInViewport - (viewportWidth - EDGE_THRESHOLD);
        scrollVelocityRef.current = distance * VELOCITY_MULTIPLIER;
      } else if (pointerXInViewport < EDGE_THRESHOLD && scrollLeft > 0) {
        // Near or beyond left edge → scroll left
        const distance = EDGE_THRESHOLD - pointerXInViewport;
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
        document.body.style.userSelect = "";
        document.body.classList.remove("cursor-lock-ew");

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
      document.body.style.userSelect = "";
      document.body.classList.remove("cursor-lock-ew");
    };

    // Prevent text selection during drag
    document.body.style.userSelect = "none";
    document.body.classList.add("cursor-lock-ew");

    // ✅ Use GLOBAL pointer events (not element-bound)
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("blur", handleWindowBlur);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.classList.remove("cursor-lock-ew");
      scrollVelocityRef.current = 0;
    };
  }, [isDragging, duration, pixelsPerSecond, seek, containerRef, setScrollLeft]);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

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

    // Seek to clicked position
    const parent = playheadRef.current?.parentElement;
    const container = containerRef.current;
    if (parent && container) {
      const rect = parent.getBoundingClientRect();
      const x = e.clientX - rect.left + container.scrollLeft;
      const newTime = Math.max(0, Math.min(x / pixelsPerSecond, duration));
      seek(newTime);
    }

    setIsDragging(true);
  };

  return (
    <div
      ref={playheadRef}
      data-playhead="true"
      data-timeline-interactive="true"
      className={`absolute inset-y-0 select-none cursor-timeline-ew ${isDragging ? "cursor-timeline-ew-grabbing" : ""}`}
      style={{
        left: `${left}px`,
        width: "8px",
        marginLeft: "-3px",
        zIndex: 100,
        touchAction: "none", // Prevent default touch behaviors
      }}
      onPointerDown={handlePointerDown}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Visual line */}
      <div
        className="absolute inset-y-0 left-1/2 -translate-x-1/2 pointer-events-none"
        style={{
          width: "2px",
          backgroundColor: "#6c63ff",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
        }}
      />

      {/* Circle handle at top */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          left: "50%",
          transform: "translateX(-50%)",
          top: "2px",
          width: "10px",
          height: "10px",
          backgroundColor: "#6c63ff",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
        }}
      />
    </div>
  );
};
