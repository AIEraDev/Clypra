import React from "react";
// @ts-ignore - react-dnd types issue
import { useDrop } from "react-dnd";
import { useUIStore } from "../../../store/uiStore";
import { useTimeline } from "../../../hooks/useTimeline";
import { Clip } from "./Clip";
import type { Track as TrackType, DragItem } from "../../../types";

interface TrackProps {
  track: TrackType;
  pixelsPerSecond: number;
  clips: any[];
}

export const Track: React.FC<TrackProps> = ({ track, pixelsPerSecond, clips }) => {
  const { selectedClipId, selectedTrackId } = useUIStore();
  const { addClipFromAsset, getMediaAsset, moveClip, updateClip, scrollLeft } = useTimeline();

  // Drop handler
  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: ["MEDIA_ASSET", "CLIP"],
      collect: (monitor: any) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
      drop: (item: DragItem, monitor: any) => {
        if (track.locked) return;

        const clientOffset = monitor.getClientOffset();
        if (!clientOffset) return;

        const trackElement = document.querySelector(`[data-track-id="${track.id}"]`);
        if (!trackElement) return;

        const rect = (trackElement as HTMLElement).getBoundingClientRect();
        const x = clientOffset.x - rect.left + scrollLeft;
        const startTime = x / pixelsPerSecond;

        // Check if it's a media asset or existing clip
        if (item.type === "MEDIA_ASSET") {
          addClipFromAsset(item.asset, track.id, startTime);
        } else if (item.type === "CLIP") {
          const clip = item.clip;
          if (clip.trackId === track.id) {
            moveClip(clip.id, startTime);
          } else {
            updateClip(clip.id, { trackId: track.id, startTime });
          }
        }
      },
    }),
    [track.id, pixelsPerSecond, addClipFromAsset, moveClip, updateClip, scrollLeft],
  );

  const trackClips = clips.filter((c) => c.trackId === track.id);

  return (
    <div ref={drop} data-track-id={track.id} className={`relative border-b border-border transition-colors ${selectedTrackId === track.id ? "bg-[#1f242b]" : "hover:bg-[#1f242b]"} ${isOver && canDrop ? "bg-cyan-500/10 ring-1 ring-cyan-500/50" : ""}`} style={{ height: `${track.height}px` }}>
      {track.visible && trackClips.map((clip) => <Clip key={clip.id} clip={clip} mediaAsset={getMediaAsset(clip.mediaId)} pixelsPerSecond={pixelsPerSecond} selected={clip.id === selectedClipId} locked={track.locked} />)}
    </div>
  );
};
