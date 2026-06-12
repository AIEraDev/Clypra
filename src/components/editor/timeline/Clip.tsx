import React, { useState, useEffect, useRef } from "react";
import { useUIStore } from "@/store/uiStore";
import { useTimelineStore } from "@/store/timelineStore";
import { usePlaybackClock, useTransportControls } from "@/hooks/usePlaybackClock";
import type { Clip as ClipType, MediaAsset } from "@/types";
import { ClipFilmstrip } from "./ClipFilmstrip";
import { TimelineWaveform } from "./TimelineWaveform";
import { convertFileSrc } from "@tauri-apps/api/core";

const isExternalOrDataUrl = (value: string) => value.startsWith("data:") || value.startsWith("http") || value.startsWith("asset://");

const resolveMediaSrc = (path: string) => {
  if (!path) return "";
  return isExternalOrDataUrl(path) ? path : convertFileSrc(path);
};

/** Movement past this (px) starts a clip drag; below it, release is still a click (selection set on pointerDown). */
const DRAG_THRESHOLD_PX = 6;
const RESIZE_TRACE = true;
const MAX_STILL_CLIP_DURATION_SEC = 60 * 60; // 1 hour guardrail for stills
const MIN_TRIM_DURATION_SEC = 1;
const SNAP_THRESHOLD_SECONDS = 0.1; // Snap when within 100ms
const traceResize = (...args: unknown[]) => {
  if (!RESIZE_TRACE) return;
};

interface ClipProps {
  clip: ClipType;
  mediaAsset?: MediaAsset;
  pixelsPerSecond: number;
  selected?: boolean;
  locked?: boolean;
  onDragStart?: (clipId: string, startX: number, startY: number, pointerOffsetFromLeft?: number) => void;
  onDragMove?: (clipId: string, deltaX: number, deltaY: number, clientX: number, clientY: number) => void;
  onDragEnd?: (clipId: string) => void;
  dragState?: {
    isDragging: boolean;
    offsetX: number;
    offsetY: number;
    isInvalidPosition?: boolean;
  };
}

