/**
 * TimelineTracks Component for Timeline Engine v1
 * Renders all track lanes with clips using the new Clip component
 */

import { useMemo } from "react";
import { useTimelineStore } from "../store";
import { TrackLane } from "./TrackLane";

interface TimelineTracksProps {
  pxPerSec: number;
  scrollLeft: number;
  viewportWidth: number;
  contentWidth: number;
}

export function TimelineTracks({ pxPerSec, scrollLeft, viewportWidth, contentWidth }: TimelineTracksProps) {
  const { tracks, clips, selectedClipIds, selectClip } = useTimelineStore();

  const sortedTracks = useMemo(() => {
    return Array.from(tracks.values()).sort((a, b) => a.order - b.order);
  }, [tracks]);

  // Convert clips Map to array
  const clipsArray = useMemo(() => Array.from(clips.values()), [clips]);

  return (
    <div className="relative" style={{ width: contentWidth }}>
      {sortedTracks.map((track) => (
        <TrackLane key={track.id} track={track} clips={clipsArray} selectedClipIds={selectedClipIds} pxPerSec={pxPerSec} scrollLeft={scrollLeft} viewportWidth={viewportWidth} onClipSelect={selectClip} />
      ))}
    </div>
  );
}
