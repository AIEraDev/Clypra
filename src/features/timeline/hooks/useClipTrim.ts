/**
 * Clip trim interaction hook for Timeline Engine v1
 */

import { useCallback } from "react";
import { useTimelineStore } from "../store/timelineStore";
import { CoordinateSystem } from "../utils/coordinateSystem";
import { SnapSystem } from "../utils/snapSystem";
import { clamp } from "../utils/math";

interface UseClipTrimOptions {
  clipId: string;
  edge: "start" | "end";
  coords: CoordinateSystem;
}

interface UseClipTrimReturn {
  handlePointerDown: (e: React.PointerEvent) => void;
}

/**
 * Hook for handling clip trim interactions
 * Supports trimming clip start and end with snap system integration
 */
export function useClipTrim({ clipId, edge, coords }: UseClipTrimOptions): UseClipTrimReturn {
  const store = useTimelineStore();

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;

      // Stop propagation to prevent clip drag
      e.stopPropagation();

      const clip = store.clips.get(clipId);
      if (!clip || clip.locked) return;

      store.setTrimState({
        clipId,
        edge,
        originalStartTime: clip.startTime,
        originalDuration: clip.duration,
        currentTime: edge === "start" ? clip.startTime : clip.startTime + clip.duration,
        snapTarget: null,
      });

      // Create snap system with current settings
      const snapSystem = new SnapSystem(coords, {
        playhead: store.snapToPlayhead,
        clips: store.snapToClips,
        markers: store.snapToMarkers,
      });

      const handleMove = (e: PointerEvent) => {
        const trimState = store.trimState;
        if (!trimState) return;

        const clip = store.clips.get(clipId);
        if (!clip) return;

        // Get the timeline container to calculate relative position
        const timelineElement = document.querySelector("[data-timeline-scroll-area]");
        if (!timelineElement) return;

        const rect = timelineElement.getBoundingClientRect();
        const x = e.clientX - rect.left + store.scrollLeft;
        const time = coords.pixelsToTime(x);

        const allClips = Array.from(store.clips.values());
        const snapTarget = snapSystem.findSnapTarget(
          time,
          allClips.filter((c) => c.id !== clipId), // Exclude current clip from snap targets
          store.playhead,
          [], // No markers in MVP
        );

        const snappedTime = snapTarget ? snapTarget.time : time;

        let finalTime = snappedTime;

        if (edge === "start") {
          const maxStartTime = clip.startTime + clip.duration - MIN_DURATION;

          finalTime = clamp(snappedTime, 0, maxStartTime);

          const sourceStartDelta = finalTime - clip.startTime;
          const newSourceStart = clip.sourceStart + sourceStartDelta;

          // Ensure we don't trim before source media start
          if (newSourceStart < 0) {
            finalTime = clip.startTime - clip.sourceStart;
          }
        } else {
          const minEndTime = clip.startTime + MIN_DURATION;

          finalTime = clamp(snappedTime, minEndTime, store.duration);

          const newDuration = finalTime - clip.startTime;
          const newSourceEnd = clip.sourceStart + newDuration;
          const sourceMediaDuration = clip.sourceEnd - clip.sourceStart + clip.duration;

          // Ensure we don't trim beyond source media end
          if (newSourceEnd > sourceMediaDuration) {
            finalTime = clip.startTime + (sourceMediaDuration - clip.sourceStart);
          }
        }

        // Update trim state with current time and snap target
        store.setTrimState({
          ...trimState,
          currentTime: finalTime,
          snapTarget,
        });
      };

      const handleUp = () => {
        const trimState = store.trimState;
        if (!trimState) return;

        const clip = store.clips.get(clipId);
        if (!clip) return;

        // Calculate new start time and duration based on trim edge
        let newStartTime: number;
        let newDuration: number;

        if (edge === "start") {
          newStartTime = trimState.currentTime;
          newDuration = clip.duration + (clip.startTime - trimState.currentTime);
        } else {
          newStartTime = clip.startTime;
          newDuration = trimState.currentTime - clip.startTime;
        }

        store.trimClip(clipId, newStartTime, newDuration);

        // Clear trim state
        store.setTrimState(null);

        // Remove event listeners
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      // Attach global event listeners
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [clipId, edge, coords, store],
  );

  return { handlePointerDown };
}
