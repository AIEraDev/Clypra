import { useState, useEffect, useCallback, useRef, useMemo, RefObject } from "react";
import { useTimelineStore, getInsertIndexForNewTrack, getInsertIndexForNewTrackSmart } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useUIStore } from "@/store/uiStore";
import type { Clip } from "@/types";
import { suspendAutoSave, resumeAutoSave } from "@/store/middleware/autoSaveMiddleware";
import { calculateDraggedBlockDuration } from "@/lib/clipPositions";
import { usePlaybackClock, useTransportControls } from "@/hooks/usePlaybackClock";

// Three-layer architecture imports
import { locateTrackRegion, type TrackRegion } from "@/lib/trackRegion";
import { findSnap, type SnapResult } from "@/lib/snapTargets";
import { classifyDropTarget, type DropTarget } from "@/lib/dropTarget";
import { buildPlacementPreview, createPreviewKey, type PlacementPreview } from "@/lib/placementPreview";

const DRAG_RENDER_EPSILON_PX = 0.25;
const EDGE_HIT_WIDTH_PX = 8; // Screen-space edge detection (stable at any zoom)
const SNAP_THRESHOLD_SECONDS = 0.1; // Time-based snap threshold
const BETWEEN_TRACKS_THRESHOLD_PX = 8; // Pixels threshold to detect between-track gaps

function resolveTrackAtClientY(
  container: HTMLElement,
  tracks: Array<{ id: string }>,
  clientY: number,
): {
  targetTrackId: string | null;
  willCreateNewTrack: boolean;
  newTrackPosition: "above" | "below" | "between" | null;
  betweenTrackIds?: { aboveId: string; belowId: string };
} {
  if (tracks.length === 0) {
    return { targetTrackId: null, willCreateNewTrack: true, newTrackPosition: "below" };
  }

  const rects: { id: string; top: number; bottom: number }[] = [];
  for (const track of tracks) {
    const row = container.querySelector<HTMLElement>(`[data-track-id="${track.id}"]`);
    if (!row) continue;
    const r = row.getBoundingClientRect();
    rects.push({ id: track.id, top: r.top, bottom: r.bottom });
  }

  if (rects.length === 0) {
    return { targetTrackId: null, willCreateNewTrack: false, newTrackPosition: null };
  }

  // Sort rects by top position
  const sortedRects = [...rects].sort((a, b) => a.top - b.top);

  const firstTop = sortedRects[0].top;
  const lastBottom = sortedRects[sortedRects.length - 1].bottom;

  // Above all tracks
  if (clientY < firstTop) {
    return { targetTrackId: null, willCreateNewTrack: true, newTrackPosition: "above" };
  }

  // Below all tracks
  if (clientY >= lastBottom) {
    return { targetTrackId: null, willCreateNewTrack: true, newTrackPosition: "below" };
  }

  // Check if cursor is within a track
  for (const track of tracks) {
    const row = container.querySelector<HTMLElement>(`[data-track-id="${track.id}"]`);
    if (!row) continue;
    const r = row.getBoundingClientRect();
    if (clientY >= r.top && clientY < r.bottom) {
      return { targetTrackId: track.id, willCreateNewTrack: false, newTrackPosition: null };
    }
  }

  // Check if cursor is between tracks (in the gap)
  for (let i = 0; i < sortedRects.length - 1; i++) {
    const currentTrack = sortedRects[i];
    const nextTrack = sortedRects[i + 1];
    const gapStart = currentTrack.bottom;
    const gapEnd = nextTrack.top;
    const gapSize = gapEnd - gapStart;

    // If there's a meaningful gap and cursor is in it
    if (gapSize > 2 && clientY >= gapStart && clientY < gapEnd) {
      // Determine which track to target based on cursor position within gap
      const distToTop = clientY - gapStart;
      const distToBottom = gapEnd - clientY;

      // If cursor is very close to the gap center, show "between" indicator
      if (Math.abs(distToTop - distToBottom) < BETWEEN_TRACKS_THRESHOLD_PX) {
        return {
          targetTrackId: null,
          willCreateNewTrack: true,
          newTrackPosition: "between",
          betweenTrackIds: { aboveId: currentTrack.id, belowId: nextTrack.id },
        };
      }

      // Otherwise, snap to nearest track
      const targetId = distToTop < distToBottom ? currentTrack.id : nextTrack.id;
      return { targetTrackId: targetId, willCreateNewTrack: false, newTrackPosition: null };
    }
  }

  // Fallback: find nearest track by center distance
  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const rect of rects) {
    const mid = (rect.top + rect.bottom) / 2;
    const d = Math.abs(clientY - mid);
    if (d < bestDist) {
      bestDist = d;
      bestId = rect.id;
    }
  }
  return { targetTrackId: bestId, willCreateNewTrack: false, newTrackPosition: null };
}

