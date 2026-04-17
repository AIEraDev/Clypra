/**
 * Clip drag interaction hook for Timeline Engine v1
 */

import { useCallback } from "react";
import { useTimelineStore } from "../store/timelineStore";
import { CoordinateSystem } from "../utils/coordinateSystem";
import { SnapSystem } from "../utils/snapSystem";

interface UseClipDragOptions {
  clipId: string;
  coords: CoordinateSystem;
}

interface UseClipDragReturn {
  handlePointerDown: (e: React.PointerEvent) => void;
}

/**
 * Hook for handling clip drag interactions
 * Supports multi-clip drag for selected clips and snap system integration
 */
export function useClipDrag({ clipId, coords }: UseClipDragOptions): UseClipDragReturn {
  const store = useTimelineStore();

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;

      const clip = store.clips.get(clipId);
      if (!clip || clip.locked) return;

      const selectedIds = store.selectedClipIds.has(clipId) ? Array.from(store.selectedClipIds) : [clipId];

      // Store original start times for all clips being dragged
      const startTimes = new Map(
        selectedIds.map((id) => {
          const c = store.clips.get(id);
          return [id, c ? c.startTime : 0];
        }),
      );

      store.setDragState({
        clipIds: selectedIds,
        startX: e.clientX,
        startTimes,
        currentOffset: 0,
        snapTarget: null,
      });

      // Create snap system with current settings
      const snapSystem = new SnapSystem(coords, {
        playhead: store.snapToPlayhead,
        clips: store.snapToClips,
        markers: store.snapToMarkers,
      });

      const handleMove = (e: PointerEvent) => {
        const dragState = store.dragState;
        if (!dragState) return;

        // Calculate time offset from pointer movement
        const deltaX = e.clientX - dragState.startX;
        const deltaTime = coords.pixelsToTime(deltaX);

        // Calculate new time for primary clip (first in selection)
        const primaryClip = store.clips.get(selectedIds[0]);
        if (!primaryClip) return;

        const newTime = primaryClip.startTime + deltaTime;

        const allClips = Array.from(store.clips.values());
        const snapTarget = snapSystem.findSnapTarget(
          newTime,
          allClips.filter((c) => !selectedIds.includes(c.id)), // Exclude dragged clips from snap targets
          store.playhead,
          [], // No markers in MVP
        );

        const snappedTime = snapTarget ? snapTarget.time : newTime;
        const finalOffset = snappedTime - primaryClip.startTime;

        // Update drag state with current offset and snap target
        store.setDragState({
          ...dragState,
          currentOffset: finalOffset,
          snapTarget,
        });
      };

      const handleUp = () => {
        const dragState = store.dragState;
        if (!dragState) return;

        const offset = dragState.currentOffset;

        // Commit new positions for all dragged clips
        for (const id of selectedIds) {
          const originalTime = startTimes.get(id);
          if (originalTime === undefined) continue;

          const clipToMove = store.clips.get(id);
          if (!clipToMove) continue;

          const newStartTime = Math.max(0, originalTime + offset);
          const newEndTime = newStartTime + clipToMove.duration;

          if (newEndTime <= store.duration) {
            store.moveClip(id, newStartTime, clipToMove.trackId);
          } else {
            // Clamp to fit within timeline
            const clampedStartTime = Math.max(0, store.duration - clipToMove.duration);
            store.moveClip(id, clampedStartTime, clipToMove.trackId);
          }
        }

        // Clear drag state
        store.setDragState(null);

        // Remove event listeners
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      // Attach global event listeners
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [clipId, coords, store],
  );

  return { handlePointerDown };
}
