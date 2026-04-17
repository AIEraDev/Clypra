/**
 * ScreenReaderAnnouncer Component
 * Provides ARIA live region for announcing timeline state changes to screen readers
 */

import { useEffect, useRef } from "react";
import { useTimelineStore } from "../store/timelineStore";
import { formatTime } from "../utils/timeFormat";

/**
 * Hook to announce messages to screen readers
 */
export function useScreenReaderAnnouncement() {
  const announcementRef = useRef<string>("");
  const timeoutRef = useRef<number | null>(null);

  const announce = (message: string, priority: "polite" | "assertive" = "polite") => {
    // Clear any pending announcement
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Update announcement
    announcementRef.current = message;

    // Dispatch custom event for the announcer component to pick up
    const event = new CustomEvent("screenReaderAnnounce", {
      detail: { message, priority },
    });
    window.dispatchEvent(event);

    // Clear announcement after a delay to allow for new announcements
    timeoutRef.current = setTimeout(() => {
      announcementRef.current = "";
    }, 1000);
  };

  return { announce };
}

/**
 * ScreenReaderAnnouncer component
 * Renders ARIA live regions for screen reader announcements
 */
export function ScreenReaderAnnouncer() {
  const politeRef = useRef<HTMLDivElement>(null);
  const assertiveRef = useRef<HTMLDivElement>(null);
  const playhead = useTimelineStore((state) => state.playhead);
  const clips = useTimelineStore((state) => state.clips);
  const dragState = useTimelineStore((state) => state.dragState);
  const trimState = useTimelineStore((state) => state.trimState);

  const prevPlayheadRef = useRef(playhead);
  const prevClipsCountRef = useRef(clips.size);
  const prevDragStateRef = useRef(dragState);
  const prevTrimStateRef = useRef(trimState);

  // Listen for custom announcement events
  useEffect(() => {
    const handleAnnounce = (e: Event) => {
      const customEvent = e as CustomEvent<{ message: string; priority: "polite" | "assertive" }>;
      const { message, priority } = customEvent.detail;

      const targetRef = priority === "assertive" ? assertiveRef : politeRef;
      if (targetRef.current) {
        targetRef.current.textContent = message;
      }
    };

    window.addEventListener("screenReaderAnnounce", handleAnnounce);
    return () => window.removeEventListener("screenReaderAnnounce", handleAnnounce);
  }, []);

  // Announce playhead position changes (throttled)
  useEffect(() => {
    const prevPlayhead = prevPlayheadRef.current;
    const diff = Math.abs(playhead - prevPlayhead);

    // Only announce significant playhead movements (> 0.5 seconds)
    if (diff > 0.5) {
      if (politeRef.current) {
        politeRef.current.textContent = `Playhead at ${formatTime(playhead)}`;
      }
      prevPlayheadRef.current = playhead;
    }
  }, [playhead]);

  // Announce clip operations
  useEffect(() => {
    const prevClipsCount = prevClipsCountRef.current;
    const currentClipsCount = clips.size;

    if (currentClipsCount > prevClipsCount) {
      // Clip added
      if (assertiveRef.current) {
        assertiveRef.current.textContent = `Clip added. ${currentClipsCount} clips on timeline.`;
      }
    } else if (currentClipsCount < prevClipsCount) {
      // Clip deleted
      if (assertiveRef.current) {
        assertiveRef.current.textContent = `Clip deleted. ${currentClipsCount} clips remaining.`;
      }
    }

    prevClipsCountRef.current = currentClipsCount;
  }, [clips.size]);

  // Announce drag operations
  useEffect(() => {
    const prevDragState = prevDragStateRef.current;

    if (!prevDragState && dragState) {
      // Drag started
      if (politeRef.current) {
        const clipCount = dragState.clipIds.length;
        politeRef.current.textContent = `Dragging ${clipCount} clip${clipCount > 1 ? "s" : ""}`;
      }
    } else if (prevDragState && !dragState) {
      // Drag ended
      if (politeRef.current) {
        politeRef.current.textContent = "Clip position updated";
      }
    }

    prevDragStateRef.current = dragState;
  }, [dragState]);

  // Announce trim operations
  useEffect(() => {
    const prevTrimState = prevTrimStateRef.current;

    if (!prevTrimState && trimState) {
      // Trim started
      if (politeRef.current) {
        const clip = clips.get(trimState.clipId);
        if (clip) {
          politeRef.current.textContent = `Trimming ${trimState.edge} of ${clip.name}`;
        }
      }
    } else if (prevTrimState && !trimState) {
      // Trim ended
      if (politeRef.current) {
        politeRef.current.textContent = "Clip trimmed";
      }
    }

    prevTrimStateRef.current = trimState;
  }, [trimState, clips]);

  return (
    <>
      {/* Polite announcements - don't interrupt current speech */}
      <div ref={politeRef} role="status" aria-live="polite" aria-atomic="true" className="sr-only" />

      {/* Assertive announcements - interrupt current speech for important updates */}
      <div ref={assertiveRef} role="alert" aria-live="assertive" aria-atomic="true" className="sr-only" />
    </>
  );
}
