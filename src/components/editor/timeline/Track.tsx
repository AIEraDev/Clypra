import React from "react";
// @ts-ignore - react-dnd types issue
import { useDrop } from "react-dnd";
import { useUIStore } from "../../../store/uiStore";
import { useTimelineStore } from "../../../store/timelineStore";
import { useTimeline } from "../../../hooks/useTimeline";
import { Clip } from "./Clip";
import type { Track as TrackType, DragItem } from "../../../types";

interface TrackProps {
  track: TrackType;
  pixelsPerSecond: number;
  clips: any[];
}

export const Track: React.FC<TrackProps> = ({ track, pixelsPerSecond, clips }) => {
  const { selectedClipId, selectedTrackId } = useUIStore();
  const { addClipFromAsset, getMediaAsset, moveClip, updateClip, scrollLeft } = useTimeline();
  const { dragState, setDragState, calculateShiftedPositions } = useTimelineStore();
  const [isAltPressed, setIsAltPressed] = React.useState(false);

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

  const trackClips = clips.filter((c) => c.trackId === track.id);

  return (
    <div ref={drop} data-track-id={track.id} className={`relative border-b border-border transition-colors ${selectedTrackId === track.id ? "bg-[#1f242b]" : "hover:bg-[#1f242b]"} ${isOver && canDrop ? "bg-cyan-500/10 ring-1 ring-cyan-500/50" : ""}`} style={{ height: `${track.height}px` }}>
      {track.visible &&
        trackClips.map((clip) => {
          // If a drag is in progress in insert mode, use shifted position
          const shifted = dragState?.affectedClips.find((a) => a.clipId === clip.id);
          const displayStartTime = shifted ? shifted.shiftedStartTime : clip.startTime;
          const isShifting = !!shifted && shifted.shiftedStartTime !== shifted.originalStartTime;

          return <Clip key={clip.id} clip={clip} mediaAsset={getMediaAsset(clip.mediaId)} pixelsPerSecond={pixelsPerSecond} selected={clip.id === selectedClipId} locked={track.locked} displayStartTime={displayStartTime} isShifting={isShifting} />;
        })}

      {/* Ghost drop zone indicator */}
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
