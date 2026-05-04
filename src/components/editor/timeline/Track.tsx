import React from "react";
// @ts-ignore - react-dnd types issue
import { useDrop } from "react-dnd";
import { useUIStore } from "../../../store/uiStore";
import { useTimelineStore } from "../../../store/timelineStore";
import { useDragStateStore } from "../../../store/dragStateStore";
import { useTimeline } from "../../../hooks/useTimeline";
import { Clip } from "./Clip";
import type { Track as TrackType, DragItem } from "../../../types";

interface TrackProps {
  track: TrackType;
  pixelsPerSecond: number;
  clips: any[];
}

export const Track: React.FC<TrackProps> = ({ track, pixelsPerSecond, clips }) => {
  const { selectedClipIds, selectedTrackId } = useUIStore();
  const { addClipFromAsset, getMediaAsset, scrollLeft } = useTimeline();
  const { addClip } = useTimelineStore();
  const { draggingClip, insertionTrackId, insertionTime, setInsertion, clearDragging, originalTrackId, originalStartTime } = useDragStateStore();

  // Drop handler
  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: ["MEDIA_ASSET", "CLIP"],
      collect: (monitor: any) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
      hover: (item: DragItem, monitor: any) => {
        if (track.locked) return;

        const clientOffset = monitor.getClientOffset();
        if (!clientOffset) return;

        const trackElement = document.querySelector(`[data-track-id="${track.id}"]`);
        if (!trackElement) return;

        const rect = (trackElement as HTMLElement).getBoundingClientRect();
        const x = clientOffset.x - rect.left + scrollLeft;
        const pointerTime = Math.max(0, x / pixelsPerSecond);

        // Only handle CLIP dragging for insertion gap
        if (item.type === "CLIP" && draggingClip) {
          // ✅ Find insertion point between clips
          const trackClips = clips.filter((c) => c.trackId === track.id).sort((a, b) => a.startTime - b.startTime);

          let insertTime = 0;

          if (trackClips.length === 0) {
            // Empty track - insert at pointer position
            insertTime = pointerTime;
          } else {
            // Find the gap the pointer is in
            let foundGap = false;

            for (let i = 0; i < trackClips.length; i++) {
              const currentClip = trackClips[i];
              const nextClip = trackClips[i + 1];

              // Check if pointer is before first clip
              if (i === 0 && pointerTime < currentClip.startTime) {
                insertTime = 0;
                foundGap = true;
                break;
              }

              // Check if pointer is in gap between current and next
              if (nextClip) {
                const gapStart = currentClip.startTime + currentClip.duration;
                const gapEnd = nextClip.startTime;
                const gapMidpoint = (gapStart + gapEnd) / 2;

                if (pointerTime >= gapStart && pointerTime < gapEnd) {
                  // Snap to start of gap if before midpoint, end if after
                  insertTime = pointerTime < gapMidpoint ? gapStart : gapEnd;
                  foundGap = true;
                  break;
                }
              }

              // Check if pointer is after last clip
              if (i === trackClips.length - 1 && pointerTime >= currentClip.startTime + currentClip.duration) {
                insertTime = currentClip.startTime + currentClip.duration;
                foundGap = true;
                break;
              }
            }

            if (!foundGap) {
              insertTime = pointerTime;
            }
          }

          // ✅ Update insertion state
          setInsertion(track.id, insertTime);
        }
      },
      drop: (item: DragItem, monitor: any) => {
        if (track.locked) return;

        const clientOffset = monitor.getClientOffset();
        if (!clientOffset) return;

        // Check if it's a media asset or existing clip
        if (item.type === "MEDIA_ASSET") {
          const trackElement = document.querySelector(`[data-track-id="${track.id}"]`);
          if (!trackElement) return;

          const rect = (trackElement as HTMLElement).getBoundingClientRect();
          const x = clientOffset.x - rect.left + scrollLeft;
          const startTime = Math.max(0, x / pixelsPerSecond);

          addClipFromAsset(item.asset, track.id, startTime);
        } else if (item.type === "CLIP" && draggingClip && insertionTime !== null) {
          // ✅ Add clip at insertion position
          addClip({
            ...draggingClip,
            trackId: track.id,
            startTime: insertionTime,
          });

          // ✅ Clear drag state
          clearDragging();
        }
      },
      canDrop: () => !track.locked,
    }),
    [track.id, track.locked, pixelsPerSecond, addClipFromAsset, scrollLeft, draggingClip, insertionTime, setInsertion, addClip, clearDragging, clips],
  );

  const trackClips = clips.filter((c) => c.trackId === track.id);

  // ✅ Calculate shifted positions for clips after insertion point
  const getDisplayStartTime = (clip: any) => {
    if (insertionTrackId === track.id && insertionTime !== null && draggingClip) {
      // Shift clips that start at or after insertion point
      if (clip.startTime >= insertionTime) {
        return clip.startTime + draggingClip.duration;
      }
    }
    return clip.startTime;
  };

  return (
    <div ref={drop} data-track-id={track.id} className={`relative border-b border-border transition-colors ${selectedTrackId === track.id ? "bg-[#1f242b]" : ""}`} style={{ height: `${track.height}px` }}>
      {track.visible &&
        trackClips.map((clip) => {
          const displayStartTime = getDisplayStartTime(clip);
          const isShifting = displayStartTime !== clip.startTime;

          return <Clip key={clip.id} clip={clip} mediaAsset={getMediaAsset(clip.mediaId)} pixelsPerSecond={pixelsPerSecond} selected={selectedClipIds.includes(clip.id)} locked={track.locked} displayStartTime={displayStartTime} isShifting={isShifting} />;
        })}

      {/* ✅ Insertion gap highlight (CapCut style) */}
      {insertionTrackId === track.id && insertionTime !== null && draggingClip && (
        <div
          className="absolute top-0 pointer-events-none z-10"
          style={{
            left: `${Math.round(insertionTime * pixelsPerSecond)}px`,
            width: `${Math.round(draggingClip.duration * pixelsPerSecond)}px`,
            height: "100%",
            background: "rgba(108, 99, 255, 0.12)",
            border: "1.5px dashed #6c63ff",
            borderRadius: "4px",
            transition: "left 100ms ease-out, width 100ms ease-out",
          }}
        />
      )}
    </div>
  );
};
