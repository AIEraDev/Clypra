import React, { useEffect } from "react";
// @ts-ignore - react-dnd types issue
import { useDrop } from "react-dnd";
import { useTimelineStore } from "@/store/timelineStore";
import { handleCreateTrackAndDrop } from "@/lib/timeline/timelineUtils";
import type { DragItem } from "@/types";
import { traceTimelineDnd } from "@/lib/timeline/timelineDndTrace";

export const EmptyTimelineDropZone: React.FC = () => {
  const tracks = useTimelineStore((s) => s.tracks);

  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: ["MEDIA_ASSET"], // Only accept media assets, not clips
      drop: (item: DragItem, monitor: any) => {
        traceTimelineDnd("empty-target-drop", {
          itemType: item?.type,
          assetId: item?.type === "MEDIA_ASSET" ? item.asset?.id : undefined,
          didDropBefore: monitor.didDrop(),
          clientOffset: monitor.getClientOffset?.() ?? null,
          trackCount: tracks.length,
        });
        try {
          handleCreateTrackAndDrop(item, monitor, tracks.length); // append at end
          traceTimelineDnd("empty-target-drop-complete", {
            trackCount: useTimelineStore.getState().tracks.length,
            clipCount: useTimelineStore.getState().clips.length,
          });
          return { accepted: true };
        } catch (error) {
          traceTimelineDnd("empty-target-drop-error", {
            error: error instanceof Error ? error.message : String(error),
            itemType: item?.type,
            assetId: item?.type === "MEDIA_ASSET" ? item.asset?.id : undefined,
          });
          throw error;
        }
      },
      collect: (monitor: any) => ({
        isOver: monitor.isOver({ shallow: true }),
        canDrop: monitor.canDrop(),
      }),
    }),
    [tracks.length],
  );

  useEffect(() => {
    traceTimelineDnd("empty-target-state", { isOver, canDrop, trackCount: tracks.length });
  }, [isOver, canDrop, tracks.length]);

  return (
    <div
      ref={(node) => {
        drop(node);
      }}
      className="absolute inset-0 z-30 pointer-events-auto"
      aria-label="Timeline drop area"
      data-dnd-target="empty-timeline"
    />
  );
};
