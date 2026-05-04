import React from "react";
// @ts-ignore - react-dnd types issue
import { useDragLayer } from "react-dnd";
import { useDragStateStore } from "../../../store/dragStateStore";
import { useTimelineStore } from "../../../store/timelineStore";
import { useProjectStore } from "../../../store/projectStore";

export const ClipDragLayer: React.FC = () => {
  const { draggingClip, grabOffsetX, grabOffsetY } = useDragStateStore();
  const { pixelsPerSecond } = useTimelineStore();
  const { mediaAssets } = useProjectStore();

  const { isDragging, currentOffset } = useDragLayer((monitor: any) => ({
    isDragging: monitor.isDragging() && monitor.getItemType() === "CLIP",
    currentOffset: monitor.getClientOffset(),
  }));

  if (!isDragging || !draggingClip || !currentOffset) {
    return null;
  }

  const mediaAsset = mediaAssets.find((a) => a.id === draggingClip.assetId);
  const clipWidth = Math.min(Math.round(draggingClip.duration * pixelsPerSecond), 360);
  const trackHeight = 68; // Standard video track height

  return (
    <div
      style={{
        position: "fixed",
        left: currentOffset.x - grabOffsetX,
        top: currentOffset.y - grabOffsetY,
        width: clipWidth,
        height: trackHeight,
        pointerEvents: "none",
        zIndex: 9999,
        transform: "rotate(2deg)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        borderRadius: "4px",
        overflow: "hidden",
        opacity: 0.95,
      }}
    >
      {/* Mirror the clip appearance */}
      <div
        className="relative w-full h-full"
        style={{
          backgroundColor: draggingClip.type === "video" ? "#2d2340" : draggingClip.type === "audio" ? "#1a3040" : "#3d3010",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        {/* Thumbnail if available */}
        {mediaAsset?.posterFrame && draggingClip.type === "video" && <img src={mediaAsset.posterFrame} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" style={{ pointerEvents: "none" }} />}

        {/* Clip name */}
        <div className="absolute top-1 left-2 text-xs text-white/90 font-medium truncate max-w-[calc(100%-16px)]">{mediaAsset?.name || "Clip"}</div>

        {/* Duration */}
        <div className="absolute bottom-1 right-2 text-xs text-white/70">{draggingClip.duration.toFixed(1)}s</div>
      </div>
    </div>
  );
};
