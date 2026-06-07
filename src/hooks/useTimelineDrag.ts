import { useState, useEffect, useCallback, useRef, useMemo, RefObject } from "react";
import { useTimelineStore, getInsertIndexForNewTrack } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useUIStore } from "@/store/uiStore";
import { usePlayback } from "@/hooks/usePlayback";
import type { Clip } from "@/types";
import { suspendAutoSave, resumeAutoSave } from "@/store/middleware/autoSaveMiddleware";

const DRAG_RENDER_EPSILON_PX = 0.25;
const BOUNDARY_SNAP_EPSILON_PX = 2;
const TIME_SNAP_EPSILON_SEC = 0.06;

function resolveTrackAtClientY(
  container: HTMLElement,
  tracks: Array<{ id: string }>,
  clientY: number,
): {
  targetTrackId: string | null;
  willCreateNewTrack: boolean;
  newTrackPosition: "above" | "below" | null;
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

  const firstTop = Math.min(...rects.map((x) => x.top));
  const lastBottom = Math.max(...rects.map((x) => x.bottom));

  if (clientY < firstTop) {
    return { targetTrackId: null, willCreateNewTrack: true, newTrackPosition: "above" };
  }
  if (clientY >= lastBottom) {
    return { targetTrackId: null, willCreateNewTrack: true, newTrackPosition: "below" };
  }

  for (const track of tracks) {
    const row = container.querySelector<HTMLElement>(`[data-track-id="${track.id}"]`);
    if (!row) continue;
    const r = row.getBoundingClientRect();
    if (clientY >= r.top && clientY < r.bottom) {
      return { targetTrackId: track.id, willCreateNewTrack: false, newTrackPosition: null };
    }
  }

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
  targetTrackId: string | null;
  insertionIndex: number | null;
  gapStartTime: number | null;
  gapDuration: number | null;
  targetStartTime: number | null;
  isInvalidPosition?: boolean;
  willCreateNewTrack?: boolean;
  newTrackPosition?: "above" | "below" | null;
}

