/**
 * TimelineTrackHeaders Component
 */

import { useState } from "react";
import { COLORS } from "../../../constants/colors";
import { IconLock, IconEye, IconSpeaker, IconVideo, IconMic } from "../../../components/ui/icons";
import { useTimelineStore } from "../store";
import type { Track } from "../types/core";

/**
 * Icon component for text tracks
 */
function IconText() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M5 4h14v3h-2V6H11v12h2v2H11v-2H9V6H7v1H5V4z" />
    </svg>
  );
}

/**
 * Returns the appropriate icon for a track type
 */
function getTrackIcon(type: Track["type"]) {
  switch (type) {
    case "video":
      return <IconVideo />;
    case "audio":
      return <IconMic />;
    case "text":
      return <IconText />;
    case "effects":
      return <span className="text-[8px] font-bold">FX</span>;
    default:
      return null;
  }
}

/**
 * Individual track header row component
 */
function TrackHeader({ track }: { track: Track }) {
  const [isDragging, setIsDragging] = useState(false);
  const { toggleTrackLock, toggleTrackVisibility, toggleTrackMute, reorderTrack, tracks } = useTimelineStore();

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", track.id);
    setIsDragging(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const draggedTrackId = e.dataTransfer.getData("text/plain");
    const draggedTrack = tracks.get(draggedTrackId);

    if (draggedTrack && draggedTrackId !== track.id) {
      // Swap orders
      const targetOrder = track.order;
      const draggedOrder = draggedTrack.order;

      reorderTrack(draggedTrackId, targetOrder);
      reorderTrack(track.id, draggedOrder);
    }
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`flex items-center gap-1.5 border-b px-2 py-2 text-[11px] transition-opacity ${isDragging ? "opacity-50" : ""}`}
      style={{
        borderColor: COLORS.BORDER,
        height: `${track.height}px`,
        cursor: "grab",
      }}
      role="row"
      aria-label={`${track.type} track: ${track.name}`}
      aria-grabbed={isDragging}
    >
      {/* Track type icon */}
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded" style={{ backgroundColor: track.color }} aria-hidden="true">
        {getTrackIcon(track.type)}
      </span>

      {/* Track name (truncated) */}
      <span className="min-w-0 flex-1 truncate text-zinc-300" title={track.name} role="heading" aria-level={2}>
        {track.name}
      </span>

      {/* Lock toggle */}
      <button type="button" onClick={() => toggleTrackLock(track.id)} className={`shrink-0 transition-colors hover:text-zinc-200 ${track.locked ? "text-red-400" : "text-zinc-500"}`} title={track.locked ? "Unlock track" : "Lock track"} aria-label={track.locked ? `Unlock ${track.name} track` : `Lock ${track.name} track`} aria-pressed={track.locked}>
        <IconLock />
      </button>

      {/* Visibility toggle */}
      <button type="button" onClick={() => toggleTrackVisibility(track.id)} className={`shrink-0 transition-colors hover:text-zinc-200 ${track.visible ? "text-zinc-400" : "text-zinc-600"}`} title={track.visible ? "Hide track" : "Show track"} aria-label={track.visible ? `Hide ${track.name} track` : `Show ${track.name} track`} aria-pressed={!track.visible}>
        <IconEye />
      </button>

      {/* Mute toggle (only for audio/video tracks) */}
      {(track.type === "audio" || track.type === "video") && (
        <button type="button" onClick={() => toggleTrackMute(track.id)} className={`shrink-0 transition-colors hover:text-zinc-200 ${track.muted ? "text-red-400" : "text-zinc-400"}`} title={track.muted ? "Unmute track" : "Mute track"} aria-label={track.muted ? `Unmute ${track.name} track` : `Mute ${track.name} track`} aria-pressed={track.muted}>
          <IconSpeaker />
        </button>
      )}
    </div>
  );
}

/**
 * Track headers component - displays track information and controls
 * Supports drag-and-drop reordering and sticky positioning
 */
export function TimelineTrackHeaders() {
  const tracks = useTimelineStore((state) => state.tracks);

  // Sort tracks by order (lower order = higher on screen)
  const sortedTracks = Array.from(tracks.values()).sort((a, b) => a.order - b.order);

  return (
    <div className="sticky left-0 z-10 flex w-[180px] shrink-0 flex-col border-r" style={{ borderColor: COLORS.BORDER, backgroundColor: COLORS.RAIL }} role="rowgroup" aria-label="Track headers">
      {/* Header spacer (aligns with time ruler) */}
      <div className="h-[26px] shrink-0 border-b" style={{ borderColor: COLORS.BORDER }} aria-hidden="true" />

      {/* Track headers */}
      {sortedTracks.map((track) => (
        <TrackHeader key={track.id} track={track} />
      ))}
    </div>
  );
}
