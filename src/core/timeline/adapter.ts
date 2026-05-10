/**
 * Adapter layer between legacy Clip type and CompositorClip.
 * Bridges the old track-centric model with the new compositor model.
 *
 * This allows gradual migration without breaking existing code.
 */

import type { Clip, Track } from "../../types";
import type { CompositorClip, ClipRole } from "../compositor/types";

/**
 * Convert legacy Clip to CompositorClip.
 * Infers compositor metadata from track information.
 *
 * @param clip - Legacy clip
 * @param tracks - All tracks (for index lookup)
 * @returns CompositorClip with inferred metadata
 */
export function toCompositorClip(clip: Clip, tracks: Track[]): CompositorClip {
  const track = tracks.find((t) => t.id === clip.trackId);

  // Infer role from track type
  const role = inferRoleFromTrack(track);

  // Get track index (for compositing order)
  const trackIndex = tracks.findIndex((t) => t.id === clip.trackId);

  // Default z-index and priority
  // TODO: These should eventually come from clip metadata
  const zIndex = trackIndex; // Higher tracks = higher z-index
  const evaluationPriority = 0; // Default priority

  return {
    ...clip,
    role,
    trackIndex: trackIndex >= 0 ? trackIndex : 0,
    zIndex,
    evaluationPriority,
  };
}

/**
 * Convert multiple legacy clips to compositor clips.
 */
export function toCompositorClips(clips: Clip[], tracks: Track[]): CompositorClip[] {
  return clips.map((clip) => toCompositorClip(clip, tracks));
}

/**
 * Infer clip role from track type.
 * This is a temporary heuristic until clips have explicit roles.
 */
function inferRoleFromTrack(track: Track | undefined): ClipRole {
  if (!track) return "primary"; // Default fallback

  switch (track.type) {
    case "video":
      // First video track is primary, others are overlays
      // TODO: This should be more sophisticated
      return "primary";
    case "audio":
      return "audio";
    case "text":
      return "text";
    default:
      return "primary";
  }
}

/**
 * Enhance role inference with track position.
 * First video track = primary, subsequent = overlay.
 */
export function inferRoleFromTrackPosition(track: Track | undefined, trackIndex: number, tracks: Track[]): ClipRole {
  if (!track) return "primary";

  if (track.type === "audio") return "audio";
  if (track.type === "text") return "text";

  // For video tracks, first one is primary, rest are overlays
  const videoTracks = tracks.filter((t) => t.type === "video");
  const videoTrackIndex = videoTracks.findIndex((t) => t.id === track.id);

  if (videoTrackIndex === 0) {
    return "primary";
  } else {
    return "overlay";
  }
}

/**
 * Convert CompositorClip back to legacy Clip.
 * Strips compositor metadata.
 */
export function fromCompositorClip(compositorClip: CompositorClip): Clip {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { role, trackIndex, zIndex, evaluationPriority, ...legacyClip } = compositorClip;
  return legacyClip;
}
