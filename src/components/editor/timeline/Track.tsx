import React, { useEffect, useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { useDrop } from "react-dnd";
import { useUIStore } from "@/store/uiStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useTimeline } from "@/hooks";
import { Clip } from "./Clip";
import { GapIndicator } from "./GapIndicator";
import { TransitionIndicator } from "./TransitionIndicator";
import { handleDropOnTrack } from "@/lib/timeline/timelineUtils";
import { timeToPixel, pixelToTime } from "@/lib/timeline/timelineViewport";
import { getTimelineLaneClientX } from "@/lib/timeline/timelineViewport";
import { resolveInsertEdit } from "@/lib/timeline/insertEdit";
import { resolveClipDuration } from "@/lib/timeline/timelineClip";
import { useProjectStore } from "@/store/projectStore";
import { getTrackVisualSpec, type TrackVisualSpec } from "@/lib/timeline/trackTypeConfig";
import type { Clip as ClipType, Track as TrackType, DragItem } from "@/types";


interface TrackProps {
  track: TrackType;
  visualSpec?: TrackVisualSpec;
  pixelsPerSecond: number;
  clips: any[];
  onClipDragStart?: (clipId: string, startX: number, startY: number) => void;
  onClipDragMove?: (clipId: string, deltaX: number, deltaY: number, clientX: number, clientY: number) => void;
  onClipDragEnd?: (clipId: string) => void;
  onClipContextMenu?: (e: React.MouseEvent, clipId: string, trackId: string) => void;
  onTrackContextMenu?: (e: React.MouseEvent, trackId: string, time: number) => void;
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

const TrackInner: React.FC<TrackProps> = ({ track, visualSpec: visualSpecProp, pixelsPerSecond, clips, onClipDragStart, onClipDragMove, onClipDragEnd, onClipContextMenu, onTrackContextMenu, dragState }) => {
  const selectedClipIds = useUIStore((state) => state.selectedClipIds);
  const selectedGapId = useUIStore((state) => state.selectedGapId);
  const selectedTrackId = useUIStore((state) => state.selectedTrackId);
  const gaps = useTimelineStore((state) => state.gaps ?? []);
  const transitions = useTimelineStore((state) => state.transitions ?? []);
  const allClips = useTimelineStore((state) => state.clips);
  const allTracks = useTimelineStore((state) => state.tracks);
  const mainVideoTrackId = useTimelineStore((state) => state.mainVideoTrackId);
  const scrollLeft = useTimelineStore((state) => state.scrollLeft);
  const frameRate = useProjectStore((state) => state.project?.frameRate ?? 30);
  const { getMediaAsset } = useTimeline();
  const [mediaDropPreview, setMediaDropPreview] = useState<{ startTime: number; duration: number; splitClipId: string | null; shiftedClipIds: string[] } | null>(null);
  const visualSpec = visualSpecProp ?? getTrackVisualSpec(track, allTracks.length > 0 ? allTracks : [track], mainVideoTrackId);

  // Drop handler for media assets from MediaTab
  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: ["MEDIA_ASSET"],
      hover: (item: DragItem, monitor: any) => {
        if (item.type !== "MEDIA_ASSET") return;
        const offset = monitor.getClientOffset();
        const container = document.getElementById("timeline-tracks-container");
        if (!offset || !container) return;
        const rect = container.getBoundingClientRect();
        const requestedTime = pixelToTime(getTimelineLaneClientX(offset.x, rect.left, allClips.length > 0) + scrollLeft, pixelsPerSecond);

        const decision = resolveInsertEdit({ track, asset: item.asset, clips: allClips, requestedTime, frameRate });
        setMediaDropPreview(
          decision.accepted
            ? {
                startTime: decision.insertionTime,
                duration: resolveClipDuration(item.asset),
                splitClipId: decision.splitClipId,
                shiftedClipIds: decision.shiftedClipIds,
              }
            : null,
        );
      },
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
    [track, allClips, scrollLeft, pixelsPerSecond, frameRate],
  );

  useEffect(() => {
    if (!isOver) setMediaDropPreview(null);
  }, [isOver]);

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
    if ((!dragState || !dragState.draggedClipIds) && mediaDropPreview) {
      const shifted = new Set(mediaDropPreview.shiftedClipIds);
      return {
        displayPositions: new Map(sortedTrackClips.map((clip) => [clip.id, shifted.has(clip.id) ? clip.startTime + mediaDropPreview.duration : clip.startTime])),
        gapIndicator: {
          startTime: mediaDropPreview.startTime,
          duration: mediaDropPreview.duration,
        },
      };
    }

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
            const clipLeftOriginal = timeToPixel(placement.startTime, pixelsPerSecond);
            const clipLeftLive = clipLeftOriginal + (dragState.offsetX || 0);
            const liveStartTime = pixelToTime(clipLeftLive, pixelsPerSecond);


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
  }, [dragState, track.id, sortedTrackClips, pixelsPerSecond, mediaDropPreview]);

  const { displayPositions, gapIndicator } = displayInfo;

  const handleTrackContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && target.closest("[data-clip-id]")) return;
    if (target && target.closest("[data-gap-id]")) return;
    e.preventDefault();
    e.stopPropagation();
    const container = document.getElementById("timeline-tracks-container");
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const clickedTime = pixelToTime(getTimelineLaneClientX(e.clientX, rect.left, allClips.length > 0) + scrollLeft, pixelsPerSecond);
    onTrackContextMenu?.(e, track.id, Math.max(0, clickedTime));
  };

  return (
    <div
      ref={(node) => {
        drop(node);
      }}
      data-track-id={track.id}
      onContextMenu={handleTrackContextMenu}
      className={`relative transition-colors mb-0 bg-surface-raised/40 ${visualSpec.tone === "primary" ? "border-l-2 border-accent/70" : visualSpec.tone === "secondary" ? "border-l border-accent/30" : visualSpec.tone === "audio" ? "border-l border-white/15" : "border-l border-violet-400/25"} ${selectedTrackId === track.id ? "bg-timeline-track-active" : ""} ${isOver && canDrop ? "bg-accent/10" : ""} ${track.locked ? "bg-slate-900/45" : ""}`}
      style={{ height: `${visualSpec.height}px` }}
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
          let displayClip = isShifted ? { ...clip, startTime: displayStartTime } : clip;
          const activeMediaPreview = mediaDropPreview;
          if (activeMediaPreview && activeMediaPreview.splitClipId === clip.id) {
            displayClip = {
              ...displayClip,
              duration: Math.max(0, activeMediaPreview.startTime - clip.startTime),
              trimOut: clip.trimIn + Math.max(0, activeMediaPreview.startTime - clip.startTime),
            };
          }

          return (
            <Clip
              key={clip.id}
              clip={displayClip}
              mediaAsset={getMediaAsset(clip.mediaId)}
              pixelsPerSecond={pixelsPerSecond}
              trackHeightPx={visualSpec.height}
              trackVisualRole={visualSpec.role}
              trackVisualOpacity={visualSpec.opacity}
              selected={selectedClipIds.includes(clip.id)}
              locked={track.locked}
              onDragStart={onClipDragStart}
              onDragMove={onClipDragMove}
              onDragEnd={onClipDragEnd}
              onContextMenu={(e, clipId) => onClipContextMenu?.(e, clipId, track.id)}
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

      {mediaDropPreview?.splitClipId &&
        (() => {
          const splitClip = sortedTrackClips.find((clip) => clip.id === mediaDropPreview!.splitClipId);
          if (!splitClip) return null;
          const previewLeftPx = timeToPixel(mediaDropPreview.startTime + mediaDropPreview.duration, pixelsPerSecond);
          const previewRightPx = timeToPixel(splitClip.startTime + splitClip.duration, pixelsPerSecond);
          const widthPx = Math.max(1, previewRightPx - previewLeftPx);
          return (
            <div
              className="pointer-events-none absolute top-1 bottom-1 z-10 rounded border border-accent/60 bg-accent/20"
              style={{
                left: `${previewLeftPx}px`,
                width: `${widthPx}px`,
              }}
              aria-hidden
            />
          );
        })()}

      {/* Transitions layer */}
      {track.visible &&
        trackTransitions.map((t) => {
          // Find the from and to clips for this transition
          const fromClip = allClips.find((c) => c.id === t.fromItemId);
          const toClip = allClips.find((c) => c.id === t.toItemId);

          return <TransitionIndicator key={t.id} transition={t} pixelsPerSecond={pixelsPerSecond} fromClip={fromClip} toClip={toClip} />;
        })}

      {/* Gaps layer - render permanent gaps */}
      {track.visible && !(dragState && (dragState.targetTrackId === track.id || dragState.draggedClipIds?.some((id) => sortedTrackClips.some((c) => c.id === id)))) && trackGaps.map((gap) => <GapIndicator key={gap.id} gap={gap} pixelsPerSecond={pixelsPerSecond} selected={selectedGapId === gap.id} locked={track.locked} />)}

      {/* Gap indicator (blue dashed background) - temporary drag preview */}
      {gapIndicator && (() => {
        const gapLeft = timeToPixel(gapIndicator.startTime, pixelsPerSecond);
        const gapRight = timeToPixel(gapIndicator.startTime + gapIndicator.duration, pixelsPerSecond);
        const gapWidth = gapRight - gapLeft;
        return (
          <div
            className="absolute top-0 pointer-events-none z-5"
            style={{
              left: `${gapLeft}px`,
              width: `${gapWidth}px`,
              height: "100%",
              background: "rgba(96, 165, 250, 0.25)",
              border: "2px dashed rgba(96, 165, 250, 0.6)",
              borderRadius: "4px",
            }}
          />
        );
      })()}


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

// Custom comparison function to prevent unnecessary re-renders
const arePropsEqual = (prevProps: TrackProps, nextProps: TrackProps) => {
  // Check track properties
  if (prevProps.track.id !== nextProps.track.id || prevProps.track.locked !== nextProps.track.locked || prevProps.track.visible !== nextProps.track.visible || prevProps.track.height !== nextProps.track.height) {
    return false;
  }

  // Check pixelsPerSecond
  if (prevProps.pixelsPerSecond !== nextProps.pixelsPerSecond) {
    return false;
  }

  const prevVisual = prevProps.visualSpec;
  const nextVisual = nextProps.visualSpec;
  if (
    prevVisual?.role !== nextVisual?.role ||
    prevVisual?.height !== nextVisual?.height ||
    prevVisual?.opacity !== nextVisual?.opacity
  ) {
    return false;
  }

  // Check clips array - include audio-envelope fields so volume edits repaint
  // immediately instead of waiting for another parent render (for example save).
  if (prevProps.clips.length !== nextProps.clips.length) {
    return false;
  }

  // Check if clip IDs or key properties changed
  for (let i = 0; i < prevProps.clips.length; i++) {
    const prevClip = prevProps.clips[i];
    const nextClip = nextProps.clips[i];
    if (
      prevClip.id !== nextClip.id ||
      prevClip.startTime !== nextClip.startTime ||
      prevClip.duration !== nextClip.duration ||
      prevClip.volume !== nextClip.volume ||
      prevClip.fadeIn !== nextClip.fadeIn ||
      prevClip.fadeOut !== nextClip.fadeOut ||
      prevClip.volumeKeyframes !== nextClip.volumeKeyframes
    ) {
      return false;
    }
  }

  // Check dragState
  const prevDrag = prevProps.dragState;
  const nextDrag = nextProps.dragState;
  if (prevDrag?.draggingClipId !== nextDrag?.draggingClipId || prevDrag?.offsetX !== nextDrag?.offsetX || prevDrag?.offsetY !== nextDrag?.offsetY || prevDrag?.isInvalidPosition !== nextDrag?.isInvalidPosition || prevDrag?.targetTrackId !== nextDrag?.targetTrackId) {
    return false;
  }

  // Props are equal - skip re-render
  return true;
};

export const Track = React.memo(TrackInner, arePropsEqual);
