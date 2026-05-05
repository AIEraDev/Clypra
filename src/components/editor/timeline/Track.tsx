import React, { useMemo } from "react";
import { useUIStore } from "../../../store/uiStore";
import { useTimeline } from "../../../hooks/useTimeline";
import { Clip } from "./Clip";
import type { Clip as ClipType, Track as TrackType } from "../../../types";

interface TrackProps {
  track: TrackType;
  pixelsPerSecond: number;
  clips: any[];
  onClipDragStart?: (clipId: string, startX: number, startY: number) => void;
  onClipDragMove?: (clipId: string, deltaX: number, deltaY: number, clientX: number, clientY: number) => void;
  onClipDragEnd?: (clipId: string) => void;
  dragState?: {
    draggingClipId: string | null;
    offsetX: number;
    offsetY: number;
    isInvalidPosition?: boolean;
    targetTrackId?: string | null;
    insertionIndex?: number | null;
    gapStartTime?: number | null;
    gapDuration?: number | null;
  };
}

export const Track: React.FC<TrackProps> = ({ track, pixelsPerSecond, clips, onClipDragStart, onClipDragMove, onClipDragEnd, dragState }) => {
  const { selectedClipIds, selectedTrackId } = useUIStore();
  const { getMediaAsset } = useTimeline();

  // Get all clips for this track (keep dragged clip for pointer events)
  const trackClips = clips.filter((c) => c.trackId === track.id);

  console.log("[TRACK] 🎬 Track render", {
    trackId: track.id,
    trackClipsCount: trackClips.length,
    trackClips: trackClips.map((c) => c.id),
    draggingClipId: dragState?.draggingClipId,
  });

  // Chronological order for gap shifts — must NOT sort `trackClips` in place while `.map()` iterates it.
  const sortedTrackClips = useMemo(() => [...trackClips].sort((a, b) => a.startTime - b.startTime), [trackClips]);

  // Calculate shifted positions for gap engine (not the clip being dragged — it already uses offsetX/Y)
  const getDisplayStartTime = (clip: ClipType) => {
    if (dragState?.draggingClipId === clip.id) {
      return clip.startTime;
    }
    // Only shift if dragging and this is the target track
    if (
      dragState?.targetTrackId === track.id &&
      dragState.insertionIndex != null &&
      dragState.gapStartTime != null &&
      dragState.gapDuration != null
    ) {
      const clipIndex = sortedTrackClips.findIndex((c) => c.id === clip.id);
      const insertionIndex = dragState.insertionIndex;
      const gapDuration = dragState.gapDuration;

      if (clipIndex >= insertionIndex) {
        // Shift clips at or after insertion point
        return clip.startTime + gapDuration;
      }
    }

    return clip.startTime;
  };

  return (
    <div data-track-id={track.id} className={`relative border-b border-border transition-colors ${selectedTrackId === track.id ? "bg-[#1f242b]" : ""}`} style={{ height: `${track.height}px` }}>
      {/* Clips layer */}
      {track.visible &&
        trackClips.map((clip) => {
          const isDragging = dragState?.draggingClipId === clip.id;

          const displayStartTime = getDisplayStartTime(clip);
          const isShifted = displayStartTime !== clip.startTime;

          // Override clip's startTime for display if shifted
          const displayClip = isShifted ? { ...clip, startTime: displayStartTime } : clip;

          return (
            <Clip
              key={clip.id}
              clip={displayClip}
              mediaAsset={getMediaAsset(clip.mediaId)}
              pixelsPerSecond={pixelsPerSecond}
              selected={selectedClipIds.includes(clip.id)}
              locked={track.locked}
              onDragStart={onClipDragStart}
              onDragMove={onClipDragMove}
              onDragEnd={onClipDragEnd}
              dragState={
                isDragging
                  ? {
                      isDragging: true,
                      offsetX: dragState?.offsetX || 0,
                      offsetY: dragState?.offsetY || 0,
                      isInvalidPosition: dragState?.isInvalidPosition,
                    }
                  : undefined
              }
            />
          );
        })}

      {/* Gap indicator (gray background) */}
      {dragState?.targetTrackId === track.id && dragState?.gapStartTime !== null && dragState?.gapDuration !== null && (
        <div
          className="absolute top-0 pointer-events-none z-5"
          style={{
            left: `${Math.round(dragState.gapStartTime! * pixelsPerSecond)}px`,
            width: `${Math.round(dragState.gapDuration! * pixelsPerSecond)}px`,
            height: "100%",
            background: "rgba(150, 150, 150, 0.3)",
            borderRadius: "4px",
            transition: "left 100ms ease-out, width 100ms ease-out",
          }}
        />
      )}
    </div>
  );
};