export interface DragState {
  draggingClipId: string | null;
  draggedClipIds: string[];
  offsetX: number;
  offsetY: number;
  pointerXContentStart: number;
  pointerClientYStart: number;
  visualLeftAnchorDelta: number;
  originalTrackId: string;
  originalIndex: number;
  originalStartTime: number;
  originalPlacements: Record<string, { trackId: string; startTime: number; index: number }>;
  draggedBlockDuration: number;
  // Three-layer architecture state
  targetTrackId: string | null;
  trackRegion: TrackRegion | null;
  snapResult: SnapResult | null;
  dropTarget: DropTarget | null;
  placementPreview: PlacementPreview | null;
  previewCacheKey: string | null;
  // Legacy compatibility
  isInvalidPosition?: boolean;
  willCreateNewTrack?: boolean;
  newTrackPosition?: "above" | "below" | "between" | null;
  betweenTrackIds?: { aboveId: string; belowId: string };
  pointerOffsetFromLeft?: number;
}

export function useTimelineDrag(containerRef: RefObject<HTMLDivElement | null>) {
  const { tracks, clips, updateClip, withBatch, normalizeTrack, insertClipAtIndex, removeEmptyNonMainTracks, setSnapGuides, clearSnapGuides } = useTimelineStore();
  const snapEnabled = useTimelineStore((state) => state.snapEnabled);
  const clockState = usePlaybackClock();
  const currentTime = clockState.time;
  const { pause } = useTransportControls();

  const [dragState, setDragState] = useState<DragState | null>(null);

  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;

  const dragMoveRafRef = useRef<number | null>(null);
  const dragMovePointerRef = useRef<{ clipId: string; clientX: number; clientY: number } | null>(null);

  // Auto-scroll during clip drag
  const autoScrollRafRef = useRef<number | null>(null);
  const autoScrollTsRef = useRef(0);

  // ── Lookup maps: O(n) once per clip/track change, O(1) during drag ──
  const clipMapRef = useRef<Map<string, Clip>>(new Map());
  const trackClipsMapRef = useRef<Map<string, Clip[]>>(new Map());

  useMemo(() => {
    clipMapRef.current = new Map(clips.map((c) => [c.id, c]));

    const tcMap = new Map<string, Clip[]>();
    for (const track of tracks) {
      tcMap.set(
        track.id,
        clips.filter((c) => c.trackId === track.id).sort((a, b) => a.startTime - b.startTime),
      );
    }
    trackClipsMapRef.current = tcMap;
  }, [clips, tracks]);

  const handleClipDragStart = useCallback(
    (clipId: string, startX: number, startY: number, pointerOffsetFromLeft?: number) => {
      const clip = clipMapRef.current.get(clipId);
      if (!clip) return;
      pause();
      suspendAutoSave();
      const selectedClipIds = useUIStore.getState().selectedClipIds;
      const draggedClipIds = selectedClipIds.includes(clipId) ? selectedClipIds : [clipId];

      // Find clip's index in its track
      const trackClips = trackClipsMapRef.current.get(clip.trackId) ?? [];
      const originalIndex = trackClips.findIndex((c) => c.id === clipId);
      const originalPlacements: Record<string, { trackId: string; startTime: number; index: number }> = {};
      for (const draggedId of draggedClipIds) {
        const dragged = clipMapRef.current.get(draggedId);
        if (!dragged) continue;
        const draggedTrackClips = trackClipsMapRef.current.get(dragged.trackId) ?? [];
        originalPlacements[dragged.id] = {
          trackId: dragged.trackId,
          startTime: dragged.startTime,
          index: draggedTrackClips.findIndex((c) => c.id === dragged.id),
        };
      }

      const container = containerRef.current;
      let pointerXContentStart = startX;
      let visualLeftAnchorDelta = 0;
      const pointerClientYStart = startY;
      if (container) {
        const cr = container.getBoundingClientRect();
        // Convert cursor position to content coordinates
        const cursorContentX = startX - cr.left + container.scrollLeft;

        // Calculate the clip's left edge in content space
        const clipLeftContent = clip.startTime * useTimelineStore.getState().pixelsPerSecond;

        // Store the offset between cursor and clip's left edge in content space
        const pointerOffsetContent = cursorContentX - clipLeftContent;

        // Store cursor position in content space
        pointerXContentStart = cursorContentX;

        // Store the content-space offset for proper rendering
        visualLeftAnchorDelta = pointerOffsetContent;
      }

      // Calculate dragged block duration (for multi-clip selections)
      const draggedBlockDuration = calculateDraggedBlockDuration(clips, draggedClipIds);

      const nextDragState: DragState = {
        draggingClipId: clipId,
        draggedClipIds,
        offsetX: 0,
        offsetY: 0,
        pointerXContentStart,
        pointerClientYStart,
        visualLeftAnchorDelta,
        originalTrackId: clip.trackId,
        originalIndex,
        originalStartTime: clip.startTime,
        originalPlacements,
        draggedBlockDuration,
        targetTrackId: null,
        trackRegion: null,
        snapResult: null,
        dropTarget: null,
        placementPreview: null,
        previewCacheKey: null,
        isInvalidPosition: false,
        willCreateNewTrack: false,
        newTrackPosition: null,
        pointerOffsetFromLeft,
      };
      dragStateRef.current = nextDragState;
      setDragState(nextDragState);
    },
    [clips, containerRef, pause],
  );

  const flushQueuedClipDragMove = useCallback(() => {
    dragMoveRafRef.current = null;
    const pointer = dragMovePointerRef.current;
    if (!pointer) return;
    const { clipId, clientX, clientY } = pointer;
    const ds = dragStateRef.current;
    if (!ds || ds.draggingClipId !== clipId) return;

    const container = containerRef.current;
    if (!container) return;

    const cr = container.getBoundingClientRect();
    const pointerXContent = clientX - cr.left + container.scrollLeft;
    const contentDeltaPx = pointerXContent - ds.pointerXContentStart;

    const { clips: liveClips, tracks: liveTracks, pixelsPerSecond: livePps } = useTimelineStore.getState();
    const clip = clipMapRef.current.get(clipId) ?? liveClips.find((c) => c.id === clipId);
    if (!clip) return;

    // Calculate offsetX using the drag anchor
    // The clip should render so that: clipLeftAtRender = pointerXContent - visualLeftAnchorDelta
    const clipLeftOriginal = clip.startTime * livePps;
    const clipLeftAtRender = pointerXContent - ds.visualLeftAnchorDelta;
    const offsetX = clipLeftAtRender - clipLeftOriginal;
    const offsetY = clientY - ds.pointerClientYStart;

    // Debug logging (development only)
    if (import.meta.env.DEV) {
      const clipLeftContent = clip.startTime * livePps;
      const displayLeft = clipLeftContent + offsetX;
      const expectedCursorOffset = ds.visualLeftAnchorDelta;
      const actualCursorOffset = pointerXContent - displayLeft;
      const mismatch = Math.abs(expectedCursorOffset - actualCursorOffset) > 1;

      if (mismatch) {
        console.error("[DRAG MISMATCH!]", {
          expectedOffset: expectedCursorOffset,
          actualOffset: actualCursorOffset,
          difference: actualCursorOffset - expectedCursorOffset,
          visualLeftAnchorDelta: ds.visualLeftAnchorDelta,
          offsetX,
        });
      }
    }

    const { targetTrackId, willCreateNewTrack, newTrackPosition, betweenTrackIds } = resolveTrackAtClientY(container, liveTracks, clientY);

    // If creating new track, show indicator and skip architecture
    if (willCreateNewTrack) {
      const next: DragState = {
        ...ds,
        offsetX,
        offsetY,
        isInvalidPosition: false,
        targetTrackId: null,
        trackRegion: null,
        snapResult: null,
        dropTarget: null,
        placementPreview: null,
        previewCacheKey: null,
        willCreateNewTrack: true,
        newTrackPosition,
        betweenTrackIds,
      };
      const visualChanged = Math.abs((next.offsetX ?? 0) - (ds.offsetX ?? 0)) > DRAG_RENDER_EPSILON_PX || Math.abs((next.offsetY ?? 0) - (ds.offsetY ?? 0)) > DRAG_RENDER_EPSILON_PX;
      dragStateRef.current = next;
      if (visualChanged || ds.willCreateNewTrack !== next.willCreateNewTrack || ds.newTrackPosition !== next.newTrackPosition) {
        setDragState(next);
      }
      return;
    }

    const targetTrack = liveTracks.find((t) => t.id === targetTrackId);

    // Validate track compatibility
    let isTrackTypeMismatch = false;
    if (targetTrack) {
      for (const draggedId of ds.draggedClipIds) {
        const draggedClip = clipMapRef.current.get(draggedId) ?? liveClips.find((c) => c.id === draggedId);
        if (!draggedClip) continue;
        const kind = draggedClip.kind ?? (
          ("text" in draggedClip || draggedClip.id.startsWith("text-clip-")) ? "text" :
          draggedClip.mediaId.startsWith("sticker-") ? "sticker" :
          "video"
        );
        if (kind === "text" && targetTrack.type !== "text") {
          isTrackTypeMismatch = true;
          break;
        }
        if (kind === "sticker" && targetTrack.type !== "sticker") {
          isTrackTypeMismatch = true;
          break;
        }
        if (kind !== "text" && kind !== "sticker" && (targetTrack.type === "text" || targetTrack.type === "sticker")) {
          isTrackTypeMismatch = true;
          break;
        }
      }
    }

    const isInvalidPosition = targetTrack?.locked || isTrackTypeMismatch || false;
    if (isInvalidPosition) {
      const next: DragState = {
        ...ds,
        offsetX,
        offsetY,
        isInvalidPosition: true,
        targetTrackId: null,
        trackRegion: null,
        snapResult: null,
        dropTarget: null,
        placementPreview: null,
        previewCacheKey: null,
        willCreateNewTrack: false,
        newTrackPosition: null,
      };
      const visualChanged = Math.abs((next.offsetX ?? 0) - (ds.offsetX ?? 0)) > DRAG_RENDER_EPSILON_PX || Math.abs((next.offsetY ?? 0) - (ds.offsetY ?? 0)) > DRAG_RENDER_EPSILON_PX;
      dragStateRef.current = next;
      if (visualChanged || ds.isInvalidPosition !== next.isInvalidPosition) {
        setDragState(next);
      }
      return;
    }

    if (!targetTrackId) {
      const next: DragState = { ...ds, offsetX, offsetY };
      const visualChanged = Math.abs((next.offsetX ?? 0) - (ds.offsetX ?? 0)) > DRAG_RENDER_EPSILON_PX || Math.abs((next.offsetY ?? 0) - (ds.offsetY ?? 0)) > DRAG_RENDER_EPSILON_PX;
      dragStateRef.current = next;
      if (visualChanged) {
        setDragState(next);
      }
      return;
    }

    // ═══════════════════════════════════════════════════════════
    // Three-Layer Architecture
    // ═══════════════════════════════════════════════════════════

    const trackClips = trackClipsMapRef.current.get(targetTrackId) ?? [];
    const pps = Math.max(1, livePps);
    const pointerTrackX = clientX - cr.left + container.scrollLeft;
    const pointerTimeSeconds = pointerTrackX / pps;

    // Calculate where the CLIP's left edge will land (not where cursor is)
    // This accounts for the grab point offset within the clip
    const clipTargetTimeSeconds = pointerTimeSeconds - ds.visualLeftAnchorDelta / pps;

    // Layer 1: Geometry - Where is the pointer?
    const trackRegion = locateTrackRegion({
      trackClips,
      draggedClipIds: ds.draggedClipIds,
      pointerTimeSeconds: clipTargetTimeSeconds, // Use clip position, not cursor position
      pointerTrackX,
      pixelsPerSecond: pps,
      edgeHitWidthPx: EDGE_HIT_WIDTH_PX,
    });

    // Snap System - Calculate snap targets (using clip's left edge position)
    // Pass ALL clips from ALL tracks for cross-track alignment
    const allClipsForSnapping = liveClips.filter((c) => !ds.draggedClipIds.includes(c.id));

    const snapResult = findSnap({
      candidateTime: clipTargetTimeSeconds, // Snap the clip's left edge, not cursor
      trackClips: allClipsForSnapping, // Use all clips instead of just target track clips
      draggedClipIds: ds.draggedClipIds,
      snapEnabled,
      snapThresholdSeconds: SNAP_THRESHOLD_SECONDS,
      playheadTime: currentTime, // Snap to playhead position
    });

    // Update snap guides for visual feedback
    if (snapResult.snapped && snapResult.snapTarget) {
      const target = snapResult.snapTarget;
      let guideType: "clip-start" | "clip-end" | "playhead" = "clip-start";

      if (target.type === "clip-start") {
        guideType = "clip-start";
      } else if (target.type === "clip-end") {
        guideType = "clip-end";
      } else if (target.type === "playhead") {
        guideType = "playhead";
      }

      setSnapGuides([
        {
          time: snapResult.snappedTime!,
          type: guideType,
        },
      ]);
    } else {
      clearSnapGuides();
    }

    // Layer 2: Intent - What editing operation?
    const dropTarget = classifyDropTarget({
      region: trackRegion,
      trackClips,
      draggedClipIds: ds.draggedClipIds,
      pointerTimeSeconds: clipTargetTimeSeconds, // Use clip position for target classification
      snapResult,
      sourceTrackId: ds.originalTrackId,
      targetTrackId: targetTrackId,
    });

    // Check if preview needs regeneration (cache optimization)
    const newPreviewKey = createPreviewKey(targetTrackId, dropTarget, ds.draggedBlockDuration, trackClips, ds.draggedClipIds);

    let placementPreview = ds.placementPreview;
    if (newPreviewKey !== ds.previewCacheKey) {
      // Preview cache miss - regenerate
      placementPreview = buildPlacementPreview({
        dropTarget,
        trackClips,
        draggedClipIds: ds.draggedClipIds,
        draggedBlockDuration: ds.draggedBlockDuration,
      });
    }

    // Update drag state
    const next: DragState = {
      ...ds,
      offsetX,
      offsetY,
      targetTrackId,
      trackRegion,
      snapResult,
      dropTarget,
      placementPreview,
      previewCacheKey: newPreviewKey,
      isInvalidPosition: false,
      willCreateNewTrack: false,
      newTrackPosition: null,
    };

    const visualChanged = Math.abs((next.offsetX ?? 0) - (ds.offsetX ?? 0)) > DRAG_RENDER_EPSILON_PX || Math.abs((next.offsetY ?? 0) - (ds.offsetY ?? 0)) > DRAG_RENDER_EPSILON_PX;
    const targetChanged = ds.targetTrackId !== next.targetTrackId || ds.previewCacheKey !== next.previewCacheKey || ds.isInvalidPosition !== next.isInvalidPosition || ds.willCreateNewTrack !== next.willCreateNewTrack || ds.newTrackPosition !== next.newTrackPosition;

    dragStateRef.current = next;
    if (visualChanged || targetChanged) {
      setDragState(next);
    }
  }, [containerRef, snapEnabled, setSnapGuides, clearSnapGuides]);

  const handleClipDragMove = useCallback(
    (clipId: string, _deltaX: number, _deltaY: number, clientX: number, clientY: number) => {
      const ds = dragStateRef.current;
      if (!ds || ds.draggingClipId !== clipId) return;
      dragMovePointerRef.current = { clipId, clientX, clientY };
      if (dragMoveRafRef.current !== null) return;
      dragMoveRafRef.current = requestAnimationFrame(flushQueuedClipDragMove);
    },
    [flushQueuedClipDragMove],
  );

  const clearQueuedDragMove = useCallback(() => {
    if (dragMoveRafRef.current !== null) {
      cancelAnimationFrame(dragMoveRafRef.current);
      dragMoveRafRef.current = null;
    }
    dragMovePointerRef.current = null;
  }, []);

  const handleClipDragEnd = useCallback(
    (clipId: string) => {
      flushQueuedClipDragMove();
      const dragSnapshot = dragStateRef.current;

      // Clear snap guides when drag ends
      clearSnapGuides();

      if (!dragSnapshot) {
        clearQueuedDragMove();
        return;
      }

      const sourceTrackIds = Array.from(new Set(Object.values(dragSnapshot.originalPlacements).map((p) => p.trackId)));

      if (dragSnapshot.isInvalidPosition) {
        dragStateRef.current = null;
        setDragState(null);
        clearQueuedDragMove();
        resumeAutoSave();
        return;
      }

      const clip = useTimelineStore.getState().clips.find((c) => c.id === clipId);
      if (!clip) {
        dragStateRef.current = null;
        setDragState(null);
        clearQueuedDragMove();
        resumeAutoSave();
        return;
      }

      // Handle new track creation
      if (dragSnapshot.willCreateNewTrack && dragSnapshot.newTrackPosition) {
        const isTextClip = clip.kind === "text";
        const isStickerClip = clip.kind === "sticker";
        const mediaAsset = useProjectStore.getState().mediaAssets.find((a) => a.id === clip.mediaId);
        const trackType = isTextClip ? "text" : isStickerClip ? "sticker" : mediaAsset?.type === "audio" ? "audio" : "video";

        const store = useTimelineStore.getState();
        const insertIndex = getInsertIndexForNewTrackSmart(store.tracks, trackType, {
          newTrackPosition: dragSnapshot.newTrackPosition,
          betweenTrackIds: dragSnapshot.betweenTrackIds,
        });
        const newTrackId = store.insertTrackAt(trackType, insertIndex);

        const orderedDragged = [...dragSnapshot.draggedClipIds].sort((a, b) => {
          const pa = dragSnapshot.originalPlacements[a];
          const pb = dragSnapshot.originalPlacements[b];
          if (!pa || !pb) return a.localeCompare(b);
          if (pa.startTime !== pb.startTime) return pa.startTime - pb.startTime;
          return a.localeCompare(b);
        });

        const baseStartTime = 0; // New track: clips land at time 0
        const primaryDraggedId = dragSnapshot.draggingClipId ?? dragSnapshot.draggedClipIds[0];
        const primaryOriginalStart = (primaryDraggedId ? dragSnapshot.originalPlacements[primaryDraggedId]?.startTime : undefined) ?? 0;

        withBatch(() => {
          orderedDragged.forEach((id) => {
            const placement = dragSnapshot.originalPlacements[id];
            if (!placement) return;
            const relativeStartOffset = placement.startTime - primaryOriginalStart;
            updateClip(id, {
              trackId: newTrackId,
              startTime: Math.max(0, baseStartTime + relativeStartOffset),
            });
          });
        });

        removeEmptyNonMainTracks(sourceTrackIds);
        dragStateRef.current = null;
        setDragState(null);
        clearQueuedDragMove();
        resumeAutoSave();
        return;
      }

      // Handle drop based on target type
      if (!dragSnapshot.targetTrackId || !dragSnapshot.dropTarget || !dragSnapshot.placementPreview) {
        dragStateRef.current = null;
        setDragState(null);
        clearQueuedDragMove();
        resumeAutoSave();
        return;
      }

      const dropTarget = dragSnapshot.dropTarget;
      const preview = dragSnapshot.placementPreview;
      const sourceTrackId = dragSnapshot.originalTrackId;

      switch (dropTarget.type) {
        case "insert": {
          // Use preview's insertion index (already resolved from clip identity)
          const insertionIndex = preview.type === "insert" ? preview.insertionIndex : 0;

          const orderedDragged = [...dragSnapshot.draggedClipIds].sort((a, b) => {
            const pa = dragSnapshot.originalPlacements[a];
            const pb = dragSnapshot.originalPlacements[b];
            if (!pa || !pb) return a.localeCompare(b);
            if (pa.startTime !== pb.startTime) return pa.startTime - pb.startTime;
            return a.localeCompare(b);
          });

          withBatch(() => {
            orderedDragged.forEach((id, i) => {
              insertClipAtIndex(id, dragSnapshot.targetTrackId!, insertionIndex + i);
            });
          });

          // DON'T call normalizeTrack() - gaps preserved automatically!
          // The prefix-sum algorithm closes departure gap naturally.

          // Detect and sync gaps after drag operation
          const store = useTimelineStore.getState();
          if (sourceTrackId !== dragSnapshot.targetTrackId) {
            // Cross-track: detect gaps on source track (departure gap)
            store.detectAndSyncGaps(sourceTrackId);
          }
          // Also sync target track gaps
          store.detectAndSyncGaps(dragSnapshot.targetTrackId);

          break;
        }

        case "gap":
        case "append": {
          // Free positioning - prevent overlaps but preserve gaps
          const primaryDraggedId = dragSnapshot.draggingClipId ?? dragSnapshot.draggedClipIds[0];
          const primaryOriginalStart = dragSnapshot.originalPlacements[primaryDraggedId]?.startTime ?? 0;

          // Calculate the time offset for the entire selection
          const baseStartTime = dropTarget.startTime;

          // Get LATEST clips from store (not stale closure)
          const liveClips = useTimelineStore.getState().clips;

          // Get all clips on target track (excluding dragged clips)
          const targetTrackClips = liveClips.filter((c) => c.trackId === dragSnapshot.targetTrackId && !dragSnapshot.draggedClipIds.includes(c.id)).sort((a, b) => a.startTime - b.startTime);

          // Sort dragged clips by their original order
          const orderedDragged = [...dragSnapshot.draggedClipIds]
            .map((id) => {
              const placement = dragSnapshot.originalPlacements[id];
              return { id, startTime: placement?.startTime ?? 0 };
            })
            .sort((a, b) => a.startTime - b.startTime);

          // Calculate positions for dragged clips (maintaining relative spacing)
          const draggedClipsWithPositions = orderedDragged
            .map((item) => {
              const clip = liveClips.find((c) => c.id === item.id);
              if (!clip) {
                console.error(`[DRAG ERROR] Clip not found: ${item.id}`);
                return null;
              }
              const relativeOffset = item.startTime - primaryOriginalStart;
              return {
                clip,
                desiredStartTime: baseStartTime + relativeOffset,
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);

          // Check for overlaps and adjust positions (handle cascading)
          let adjustedPositions = draggedClipsWithPositions.map(({ clip, desiredStartTime }) => {
            let finalStartTime = desiredStartTime;
            let hasOverlap = true;

            // Keep checking until no overlaps (handle cascading shifts)
            while (hasOverlap) {
              hasOverlap = false;
              for (const existingClip of targetTrackClips) {
                const existingEnd = existingClip.startTime + existingClip.duration;
                const newEnd = finalStartTime + clip.duration;

                // Check for overlap
                if (finalStartTime < existingEnd && newEnd > existingClip.startTime) {
                  // Overlap detected - move to end of conflicting clip
                  finalStartTime = existingEnd;
                  hasOverlap = true; // Re-check with new position
                  break; // Restart the loop from beginning
                }
              }
            }

            return { clipId: clip.id, startTime: Math.max(0, finalStartTime) };
          });

          // Apply positions
          withBatch(() => {
            adjustedPositions.forEach(({ clipId, startTime }) => {
              updateClip(clipId, {
                startTime,
                trackId: dragSnapshot.targetTrackId!,
              });
            });
          });

          // Detect and sync gaps after free positioning
          const store = useTimelineStore.getState();
          if (sourceTrackId !== dragSnapshot.targetTrackId) {
            // Cross-track: detect gaps on source track
            store.detectAndSyncGaps(sourceTrackId);
          }
          // Also sync target track gaps
          store.detectAndSyncGaps(dragSnapshot.targetTrackId);

          break;
        }
      }

      removeEmptyNonMainTracks(sourceTrackIds);
      dragStateRef.current = null;
      setDragState(null);
      clearQueuedDragMove();
      resumeAutoSave();
    },
    [flushQueuedClipDragMove, clearQueuedDragMove, updateClip, insertClipAtIndex, removeEmptyNonMainTracks, withBatch, clearSnapGuides],
  );

  // Handle ESC key to cancel drag
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      clearQueuedDragMove();
      clearSnapGuides(); // Clear snap guides on cancel
      const ds = dragStateRef.current;
      if (!ds) return;

      // No restoration needed - we never mutated state during drag start
      dragStateRef.current = null;
      setDragState(null);
      resumeAutoSave();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearQueuedDragMove, clearSnapGuides]);

  useEffect(() => {
    return () => {
      clearQueuedDragMove();
    };
  }, [clearQueuedDragMove]);

  // ── Smooth auto-scroll during clip drag ──────────────────────────────────
  useEffect(() => {
    if (!dragState?.draggingClipId) {
      // No active drag — tear down loop
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
      autoScrollTsRef.current = 0;
      return;
    }

    const EDGE_ZONE = 80;       // px from viewport edge where scrolling starts
    const MAX_SPEED = 600;      // px/s at the very edge
    const MIN_SPEED = 60;       // px/s at the zone boundary
    const LABEL_WIDTH = 160;    // track-label column width

    const tick = (timestamp: number) => {
      const container = containerRef.current;
      const pointer = dragMovePointerRef.current;
      const ds = dragStateRef.current;

      if (!container || !pointer || !ds?.draggingClipId) {
        autoScrollRafRef.current = requestAnimationFrame(tick);
        return;
      }

      // Delta-time for frame-rate-independent speed (capped to avoid jumps)
      const elapsed = autoScrollTsRef.current
        ? Math.min(timestamp - autoScrollTsRef.current, 50)
        : 16;
      autoScrollTsRef.current = timestamp;

      const rect = container.getBoundingClientRect();
      const clipsLeft = rect.left + LABEL_WIDTH;

      let velocity = 0;

      if (pointer.clientX >= rect.right) {
        // Pointer past right edge → full speed
        velocity = MAX_SPEED;
      } else if (pointer.clientX <= clipsLeft) {
        // Pointer past left edge → full speed leftward
        velocity = -MAX_SPEED;
      } else {
        const distRight = rect.right - pointer.clientX;
        const distLeft = pointer.clientX - clipsLeft;

        if (distRight < EDGE_ZONE) {
          // Approaching right edge — quadratic ramp
          const t = 1 - distRight / EDGE_ZONE;        // 0→1
          velocity = MIN_SPEED + t * t * (MAX_SPEED - MIN_SPEED);
        } else if (distLeft < EDGE_ZONE) {
          // Approaching left edge — quadratic ramp
          const t = 1 - distLeft / EDGE_ZONE;
          velocity = -(MIN_SPEED + t * t * (MAX_SPEED - MIN_SPEED));
        }
      }

      if (velocity !== 0) {
        const scrollDelta = velocity * (elapsed / 1000);
        const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
        const newScroll = Math.max(0, Math.min(container.scrollLeft + scrollDelta, maxScroll));

        if (Math.abs(newScroll - container.scrollLeft) > 0.5) {
          container.scrollLeft = newScroll;
          useTimelineStore.getState().setScrollLeft(newScroll);

          // Cancel pending pointermove RAF to avoid double processing
          if (dragMoveRafRef.current !== null) {
            cancelAnimationFrame(dragMoveRafRef.current);
            dragMoveRafRef.current = null;
          }
          // Re-process drag position with updated scroll offset
          flushQueuedClipDragMove();
        }
      }

      autoScrollRafRef.current = requestAnimationFrame(tick);
    };

    autoScrollTsRef.current = 0;
    autoScrollRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
    };
  }, [dragState?.draggingClipId, containerRef, flushQueuedClipDragMove]);

  return {
    dragState,
    handleClipDragStart,
    handleClipDragMove,
    handleClipDragEnd,
  };
}
