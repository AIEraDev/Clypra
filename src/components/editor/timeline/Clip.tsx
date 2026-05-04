import React, { useState, useEffect } from "react";
// @ts-ignore - react-dnd types issue
import { useDrag, useDragLayer } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import { useUIStore } from "../../../store/uiStore";
import { useTimelineStore } from "../../../store/timelineStore";
import { useDragStateStore } from "../../../store/dragStateStore";
import type { Clip as ClipType, MediaAsset } from "../../../types";

interface ClipProps {
  clip: ClipType;
  mediaAsset?: MediaAsset;
  pixelsPerSecond: number;
  selected?: boolean;
  locked?: boolean;
  displayStartTime?: number; // For magnetic timeline shifting
  isShifting?: boolean; // Whether clip is being shifted
}

export const Clip: React.FC<ClipProps> = ({ clip, mediaAsset, pixelsPerSecond, selected, locked = false, displayStartTime, isShifting = false }) => {
  const { selectClip, toggleClipSelection } = useUIStore();
  const { updateClip, rippleEditEnabled, rippleTrimClip, removeClip, addClip } = useTimelineStore();
  const { setDragging, setGrabOffset, draggingClip } = useDragStateStore();
  const [isResizing, setIsResizing] = useState<"left" | "right" | null>(null);
  const [resizeStart, setResizeStart] = useState<{ x: number; startTime: number; duration: number; trimIn: number; trimOut: number; isRipple: boolean } | null>(null);

  const [{ isDragging }, drag, dragPreview] = useDrag(
    () => ({
      type: "CLIP",
      item: () => {
        // ✅ Immediately remove clip from timeline (CapCut model)
        removeClip(clip.id);

        // ✅ Store in drag state
        setDragging(clip, clip.trackId, clip.startTime);

        return { type: "CLIP" as const, clip };
      },
      canDrag: !locked && !isResizing,
      collect: (monitor: any) => ({
        isDragging: monitor.isDragging(),
      }),
      end: (_: any, monitor: any) => {
        // Handled by Track drop or Timeline cleanup
      },
    }),
    [clip, locked, isResizing, removeClip, setDragging],
  );

  // ✅ Suppress default drag image (we use custom ClipDragLayer)
  useEffect(() => {
    if (dragPreview && typeof dragPreview === "function") {
      dragPreview(getEmptyImage(), { captureDraggingState: true });
    }
  }, [dragPreview]);

  // ✅ If this clip is being dragged, don't render it (it's in the drag layer)
  if (draggingClip?.id === clip.id) {
    return null;
  }

  // Use displayStartTime if provided (for magnetic shifting), otherwise use clip.startTime
  const startTime = displayStartTime !== undefined ? displayStartTime : clip.startTime;
  // ✅ Round to avoid subpixel rendering issues (same as Timeline scroll logic)
  const left = Math.round(startTime * pixelsPerSecond);
  const width = Math.round(clip.duration * pixelsPerSecond);

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
      ref={drag}
      data-timeline-interactive="true"
      data-testid={`clip-${clip.id}`}
      onClick={(e) => {
        e.stopPropagation();
        if (locked) return;

        // Multi-select with Shift/Cmd/Ctrl
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          toggleClipSelection(clip.id);
        } else {
          selectClip(clip.id);
        }
      }}
      onMouseDown={(e) => {
        e.stopPropagation();

        // ✅ Capture grab offset for accurate drag positioning
        const rect = e.currentTarget.getBoundingClientRect();
        setGrabOffset(e.clientX - rect.left, e.clientY - rect.top);
      }}
      className={`absolute h-full rounded-sm overflow-hidden border ${selected ? "ring-2 ring-accent" : ""} ${isResizing ? (resizeStart?.isRipple ? "ring-2 ring-yellow-500" : "ring-2 ring-cyan-500") : ""} ${locked ? "cursor-not-allowed" : ""} ${getClipColor()} ${isShifting ? "transition-all duration-150 ease-out" : ""}`}
      style={{
        left: `${left}px`,
        width: `${width}px`,
      }}
    >
      {/* Left trim handle */}
      <div data-testid={`clip-${clip.id}-resize-left`} className={`absolute left-0 top-0 w-3 h-full hover:bg-cyan-300/40 cursor-ew-resize z-20 ${isResizing === "left" ? (resizeStart?.isRipple ? "bg-yellow-300/60" : "bg-cyan-300/60") : "bg-transparent"}`} onMouseDown={(e) => handleResizeStart(e, "left")} title={rippleEditEnabled ? "Ripple trim (ripple mode ON)" : "Hold Shift for ripple trim"} />

      {/* Clip content */}
      <div className="w-full h-full px-1 py-1 flex flex-col gap-1 overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="text-[9px] font-semibold tracking-[0.01em] text-[#d8edf1] truncate">{mediaAsset?.name || "Clip"}</div>
          <div className="text-[9px] font-medium text-[#b9e0e6] shrink-0">{formatDuration(clip.duration)}</div>
        </div>
        {mediaAsset?.posterFrame ? (
          <div
            className="h-8 rounded-[2px] border border-black/20"
            style={{
              backgroundImage: `url(${mediaAsset.posterFrame})`,
              backgroundRepeat: "repeat-x",
              backgroundSize: "auto 100%",
              backgroundPosition: "left center",
            }}
          />
        ) : (
          <div className="h-8 rounded-[2px] bg-[#0c2730]/60" />
        )}
      </div>

      {/* Right trim handle */}
      <div data-testid={`clip-${clip.id}-resize-right`} className={`absolute right-0 top-0 w-3 h-full hover:bg-cyan-300/40 cursor-ew-resize z-20 ${isResizing === "right" ? (resizeStart?.isRipple ? "bg-yellow-300/60" : "bg-cyan-300/60") : "bg-transparent"}`} onMouseDown={(e) => handleResizeStart(e, "right")} title={rippleEditEnabled ? "Ripple trim (ripple mode ON)" : "Hold Shift for ripple trim"} />
    </div>
  );
};
