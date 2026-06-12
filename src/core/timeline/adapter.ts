/**
 * Adapter layer between legacy Clip type and CompositorClip.
 * Bridges the old track-centric model with the new compositor model.
 *
 * This allows gradual migration without breaking existing code.
 */

import type { Clip, Track } from "@/types";
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

  // Get track index (for compositing order)
  const trackIndex = tracks.findIndex((t) => t.id === clip.trackId);

  // Use explicit clip role when available, otherwise infer from track position.
  const role = ((clip as any).role as ClipRole | undefined) ?? inferRoleFromTrackPosition(track, trackIndex, tracks);

  // TRACE: Z-order verification (can be removed after validation)
  console.log("[TRACE][ADAPTER] trackIndex:", trackIndex, "role:", role, "clipId:", clip.id.substring(0, 8));

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
    case "sticker":
      return "overlay";
    default:
      return "primary";
  }
}

/**
 * Enhance role inference with track position.
 *
 * CRITICAL: All video tracks are assigned "overlay" role.
 * Z-order between video tracks is determined entirely by trackIndex
 * in the evaluator sort (descending — lower trackIndex draws last = on top).
 *
 * The "primary" role should be reserved for explicit background plates
 * or generated mattes that must always sit below everything else.
 */
export function inferRoleFromTrackPosition(track: Track | undefined, trackIndex: number, tracks: Track[]): ClipRole {
  if (!track) return "overlay";

  if (track.type === "audio") return "audio";
  if (track.type === "text") return "text";
  if (track.type === "sticker") return "overlay";

  // All video tracks are overlays.
  // Z-order is handled by trackIndex sorting, not by role distinction.
  return "overlay";
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
