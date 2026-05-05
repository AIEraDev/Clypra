import React, { useState, useEffect, useRef } from "react";
import { useUIStore } from "../../../store/uiStore";
import { useTimelineStore } from "../../../store/timelineStore";
import type { Clip as ClipType, MediaAsset } from "../../../types";
import { ClipFilmstrip } from "./ClipFilmstrip";

console.log("[CLIP MODULE] 📦 Clip.tsx loaded");

interface ClipProps {
  clip: ClipType;
  mediaAsset?: MediaAsset;
  pixelsPerSecond: number;
  selected?: boolean;
  locked?: boolean;
  onDragStart?: (clipId: string, startX: number, startY: number) => void;
  onDragMove?: (clipId: string, deltaX: number, deltaY: number, clientX: number, clientY: number) => void;
  onDragEnd?: (clipId: string) => void;
  dragState?: {
    isDragging: boolean;
    offsetX: number;
    offsetY: number;
    isInvalidPosition?: boolean;
  };
}

export const Clip: React.FC<ClipProps> = ({ clip, mediaAsset, pixelsPerSecond, selected, locked = false, onDragStart, onDragMove, onDragEnd, dragState }) => {
  console.log("[CLIP] 🔄 Render", { clipId: clip.id, locked, selected });

  const { selectClip, toggleClipSelection } = useUIStore();
  const { updateClip, rippleEditEnabled, rippleTrimClip } = useTimelineStore();
  const [isResizing, setIsResizing] = useState<"left" | "right" | null>(null);
  const [resizeStart, setResizeStart] = useState<{ x: number; startTime: number; duration: number; trimIn: number; trimOut: number; isRipple: boolean } | null>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ startX: number; startY: number; startTime: number; hasMoved: boolean } | null>(null);

  // Calculate position
  const left = Math.round(clip.startTime * pixelsPerSecond);
  const width = Math.round(clip.duration * pixelsPerSecond);

  // Apply drag offset if dragging
  const isDragging = dragState?.isDragging || false;
  const isInvalidPosition = dragState?.isInvalidPosition || false;
  const displayLeft = isDragging ? left + (dragState?.offsetX || 0) : left;

  // Handle pointer-based drag
  const handlePointerDown = (e: React.PointerEvent) => {
    console.log("[CLIP] ⬇️ onPointerDown", {
      clipId: clip.id,
      button: e.button,
      target: (e.target as HTMLElement).className,
      locked,
      isResizing,
    });

    // Ignore if locked, resizing, or not left button
    if (locked || isResizing || e.button !== 0) return;

    // Check if clicking resize handle
    const target = e.target as HTMLElement;
    const isResizeHandle = target.closest('[data-testid*="resize"]');
    if (isResizeHandle) {
      console.log("[CLIP] 🚫 Resize handle clicked - not dragging");
      return;
    }

    // Start drag
    e.stopPropagation();
    const rect = clipRef.current?.getBoundingClientRect();
    if (!rect) return;

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTime: clip.startTime,
      hasMoved: false,
    };

    // Capture pointer for smooth dragging
    clipRef.current?.setPointerCapture(e.pointerId);

    console.log("[CLIP] 🚀 Drag START", { clipId: clip.id, startX: e.clientX, startY: e.clientY });
    onDragStart?.(clip.id, e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current || !onDragMove) {
      console.log("[CLIP] ⚠️ Pointer move ignored", {
        hasDragStart: !!dragStartRef.current,
        hasOnDragMove: !!onDragMove,
      });
      return;
    }

    const deltaX = e.clientX - dragStartRef.current.startX;
    const deltaY = e.clientY - dragStartRef.current.startY;

    console.log("[CLIP] 🔄 Pointer move", {
      clipId: clip.id,
      deltaX,
      deltaY,
      clientX: e.clientX,
      clientY: e.clientY,
      hasMoved: dragStartRef.current.hasMoved,
    });

    // Mark as moved if threshold exceeded
    if (!dragStartRef.current.hasMoved && (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)) {
      dragStartRef.current.hasMoved = true;
      console.log("[CLIP] ✅ Movement threshold exceeded - starting drag");
    }

    if (dragStartRef.current.hasMoved) {
      onDragMove(clip.id, deltaX, deltaY, e.clientX, e.clientY);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;

    console.log("[CLIP] 🏁 Drag END", { clipId: clip.id, hasMoved: dragStartRef.current.hasMoved });

    // If didn't move, treat as click for selection
    if (!dragStartRef.current.hasMoved) {
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        toggleClipSelection(clip.id);
      } else {
        selectClip(clip.id);
      }
    }

    onDragEnd?.(clip.id);
    dragStartRef.current = null;
  };

  const handleResizeStart = (e: React.MouseEvent, side: "left" | "right") => {
    e.stopPropagation();
    if (locked) return;

    // Let's check if ripple mode is active (Shift key OR global ripple mode enabled)
    const isRipple = e.shiftKey || rippleEditEnabled;

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

  useEffect(() => {
    if (!isResizing || !resizeStart) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - resizeStart.x;
      const deltaTime = deltaX / pixelsPerSecond;

      if (resizeStart.isRipple) {
        // RIPPLE MODE: Shift downstream clips
        rippleTrimClip(clip.id, isResizing, deltaTime);

        // Update resizeStart to track cumulative changes
        setResizeStart({
          ...resizeStart,
          x: e.clientX,
        });
      } else {
        // STANDARD MODE: Normal trim (no ripple)
        if (isResizing === "left") {
          // Resize from left (trim in)
          const newStartTime = Math.max(0, resizeStart.startTime + deltaTime);
          const newDuration = resizeStart.duration - (newStartTime - resizeStart.startTime);
          const newTrimIn = resizeStart.trimIn + (newStartTime - resizeStart.startTime);

          // Get media asset duration for validation
          const maxTrimIn = mediaAsset?.duration || resizeStart.trimOut;

          // Clamp to valid range
          if (newDuration >= 0.1 && newTrimIn >= 0 && newTrimIn < resizeStart.trimOut && newTrimIn <= maxTrimIn) {
            updateClip(clip.id, {
              startTime: newStartTime,
              duration: newDuration,
              trimIn: newTrimIn,
            });
          }
        } else {
          // Resize from right (trim out)
          const newDuration = Math.max(0.1, resizeStart.duration + deltaTime);
          const newTrimOut = resizeStart.trimIn + newDuration;

          // Get media asset duration for validation
          const maxDuration = mediaAsset?.duration || resizeStart.trimOut;

          if (newTrimOut <= maxDuration) {
            updateClip(clip.id, {
              duration: newDuration,
              trimOut: newTrimOut,
            });
          }
        }
      }
    };

    const handleMouseUp = () => {
      setIsResizing(null);
      setResizeStart(null);
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, resizeStart, clip.id, pixelsPerSecond, updateClip, rippleTrimClip, mediaAsset]);

  const getClipColor = () => {
    if (mediaAsset?.type === "audio") return "bg-[#153840] border-[#30a7c8]/40";
    return "bg-accent/10";
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `00:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}:00`;
  };

  return (
    <div
      ref={clipRef}
      data-timeline-interactive="true"
      data-testid={`clip-${clip.id}`}
      data-clip-id={clip.id}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className={`absolute h-full rounded-sm overflow-hidden border ${selected ? "ring-2 ring-accent" : ""} ${isResizing ? (resizeStart?.isRipple ? "ring-2 ring-yellow-500" : "ring-2 ring-cyan-500") : ""} ${locked ? "cursor-not-allowed" : isDragging ? (isInvalidPosition ? "cursor-not-allowed" : "cursor-grabbing") : "cursor-grab"} ${getClipColor()} transition-none`}
      style={{
        left: `${displayLeft}px`,
        width: `${width}px`,
        opacity: isInvalidPosition ? 0.5 : 1,
        pointerEvents: "auto",
        zIndex: isDragging ? 100 : 1,
        boxShadow: isDragging ? (isInvalidPosition ? "0 8px 32px rgba(255,0,0,0.6)" : "0 8px 32px rgba(0,0,0,0.6)") : "none",
        transformOrigin: isDragging ? "0 0" : undefined,
        transform: isDragging ? `translateY(${dragState?.offsetY ?? 0}px) scale(1.02)` : "scale(1)",
        border: isInvalidPosition ? "2px solid #ef4444" : undefined,
      }}
    >
      {/* Left trim handle */}
      <div
        data-testid={`clip-${clip.id}-resize-left`}
        className={`absolute left-0 top-0 w-3 h-full hover:bg-cyan-300/40 cursor-ew-resize z-20 ${isResizing === "left" ? (resizeStart?.isRipple ? "bg-yellow-300/60" : "bg-cyan-300/60") : "bg-transparent"}`}
        onMouseDown={(e) => {
          e.stopPropagation(); // Prevent drag when clicking resize handle
          handleResizeStart(e, "left");
        }}
        title={rippleEditEnabled ? "Ripple trim (ripple mode ON)" : "Hold Shift for ripple trim"}
      />

      {/* Clip content */}
      <div className="flex h-full min-h-0 w-full flex-col gap-1 overflow-hidden px-1 py-1">
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-[9px] font-semibold tracking-[0.01em] text-[#d8edf1] truncate">{mediaAsset?.name || "Clip"}</div>
          <div className="text-[9px] font-medium text-[#b9e0e6] shrink-0">{formatDuration(clip.duration)}</div>
        </div>
        {mediaAsset?.type === "video" ? (
          <div className="flex min-h-0 w-full flex-1 items-center">
            <ClipFilmstrip
              className="w-full shrink-0"
              clip={clip}
              mediaAsset={mediaAsset}
              clipWidthPx={width}
              pixelsPerSecond={pixelsPerSecond}
              stripHeightPx={40}
            />
          </div>
        ) : mediaAsset?.type === "image" ? (
          mediaAsset.posterFrame ? (
            <img
              src={mediaAsset.posterFrame}
              alt=""
              className="h-8 w-full rounded-[2px] border border-black/20 object-cover"
              draggable={false}
            />
          ) : (
            <div className="h-8 w-full rounded-[2px] bg-[#0c2730]/60" />
          )
        ) : mediaAsset?.type === "audio" ? (
          mediaAsset.posterFrame ? (
            <img
              src={mediaAsset.posterFrame}
              alt=""
              className="h-8 w-full rounded-[2px] border border-black/20 object-cover"
              draggable={false}
            />
          ) : (
            <div className="h-8 w-full rounded-[2px] bg-[#0c2730]/60" />
          )
        ) : mediaAsset?.posterFrame ? (
          <img
            src={mediaAsset.posterFrame}
            alt=""
            className="h-8 w-full rounded-[2px] border border-black/20 object-cover"
            draggable={false}
          />
        ) : (
          <div className="h-8 w-full rounded-[2px] bg-[#0c2730]/60" />
        )}
      </div>

      {/* Right trim handle */}
      <div
        data-testid={`clip-${clip.id}-resize-right`}
        className={`absolute right-0 top-0 w-3 h-full hover:bg-cyan-300/40 cursor-ew-resize z-20 ${isResizing === "right" ? (resizeStart?.isRipple ? "bg-yellow-300/60" : "bg-cyan-300/60") : "bg-transparent"}`}
        onMouseDown={(e) => {
          e.stopPropagation(); // Prevent drag when clicking resize handle
          handleResizeStart(e, "right");
        }}
        title={rippleEditEnabled ? "Ripple trim (ripple mode ON)" : "Hold Shift for ripple trim"}
      />
    </div>
  );
};
