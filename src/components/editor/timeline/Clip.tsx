import React, { useState, useEffect, useRef } from "react";
import { Layers, Sparkles } from "lucide-react";
import { useUIStore } from "@/store/uiStore";
import { useTimelineStore } from "@/store/timelineStore";
import {
  getPlaybackClock,
  useTransportControls,
} from "@/hooks/usePlaybackClock";
import type { Clip as ClipType, MediaAsset } from "@/types";
import type { TrackVisualRole } from "@/lib/timeline/trackTypeConfig";
import { ClipFilmstrip } from "./ClipFilmstrip";
import { VolumeWaveform } from "./VolumeWaveform";
import { AudioEnvelopeEditor } from "./AudioEnvelopeEditor";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useHistoryStore } from "@/store/historyStore";
import { TimelineTrimCommand } from "@/core/history/commands/TimelineTrimCommand";
import {
  getPreviewInteractionCoordinator,
  type PreviewInteractionToken,
} from "@/core/interactions";

import { timeToPixel, pixelToTime } from "@/lib/timeline/timelineViewport";

const isExternalOrDataUrl = (value: string) =>
  value.startsWith("data:") ||
  value.startsWith("http") ||
  value.startsWith("asset://");

const resolveMediaSrc = (path: string) => {
  if (!path) return "";
  return isExternalOrDataUrl(path) ? path : convertFileSrc(path);
};

/** Movement past this (px) starts a clip drag; below it, release is still a click (selection set on pointerDown). */
const DRAG_THRESHOLD_PX = 6;
const MAX_STILL_CLIP_DURATION_SEC = 60 * 60; // 1 hour guardrail for stills
const MIN_TRIM_DURATION_SEC = 1;
const SNAP_THRESHOLD_SECONDS = 0.1; // Snap when within 100ms

interface ClipProps {
  clip: ClipType;
  mediaAsset?: MediaAsset;
  pixelsPerSecond: number;
  trackHeightPx?: number;
  trackVisualRole?: TrackVisualRole;
  trackVisualOpacity?: number;
  selected?: boolean;
  active?: boolean;
  locked?: boolean;
  onDragStart?: (
    clipId: string,
    startX: number,
    startY: number,
    pointerOffsetFromLeft?: number,
  ) => void;
  onDragMove?: (
    clipId: string,
    deltaX: number,
    deltaY: number,
    clientX: number,
    clientY: number,
  ) => void;
  onDragEnd?: (clipId: string) => void;
  onContextMenu?: (e: React.MouseEvent, clipId: string) => void;
  isBeingShifted?: boolean;
  dragState?: {
    isDragging: boolean;
    offsetX: number;
    offsetY: number;
    isInvalidPosition?: boolean;
  };
}

