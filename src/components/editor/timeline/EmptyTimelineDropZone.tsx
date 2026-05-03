import React from "react";
import { Plus } from "lucide-react";
// @ts-ignore - react-dnd types issue
import { useDrop } from "react-dnd";
import { useTimelineStore } from "../../../store/timelineStore";
import { handleCreateTrackAndDrop } from "../../../lib/timelineUtils";
import type { DragItem } from "../../../types";

interface EmptyTimelineDropZoneProps {
  isDragging: boolean;
}

export const EmptyTimelineDropZone: React.FC<EmptyTimelineDropZoneProps> = ({ isDragging }) => {
  const tracks = useTimelineStore((s) => s.tracks);

  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: ["MEDIA_ASSET"], // Only accept media assets, not clips
      drop: (item: DragItem, monitor: any) => {
        handleCreateTrackAndDrop(item, monitor, tracks.length); // append at end
      },
      collect: (monitor: any) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }),
    [tracks.length],
  );

  return (
    <div
      ref={drop}
      className={`w-full ${isDragging ? "flex-1 min-h-[120px]" : "h-0"} ${!isDragging ? "pointer-events-none" : ""}`}
      // No background — completely invisible unless hovering
    >
      {isDragging && isOver && canDrop && (
        <div className="h-full flex items-start pt-3 justify-center pointer-events-none">
          <div className="flex items-center gap-1.5 text-accent text-xs border border-accent/40 rounded px-2 py-1 bg-accent/5">
            <Plus size={11} />
            Drop to create new track
          </div>
        </div>
      )}
    </div>
  );
};
