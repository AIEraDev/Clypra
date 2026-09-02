import React from "react";
// @ts-ignore - react-dnd types issue
import { useDragLayer } from "react-dnd";
import { useDragStateStore } from "@/store/dragStateStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { TRACK_TYPE_CONFIG, resolveTrackTypeForClip } from "@/lib/timeline/trackTypeConfig";

export const ClipDragLayer: React.FC = () => {
  const { draggingClip, grabOffsetX, grabOffsetY } = useDragStateStore();
  const { pixelsPerSecond, tracks } = useTimelineStore();
  const { mediaAssets } = useProjectStore();

  const { isDragging, currentOffset } = useDragLayer((monitor: any) => ({
    isDragging: monitor.isDragging() && monitor.getItemType() === "CLIP",
    currentOffset: monitor.getClientOffset(),
  }));

  if (!isDragging || !draggingClip || !currentOffset) {
    return null;
  }

  const mediaAsset = mediaAssets.find((a) => a.id === draggingClip.mediaId);
  const sourceTrack = tracks.find((t) => t.id === draggingClip.trackId);
  const resolvedTrackType = resolveTrackTypeForClip(draggingClip, sourceTrack, mediaAsset);
  const clipWidth = Math.min(Math.round(draggingClip.duration * pixelsPerSecond), 360);
  const trackHeight = TRACK_TYPE_CONFIG[resolvedTrackType]?.height ?? TRACK_TYPE_CONFIG.video.height;

  // Determine background color based on resolved track type & media asset type
  const getBackgroundColor = () => {
    if (resolvedTrackType === "text") return "var(--clypra-clip-text-bg)";
    if (resolvedTrackType === "audio" || mediaAsset?.type === "audio") return "var(--clypra-clip-audio-bg)";
    if (mediaAsset?.type === "video") return "var(--clypra-clip-video-bg)";
    return "var(--clypra-clip-image-bg)";
  };

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
        boxShadow: "var(--clypra-clip-drag-shadow)",
        borderRadius: "4px",
        overflow: "hidden",
        opacity: 0.95,
      }}
    >
      {/* Mirror the clip appearance */}
      <div
        className="relative w-full h-full"
        style={{
          backgroundColor: getBackgroundColor(),
          border: "1px solid var(--clypra-clip-drag-border)",
        }}
      >
        {/* Thumbnail if available */}
        {mediaAsset?.posterFrame && mediaAsset.type === "video" && <img src={mediaAsset.posterFrame} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" style={{ pointerEvents: "none" }} />}

        {/* Clip name */}
        <div className="absolute top-1 left-2 text-xs text-clypra-clip-fg font-medium truncate max-w-[calc(100%-16px)]">{mediaAsset?.name || "Clip"}</div>

        {/* Duration */}
        <div className="absolute bottom-1 right-2 text-xs text-clypra-clip-muted-fg">{draggingClip.duration.toFixed(1)}s</div>
      </div>
    </div>
  );
};