const ClipInner: React.FC<ClipProps> = ({
  clip,
  mediaAsset,
  pixelsPerSecond,
  trackHeightPx = 80,
  trackVisualRole,
  trackVisualOpacity = 1,
  selected,
  active = false,
  locked = false,
  onDragStart,
  onDragMove,
  onDragEnd,
  onContextMenu,
  isBeingShifted = false,
  dragState,
}) => {
  const selectClip = useUIStore((s) => s.selectClip);
  const toggleClipSelection = useUIStore((s) => s.toggleClipSelection);
  // PERF-4 fix: granular selectors prevent all clips re-rendering on every scroll/clip change
  const updateClip = useTimelineStore((s) => s.updateClip);
  const rippleEditEnabled = useTimelineStore((s) => s.rippleEditEnabled);
  const rippleTrimClip = useTimelineStore((s) => s.rippleTrimClip);
  const snapEnabled = useTimelineStore((s) => s.snapEnabled);
  const setSnapGuides = useTimelineStore((s) => s.setSnapGuides);
  const clearSnapGuides = useTimelineStore((s) => s.clearSnapGuides);
  useTransportControls();
  const previewInteractionCoordinator = getPreviewInteractionCoordinator();
  const previewInteractionRef = useRef<PreviewInteractionToken | null>(null);

  const [isResizing, setIsResizing] = useState<"left" | "right" | null>(null);
  const resizeStartRef = useRef<{
    x: number;
    startTime: number;
    duration: number;
    trimIn: number;
    trimOut: number;
    isRipple: boolean;
    beforeClips: ClipType[];
    beforeGaps: import("@/types/gap").Gap[];
  } | null>(null);
  const [isRippleResize, setIsRippleResize] = useState(false);
  const clipRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    hasMoved: boolean;
    hasDragStarted: boolean;
    pointerId: number;
    pointerOffsetFromLeft?: number;
  } | null>(null);
  const isPointerOnResizeHandle = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return Boolean(el.closest("[data-clip-resize-handle='true']"));
  };

  // Calculate position (derived from right edge to align with END marker)
  const left = timeToPixel(clip.startTime, pixelsPerSecond);
  const right = timeToPixel(clip.startTime + clip.duration, pixelsPerSecond);
  const width = right - left;
  const clipMetaRowHeightPx = 20;
  const clipAudioRowHeightPx = 16;
  const clipFilmstripHeightPx = Math.max(
    1,
    trackHeightPx - clipMetaRowHeightPx - clipAudioRowHeightPx,
  );

  // Apply drag offset if dragging
  const isDragging = dragState?.isDragging || false;
  const isInvalidPosition = dragState?.isInvalidPosition || false;
  const displayLeft = isDragging ? left + (dragState?.offsetX || 0) : left;
  const trackToneClass =
    trackVisualRole === "a-roll"
      ? "border-accent/70"
      : trackVisualRole === "b-roll"
        ? "border-accent/30"
        : trackVisualRole === "audio"
          ? "border-border/70"
          : trackVisualRole
            ? "border-accent/25"
            : "";
  // Trim handles are a selection affordance, not a hover affordance. Keep
  // both handles on the exact same visibility rule so an unselected clip has
  // no visible or interactive trim edge.
  const showResizeHandles = selected && clip.kind !== "compound";
  const resizeHandleVisibility = showResizeHandles
    ? "opacity-100 pointer-events-auto"
    : "pointer-events-none opacity-0";

  // Handle right-click context menu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const currentSelectedIds = useUIStore.getState().selectedClipIds;
    if (!currentSelectedIds.includes(clip.id)) {
      selectClip(clip.id);
    }
    onContextMenu?.(e, clip.id);
  };

  // Keyboard navigation & accessibility actions
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (locked) return;

    // Selection & multi-selection
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        toggleClipSelection(clip.id);
      } else {
        selectClip(clip.id);
      }
      return;
    }

    // Deselection
    if (e.key === "Escape") {
      if (selected) {
        e.preventDefault();
        e.stopPropagation();
        selectClip(null);
      }
      return;
    }

    // Keyboard-triggered context menu (ContextMenu key or Shift+F10)
    if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
      const currentSelectedIds = useUIStore.getState().selectedClipIds;
      if (!currentSelectedIds.includes(clip.id)) {
        selectClip(clip.id);
      }
      const rect = clipRef.current?.getBoundingClientRect();
      const clientX = rect ? rect.left + rect.width / 2 : 0;
      const clientY = rect ? rect.top + rect.height / 2 : 0;
      onContextMenu?.(
        {
          clientX,
          clientY,
          preventDefault: () => {},
          stopPropagation: () => {},
        } as unknown as React.MouseEvent,
        clip.id,
      );
      return;
    }

    // Keyboard nudge with Alt/Option + Left/Right arrows
    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? 1.0 : 1 / 30; // 1 sec with Shift, 1 frame (1/30s) without
      const delta = e.key === "ArrowRight" ? step : -step;
      const newStartTime = Math.max(0, clip.startTime + delta);
      updateClip(clip.id, { startTime: newStartTime });
      return;
    }
  };

  // Handle pointer-based drag
  const handlePointerDown = (e: React.PointerEvent) => {
    // Ignore if locked, resizing, or not left button
    if (locked || isResizing || (e.button !== 0 && e.pointerType === "mouse"))
      return;

    // Check if clicking resize handle
    if (isPointerOnResizeHandle(e.target)) {
      return;
    }

    // Start drag
    e.stopPropagation();
    const rect = clipRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Select on press so a real click always selects; drag only starts after DRAG_THRESHOLD_PX.
    const isMultiKey = e.shiftKey || e.metaKey || e.ctrlKey;
    const alreadySelected = useUIStore
      .getState()
      .selectedClipIds.includes(clip.id);
    if (isMultiKey) {
      toggleClipSelection(clip.id);
    } else if (!alreadySelected) {
      selectClip(clip.id);
    }

    // Calculate offset from clip's left edge to cursor for proper drag anchoring
    const pointerOffsetFromLeft = e.clientX - rect.left;

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTime: clip.startTime,
      hasMoved: false,
      hasDragStarted: false,
      pointerId: e.pointerId,
      pointerOffsetFromLeft, // Store where cursor is within the clip
    };

    // Capture pointer for smooth dragging
    clipRef.current?.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isPointerOnResizeHandle(e.target)) return;
    if (!dragStartRef.current || !onDragMove) {
      // Silently ignore pointer moves when not dragging (normal behavior)
      return;
    }

    const deltaX = e.clientX - dragStartRef.current.startX;
    const deltaY = e.clientY - dragStartRef.current.startY;

    // Mark as moved if threshold exceeded
    if (
      !dragStartRef.current.hasMoved &&
      (Math.abs(deltaX) > DRAG_THRESHOLD_PX ||
        Math.abs(deltaY) > DRAG_THRESHOLD_PX)
    ) {
      dragStartRef.current.hasMoved = true;
      if (!dragStartRef.current.hasDragStarted) {
        dragStartRef.current.hasDragStarted = true;

        // Pass original pointer-down values - NEVER recompute the anchor
        onDragStart?.(
          clip.id,
          dragStartRef.current.startX,
          dragStartRef.current.startY,
          dragStartRef.current.pointerOffsetFromLeft,
        );

        return;
      }
    }

    if (dragStartRef.current.hasMoved) {
      onDragMove(clip.id, deltaX, deltaY, e.clientX, e.clientY);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;

    if (dragStartRef.current.hasDragStarted) {
      onDragEnd?.(clip.id);
    }
    clipRef.current?.releasePointerCapture(dragStartRef.current.pointerId);
    dragStartRef.current = null;
  };

  const handlePointerCancel = () => {
    if (!dragStartRef.current) return;
    if (dragStartRef.current.hasDragStarted) {
      onDragEnd?.(clip.id);
    }
    clipRef.current?.releasePointerCapture(dragStartRef.current.pointerId);
    dragStartRef.current = null;
  };

  const resizePointerIdRef = useRef<number | null>(null);
  const activeResizeHandleRef = useRef<HTMLElement | null>(null);
  // PERF (0-B): RAF coalescing refs for resize pointer events.
  // Raw pointermove fires at 120–240Hz on high-polling devices. We coalesce
  // all events within a single display frame into one store write.
  const resizeRafRef = useRef<number | null>(null);
  const pendingResizeEventRef = useRef<PointerEvent | null>(null);

  const handleResizeStart = (e: React.PointerEvent, side: "left" | "right") => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0 && e.pointerType === "mouse") {
      return;
    }
    if (locked) {
      return;
    }

    previewInteractionRef.current =
      previewInteractionCoordinator.begin("clip-trim");

    // Let's check if ripple mode is active (Shift key OR global ripple mode enabled)
    const isRipple = e.shiftKey || rippleEditEnabled;
    resizePointerIdRef.current = e.pointerId;
    activeResizeHandleRef.current = e.currentTarget as HTMLElement;
    try {
      activeResizeHandleRef.current.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    setIsResizing(side);
    setIsRippleResize(isRipple);
    const timelineBeforeResize = useTimelineStore.getState();
    resizeStartRef.current = {
      x: e.clientX,
      startTime: clip.startTime,
      duration: clip.duration,
      trimIn: clip.trimIn,
      trimOut: clip.trimOut,
      isRipple,
      beforeClips: timelineBeforeResize.clips.map((candidate) => ({
        ...candidate,
      })),
      beforeGaps: timelineBeforeResize.gaps.map((gap) => ({
        ...gap,
        metadata: gap.metadata ? { ...gap.metadata } : gap.metadata,
      })),
    };

    // Let's prevent text selection during resize
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const initialResizeStart = resizeStartRef.current;
    if (!isResizing) {
      return;
    }
    if (!initialResizeStart) {
      return;
    }

    // FIX: Capture clipId and trackId once at effect start to avoid stale closure bug.
    // Previously, `clip` was in the dependency array, causing the effect to rebuild
    // on every state update during resize. This reset resizeStartRef mid-drag, breaking
    // cumulative delta calculations. Now we capture stable IDs and never re-run the effect
    // during an active resize operation.
    const clipId = clip.id;
    const trackId = clip.trackId;

    const applyResizeMove = (e: PointerEvent) => {
      if (
        resizePointerIdRef.current !== null &&
        e.pointerId !== resizePointerIdRef.current
      ) {
        return;
      }
      const resizeStart = resizeStartRef.current;
      if (!resizeStart) {
        return;
      }
      const deltaX = e.clientX - resizeStart.x;
      const deltaTime = pixelToTime(deltaX, pixelsPerSecond);

      const isRippleActive = e.shiftKey || rippleEditEnabled;

      // read clips from store snapshot instead of stale closure
      const storeState = useTimelineStore.getState();
      const liveClips = storeState.clips;
      const trackClips = liveClips.filter(
        (c) => c.trackId === trackId && c.id !== clipId,
      );
      const allClips = liveClips.filter((c) => c.id !== clipId);

      const prevClipEnd = trackClips.reduce((maxEnd, c) => {
        const end = c.startTime + c.duration;
        if (end <= resizeStart.startTime + 1e-6) return Math.max(maxEnd, end);
        return maxEnd;
      }, 0);
      const nextClipStart = trackClips.reduce((minStart, c) => {
        if (c.startTime >= resizeStart.startTime + resizeStart.duration - 1e-6)
          return Math.min(minStart, c.startTime);
        return minStart;
      }, Number.POSITIVE_INFINITY);

      // Snap detection logic
      let snappedTime: number | null = null;
      let snapGuides: Array<{
        time: number;
        type: "clip-start" | "clip-end" | "playhead";
      }> = [];

      if (snapEnabled) {
        // Calculate the edge time we're moving
        const currentEdgeTime =
          isResizing === "left"
            ? resizeStart.startTime + deltaTime
            : resizeStart.startTime + resizeStart.duration + deltaTime;

        // Build snap candidates
        const snapCandidates: Array<{
          time: number;
          type: "clip-start" | "clip-end" | "playhead";
        }> = [];

        // Read playhead time imperatively (no subscription - only read when actually needed during resize)
        // This avoids re-rendering all clips on every playback frame
        const playbackClock = getPlaybackClock();
        const currentTime = playbackClock.time;

        // Add playhead position as snap candidate
        snapCandidates.push({ time: currentTime, type: "playhead" });

        // Add all other clip edges (across all tracks for professional alignment)
        for (const c of allClips) {
          snapCandidates.push({ time: c.startTime, type: "clip-start" });
          snapCandidates.push({
            time: c.startTime + c.duration,
            type: "clip-end",
          });
        }

        // Find closest snap point
        let bestCandidate: (typeof snapCandidates)[0] | null = null;
        let bestDistance = SNAP_THRESHOLD_SECONDS;

        for (const candidate of snapCandidates) {
          const distance = Math.abs(candidate.time - currentEdgeTime);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestCandidate = candidate;
          }
        }

        if (bestCandidate) {
          snappedTime = bestCandidate.time;
          snapGuides = [bestCandidate];
        }
      }

      // Update snap guides in store
      if (snapGuides.length > 0) {
        setSnapGuides(snapGuides);
      } else {
        clearSnapGuides();
      }

      if (isRippleActive) {
        // RIPPLE MODE: Shift downstream clips
        rippleTrimClip(clipId, isResizing, deltaTime);

        // Update resizeStart to track cumulative changes
        resizeStartRef.current = {
          ...resizeStart,
          x: e.clientX,
        };
      } else {
        // STANDARD MODE: Normal trim (no ripple)

        // Apply snap adjustment if snapping is active
        let adjustedDeltaTime = deltaTime;
        if (snappedTime !== null) {
          if (isResizing === "left") {
            adjustedDeltaTime = snappedTime - resizeStart.startTime;
          } else {
            adjustedDeltaTime =
              snappedTime - (resizeStart.startTime + resizeStart.duration);
          }
        }

        if (isResizing === "left") {
          // Resize from left (trim in)
          const minDuration = MIN_TRIM_DURATION_SEC;
          const isStill = !mediaAsset || mediaAsset.type === "image";
          const maxMediaTime = isStill
            ? MAX_STILL_CLIP_DURATION_SEC
            : (mediaAsset?.duration ?? resizeStart.trimOut);
          const maxTrimIn = Math.min(maxMediaTime, resizeStart.trimOut - 0.001);

          // Calculate minimum start time (collision with previous clip or timeline start)
          const minStartTimeByPrevClip = prevClipEnd;
          const minStartTimeByTimeline = 0;
          const minStartTime = Math.max(
            minStartTimeByPrevClip,
            minStartTimeByTimeline,
          );

          // Calculate maximum start time (maintain minimum duration and media bounds)
          const maxStartTimeByDuration =
            resizeStart.startTime + resizeStart.duration - minDuration;
          const maxStartTimeByMedia =
            resizeStart.startTime + (maxTrimIn - resizeStart.trimIn);
          const maxStartTime = Math.min(
            maxStartTimeByDuration,
            maxStartTimeByMedia,
          );

          // Calculate desired start time with snap adjustment, then clamp to valid range
          const desiredStartTime = resizeStart.startTime + adjustedDeltaTime;
          const newStartTime = Math.max(
            minStartTime,
            Math.min(desiredStartTime, maxStartTime),
          );

          // Calculate new duration and trimIn based on the new start time
          const clipEndTime = resizeStart.startTime + resizeStart.duration;
          const newDuration = clipEndTime - newStartTime;
          const startTimeDelta = newStartTime - resizeStart.startTime;
          const newTrimIn = resizeStart.trimIn + startTimeDelta;

          // PERF (0-B / 8-C): Skip epoch increment during drag preview.
          // The committed TimelineTrimCommand on pointerup will trigger a full
          // epoch increment. This prevents 120–240 filmstrip invalidations/sec.
          updateClip(clipId, {
            startTime: newStartTime,
            duration: newDuration,
            trimIn: newTrimIn,
            _skipEpochIncrement: true,
          } as Parameters<typeof updateClip>[1]);
        } else {
          // Resize from right (trim out)
          const minDuration = MIN_TRIM_DURATION_SEC;
          const isStill = !mediaAsset || mediaAsset.type === "image";
          const maxMediaTime = isStill
            ? MAX_STILL_CLIP_DURATION_SEC
            : (mediaAsset?.duration ?? resizeStart.trimOut);
          const maxDurationByMedia = Math.max(
            minDuration,
            maxMediaTime - resizeStart.trimIn,
          );
          const maxDurationByNextClip = Number.isFinite(nextClipStart)
            ? Math.max(minDuration, nextClipStart - resizeStart.startTime)
            : Number.POSITIVE_INFINITY;
          const maxDuration = Math.min(
            maxDurationByMedia,
            maxDurationByNextClip,
          );

          const desiredDuration = resizeStart.duration + adjustedDeltaTime;
          const newDuration = Math.max(
            minDuration,
            Math.min(desiredDuration, maxDuration),
          );
          const unclampedTrimOut = resizeStart.trimIn + newDuration;
          const newTrimOut = isStill
            ? unclampedTrimOut
            : Math.min(unclampedTrimOut, maxMediaTime);

          // PERF (0-B / 8-C): Skip epoch increment during drag preview.
          updateClip(clipId, {
            duration: newDuration,
            trimOut: newTrimOut,
            _skipEpochIncrement: true,
          } as Parameters<typeof updateClip>[1]);
        }
      }
    };

    // PERF (0-B): RAF coalescing — save the latest event and schedule at most
    // one RAF per display frame. Many pointermove events collapse to one store write.
    const handlePointerMove = (e: PointerEvent) => {
      pendingResizeEventRef.current = e;
      if (resizeRafRef.current !== null) return; // RAF already queued
      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = null;
        const pending = pendingResizeEventRef.current;
        pendingResizeEventRef.current = null;
        if (pending) applyResizeMove(pending);
      });
    };

    const finishResize = () => {
      // PERF (0-B): Drain any pending RAF before committing so the final
      // pointer position is always applied even if the RAF hasn't fired yet.
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      const drainEvent = pendingResizeEventRef.current;
      pendingResizeEventRef.current = null;
      if (drainEvent) applyResizeMove(drainEvent);

      if (
        activeResizeHandleRef.current &&
        resizePointerIdRef.current !== null
      ) {
        try {
          activeResizeHandleRef.current.releasePointerCapture(
            resizePointerIdRef.current,
          );
        } catch {
          // Ignore when capture is already released.
        }
      }
      setIsResizing(null);
      setIsRippleResize(false);
      resizeStartRef.current = null;
      activeResizeHandleRef.current = null;
      resizePointerIdRef.current = null;
      document.body.style.userSelect = "";

      // Clear snap guides when resize ends
      clearSnapGuides();

      // Sync gaps before committing the completed gesture so the trim and its
      // gap changes are restored atomically by one history entry.
      const store = useTimelineStore.getState();
      store.detectAndSyncGaps(trackId);
      const afterResize = useTimelineStore.getState();
      // PERF (7 / 8-D): Compare only the trimmed clip by ID instead of
      // JSON.stringify-ing the entire clips array (was O(n) serialization of
      // both before and after arrays on every drag completion).
      const beforeClip = initialResizeStart.beforeClips.find(
        (c) => c.id === clipId,
      );
      const afterClip = afterResize.clips.find((c) => c.id === clipId);
      const clipsChanged =
        !beforeClip ||
        !afterClip ||
        beforeClip.startTime !== afterClip.startTime ||
        beforeClip.duration !== afterClip.duration ||
        beforeClip.trimIn !== afterClip.trimIn ||
        beforeClip.trimOut !== afterClip.trimOut;
      if (clipsChanged) {
        useHistoryStore
          .getState()
          .execute(
            new TimelineTrimCommand(
              initialResizeStart.beforeClips,
              afterResize.clips,
              initialResizeStart.beforeGaps,
              afterResize.gaps,
            ),
          );
      }
      if (previewInteractionRef.current) {
        previewInteractionCoordinator.commit(previewInteractionRef.current);
        previewInteractionRef.current = null;
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (
        resizePointerIdRef.current !== null &&
        e.pointerId !== resizePointerIdRef.current
      )
        return;
      finishResize();
    };

    const handlePointerCancel = (e: PointerEvent) => {
      if (
        resizePointerIdRef.current !== null &&
        e.pointerId !== resizePointerIdRef.current
      )
        return;
      finishResize();
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerCancel);

    return () => {
      // Cancel any pending RAF so it doesn't fire after unmount/re-run
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      pendingResizeEventRef.current = null;
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerCancel);
      if (previewInteractionRef.current) {
        previewInteractionCoordinator.cancel(previewInteractionRef.current);
        previewInteractionRef.current = null;
      }
    };
  }, [
    isResizing,
    pixelsPerSecond,
    mediaAsset,
    updateClip,
    rippleEditEnabled,
    rippleTrimClip,
    snapEnabled,
    setSnapGuides,
    clearSnapGuides,
    previewInteractionCoordinator,
    // NOTE: useHistoryStore is intentionally omitted — it is the stable Zustand
    // hook reference itself (never changes), so including it was misleading (BUG 8-D).
    // useHistoryStore.getState() is called imperatively inside finishResize.
  ]);

  const formatDuration = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0 || isNaN(seconds)) {
      seconds = 0;
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `00:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}:00`;
  };

  const inferredKind =
    clip.kind ??
    ("text" in clip || clip.id.startsWith("text-clip-")
      ? "text"
      : clip.mediaId.startsWith("sticker-")
        ? "sticker"
        : clip.id.startsWith("filter-clip-")
          ? "filter"
          : mediaAsset?.type);

  const isSticker = inferredKind === "sticker";
  // Text templates are composition clips, but they belong to the same text
  // track presentation as normal text and text effects. They must never fall
  // through to the media branch, which expects a filmstrip asset.
  const isClipText =
    inferredKind === "text" || inferredKind === "text-template";
  const isClipAudio = inferredKind === "audio";
  const isClipVideo = inferredKind === "video";
  const isClipImage = inferredKind === "image";
  const isClipFilter = inferredKind === "filter";
  const isClipVideoEffect = inferredKind === "video-effect";
  const isClipBodyEffect = inferredKind === "body-effect";
  const isClipAnimatedOverlay = inferredKind === "animated-overlay";
  const isCompound = inferredKind === "compound";

  // Check if text clip is a caption or title
  const textClip = isClipText ? (clip as any) : null;
  const textRole = textClip?.textRole as "caption" | "title" | undefined;
  const isCaption = textRole === "caption";
  const isTitle = textRole === "title";

  const getClipStyle = () => {
    if (isCompound) return "clip-kind-compound";
    if (
      isClipFilter ||
      isClipVideoEffect ||
      isClipBodyEffect ||
      isClipAnimatedOverlay
    )
      return "clip-kind-effect";
    if (isSticker) return "clip-kind-sticker";
    if (isClipText) {
      return isCaption
        ? "clip-kind-caption"
        : isTitle
          ? "clip-kind-title"
          : inferredKind === "text-template"
            ? "clip-kind-title"
            : "clip-kind-text";
    }
    if (isClipAudio) return "clip-kind-audio bg-timeline-clip-audio";
    if (isClipVideo) return "clip-kind-video bg-timeline-clip-video";
    if (isClipImage) return "clip-kind-image bg-timeline-clip-image";
    return "";
  };

  const clipAccessibleName = `${clip.name || inferredKind || "Clip"}, track ${clip.trackId || 0}, start ${clip.startTime.toFixed(2)} seconds, duration ${clip.duration.toFixed(2)} seconds${locked ? ", locked" : ""}${selected ? ", selected" : ""}${mediaAsset?.isMissing ? ", offline media" : ""}`;

  return (
    <div
      ref={clipRef}
      tabIndex={locked ? -1 : 0}
      role="button"
      aria-label={clipAccessibleName}
      aria-selected={selected ? "true" : "false"}
      aria-disabled={locked ? "true" : "false"}
      aria-haspopup="menu"
      data-timeline-interactive="true"
      data-testid={`clip-${clip.id}`}
      data-clip-id={clip.id}
      data-clip-kind={inferredKind ?? "unknown"}
      data-clip-selected={selected ? "true" : "false"}
      data-clip-disabled={locked || isInvalidPosition ? "true" : "false"}
      data-clip-active={active ? "true" : "false"}
      data-clip-start={clip.startTime}
      data-clip-duration={clip.duration}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      className={`absolute rounded-[1px] h-full overflow-hidden border ${trackToneClass} ${selected ? "border-accent-soft" : "border-transparent"} ${locked ? "cursor-not-allowed" : isDragging ? (isInvalidPosition ? "cursor-not-allowed" : "cursor-grabbing") : "cursor-default"} ${getClipStyle()} ${mediaAsset?.isMissing ? "ring-1 ring-red-500/80" : ""} ${isDragging || isResizing || isBeingShifted ? "transition-none" : "transition-[left] duration-150 ease-out"} focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:outline-none`}
      style={{
        left: `${displayLeft}px`,
        width: `${width}px`,
        opacity: isInvalidPosition
          ? trackVisualOpacity * 0.5
          : trackVisualOpacity,
        pointerEvents: "auto",
        touchAction: "none",
        zIndex: isDragging ? 100 : 1,
        boxShadow: "none",
        transformOrigin: isDragging ? "0 0" : undefined,
        transform: isDragging
          ? `translateY(${dragState?.offsetY ?? 0}px)`
          : "none",
        border: isInvalidPosition
          ? "2px solid var(--clypra-clip-invalid)"
          : undefined,
      }}
    >
      {/* Left trim handle */}
      <div
        data-testid={`clip-${clip.id}-resize-left`}
        data-clip-resize-handle="true"
        className={`group/resize absolute left-0 top-0 z-30 h-full w-3 cursor-col-resize transition-colors ${resizeHandleVisibility} ${isResizing === "left" ? (isRippleResize ? "bg-clypra-clip-effect/35" : "bg-clypra-clip-fg/35") : "bg-transparent"}`}
        style={{ touchAction: "none", cursor: "col-resize" }}
        onPointerDown={(e) => {
          e.stopPropagation(); // Prevent drag when clicking resize handle
          handleResizeStart(e, "left");
        }}
        title={
          rippleEditEnabled
            ? "Ripple trim (Shift to disable)"
            : "Normal trim (Shift for ripple)"
        }
      >
        <div
          className={`pointer-events-none absolute inset-y-0 left-0 h-full w-0.5 rounded-r bg-clypra-clip-fg/90 transition-all group-hover/resize:w-0.75 group-hover/resize:bg-clypra-clip-fg ${isResizing === "left" ? (isRippleResize ? "bg-clypra-clip-effect" : "bg-clypra-clip-fg") : ""}`}
        />
      </div>

      {/* Clip content */}
      {isCompound ? (
        <div className="relative flex h-full w-full items-center gap-2 px-2 select-none pointer-events-none">
          {clip.compoundPreview ? (
            <img
              src={resolveMediaSrc(clip.compoundPreview)}
              alt=""
              className="h-full w-16 shrink-0 object-cover opacity-80"
              draggable={false}
            />
          ) : (
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-clypra-clip-overlay">
              <Layers className="h-4 w-4" />
            </div>
          )}
          <div className="min-w-0 truncate text-[11px] font-semibold">
            {clip.name || "Compound Clip"}
          </div>
          <div className="shrink-0 rounded bg-clypra-clip-overlay px-1.5 py-0.5 text-[10px]">
            {clip.compoundChildren?.length ?? 0}
          </div>
        </div>
      ) : isClipText ? (
        <div className="relative flex h-full w-full items-center px-3">
          {/* Icon badge for text role differentiation */}
          {(isCaption || isTitle) && (
            <div className="absolute left-1 top-1/2 -translate-y-1/2 flex items-center justify-center rounded bg-clypra-clip-badge-bg px-1.5 py-0.5 text-[9px] font-semibold text-clypra-clip-fg backdrop-blur-sm">
              {isCaption ? "CC" : "T"}
            </div>
          )}
          <div className="text-[12px] text-clypra-clip-fg font-medium tracking-[0.01em] truncate max-w-full select-none pointer-events-none pl-4">
            {clip.kind === "text-template"
              ? clip.name ||
                (clip as any).templateSnapshot?.metadata?.label ||
                "Text Template"
              : (clip as any).text || "Default text"}
          </div>
        </div>
      ) : isClipFilter ? (
        <div className="relative flex h-full w-full items-center px-2 select-none pointer-events-none gap-2">
          <div className="w-5 h-5 rounded bg-clypra-clip-effect/80 border border-clypra-clip-fg/15 flex items-center justify-center backdrop-blur-sm">
            <Sparkles className="w-3.5 h-3.5 text-clypra-clip-fg" />
          </div>
          <span className="text-[10px] font-bold text-clypra-clip-fg/90 truncate">
            {clip.name || "Filter"}
          </span>
        </div>
      ) : isClipVideoEffect ? (
        <div className="relative flex h-full w-full items-center px-2 select-none pointer-events-none gap-2">
          <div className="w-5 h-5 rounded bg-clypra-clip-effect/80 border border-clypra-clip-fg/15 flex items-center justify-center backdrop-blur-sm">
            <Sparkles className="w-3.5 h-3.5 text-clypra-clip-fg" />
          </div>
          <span className="text-[10px] font-bold text-clypra-clip-fg/90 truncate">
            {clip.name || "Video Effect"}
          </span>
        </div>
      ) : isClipBodyEffect ? (
        <div className="relative flex h-full w-full items-center px-2 select-none pointer-events-none gap-2">
          <div className="w-5 h-5 rounded bg-clypra-clip-effect/80 border border-clypra-clip-fg/15 flex items-center justify-center backdrop-blur-sm">
            <Sparkles className="w-3.5 h-3.5 text-clypra-clip-fg" />
          </div>
          <span className="text-[10px] font-bold text-clypra-clip-fg/90 truncate">
            {clip.name || "Body Effect"}
          </span>
        </div>
      ) : isClipAnimatedOverlay ? (
        <div className="relative flex h-full w-full items-center px-2 select-none pointer-events-none gap-2">
          <div className="w-5 h-5 rounded bg-clypra-clip-effect/80 border border-clypra-clip-fg/15 flex items-center justify-center backdrop-blur-sm">
            <Sparkles className="w-3.5 h-3.5 text-clypra-clip-fg" />
          </div>
          <span className="text-[10px] font-bold text-clypra-clip-fg/90 truncate">
            {clip.name || "Overlay"}
          </span>
        </div>
      ) : isSticker ? (
        <div className="relative flex h-full w-full items-center px-2 select-none pointer-events-none gap-2">
          {mediaAsset?.path ? (
            <img
              src={resolveMediaSrc(mediaAsset.path)}
              alt=""
              className="w-5 h-5 object-contain filter brightness-0 invert opacity-90 shrink-0"
              draggable={false}
            />
          ) : (
            <div className="w-5 h-5 flex items-center justify-center text-xs shrink-0">
              🎨
            </div>
          )}
          <span className="text-[10px] font-bold text-clypra-clip-fg/90 truncate">
            {mediaAsset?.name || "Sticker"}
          </span>
        </div>
      ) : (
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
          {/* CapCut-style hierarchy: metadata, visual strip, then audio strip. */}
          <div className="flex h-4 shrink-0 items-center gap-2 border-b border-clypra-clip-metadata-border bg-clypra-clip-metadata-bg px-1.5">
            <div className="min-w-0 truncate text-[9px] font-semibold tracking-[0.01em] text-timeline-clip-text">
              {mediaAsset?.name || "Clip"}
            </div>
            {mediaAsset?.isMissing && (
              <span
                data-testid="clip-offline-badge"
                className="shrink-0 bg-red-600/90 text-white px-1 py-px rounded text-[7px] font-bold uppercase tracking-wider"
                title="Source media file is missing or offline"
              >
                Offline
              </span>
            )}
            <div className="shrink-0 text-[9px] font-medium text-timeline-clip-duration">
              {formatDuration(clip.duration)}
            </div>
          </div>
          {clip.kind !== "audio" &&
          mediaAsset &&
          (mediaAsset.type === "video" || mediaAsset.type === "image") ? (
            <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-hidden bg-clypra-clip-overlay-soft">
                <ClipFilmstrip
                  className="h-full w-full"
                  clip={clip}
                  mediaAsset={mediaAsset}
                  clipWidthPx={width}
                  pixelsPerSecond={pixelsPerSecond}
                  stripHeightPx={clipFilmstripHeightPx}
                />
              </div>
              {mediaAsset.type === "video" && mediaAsset.path && (
                <div
                  data-testid="clip-audio-waveform"
                  className="relative h-4 shrink-0 border-t border-clypra-clip-waveform-border bg-clypra-clip-waveform-bg px-0.5"
                >
                  <VolumeWaveform
                    audioPath={(clip as any).audioPath || mediaAsset.path}
                    clipWidthPx={width}
                    duration={clip.duration}
                    mediaDuration={mediaAsset.duration}
                    trimIn={clip.trimIn}
                    trimOut={clip.trimOut}
                    volume={clip.volume}
                    volumeKeyframes={clip.volumeKeyframes}
                    fadeIn={clip.fadeIn}
                    fadeOut={clip.fadeOut}
                    fadeInCurve={clip.fadeInCurve}
                    fadeOutCurve={clip.fadeOutCurve}
                    heightPx={16}
                    className="opacity-75"
                  />
                  <AudioEnvelopeEditor
                    clip={clip}
                    clipWidthPx={width}
                    pixelsPerSecond={pixelsPerSecond}
                  />
                </div>
              )}
            </div>
          ) : mediaAsset?.type === "audio" || (clip as any).audioPath ? (
            <div className="relative flex min-h-0 w-full flex-1 items-center overflow-hidden px-0.5">
              <VolumeWaveform
                audioPath={(clip as any).audioPath || mediaAsset?.path || ""}
                clipWidthPx={width}
                duration={clip.duration}
                mediaDuration={mediaAsset?.duration}
                trimIn={clip.trimIn}
                trimOut={clip.trimOut}
                volume={clip.volume}
                volumeKeyframes={clip.volumeKeyframes}
                fadeIn={clip.fadeIn}
                fadeOut={clip.fadeOut}
                fadeInCurve={clip.fadeInCurve}
                fadeOutCurve={clip.fadeOutCurve}
                heightPx={40}
                className="rounded-xs"
              />
              <AudioEnvelopeEditor
                clip={clip}
                clipWidthPx={width}
                pixelsPerSecond={pixelsPerSecond}
              />
            </div>
          ) : mediaAsset?.posterFrame ? (
            <img
              src={mediaAsset.posterFrame}
              alt=""
              className="min-h-0 w-full flex-1 object-cover"
              draggable={false}
            />
          ) : (
            <div className="min-h-0 w-full flex-1 bg-timeline-filmstrip-empty" />
          )}
        </div>
      )}

      {/* Right trim handle */}
      <div
        data-testid={`clip-${clip.id}-resize-right`}
        data-clip-resize-handle="true"
        className={`group/resize absolute right-0 top-0 z-30 h-full w-3 cursor-col-resize transition-colors ${resizeHandleVisibility} ${isResizing === "right" ? (isRippleResize ? "bg-clypra-clip-effect/35" : "bg-clypra-clip-fg/35") : "bg-transparent"}`}
        style={{ touchAction: "none", cursor: "col-resize" }}
        onPointerDown={(e) => {
          e.stopPropagation(); // Prevent drag when clicking resize handle
          handleResizeStart(e, "right");
        }}
        // removed duplicate onMouseDown (PointerEvents sufficient for Chromium/Tauri)
        title={
          rippleEditEnabled
            ? "Ripple trim (Shift to disable)"
            : "Normal trim (Shift for ripple)"
        }
      >
        <div
          className={`pointer-events-none absolute inset-y-0 right-0 h-full w-0.5 rounded-l bg-clypra-clip-fg/90 transition-all group-hover/resize:w-0.75 group-hover/resize:bg-clypra-clip-fg ${isResizing === "right" ? (isRippleResize ? "bg-clypra-clip-effect" : "bg-clypra-clip-fg") : ""}`}
        />
      </div>
    </div>
  );
};

