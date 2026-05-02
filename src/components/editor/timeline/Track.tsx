import React from "react";
// @ts-ignore - react-dnd types issue
import { useDrop } from "react-dnd";
import { Film, Music, Type } from "lucide-react";
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
  const { selectTrack, selectedClipId, selectedTrackId } = useUIStore();
  const { addClipFromAsset, getMediaAsset } = useTimeline();

  const [, drop] = useDrop(
    () => ({
      accept: "MEDIA_ASSET",
      drop: (item: DragItem, monitor: any) => {
        const clientOffset = monitor.getClientOffset();
        if (!clientOffset) return;

        const trackElement = document.querySelector(`[data-track-id="${track.id}"]`);
        if (!trackElement) return;

        const rect = (trackElement as HTMLElement).getBoundingClientRect();
        const x = clientOffset.x - rect.left;
        const startTime = x / pixelsPerSecond;

        addClipFromAsset(item.asset, track.id, startTime);
      },
    }),
    [track.id, pixelsPerSecond, addClipFromAsset],
  );

  const getTrackIcon = () => {
    if (track.type === "video") return <Film className="w-4 h-4" />;
    if (track.type === "audio") return <Music className="w-4 h-4" />;
    return <Type className="w-4 h-4" />;
  };

  const trackClips = clips.filter((c) => c.trackId === track.id);

  return (
    <div ref={drop} data-track-id={track.id} className={`relative border-b border-border transition-colors ${selectedTrackId === track.id ? "bg-[#1f242b]" : "hover:bg-[#1f242b]"}`} style={{ height: `${track.height}px` }} onClick={() => selectTrack(track.id)}>
      {trackClips.map((clip) => (
        <Clip key={clip.id} clip={clip} mediaAsset={getMediaAsset(clip.mediaId)} pixelsPerSecond={pixelsPerSecond} selected={clip.id === selectedClipId} />
      ))}
    </div>
  );
};
