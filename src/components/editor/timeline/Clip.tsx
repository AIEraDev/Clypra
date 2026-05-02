import React, { useState } from "react";
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
}

export const Clip: React.FC<ClipProps> = ({ clip, mediaAsset, pixelsPerSecond, selected }) => {
  const [isResizing, setIsResizing] = useState<"left" | "right" | null>(null);
  const { selectClip } = useUIStore();
  const { updateClip, moveClip } = useTimelineStore();

  const [{ isDragging }, drag] = useDrag(
    () => ({
      type: "CLIP",
      item: clip,
      collect: (monitor: any) => ({
        isDragging: monitor.isDragging(),
      }),
    }),
    [],
  );

  const left = clip.startTime * pixelsPerSecond;
  const width = clip.duration * pixelsPerSecond;

  const handleResizeStart = (e: React.MouseEvent, side: "left" | "right") => {
    e.stopPropagation();
    setIsResizing(side);
  };

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
      onClick={() => selectClip(clip.id)}
      className={`absolute h-full rounded-sm overflow-hidden transition-colors border ${selected ? "border border-accent/60" : ""} ${isDragging ? "opacity-50" : ""} ${getClipColor()}`}
      style={{
        left: `${left}px`,
        width: `${width}px`,
      }}
    >
      {/* Left trim handle */}
      <div className="absolute left-0 w-1 h-full bg-black/20 hover:bg-cyan-300/40" onMouseDown={(e) => handleResizeStart(e, "left")} />

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
      <div className="absolute right-0 w-1 h-full bg-black/20 hover:bg-cyan-300/40" onMouseDown={(e) => handleResizeStart(e, "right")} />
    </div>
  );
};
