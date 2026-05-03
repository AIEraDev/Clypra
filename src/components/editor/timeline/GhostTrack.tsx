import React from "react";
// @ts-ignore - react-dnd types issue
import { useDrop } from "react-dnd";
import { handleCreateTrackAndDrop } from "../../../lib/timelineUtils";
import type { DragItem } from "../../../types";

interface GhostTrackProps {
  insertIndex: number;
  isDragging: boolean;
}

export const GhostTrack: React.FC<GhostTrackProps> = ({ insertIndex, isDragging }) => {
  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: ["MEDIA_ASSET"], // Only accept media assets, not clips
      drop: (item: DragItem, monitor: any) => {
        handleCreateTrackAndDrop(item, monitor, insertIndex);
      },
      collect: (monitor: any) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }),
    [insertIndex],
  );

  return (
    <div ref={drop} className={`relative w-full transition-all duration-150 ${isDragging && canDrop && isOver ? "h-10" : "h-0"} ${!isDragging ? "pointer-events-none" : ""}`}>
      {/* Only show a horizontal insertion line when dragging and hovering */}
      {isDragging && isOver && canDrop && (
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-accent rounded-full pointer-events-none">
          {/* Dot at left edge */}
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-accent" />
          <span className="absolute left-4 -top-3 text-accent text-[10px] bg-[#141920] px-1 rounded whitespace-nowrap">New track</span>
        </div>
      )}
    </div>
  );
};
