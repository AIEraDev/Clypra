import React from "react";
import { useTimelineStore } from "@/store/timelineStore";
import { TrackLabel } from "./TrackLabel";

/**
 * @deprecated TrackList is no longer rendered by Timeline.tsx.
 * The grid-based layout now renders TrackLabel components inline.
 * This wrapper is kept for backward compatibility with existing imports/tests.
 */
interface TrackListProps {
  onEditTrack?: (trackId: string) => void;
  trackListRef?: React.RefObject<HTMLDivElement | null>;
}

export const TrackList: React.FC<TrackListProps> = ({ trackListRef }) => {
  const { tracks } = useTimelineStore();

  return (
    <div ref={trackListRef} className="w-40 border-r border-timeline-track-border flex flex-col bg-timeline-track-bg overflow-hidden">
      {/* Header */}
      <div className="h-6 px-3 border-b border-timeline-track-border flex items-center shrink-0 panel-head bg-timeline-track-bg">
        <span className="text-[11px] font-semibold tracking-wide text-timeline-track-label uppercase">Track</span>
      </div>

      {/* Track labels */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {tracks.length === 0 ? (
          <div className="flex-1 flex items-center justify-center px-3">
            <span className="text-[10px] text-text-muted/40 text-center">No tracks</span>
          </div>
        ) : (
          tracks.map((track) => <TrackLabel key={track.id} track={track} />)
        )}
      </div>
    </div>
  );
};
