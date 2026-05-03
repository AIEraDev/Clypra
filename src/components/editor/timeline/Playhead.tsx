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

  // ✅ Use same pixel mapping as Timeline scroll logic (rounded to avoid subpixel issues)
  const left = Math.max(0, Math.round(currentTime * pixelsPerSecond));

  useEffect(() => {
    if (!isDragging) {
      // Cancel any ongoing auto-scroll animation
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault(); // Prevent text selection

      const container = containerRef.current;
      const parent = playheadRef.current?.parentElement;
      if (!parent || !container) return;

      // Get mouse position relative to the timeline content
      const rect = parent.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const newTime = Math.max(0, Math.min(x / pixelsPerSecond, duration));
      seek(newTime);

      // Auto-scroll logic: scroll when playhead approaches viewport edges
      const viewportRect = container.getBoundingClientRect();
      const mouseXInViewport = e.clientX - viewportRect.left;
      const viewportWidth = container.clientWidth;
      const scrollLeft = container.scrollLeft;
      const maxScrollLeft = Math.max(0, container.scrollWidth - viewportWidth);

      const EDGE_ZONE = 80; // px from edge to trigger scroll
      const SCROLL_SPEED_MIN = 2; // px per frame
      const SCROLL_SPEED_MAX = 20; // px per frame

      let scrollSpeed = 0;

      // Check if mouse is near right edge
      const distFromRight = viewportWidth - mouseXInViewport;
      if (distFromRight < EDGE_ZONE && distFromRight > 0 && scrollLeft < maxScrollLeft) {
        const t = 1 - distFromRight / EDGE_ZONE; // 0→1 as cursor approaches edge
        scrollSpeed = SCROLL_SPEED_MIN + t * (SCROLL_SPEED_MAX - SCROLL_SPEED_MIN);
      }
      // Check if mouse is near left edge
      else if (mouseXInViewport < EDGE_ZONE && mouseXInViewport > 0 && scrollLeft > 0) {
        const t = 1 - mouseXInViewport / EDGE_ZONE;
        scrollSpeed = -(SCROLL_SPEED_MIN + t * (SCROLL_SPEED_MAX - SCROLL_SPEED_MIN));
      }

      // Apply scroll if needed
      if (scrollSpeed !== 0) {
        if (!rafRef.current) {
          const scroll = () => {
            if (!container) return;

            const newScrollLeft = Math.max(0, Math.min(container.scrollLeft + scrollSpeed, maxScrollLeft));
            container.scrollLeft = newScrollLeft;
            setScrollLeft(newScrollLeft);

            rafRef.current = requestAnimationFrame(scroll);
          };
          rafRef.current = requestAnimationFrame(scroll);
        }
      } else {
        // Stop scrolling if not in edge zone
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.userSelect = ""; // Re-enable text selection
      document.body.classList.remove("cursor-lock-ew");

      // Cancel auto-scroll animation
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    // Prevent text selection during drag
    document.body.style.userSelect = "none";
    document.body.classList.add("cursor-lock-ew");

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.classList.remove("cursor-lock-ew");

      // Cancel auto-scroll animation on cleanup
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isDragging, duration, pixelsPerSecond, seek, containerRef, setScrollLeft]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const parent = playheadRef.current?.parentElement;
    if (parent) {
      const rect = parent.getBoundingClientRect();
      const x = e.clientX - rect.left;
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
      }}
      onMouseDown={handleMouseDown}
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
