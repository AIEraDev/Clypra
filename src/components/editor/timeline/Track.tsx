import React from "react";
// @ts-ignore - react-dnd types issue
import { useDrop } from "react-dnd";
import { useUIStore } from "../../../store/uiStore";
import { useTimelineStore } from "../../../store/timelineStore";
import { useTimeline } from "../../../hooks/useTimeline";
import { Clip } from "./Clip";
import { formatTime } from "../../../lib/utils";
import type { Track as TrackType, DragItem } from "../../../types";

interface TrackProps {
  track: TrackType;
  pixelsPerSecond: number;
  clips: any[];
}

export const Track: React.FC<TrackProps> = ({ track, pixelsPerSecond, clips }) => {
  const { selectedClipIds, selectedTrackId } = useUIStore();
  const { addClipFromAsset, getMediaAsset, moveClip, updateClip, scrollLeft } = useTimeline();
  const { dragState, setDragState, calculateShiftedPositions } = useTimelineStore();
  const [isAltPressed, setIsAltPressed] = React.useState(false);
  const [dropPosition, setDropPosition] = React.useState<number | null>(null);

  // Track Alt key state
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && !isAltPressed) {
        setIsAltPressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.altKey && isAltPressed) {
        setIsAltPressed(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isAltPressed]);

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
        const ghostStart = Math.max(0, x / pixelsPerSecond);

        // Snap to 0.1s intervals
        const snappedTime = Math.max(0, Math.round(ghostStart * 10) / 10);
        setDropPosition(snappedTime);

        // Only handle CLIP dragging for magnetic behavior
        if (item.type === "CLIP") {
          const clip = item.clip;
          const insertMode = isAltPressed;

          // Calculate affected clips
          const affectedClips = calculateShiftedPositions(track.id, ghostStart, clip.duration, clip.id, insertMode);

          // Update drag state
          setDragState({
            draggingClipId: clip.id,
            targetTrackId: track.id,
            ghostStartTime: ghostStart,
            ghostDuration: clip.duration,
            insertMode,
            affectedClips,
          });
        }
      },
      drop: (item: DragItem, monitor: any) => {
        if (track.locked) return;

        const clientOffset = monitor.getClientOffset();
        if (!clientOffset) return;

        const trackElement = document.querySelector(`[data-track-id="${track.id}"]`);
        if (!trackElement) return;

        const rect = (trackElement as HTMLElement).getBoundingClientRect();
        const x = clientOffset.x - rect.left + scrollLeft;
        let startTime = Math.max(0, x / pixelsPerSecond);

        // Check if it's a media asset or existing clip
        if (item.type === "MEDIA_ASSET") {
          addClipFromAsset(item.asset, track.id, startTime);
        } else if (item.type === "CLIP") {
          const clip = item.clip;
          const insertMode = isAltPressed;

          // In insert mode, shift other clips
          if (insertMode && dragState?.affectedClips) {
            // Apply shifts to all affected clips
            dragState.affectedClips.forEach((affected) => {
              if (affected.shiftedStartTime !== affected.originalStartTime) {
                moveClip(affected.clipId, affected.shiftedStartTime);
              }
            });
          }

          // Move the dragged clip
          if (clip.trackId === track.id) {
            moveClip(clip.id, startTime);
          } else {
            updateClip(clip.id, { trackId: track.id, startTime });
          }
        }

        // Clear drag state
        setDragState(null);
      },
    }),
    [track.id, pixelsPerSecond, addClipFromAsset, moveClip, updateClip, scrollLeft, isAltPressed, dragState, setDragState, calculateShiftedPositions],
  );

  // Clear drop position when not hovering
  React.useEffect(() => {
    if (!isOver) setDropPosition(null);
  }, [isOver]);

  const trackClips = clips.filter((c) => c.trackId === track.id);

  return (
    <div ref={drop} data-track-id={track.id} className={`relative border-b border-border transition-colors ${selectedTrackId === track.id ? "bg-[#1f242b]" : ""}`} style={{ height: `${track.height}px` }}>
      {track.visible &&
        trackClips.map((clip) => {
          // If a drag is in progress in insert mode, use shifted position
          const shifted = dragState?.affectedClips.find((a) => a.clipId === clip.id);
          const displayStartTime = shifted ? shifted.shiftedStartTime : clip.startTime;
          const isShifting = !!shifted && shifted.shiftedStartTime !== shifted.originalStartTime;

          return <Clip key={clip.id} clip={clip} mediaAsset={getMediaAsset(clip.mediaId)} pixelsPerSecond={pixelsPerSecond} selected={selectedClipIds.includes(clip.id)} locked={track.locked} displayStartTime={displayStartTime} isShifting={isShifting} />;
        })}

      {/* Thin vertical drop indicator line - only position, no track background */}
      {isOver && canDrop && dropPosition !== null && !dragState?.insertMode && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-accent z-20 pointer-events-none"
          style={{
            left: `${dropPosition * pixelsPerSecond}px`,
          }}
        >
          {/* Small time label */}
          <div className="absolute -top-5 left-1 bg-accent text-white text-[10px] px-1 rounded whitespace-nowrap">{formatTime(dropPosition)}</div>
        </div>
      )}

      {/* Ghost drop zone indicator for insert mode */}
      {dragState?.targetTrackId === track.id && dragState.insertMode && (
        <div
          className="absolute top-0 h-full bg-accent/20 border-2 border-accent border-dashed rounded pointer-events-none transition-all duration-100"
          style={{
            left: `${dragState.ghostStartTime * pixelsPerSecond}px`,
            width: `${dragState.ghostDuration * pixelsPerSecond}px`,
          }}
        />
      )}
    </div>
  );
};
