import React from "react";
import {
  AudioLines,
  Eye,
  EyeOff,
  Headphones,
  Layers,
  Lock,
  Minimize2,
  SlidersHorizontal,
  Sparkles,
  Sticker,
  Type,
  Unlock,
  UserRound,
  Video,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { GapManager } from "@/lib/timeline/gapManager";
import { TIMELINE_TRACK_LABEL_WIDTH_PX } from "@/lib/timeline/timelineViewport";
import {
  getTrackVisualSpec,
  type TrackVisualRole,
  type TrackVisualSpec,
} from "@/lib/timeline/trackTypeConfig";
import type { Track } from "@/types";
import { toggleTrackPropertyWithHistory } from "@/core/history/trackPropertyActions";

interface TrackLabelProps {
  track: Track;
  visualSpec?: TrackVisualSpec;
}

const TRACK_ROLE_ICONS: Record<TrackVisualRole, typeof Video> = {
  "a-roll": Video,
  "b-roll": Video,
  audio: AudioLines,
  text: Type,
  sticker: Sticker,
  filter: SlidersHorizontal,
  "video-effect": Sparkles,
  "body-effect": UserRound,
  "animated-overlay": Layers,
};

/**
 * Single track label panel — renders lock/visibility/mute controls.
 *
 * Designed to live inside a CSS Grid as a `sticky left-0` cell so it
 * stays pinned while the clip area scrolls horizontally.
 */
export const TrackLabel: React.FC<TrackLabelProps> = ({
  track,
  visualSpec: visualSpecProp,
}) => {
  const {
    tracks,
    clips,
    gaps,
    mainVideoTrackId,
  } = useTimelineStore();
  const { selectedTrackId, selectTrack } = useUIStore();
  const visualSpec =
    visualSpecProp ??
    getTrackVisualSpec(
      track,
      tracks.length > 0 ? tracks : [track],
      mainVideoTrackId,
    );

  const isEmpty = !clips.some((c) => c.trackId === track.id);
  const hasGaps = gaps.some((g) => g.trackId === track.id && !g.protected);
  const isSelected = selectedTrackId === track.id;
  const TrackRoleIcon = TRACK_ROLE_ICONS[visualSpec.role];

  return (
    <div
      className={`group relative flex items-center gap-2 px-2 transition-colors bg-surface-raised ${isSelected ? "bg-timeline-track-selected ring-1 ring-inset ring-timeline-track-active" : "hover:bg-timeline-track-hover"} ${isEmpty ? "opacity-70" : ""} ${track.locked ? "bg-timeline-track-active/60" : ""}`}
      style={{
        height: `${visualSpec.height}px`,
        position: "sticky",
        left: 0,
        zIndex: 150,
        width: `${TIMELINE_TRACK_LABEL_WIDTH_PX}px`,
        minWidth: `${TIMELINE_TRACK_LABEL_WIDTH_PX}px`,
        flexShrink: 0,
      }}
      onClick={() => selectTrack(track.id)}
    >
      <div
        className={`absolute left-0 top-0 h-full w-0.5 ${isSelected ? "bg-timeline-track-label" : "bg-transparent"}`}
      />
      <span
        data-testid={`track-${track.id}-visual-role`}
        className={`pointer-events-none inline-flex h-6 w-6 shrink-0 items-center justify-center rounded ${visualSpec.tone === "primary" ? "text-accent" : visualSpec.tone === "secondary" ? "text-accent/70" : visualSpec.tone === "audio" ? "text-text-muted" : "text-accent-soft/75"}`}
        aria-label={visualSpec.label}
        title={visualSpec.label}
      >
        <TrackRoleIcon className="h-4 w-4" aria-hidden="true" />
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleTrackPropertyWithHistory(track.id, "locked");
        }}
        className={`p-1 rounded transition-colors cursor-pointer hover:bg-timeline-button-hover ${track.locked ? "bg-timeline-button-hover text-timeline-track-name" : "text-timeline-button-icon"}`}
        aria-label={track.locked ? "Unlock track" : "Lock track"}
        title={track.locked ? "Unlock track" : "Lock track"}
      >
        {track.locked ? (
          <Lock className="w-3 h-3" />
        ) : (
          <Unlock className="w-3 h-3" />
        )}
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleTrackPropertyWithHistory(track.id, "visible");
        }}
        className={`p-1 rounded transition-colors cursor-pointer hover:bg-timeline-button-hover ${track.visible ? "text-timeline-button-icon" : "bg-timeline-button-hover text-timeline-track-name"}`}
        aria-label={track.visible ? "Hide track" : "Show track"}
        title={track.visible ? "Hide track" : "Show track"}
      >
        {track.visible ? (
          <Eye className="w-3 h-3" />
        ) : (
          <EyeOff className="w-3 h-3" />
        )}
      </button>

      {/* Only show mute button for tracks that produce audio */}
      {(track.type === "video" || track.type === "audio") && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleTrackPropertyWithHistory(track.id, "solo");
          }}
          disabled={track.locked}
          className={`p-1 rounded transition-colors ${track.locked ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-timeline-button-hover"} ${track.solo ? "bg-accent/20 text-accent" : "text-timeline-button-icon"}`}
          aria-label={track.solo ? "Unsolo track" : "Solo track"}
          title={
            track.locked
              ? "Unlock track to solo or unsolo"
              : track.solo
                ? "Unsolo track"
                : "Solo track"
          }
        >
          <Headphones className="w-3 h-3" />
        </button>
      )}

      {(track.type === "video" || track.type === "audio") && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleTrackPropertyWithHistory(track.id, "muted");
          }}
          disabled={track.locked}
          className={`p-1 rounded transition-colors ${track.locked ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-timeline-button-hover"} ${track.muted ? "bg-timeline-button-hover text-timeline-track-name" : "text-timeline-button-icon"}`}
          aria-label={track.muted ? "Unmute track" : "Mute track"}
          title={
            track.locked
              ? "Unlock track to mute or unmute"
              : track.muted
                ? "Unmute track"
                : "Mute track"
          }
        >
          {track.muted ? (
            <VolumeX className="w-3 h-3" />
          ) : (
            <Volume2 className="w-3 h-3" />
          )}
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
          aria-label="Pack track (remove gaps)"
          title="Pack track - remove all unprotected gaps"
        >
          <Minimize2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};
