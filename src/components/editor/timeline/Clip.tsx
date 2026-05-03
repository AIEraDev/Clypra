import React, { useState, useEffect } from "react";
// @ts-ignore - react-dnd types issue
import { useDrag } from "react-dnd";
import { useUIStore } from "../../../store/uiStore";
import { useTimelineStore } from "../../../store/timelineStore";
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
  const { selectClip } = useUIStore();
  const { updateClip } = useTimelineStore();
  const [isResizing, setIsResizing] = useState<"left" | "right" | null>(null);
  const [resizeStart, setResizeStart] = useState<{ x: number; startTime: number; duration: number; trimIn: number; trimOut: number } | null>(null);

  const [{ isDragging }, drag] = useDrag(
    () => ({
      type: "CLIP",
      item: () => {
        // Return the full clip object
        return { type: "CLIP" as const, clip };
      },
      canDrag: !locked && !isResizing,
      collect: (monitor: any) => ({
        isDragging: monitor.isDragging(),
      }),
      end: (_: any, monitor: any) => {
        if (!monitor.didDrop()) {
          console.log("Drag cancelled");
        }
      },
    }),
    [clip, locked, isResizing],
  );

  // Use displayStartTime if provided (for magnetic shifting), otherwise use clip.startTime
  const startTime = displayStartTime !== undefined ? displayStartTime : clip.startTime;
  const left = startTime * pixelsPerSecond;
  const width = clip.duration * pixelsPerSecond;

  const handleResizeStart = (e: React.MouseEvent, side: "left" | "right") => {
    e.stopPropagation();
    if (locked) return;

    setIsResizing(side);
    setResizeStart({
      x: e.clientX,
      startTime: clip.startTime,
      duration: clip.duration,
      trimIn: clip.trimIn,
      trimOut: clip.trimOut,
    });

    // Prevent text selection during resize
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    if (!isResizing || !resizeStart) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - resizeStart.x;
      const deltaTime = deltaX / pixelsPerSecond;

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
  }, [isResizing, resizeStart, clip.id, pixelsPerSecond, updateClip, mediaAsset]);

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
        selectClip(clip.id);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      className={`absolute h-full rounded-sm overflow-hidden border ${selected ? "border border-accent/60" : ""} ${isDragging ? "opacity-50" : ""} ${isResizing ? "ring-2 ring-cyan-500" : ""} ${locked ? "cursor-not-allowed" : ""} ${getClipColor()} ${isShifting ? "transition-all duration-150 ease-out" : ""}`}
      style={{
        left: `${left}px`,
        width: `${width}px`,
      }}
    >
      {/* Left trim handle */}
      <div data-testid={`clip-${clip.id}-resize-left`} className={`absolute left-0 w-2 h-full hover:bg-cyan-300/40 cursor-ew-resize z-10 ${isResizing === "left" ? "bg-cyan-300/60" : "bg-black/20"}`} onMouseDown={(e) => handleResizeStart(e, "left")} />

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
      <div data-testid={`clip-${clip.id}-resize-right`} className={`absolute right-0 w-2 h-full hover:bg-cyan-300/40 cursor-ew-resize z-10 ${isResizing === "right" ? "bg-cyan-300/60" : "bg-black/20"}`} onMouseDown={(e) => handleResizeStart(e, "right")} />
    </div>
  );
};