// Custom comparison function to prevent unnecessary re-renders
// Only re-render if actual clip data or relevant props change
const arePropsEqual = (prevProps: ClipProps, nextProps: ClipProps) => {
  // Check if critical clip properties changed
  if (
    prevProps.clip.id !== nextProps.clip.id ||
    prevProps.clip.startTime !== nextProps.clip.startTime ||
    prevProps.clip.duration !== nextProps.clip.duration ||
    prevProps.clip.trimIn !== nextProps.clip.trimIn ||
    prevProps.clip.trimOut !== nextProps.clip.trimOut ||
    prevProps.clip.trackId !== nextProps.clip.trackId ||
    prevProps.clip.kind !== nextProps.clip.kind ||
    prevProps.clip.name !== nextProps.clip.name ||
    ((prevProps.clip.kind === "text" ||
      prevProps.clip.kind === "text-template") &&
      (nextProps.clip.kind === "text" ||
        nextProps.clip.kind === "text-template") &&
      ((prevProps.clip as any).text !== (nextProps.clip as any).text ||
        prevProps.clip.templateRevisionId !==
          nextProps.clip.templateRevisionId ||
        prevProps.clip.templateContentHash !==
          nextProps.clip.templateContentHash ||
        prevProps.clip.templateSnapshot !== nextProps.clip.templateSnapshot))
  ) {
    return false;
  }

  // Check audio envelope properties
  if (
    prevProps.clip.volume !== nextProps.clip.volume ||
    prevProps.clip.fadeIn !== nextProps.clip.fadeIn ||
    prevProps.clip.fadeOut !== nextProps.clip.fadeOut ||
    prevProps.clip.volumeKeyframes !== nextProps.clip.volumeKeyframes
  ) {
    return false;
  }

  // Check other props
  if (
    prevProps.pixelsPerSecond !== nextProps.pixelsPerSecond ||
    prevProps.trackHeightPx !== nextProps.trackHeightPx ||
    prevProps.selected !== nextProps.selected ||
    prevProps.active !== nextProps.active ||
    prevProps.locked !== nextProps.locked ||
    prevProps.isBeingShifted !== nextProps.isBeingShifted
  ) {
    return false;
  }

  // Check mediaAsset reference (it's ok if both are undefined)
  if (prevProps.mediaAsset?.id !== nextProps.mediaAsset?.id) {
    return false;
  }

  // Check dragState (deep comparison of relevant fields)
  const prevDrag = prevProps.dragState;
  const nextDrag = nextProps.dragState;
  if (
    prevDrag?.isDragging !== nextDrag?.isDragging ||
    prevDrag?.offsetX !== nextDrag?.offsetX ||
    prevDrag?.offsetY !== nextDrag?.offsetY ||
    prevDrag?.isInvalidPosition !== nextDrag?.isInvalidPosition
  ) {
    return false;
  }

  // Props are equal - skip re-render
  return true;
};

export const Clip = React.memo(ClipInner, arePropsEqual);