const ClipInner: React.FC<ClipProps> = ({ clip, mediaAsset, pixelsPerSecond, selected, locked = false, onDragStart, onDragMove, onDragEnd, dragState }) => {
  const { selectClip, toggleClipSelection } = useUIStore();
  const { clips, updateClip, rippleEditEnabled, rippleTrimClip, scrollLeft, viewportWidth, snapEnabled, setSnapGuides, clearSnapGuides } = useTimelineStore();
  const clockState = usePlaybackClock();
  const currentTime = clockState.time;
  const { pause } = useTransportControls();
  const [isResizing, setIsResizing] = useState<"left" | "right" | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [resizeStart, setResizeStart] = useState<{ x: number; startTime: number; duration: number; trimIn: number; trimOut: number; isRipple: boolean } | null>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ startX: number; startY: number; startTime: number; hasMoved: boolean; hasDragStarted: boolean; pointerId: number; pointerOffsetFromLeft?: number } | null>(null);
  const isPointerOnResizeHandle = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return Boolean(el.closest("[data-clip-resize-handle='true']"));
  };

  // Calculate position
  const left = Math.round(clip.startTime * pixelsPerSecond);
  const width = Math.round(clip.duration * pixelsPerSecond);

  // Apply drag offset if dragging
  const isDragging = dragState?.isDragging || false;
  const isInvalidPosition = dragState?.isInvalidPosition || false;
  const displayLeft = isDragging ? left + (dragState?.offsetX || 0) : left;
  const showResizeHandles = Boolean(selected || isResizing || isHovered);

  // Handle pointer-based drag
  const handlePointerDown = (e: React.PointerEvent) => {
    // Ignore if locked, resizing, or not left button
    if (locked || isResizing || e.button !== 0) return;

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
    const alreadySelected = useUIStore.getState().selectedClipIds.includes(clip.id);
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
    if (!dragStartRef.current.hasMoved && (Math.abs(deltaX) > DRAG_THRESHOLD_PX || Math.abs(deltaY) > DRAG_THRESHOLD_PX)) {
      dragStartRef.current.hasMoved = true;
      if (!dragStartRef.current.hasDragStarted) {
        dragStartRef.current.hasDragStarted = true;

        // Pass original pointer-down values - NEVER recompute the anchor
        onDragStart?.(clip.id, dragStartRef.current.startX, dragStartRef.current.startY, dragStartRef.current.pointerOffsetFromLeft);

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

  const handleResizeStart = (e: React.PointerEvent, side: "left" | "right") => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    if (locked) return;

    pause();

    // Let's check if ripple mode is active (Shift key OR global ripple mode enabled)
    const isRipple = e.shiftKey || rippleEditEnabled;
    traceResize("pointerdown", {
      clipId: clip.id,
      side,
      pointerId: e.pointerId,
      button: e.button,
      clientX: e.clientX,
      isRipple,
      selected,
      locked,
      startTime: clip.startTime,
      duration: clip.duration,
      trimIn: clip.trimIn,
      trimOut: clip.trimOut,
    });
    resizePointerIdRef.current = e.pointerId;
    activeResizeHandleRef.current = e.currentTarget as HTMLElement;
    try {
      activeResizeHandleRef.current.setPointerCapture(e.pointerId);
    } catch {
      // Best-effort: window listeners below still provide robustness.
    }

    setIsResizing(side);
    setResizeStart({
      x: e.clientX,
      startTime: clip.startTime,
      duration: clip.duration,
      trimIn: clip.trimIn,
      trimOut: clip.trimOut,
      isRipple,
    });

    // Let's prevent text selection during resize
    document.body.style.userSelect = "none";
  };

  const handleResizeStartMouse = (e: React.MouseEvent, side: "left" | "right") => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    if (locked) return;

    pause();

    const isRipple = e.shiftKey || rippleEditEnabled;
    traceResize("mousedown-fallback", {
      clipId: clip.id,
      side,
      button: e.button,
      clientX: e.clientX,
      clientY: e.clientY,
      isRipple,
      selected,
      locked,
    });
    resizePointerIdRef.current = null;
    activeResizeHandleRef.current = e.currentTarget as HTMLElement;
    setIsResizing(side);
    setResizeStart({
      x: e.clientX,
      startTime: clip.startTime,
      duration: clip.duration,
      trimIn: clip.trimIn,
      trimOut: clip.trimOut,
      isRipple,
    });
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    if (!RESIZE_TRACE) return;
    const onDocPointerDownCapture = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const handle = target.closest("[data-clip-resize-handle='true']") as HTMLElement | null;
      if (!handle) return;
      traceResize("document pointerdown-capture hit resize handle", {
        clipId: clip.id,
        pointerId: e.pointerId,
        button: e.button,
        clientX: e.clientX,
        clientY: e.clientY,
        handleTestId: handle.getAttribute("data-testid"),
        handleAttr: handle.getAttribute("data-clip-resize-handle"),
      });
    };
    document.addEventListener("pointerdown", onDocPointerDownCapture, true);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDownCapture, true);
    };
  }, [clip.id]);

  useEffect(() => {
    if (!isResizing || !resizeStart) return;
    traceResize("resize-started", {
      clipId: clip.id,
      side: isResizing,
      pointerId: resizePointerIdRef.current,
      resizeStart,
    });

    const handlePointerMove = (e: PointerEvent) => {
      if (resizePointerIdRef.current !== null && e.pointerId !== resizePointerIdRef.current) return;
      const deltaX = e.clientX - resizeStart.x;
      const deltaTime = deltaX / pixelsPerSecond;
      const isRippleActive = e.shiftKey || rippleEditEnabled;

      const trackClips = clips.filter((c) => c.trackId === clip.trackId && c.id !== clip.id);
      const allClips = clips.filter((c) => c.id !== clip.id);

      const prevClipEnd = trackClips.reduce((maxEnd, c) => {
        const end = c.startTime + c.duration;
        if (end <= resizeStart.startTime + 1e-6) return Math.max(maxEnd, end);
        return maxEnd;
      }, 0);
      const nextClipStart = trackClips.reduce((minStart, c) => {
        if (c.startTime >= resizeStart.startTime + resizeStart.duration - 1e-6) return Math.min(minStart, c.startTime);
        return minStart;
      }, Number.POSITIVE_INFINITY);

      // Snap detection logic
      let snappedTime: number | null = null;
      let snapGuides: Array<{ time: number; type: "clip-start" | "clip-end" | "playhead" }> = [];

      if (snapEnabled) {
        // Calculate the edge time we're moving
        const currentEdgeTime = isResizing === "left" ? resizeStart.startTime + deltaTime : resizeStart.startTime + resizeStart.duration + deltaTime;

        // Build snap candidates
        const snapCandidates: Array<{ time: number; type: "clip-start" | "clip-end" | "playhead" }> = [];

        // Add playhead position
        if (currentTime !== undefined) {
          snapCandidates.push({ time: currentTime, type: "playhead" });
        }

        // Add all other clip edges (across all tracks for professional alignment)
        for (const c of allClips) {
          snapCandidates.push({ time: c.startTime, type: "clip-start" });
          snapCandidates.push({ time: c.startTime + c.duration, type: "clip-end" });
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

      traceResize("pointermove", {
        clipId: clip.id,
        side: isResizing,
        pointerId: e.pointerId,
        clientX: e.clientX,
        deltaX,
        deltaTime,
        ripple: isRippleActive,
        snappedTime,
      });

      if (isRippleActive) {
        // RIPPLE MODE: Shift downstream clips
        traceResize("apply-ripple-trim", {
          clipId: clip.id,
          side: isResizing,
          deltaTime,
        });
        rippleTrimClip(clip.id, isResizing, deltaTime);

        // Update resizeStart to track cumulative changes
        setResizeStart({
          ...resizeStart,
          x: e.clientX,
        });
      } else {
        // STANDARD MODE: Normal trim (no ripple)

        // Apply snap adjustment if snapping is active
        let adjustedDeltaTime = deltaTime;
        if (snappedTime !== null) {
          if (isResizing === "left") {
            adjustedDeltaTime = snappedTime - resizeStart.startTime;
          } else {
            adjustedDeltaTime = snappedTime - (resizeStart.startTime + resizeStart.duration);
          }
        }

        if (isResizing === "left") {
          // Resize from left (trim in)
          const minDuration = MIN_TRIM_DURATION_SEC;
          const isStill = !mediaAsset || mediaAsset.type === "image";
          const maxMediaTime = isStill ? MAX_STILL_CLIP_DURATION_SEC : (mediaAsset?.duration ?? resizeStart.trimOut);
          const maxTrimIn = Math.min(maxMediaTime, resizeStart.trimOut - 0.001);

          // Calculate minimum start time (collision with previous clip or timeline start)
          const minStartTimeByPrevClip = prevClipEnd;
          const minStartTimeByTimeline = 0;
          const minStartTime = Math.max(minStartTimeByPrevClip, minStartTimeByTimeline);

          // Calculate maximum start time (maintain minimum duration and media bounds)
          const maxStartTimeByDuration = resizeStart.startTime + resizeStart.duration - minDuration;
          const maxStartTimeByMedia = resizeStart.startTime + (maxTrimIn - resizeStart.trimIn);
          const maxStartTime = Math.min(maxStartTimeByDuration, maxStartTimeByMedia);

          // Calculate desired start time with snap adjustment, then clamp to valid range
          const desiredStartTime = resizeStart.startTime + adjustedDeltaTime;
          const newStartTime = Math.max(minStartTime, Math.min(desiredStartTime, maxStartTime));

          // Calculate new duration and trimIn based on the new start time
          const clipEndTime = resizeStart.startTime + resizeStart.duration;
          const newDuration = clipEndTime - newStartTime;
          const startTimeDelta = newStartTime - resizeStart.startTime;
          const newTrimIn = resizeStart.trimIn + startTimeDelta;

          updateClip(clip.id, {
            startTime: newStartTime,
            duration: newDuration,
            trimIn: newTrimIn,
          });
          traceResize("apply-standard-left", {
            clipId: clip.id,
            newStartTime,
            newDuration,
            newTrimIn,
          });
        } else {
          // Resize from right (trim out)
          const minDuration = MIN_TRIM_DURATION_SEC;
          const isStill = !mediaAsset || mediaAsset.type === "image";
          const maxMediaTime = isStill ? MAX_STILL_CLIP_DURATION_SEC : (mediaAsset?.duration ?? resizeStart.trimOut);
          const maxDurationByMedia = Math.max(minDuration, maxMediaTime - resizeStart.trimIn);
          const maxDurationByNextClip = Number.isFinite(nextClipStart) ? Math.max(minDuration, nextClipStart - resizeStart.startTime) : Number.POSITIVE_INFINITY;
          const maxDuration = Math.min(maxDurationByMedia, maxDurationByNextClip);

          const desiredDuration = resizeStart.duration + adjustedDeltaTime;
          const newDuration = Math.max(minDuration, Math.min(desiredDuration, maxDuration));
          const unclampedTrimOut = resizeStart.trimIn + newDuration;
          const newTrimOut = isStill ? unclampedTrimOut : Math.min(unclampedTrimOut, maxMediaTime);

          updateClip(clip.id, {
            duration: newDuration,
            trimOut: newTrimOut,
          });
          traceResize("apply-standard-right", {
            clipId: clip.id,
            newDuration,
            newTrimOut,
          });
        }
      }
    };

    const finishResize = () => {
      if (activeResizeHandleRef.current && resizePointerIdRef.current !== null) {
        try {
          activeResizeHandleRef.current.releasePointerCapture(resizePointerIdRef.current);
        } catch {
          // Ignore when capture is already released.
        }
      }
      setIsResizing(null);
      setResizeStart(null);
      activeResizeHandleRef.current = null;
      resizePointerIdRef.current = null;
      document.body.style.userSelect = "";

      // Clear snap guides when resize ends
      clearSnapGuides();

      // Sync gaps after resize completes
      const store = useTimelineStore.getState();
      store.detectAndSyncGaps(clip.trackId);
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (resizePointerIdRef.current !== null && e.pointerId !== resizePointerIdRef.current) return;
      traceResize("pointerup", {
        clipId: clip.id,
        side: isResizing,
        pointerId: e.pointerId,
      });
      finishResize();
    };

    const handlePointerCancel = (e: PointerEvent) => {
      if (resizePointerIdRef.current !== null && e.pointerId !== resizePointerIdRef.current) return;
      traceResize("pointercancel", {
        clipId: clip.id,
        side: isResizing,
        pointerId: e.pointerId,
      });
      finishResize();
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerCancel);

    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerCancel);
      traceResize("resize-effect-cleanup", {
        clipId: clip.id,
        side: isResizing,
      });
    };
  }, [isResizing, resizeStart, clip.id, pixelsPerSecond, updateClip, rippleTrimClip, mediaAsset, clips, snapEnabled, currentTime, setSnapGuides, clearSnapGuides]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `00:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}:00`;
  };

  const inferredKind = clip.kind ?? (
    ("text" in clip || clip.id.startsWith("text-clip-")) ? "text" :
    clip.mediaId.startsWith("sticker-") ? "sticker" :
    mediaAsset?.type
  );

  const isSticker = inferredKind === "sticker";
  const isClipText = inferredKind === "text";
  const isClipAudio = inferredKind === "audio";
  const isClipVideo = inferredKind === "video";
  const isClipImage = inferredKind === "image";

  // Check if text clip is a caption or title
  const textClip = isClipText ? (clip as any) : null;
  const textRole = textClip?.textRole as "caption" | "title" | undefined;
  const isCaption = textRole === "caption";
  const isTitle = textRole === "title";

  const getClipStyle = () => {
    if (isSticker) return "bg-[#d97706] text-white"; // Orange-amber for stickers
    if (isClipText) {
      // Differentiate captions (purple) from titles (orange)
      if (isCaption) {
        return "bg-[#9333ea] text-white"; // Purple for captions
      } else {
        return "bg-[#ea580c] text-white"; // Orange for titles/effects
      }
    }
    if (isClipAudio) return "bg-timeline-clip-audio";
    if (isClipVideo) return "bg-timeline-clip-video";
    if (isClipImage) return "bg-timeline-clip-image";
    return "";
  };

  const getClipBackgroundStyle = () => {
    if (isSticker) return { backgroundColor: "#d97706" }; // Amber/yellow tone matching user screenshot
    if (isClipText) return {}; // Text clips use className colors
    if (isClipAudio) return { backgroundColor: "var(--color-timeline-clip-audio)" };
    if (isClipVideo) return { backgroundColor: "var(--color-accent)" };
    if (isClipImage) return { backgroundColor: "var(--color-timeline-clip-video)" };
    return { backgroundColor: "var(--color-accent)" }; // Fallback
  };

  return (
    <div
      ref={clipRef}
      data-timeline-interactive="true"
      data-testid={`clip-${clip.id}`}
      data-clip-id={clip.id}
      data-clip-start={clip.startTime}
      data-clip-duration={clip.duration}
      onPointerDownCapture={(e) => {
        if (isPointerOnResizeHandle(e.target)) {
          e.stopPropagation();
        }
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      className={`absolute rounded-sm h-full overflow-hidden border ${selected ? "border-white" : ""} ${isResizing ? (resizeStart?.isRipple ? "ring-2 ring-yellow-500" : "ring-2 ring-cyan-500") : ""} ${locked ? "cursor-not-allowed" : isDragging ? (isInvalidPosition ? "cursor-not-allowed" : "cursor-grabbing") : "cursor-default"} ${getClipStyle()} ${isDragging || isResizing ? "transition-none" : "transition-[left] duration-150 ease-out"}`}
      style={{
        left: `${displayLeft}px`,
        width: `${width}px`,
        opacity: isInvalidPosition ? 0.5 : 1,
        pointerEvents: "auto",
        touchAction: "none",
        zIndex: isDragging ? 100 : 1,
        boxShadow: "none",
        transformOrigin: isDragging ? "0 0" : undefined,
        transform: isDragging ? `translateY(${dragState?.offsetY ?? 0}px)` : "none",
        border: isInvalidPosition ? "2px solid var(--color-timeline-clip-invalid)" : undefined,
        ...getClipBackgroundStyle(),
      }}
    >
      {/* Left trim handle */}
      <div
        data-testid={`clip-${clip.id}-resize-left`}
        data-clip-resize-handle="true"
        className={`absolute left-0 top-0 w-3 h-full z-30 cursor-col-resize ${showResizeHandles ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"} ${isResizing === "left" ? (resizeStart?.isRipple ? "bg-yellow-300/60" : "bg-cyan-300/60") : "bg-white/25 hover:bg-white/35"} transition-colors`}
        style={{ touchAction: "none", cursor: "col-resize" }}
        onPointerDownCapture={(e) => {
          traceResize("left-handle pointerdown-capture", {
            clipId: clip.id,
            pointerId: e.pointerId,
            button: e.button,
            clientX: e.clientX,
            clientY: e.clientY,
            targetTag: (e.target as HTMLElement | null)?.tagName,
            currentTargetTag: (e.currentTarget as HTMLElement | null)?.tagName,
          });
          e.stopPropagation();
        }}
        onPointerDown={(e) => {
          traceResize("left-handle pointerdown", {
            clipId: clip.id,
            pointerId: e.pointerId,
            button: e.button,
            clientX: e.clientX,
            clientY: e.clientY,
            rippleEditEnabled,
            shiftKey: e.shiftKey,
          });
          e.stopPropagation(); // Prevent drag when clicking resize handle
          handleResizeStart(e, "left");
        }}
        onMouseDown={(e) => {
          traceResize("left-handle mousedown", { clipId: clip.id, clientX: e.clientX, clientY: e.clientY, button: e.button });
          handleResizeStartMouse(e, "left");
        }}
        title={rippleEditEnabled ? "Ripple trim (Shift to disable)" : "Normal trim (Shift for ripple)"}
      >
        <div className="absolute left-[5px] top-1/2 h-[70%] w-[2px] -translate-y-1/2 rounded bg-white/90" />
      </div>

      {/* Clip content */}
      {clip.kind === "text" ? (
        <div className="relative flex h-full w-full items-center px-3">
          {/* Icon badge for text role differentiation */}
          {(isCaption || isTitle) && <div className="absolute left-1 top-1 flex items-center justify-center rounded bg-black/30 px-1.5 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">{isCaption ? "CC" : "T"}</div>}
          <div className="text-[12px] text-white/95 font-medium tracking-[0.01em] truncate max-w-full select-none pointer-events-none">{(clip as any).text || "Default text"}</div>
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
            <div className="w-5 h-5 flex items-center justify-center text-xs shrink-0">🎨</div>
          )}
          <span className="text-[10px] font-bold text-white/90 truncate">
            {mediaAsset?.name || "Sticker"}
          </span>
        </div>
      ) : (
        <div className="flex h-full min-h-0 w-full flex-col gap-1 overflow-hidden px-1 py-1">
          <div className="flex shrink-0 items-center gap-3">
            <div className="text-[9px] font-semibold tracking-[0.01em] text-timeline-clip-text truncate">{mediaAsset?.name || "Clip"}</div>
            <div className="text-[9px] font-medium text-timeline-clip-duration shrink-0">{formatDuration(clip.duration)}</div>
          </div>
          {mediaAsset && (mediaAsset.type === "video" || mediaAsset.type === "image") ? (
            <div className="flex min-h-0 w-full flex-1 items-center">
              <ClipFilmstrip className="w-full shrink-0" clip={clip} mediaAsset={mediaAsset} clipWidthPx={width} pixelsPerSecond={pixelsPerSecond} stripHeightPx={40} viewportScrollLeft={scrollLeft} viewportWidth={viewportWidth} />
            </div>
          ) : mediaAsset?.type === "audio" ? (
            <div className="flex min-h-0 w-full flex-1 items-center">
              <TimelineWaveform audioPath={mediaAsset.path} clipWidthPx={width} duration={clip.duration} className="rounded-[2px]" />
            </div>
          ) : mediaAsset?.posterFrame ? (
            <img src={mediaAsset.posterFrame} alt="" className="h-8 w-full rounded-[2px] border border-black/20 object-cover" draggable={false} />
          ) : (
            <div className="h-8 w-full rounded-[2px] bg-timeline-filmstrip-empty" />
          )}
        </div>
      )}

      {/* Right trim handle */}
      <div
        data-testid={`clip-${clip.id}-resize-right`}
        data-clip-resize-handle="true"
        className={`absolute right-0 top-0 w-3 h-full z-30 cursor-col-resize ${showResizeHandles ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"} ${isResizing === "right" ? (resizeStart?.isRipple ? "bg-yellow-300/60" : "bg-cyan-300/60") : "bg-white/25 hover:bg-white/35"} transition-colors`}
        style={{ touchAction: "none", cursor: "col-resize" }}
        onPointerDownCapture={(e) => {
          traceResize("right-handle pointerdown-capture", {
            clipId: clip.id,
            pointerId: e.pointerId,
            button: e.button,
            clientX: e.clientX,
            clientY: e.clientY,
            targetTag: (e.target as HTMLElement | null)?.tagName,
            currentTargetTag: (e.currentTarget as HTMLElement | null)?.tagName,
          });
          e.stopPropagation();
        }}
        onPointerDown={(e) => {
          traceResize("right-handle pointerdown", {
            clipId: clip.id,
            pointerId: e.pointerId,
            button: e.button,
            clientX: e.clientX,
            clientY: e.clientY,
            rippleEditEnabled,
            shiftKey: e.shiftKey,
          });
          e.stopPropagation(); // Prevent drag when clicking resize handle
          handleResizeStart(e, "right");
        }}
        onMouseDown={(e) => {
          traceResize("right-handle mousedown", { clipId: clip.id, clientX: e.clientX, clientY: e.clientY, button: e.button });
          handleResizeStartMouse(e, "right");
        }}
        title={rippleEditEnabled ? "Ripple trim (Shift to disable)" : "Normal trim (Shift for ripple)"}
      >
        <div className="absolute right-[5px] top-1/2 h-[70%] w-[2px] -translate-y-1/2 rounded bg-white/90" />
      </div>
    </div>
  );
};

export const Clip = React.memo(ClipInner);
