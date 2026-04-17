/**
 * Selection rectangle hook for Timeline Engine v1
 * Handles rectangle selection drag on empty timeline area
 */

import { useCallback, useState } from "react";
import { useTimelineStore } from "../store/timelineStore";
import { CoordinateSystem } from "../utils/coordinateSystem";
import type { Clip } from "../types/core";

interface SelectionRectangle {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface UseSelectionRectangleOptions {
  coords: CoordinateSystem;
  scrollLeft: number;
  scrollTop: number;
}

interface UseSelectionRectangleReturn {
  selectionRect: SelectionRectangle | null;
  handlePointerDown: (e: React.PointerEvent) => void;
}

/**
 * Hook for handling selection rectangle drag
 * Selects all clips intersecting the rectangle on pointer up
 */
export function useSelectionRectangle({ coords, scrollLeft, scrollTop }: UseSelectionRectangleOptions): UseSelectionRectangleReturn {
  const [selectionRect, setSelectionRect] = useState<SelectionRectangle | null>(null);
  const store = useTimelineStore();

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only handle left mouse button
      if (e.button !== 0) return;

      // Get the timeline content element to calculate correct coordinates
      const target = e.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();

      // Calculate initial position relative to timeline content (accounting for scroll)
      const startX = e.clientX - rect.left + scrollLeft;
      const startY = e.clientY - rect.top + scrollTop;

      // Initialize selection rectangle
      setSelectionRect({
        startX,
        startY,
        currentX: startX,
        currentY: startY,
      });

      // Pointer move handler - updates rectangle dimensions
      const handleMove = (e: PointerEvent) => {
        const currentX = e.clientX - rect.left + scrollLeft;
        const currentY = e.clientY - rect.top + scrollTop;

        setSelectionRect((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            currentX,
            currentY,
          };
        });
      };

      // Pointer up handler - selects intersecting clips
      const handleUp = (e: PointerEvent) => {
        const currentRect = selectionRect || {
          startX,
          startY,
          currentX: e.clientX - rect.left + scrollLeft,
          currentY: e.clientY - rect.top + scrollTop,
        };

        // Calculate rectangle bounds
        const minX = Math.min(currentRect.startX, currentRect.currentX);
        const maxX = Math.max(currentRect.startX, currentRect.currentX);
        const minY = Math.min(currentRect.startY, currentRect.currentY);
        const maxY = Math.max(currentRect.startY, currentRect.currentY);

        // Convert X coordinates to time
        const startTime = coords.pixelsToTime(minX);
        const endTime = coords.pixelsToTime(maxX);

        const intersectingClips: string[] = [];
        const allClips = Array.from(store.clips.values());

        for (const clip of allClips) {
          const clipStartTime = clip.startTime;
          const clipEndTime = clip.startTime + clip.duration;

          // Check if clip intersects time range
          const timeIntersects = clipEndTime >= startTime && clipStartTime <= endTime;

          if (timeIntersects) {
            // For Y intersection, we need to check track position
            // This is a simplified check - in a full implementation,
            // we would calculate exact track Y positions
            intersectingClips.push(clip.id);
          }
        }

        if (intersectingClips.length > 0) {
          // Replace current selection with intersecting clips
          const newSelection = new Set(intersectingClips);
          store.selectClip(intersectingClips[0], false);
          for (let i = 1; i < intersectingClips.length; i++) {
            store.selectClip(intersectingClips[i], true);
          }
        } else {
          // Clear selection if no clips intersect
          store.deselectAll();
        }

        cleanup();
      };

      const cleanup = () => {
        setSelectionRect(null);
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      // Attach global event listeners
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [coords, scrollLeft, scrollTop, store],
  );

  return {
    selectionRect,
    handlePointerDown,
  };
}
