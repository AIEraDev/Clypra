import React from "react";
// @ts-ignore - react-dnd types issue
import { useDrop } from "react-dnd";
import { useTimelineStore } from "@/store/timelineStore";
import { handleCreateTrackAndDrop } from "@/lib/timeline/timelineUtils";
import type { DragItem } from "@/types";

interface EmptyTimelineDropZoneProps {
  isDragging: boolean;
}

export const EmptyTimelineDropZone: React.FC<EmptyTimelineDropZoneProps> = ({ isDragging }) => {
  const tracks = useTimelineStore((s) => s.tracks);

  const [, drop] = useDrop(
    () => ({
      accept: ["MEDIA_ASSET"], // Only accept media assets, not clips
      drop: (item: DragItem, monitor: any) => {
        handleCreateTrackAndDrop(item, monitor, tracks.length); // append at end
      },
    }),
    [tracks.length],
  );

  return (
    <div
      ref={drop as unknown as React.Ref<HTMLDivElement>}
      className={`absolute inset-0 z-30 rounded-xl pointer-events-auto transition-colors ${isDragging ? "border-2 border-dashed border-accent/60 bg-accent/10" : ""}`}
      aria-label="Timeline drop area"
    />
  );
};
