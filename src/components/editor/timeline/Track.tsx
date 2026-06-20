import React, { useMemo } from "react";
import { Lock, Shuffle } from "lucide-react";
import { useDrop } from "react-dnd";
import { useUIStore } from "@/store/uiStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useTimeline } from "@/hooks/useTimeline";
import { Clip } from "./Clip";
import { GapIndicator } from "./GapIndicator";
import { handleDropOnTrack } from "@/lib/timeline/timelineUtils";
import type { Clip as ClipType, Track as TrackType, DragItem } from "@/types";

interface TrackProps {
  track: TrackType;
  pixelsPerSecond: number;
  clips: any[];
  onClipDragStart?: (clipId: string, startX: number, startY: number) => void;
  onClipDragMove?: (clipId: string, deltaX: number, deltaY: number, clientX: number, clientY: number) => void;
  onClipDragEnd?: (clipId: string) => void;
  dragState?: {
    draggingClipId: string | null;
    draggedClipIds?: string[];
    offsetX: number;
    offsetY: number;
    isInvalidPosition?: boolean;
    targetTrackId?: string | null;
    placementPreview?: any; // PlacementPreview type
    draggedBlockDuration?: number;
    originalPlacements?: any;
  };
}

const TrackInner: React.FC<TrackProps> = ({ track, pixelsPerSecond, clips, onClipDragStart, onClipDragMove, onClipDragEnd, dragState }) => {
  const { selectedClipIds, selectedGapId, selectedTrackId, selectedTransitionId, selectTransition } = useUIStore();
  const { gaps = [], transitions = [] } = useTimelineStore();
  const { getMediaAsset } = useTimeline();

  // Drop handler for media assets from MediaTab
  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: ["MEDIA_ASSET"],
      drop: (item: DragItem, monitor: any) => {
        if (!track.locked && track.type !== "text") {
          handleDropOnTrack(item, monitor, track.id);
        }
      },
      canDrop: () => !track.locked && track.type !== "text",
      collect: (monitor: any) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }),
    [track.id, track.locked, track.type],
  );

  // FIX: clips are now pre-filtered by Timeline, so trackClips === clips
  // No need to filter again - this was causing unnecessary re-computation
  const trackClips = clips;

  // Chronological order
  const sortedTrackClips = useMemo(() => [...trackClips].sort((a, b) => a.startTime - b.startTime), [trackClips]);

  // Get gaps for this track
  const trackGaps = useMemo(() => gaps.filter((g) => g.trackId === track.id), [gaps, track.id]);

  // Get transitions for this track
  const trackTransitions = useMemo(() => transitions.filter((t) => t.placement.trackId === track.id), [transitions, track.id]);

  // Calculate display info from placement preview (single source of truth)
  const displayInfo = useMemo(() => {
    if (!dragState || !dragState.draggedClipIds) {
      return { displayPositions: null, gapIndicator: null };
    }

    const isDraggedFromThisTrack = dragState.draggedClipIds.some((clipId) => sortedTrackClips.some((c) => c.id === clipId));

    const isTargetTrack = dragState.targetTrackId === track.id;

    // Source track: Show ripple closure (clips pack together)
    if (isDraggedFromThisTrack && !isTargetTrack) {
      // Calculate positions without the dragged clips (they've "left" the track)
      const displayMap = new Map<string, number>();
      const draggedSet = new Set(dragState.draggedClipIds);
      const restClips = sortedTrackClips.filter((c) => !draggedSet.has(c.id));

      // Pack remaining clips tightly (no gaps)
      let currentTime = 0;
      for (const clip of restClips) {
        displayMap.set(clip.id, currentTime);
        currentTime += clip.duration;
      }

      return {
        displayPositions: displayMap,
        gapIndicator: null,
      };
    }

    // Target track: Show insertion preview
    if (isTargetTrack && dragState.placementPreview) {
      if (dragState.isInvalidPosition) {
        return { displayPositions: null, gapIndicator: null };
      }
      const preview = dragState.placementPreview;

      switch (preview.type) {
        case "insert":
          return {
            displayPositions: preview.affectedClipPositions,
            gapIndicator: {
              startTime: preview.gapStartTime,
              duration: preview.gapDuration,
            },
          };

        case "position":
          // Gap indicator follows cursor (uses offsetX for live position)
          const firstDraggedClipId = dragState.draggedClipIds[0];
          const placement = firstDraggedClipId ? dragState.originalPlacements[firstDraggedClipId] : null;
          if (placement) {
            const clipLeftOriginal = placement.startTime * pixelsPerSecond;
            const clipLeftLive = clipLeftOriginal + (dragState.offsetX || 0);
            const liveStartTime = clipLeftLive / pixelsPerSecond;

            return {
              displayPositions: null,
              gapIndicator: {
                startTime: Math.max(0, liveStartTime),
                duration: dragState.draggedBlockDuration ?? 0,
              },
            };
          }
          return {
            displayPositions: null,
            gapIndicator: {
              startTime: preview.startTime,
              duration: dragState.draggedBlockDuration ?? 0,
            },
          };

        default:
          return { displayPositions: null, gapIndicator: null };
      }
    }

    return { displayPositions: null, gapIndicator: null };
  }, [dragState, track.id, sortedTrackClips, pixelsPerSecond]);

  const { displayPositions, gapIndicator } = displayInfo;

  return (
    <div
      ref={(node) => {
        drop(node);
      }}
      data-track-id={track.id}
      className={`relative transition-colors mb-0 bg-surface-raised/40 ${selectedTrackId === track.id ? "bg-timeline-track-active" : ""} ${isOver && canDrop ? "bg-accent/10" : ""} ${track.locked ? "bg-slate-900/45" : ""}`}
      style={{ height: `${track.height}px` }}
    >
      {/* Clips layer */}
      {track.visible &&
        trackClips.map((clip) => {
          const isDragging = dragState?.draggingClipId === clip.id;

          // Dragged clip uses original position + offsetX transform (NOT displayPositions map)
          // Other clips use displayPositions map (which handles gap opening/closing)
          let displayStartTime = clip.startTime;
          if (!isDragging && displayPositions) {
            displayStartTime = displayPositions.get(clip.id) ?? clip.startTime;
          }
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
              isBeingShifted={isShifted}
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

      {/* Transitions layer */}
      {track.visible &&
        trackTransitions.map((t) => {
          const isSelected = selectedTransitionId === t.id;
          const left = t.placement.startTime * pixelsPerSecond;
          const width = t.placement.duration * pixelsPerSecond;

          return (
            <button
              key={t.id}
              onClick={(e) => {
                e.stopPropagation();
                selectTransition(t.id);
              }}
              className={`absolute top-1/2 -translate-y-1/2 h-7 rounded z-35 flex items-center justify-center cursor-pointer transition-all border ${isSelected ? "bg-accent/80 text-white border-white shadow-md scale-105" : "bg-surface-raised/80 hover:bg-surface-raised border-border/40 text-text-muted hover:text-text-primary hover:border-accent/30"}`}
              style={{
                left: `${left}px`,
                width: `${width}px`,
              }}
              title={`${t.type === "dissolve" ? "Dissolve" : "Fade"} Transition (${t.placement.duration.toFixed(1)}s)`}
            >
              <Shuffle className="w-3 h-3" />
            </button>
          );
        })}

      {/* Gaps layer - render permanent gaps */}
      {track.visible && !(dragState && (dragState.targetTrackId === track.id || dragState.draggedClipIds?.some((id) => sortedTrackClips.some((c) => c.id === id)))) && trackGaps.map((gap) => <GapIndicator key={gap.id} gap={gap} pixelsPerSecond={pixelsPerSecond} selected={selectedGapId === gap.id} locked={track.locked} />)}

      {/* Gap indicator (blue dashed background) - temporary drag preview */}
      {gapIndicator && (
        <div
          className="absolute top-0 pointer-events-none z-5"
          style={{
            left: `${Math.round(gapIndicator.startTime * pixelsPerSecond)}px`,
            width: `${Math.round(gapIndicator.duration * pixelsPerSecond)}px`,
            height: "100%",
            background: "rgba(96, 165, 250, 0.25)",
            border: "2px dashed rgba(96, 165, 250, 0.6)",
            borderRadius: "4px",
          }}
        />
      )}

      {track.locked && (
        <div className="pointer-events-none absolute inset-0 z-40 bg-[repeating-linear-gradient(135deg,rgba(148,163,184,0.08)_0px,rgba(148,163,184,0.08)_8px,rgba(15,23,42,0.08)_8px,rgba(15,23,42,0.08)_16px)]">
          <div className="absolute right-2 top-2 inline-flex items-center gap-1 rounded bg-slate-900/70 px-2 py-1 text-[10px] font-medium text-slate-200">
            <Lock className="h-3 w-3" />
            <span>Locked</span>
          </div>
        </div>
      )}
    </div>
  );
};

export const Track = React.memo(TrackInner);