export function useTimelineDrag(containerRef: RefObject<HTMLDivElement | null>) {
  const { tracks, clips, updateClip, withBatch, normalizeTrack, insertClipAtIndex, removeEmptyNonMainTracks } = useTimelineStore();
  const { currentTime } = usePlayback();

  const [dragState, setDragState] = useState<DragState | null>(null);

  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;

  const dragMoveRafRef = useRef<number | null>(null);
  const dragMovePointerRef = useRef<{ clipId: string; clientX: number; clientY: number } | null>(null);
  const dragTrackMetricsRef = useRef<
    Map<
      string,
      {
        trackClips: Clip[];
        prefixWidths: Float64Array;
        midpoints: Float64Array;
      }
    >
  >(new Map());

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

  const buildDragTrackMetrics = useCallback((draggedClipIds: string[], pps: number) => {
    const draggedSet = new Set(draggedClipIds);
    const metrics = new Map<
      string,
      {
        trackClips: Clip[];
        prefixWidths: Float64Array;
        midpoints: Float64Array;
      }
    >();

    for (const track of useTimelineStore.getState().tracks) {
      const trackClips = (trackClipsMapRef.current.get(track.id) ?? []).filter((c) => !draggedSet.has(c.id));
      const prefixWidths = new Float64Array(trackClips.length + 1);
      const midpoints = new Float64Array(trackClips.length);
      for (let i = 0; i < trackClips.length; i++) {
        const w = trackClips[i].duration * pps;
        prefixWidths[i + 1] = prefixWidths[i] + w;
        midpoints[i] = prefixWidths[i] + w / 2;
      }
      metrics.set(track.id, { trackClips, prefixWidths, midpoints });
    }

    dragTrackMetricsRef.current = metrics;
  }, []);

  const handleClipDragStart = useCallback(
    (clipId: string, startX: number, startY: number) => {
      const clip = clipMapRef.current.get(clipId);
      if (!clip) return;
      suspendAutoSave();
      const selectedClipIds = useUIStore.getState().selectedClipIds;
      const draggedClipIds = selectedClipIds.includes(clipId) ? selectedClipIds : [clipId];
      const pps = useTimelineStore.getState().pixelsPerSecond;
      buildDragTrackMetrics(draggedClipIds, pps);

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

      const originalLeftPx = Math.round(clip.startTime * pps);

      // Calculate what the visual offset would be if we moved clip to tail
      // WITHOUT actually moving it yet - this is preview-only state
      const otherClips = trackClips.filter((c) => c.id !== clipId);
      let tailTime = 0;
      otherClips.forEach((c) => {
        tailTime += c.duration;
      });

      const leftNewPx = Math.round(tailTime * pps);
      const visualLeftAnchorDelta = originalLeftPx - leftNewPx;

      const container = containerRef.current;
      let pointerXContentStart = startX;
      const pointerClientYStart = startY;
      if (container) {
        const cr = container.getBoundingClientRect();
        pointerXContentStart = startX - cr.left + container.scrollLeft;
      }

      const nextDragState: DragState = {
        draggingClipId: clipId,
        draggedClipIds,
        offsetX: visualLeftAnchorDelta,
        offsetY: 0,
        pointerXContentStart,
        pointerClientYStart,
        visualLeftAnchorDelta,
        originalTrackId: clip.trackId,
        originalIndex,
        originalStartTime: clip.startTime,
        originalPlacements,
        targetTrackId: null,
        insertionIndex: null,
        gapStartTime: null,
        gapDuration: null,
        targetStartTime: null,
        isInvalidPosition: false,
        willCreateNewTrack: false,
        newTrackPosition: null,
      };
      dragStateRef.current = nextDragState;
      setDragState(nextDragState);
    },
    [buildDragTrackMetrics, updateClip, withBatch, containerRef],
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
    const offsetX = contentDeltaPx + ds.visualLeftAnchorDelta;
    const offsetY = clientY - ds.pointerClientYStart;

    const { clips: liveClips, tracks: liveTracks } = useTimelineStore.getState();
    const clip = clipMapRef.current.get(clipId) ?? liveClips.find((c) => c.id === clipId);
    if (!clip) return;

    const { targetTrackId, willCreateNewTrack, newTrackPosition } = resolveTrackAtClientY(container, liveTracks, clientY);

    // If creating new track, show indicator and skip insertion calculation.
    if (willCreateNewTrack) {
      const next: DragState = {
        ...ds,
        offsetX,
        offsetY,
        isInvalidPosition: false,
        targetTrackId: null,
        insertionIndex: null,
        gapStartTime: null,
        gapDuration: null,
        targetStartTime: null,
        willCreateNewTrack: true,
        newTrackPosition,
      };
      const visualChanged = Math.abs((next.offsetX ?? 0) - (ds.offsetX ?? 0)) > DRAG_RENDER_EPSILON_PX || Math.abs((next.offsetY ?? 0) - (ds.offsetY ?? 0)) > DRAG_RENDER_EPSILON_PX;
      dragStateRef.current = next;
      if (visualChanged || ds.willCreateNewTrack !== next.willCreateNewTrack || ds.newTrackPosition !== next.newTrackPosition) {
        setDragState(next);
      }
      return;
    }

    const targetTrack = liveTracks.find((t) => t.id === targetTrackId);

    // Validate ALL dragged clips against target track, not just primary
    let isTrackTypeMismatch = false;
    if (targetTrack) {
      for (const draggedId of ds.draggedClipIds) {
        const draggedClip = clipMapRef.current.get(draggedId) ?? liveClips.find((c) => c.id === draggedId);
        if (!draggedClip) continue;
        const isTextClip = "text" in draggedClip;
        if (isTextClip ? targetTrack.type !== "text" : targetTrack.type === "text") {
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
        insertionIndex: null,
        gapStartTime: null,
        gapDuration: null,
        targetStartTime: null,
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

    const { pixelsPerSecond: livePps, clipDragMode: dragMode, snapEnabled: snapOn } = useTimelineStore.getState();
    const pps = Math.max(1, livePps);
    const dragPrimaryPlacement = ds.originalPlacements[ds.draggingClipId ?? ""];
    const dragPrimaryStart = dragPrimaryPlacement?.startTime ?? 0;
    const deltaTime = (offsetX - ds.visualLeftAnchorDelta) / pps;
    let targetStartTime = Math.max(0, dragPrimaryStart + deltaTime);

    if (snapOn) {
      const snapCandidates: number[] = [0, currentTime];
      const onTrack = (trackClipsMapRef.current.get(targetTrackId) ?? []).filter((c) => c.id !== clipId);
      for (const c of onTrack) {
        snapCandidates.push(c.startTime, c.startTime + c.duration);
      }
      let closest = targetStartTime;
      let best = Infinity;
      for (const t of snapCandidates) {
        const d = Math.abs(t - targetStartTime);
        if (d <= TIME_SNAP_EPSILON_SEC && d < best) {
          best = d;
          closest = t;
        }
      }
      targetStartTime = closest;
    }

    if (dragMode === "insert" || dragMode === "ripple") {
      const trackMetrics = dragTrackMetricsRef.current.get(targetTrackId) ?? {
        trackClips: [],
        prefixWidths: new Float64Array(1),
        midpoints: new Float64Array(0),
      };
      const pointerX = clientX - cr.left + container.scrollLeft;
      let lo = 0;
      let hi = trackMetrics.midpoints.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const clipMidpoint = trackMetrics.midpoints[mid];
        if (pointerX < clipMidpoint) hi = mid;
        else lo = mid + 1;
      }
      let insertionIndex = lo;
      const boundaryMidpoint = trackMetrics.midpoints[Math.max(0, Math.min(trackMetrics.midpoints.length - 1, insertionIndex - 1))];
      if (Number.isFinite(boundaryMidpoint) && Math.abs(pointerX - boundaryMidpoint) <= BOUNDARY_SNAP_EPSILON_PX && ds.targetTrackId === targetTrackId && ds.insertionIndex !== null) {
        insertionIndex = ds.insertionIndex;
      }
      const gapStartTime = trackMetrics.prefixWidths[Math.max(0, Math.min(trackMetrics.prefixWidths.length - 1, insertionIndex))] / pps;
      const next: DragState = {
        ...ds,
        offsetX,
        offsetY,
        isInvalidPosition: false,
        targetTrackId,
        insertionIndex,
        gapStartTime,
        gapDuration: clip.duration,
        targetStartTime,
        willCreateNewTrack: false,
        newTrackPosition: null,
      };
      const visualChanged = Math.abs((next.offsetX ?? 0) - (ds.offsetX ?? 0)) > DRAG_RENDER_EPSILON_PX || Math.abs((next.offsetY ?? 0) - (ds.offsetY ?? 0)) > DRAG_RENDER_EPSILON_PX;
      const targetChanged = ds.targetTrackId !== next.targetTrackId || ds.targetStartTime !== next.targetStartTime || ds.insertionIndex !== next.insertionIndex || ds.isInvalidPosition !== next.isInvalidPosition || ds.willCreateNewTrack !== next.willCreateNewTrack || ds.newTrackPosition !== next.newTrackPosition;
      dragStateRef.current = next;
      if (visualChanged || targetChanged) setDragState(next);
      return;
    }

    const next: DragState = {
      ...ds,
      offsetX,
      offsetY,
      isInvalidPosition: false,
      targetTrackId,
      insertionIndex: null,
      gapStartTime: targetStartTime,
      gapDuration: clip.duration,
      targetStartTime,
      willCreateNewTrack: false,
      newTrackPosition: null,
    };
    const visualChanged = Math.abs((next.offsetX ?? 0) - (ds.offsetX ?? 0)) > DRAG_RENDER_EPSILON_PX || Math.abs((next.offsetY ?? 0) - (ds.offsetY ?? 0)) > DRAG_RENDER_EPSILON_PX;
    const targetChanged = ds.targetTrackId !== next.targetTrackId || ds.targetStartTime !== next.targetStartTime || ds.insertionIndex !== next.insertionIndex || ds.isInvalidPosition !== next.isInvalidPosition || ds.willCreateNewTrack !== next.willCreateNewTrack || ds.newTrackPosition !== next.newTrackPosition;
    dragStateRef.current = next;
    if (visualChanged || targetChanged) {
      setDragState(next);
    }
  }, [containerRef, currentTime]);

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
    dragTrackMetricsRef.current.clear();
  }, []);

  const handleClipDragEnd = useCallback(
    (clipId: string) => {
      flushQueuedClipDragMove();
      const dragSnapshot = dragStateRef.current;
      if (!dragSnapshot) {
        clearQueuedDragMove();
        return;
      }

      const sourceTrackIds = Array.from(new Set(Object.values(dragSnapshot.originalPlacements).map((p) => p.trackId)));

      if (dragSnapshot.isInvalidPosition) {
        // No restoration needed - we never mutated state during drag start
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
        const isTextClip = "text" in clip;
        const mediaAsset = useProjectStore.getState().mediaAssets.find((a) => a.id === clip.mediaId);
        const trackType = isTextClip ? "text" : mediaAsset?.type === "audio" ? "audio" : "video";

        const store = useTimelineStore.getState();
        const insertIndex = getInsertIndexForNewTrack(store.tracks, trackType);
        const newTrackId = store.insertTrackAt(trackType, insertIndex);
        const orderedDragged = [...dragSnapshot.draggedClipIds].sort((a, b) => {
          const pa = dragSnapshot.originalPlacements[a];
          const pb = dragSnapshot.originalPlacements[b];
          if (!pa || !pb) return a.localeCompare(b);
          if (pa.startTime !== pb.startTime) return pa.startTime - pb.startTime;
          return a.localeCompare(b);
        });
        const baseStartTime = dragSnapshot.targetStartTime ?? 0;
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

      const { pixelsPerSecond: livePps, clipDragMode: dragMode } = useTimelineStore.getState();
      if ((dragMode === "insert" || dragMode === "ripple") && dragSnapshot.targetTrackId && dragSnapshot.insertionIndex !== null) {
        const orderedDragged = [...dragSnapshot.draggedClipIds].sort((a, b) => {
          const pa = dragSnapshot.originalPlacements[a];
          const pb = dragSnapshot.originalPlacements[b];
          if (!pa || !pb) return a.localeCompare(b);
          if (pa.startTime !== pb.startTime) return pa.startTime - pb.startTime;
          return a.localeCompare(b);
        });
        orderedDragged.forEach((id, i) => insertClipAtIndex(id, dragSnapshot.targetTrackId!, dragSnapshot.insertionIndex! + i));
        if (dragMode === "ripple") normalizeTrack(dragSnapshot.targetTrackId);
        removeEmptyNonMainTracks(sourceTrackIds);
        dragStateRef.current = null;
        setDragState(null);
        clearQueuedDragMove();
        resumeAutoSave();
        return;
      }

      const pps = livePps;
      const anchor = dragSnapshot.visualLeftAnchorDelta ?? 0;
      const deltaTime = (dragSnapshot.offsetX - anchor) / pps;
      const normalizedDeltaTime = Math.max(
        deltaTime,
        ...dragSnapshot.draggedClipIds.map((id) => {
          const placement = dragSnapshot.originalPlacements[id];
          return placement ? -placement.startTime : 0;
        }),
      );
      const destinationTrackId = dragSnapshot.targetTrackId;

      withBatch(() => {
        dragSnapshot.draggedClipIds.forEach((id) => {
          const placement = dragSnapshot.originalPlacements[id];
          if (!placement) return;
          updateClip(id, {
            startTime: Math.max(0, placement.startTime + normalizedDeltaTime),
            trackId: destinationTrackId ?? placement.trackId,
          });
        });
      });
      removeEmptyNonMainTracks(sourceTrackIds);

      dragStateRef.current = null;
      setDragState(null);
      clearQueuedDragMove();
      resumeAutoSave();
    },
    [flushQueuedClipDragMove, clearQueuedDragMove, updateClip, insertClipAtIndex, normalizeTrack, removeEmptyNonMainTracks, withBatch],
  );

  // Handle ESC key to cancel drag
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      clearQueuedDragMove();
      const ds = dragStateRef.current;
      if (!ds) return;

      // No restoration needed - we never mutated state during drag start
      dragStateRef.current = null;
      setDragState(null);
      resumeAutoSave();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearQueuedDragMove]);

  useEffect(() => {
    return () => {
      clearQueuedDragMove();
    };
  }, [clearQueuedDragMove]);

  return {
    dragState,
    handleClipDragStart,
    handleClipDragMove,
    handleClipDragEnd,
  };
}
