import React from "react";
import { Volume2, VolumeX, Lock, Unlock, Eye, EyeOff, Minimize2 } from "lucide-react";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { GapManager } from "@/lib/timeline/gapManager";
import { TIMELINE_TRACK_LABEL_WIDTH_PX } from "@/lib/timeline/timelineViewport";
import { t } from "@/i18n";
import type { Track } from "@/types";

interface TrackLabelProps {
  track: Track;
}

/**
 * Single track label panel — renders lock/visibility/mute controls.
 *
 * Designed to live inside a CSS Grid as a `sticky left-0` cell so it
 * stays pinned while the clip area scrolls horizontally.
 */
export const TrackLabel: React.FC<TrackLabelProps> = ({ track }) => {
  const { clips, gaps, toggleTrackLock, toggleTrackMute, toggleTrackVisibility } = useTimelineStore();
  const { selectedTrackId, selectTrack } = useUIStore();

  const isEmpty = !clips.some((c) => c.trackId === track.id);
  const hasGaps = gaps.some((g) => g.trackId === track.id && !g.protected);
  const isSelected = selectedTrackId === track.id;

  return (
    <div
      className={`group relative flex items-center gap-2 px-2 transition-colors bg-surface-raised ${isSelected ? "bg-timeline-track-selected ring-1 ring-inset ring-timeline-track-active" : "hover:bg-timeline-track-hover"} ${isEmpty ? "opacity-70" : ""} ${track.locked ? "bg-timeline-track-active/60" : ""}`}
      style={{
        height: `${track.height}px`,
        position: "sticky",
        left: 0,
        zIndex: 150,
        width: `${TIMELINE_TRACK_LABEL_WIDTH_PX}px`,
        minWidth: `${TIMELINE_TRACK_LABEL_WIDTH_PX}px`,
        flexShrink: 0,
        borderRight: "1px solid var(--color-timeline-track-border)",
      }}
      onClick={() => selectTrack(track.id)}
    >
      <div className={`absolute left-0 top-0 h-full w-[2px] ${isSelected ? "bg-timeline-track-label" : "bg-transparent"}`} />
      <span className="min-w-0 flex-1 truncate text-[10px] text-timeline-track-name" title={track.name}>{track.name}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleTrackLock(track.id);
        }}
        className={`p-1 rounded transition-colors cursor-pointer hover:bg-timeline-button-hover ${track.locked ? "bg-timeline-button-hover text-timeline-track-name" : "text-timeline-button-icon"}`}
        aria-label={track.locked ? t("timeline.trackControl.unlock") : t("timeline.trackControl.lock")}
        title={track.locked ? t("timeline.trackControl.unlock") : t("timeline.trackControl.lock")}
      >
        {track.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleTrackVisibility(track.id);
        }}
        className={`p-1 rounded transition-colors cursor-pointer hover:bg-timeline-button-hover ${track.visible ? "text-timeline-button-icon" : "bg-timeline-button-hover text-timeline-track-name"}`}
        aria-label={track.visible ? t("timeline.trackControl.hide") : t("timeline.trackControl.show")}
        title={track.visible ? t("timeline.trackControl.hide") : t("timeline.trackControl.show")}
      >
        {track.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
      </button>

      {/* Only show mute button for tracks that produce audio */}
      {(track.type === "video" || track.type === "audio") && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleTrackMute(track.id);
          }}
          className={`p-1 rounded transition-colors cursor-pointer hover:bg-timeline-button-hover ${track.muted ? "bg-timeline-button-hover text-timeline-track-name" : "text-timeline-button-icon"}`}
          aria-label={track.muted ? t("timeline.trackControl.unmute") : t("timeline.trackControl.mute")}
          title={track.muted ? t("timeline.trackControl.unmute") : t("timeline.trackControl.mute")}
        >
          {track.muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
        </button>
      )}

      {/* Pack Track button - only show if track has unprotected gaps */}
      {hasGaps && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            GapManager.packTrack(track.id);
          }}
          className="p-1 rounded transition-colors cursor-pointer hover:bg-timeline-button-hover text-timeline-button-icon opacity-0 group-hover:opacity-100"
          aria-label={t("timeline.trackControl.pack")}
          title={t("timeline.trackControl.packTitle")}
        >
          <Minimize2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};
