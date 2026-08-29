/**
 * Adapter layer between legacy Clip type and CompositorClip.
 * Bridges the old track-centric model with the new compositor model.
 *
 * This allows gradual migration without breaking existing code.
 */

import type { Clip, Track } from "@/types";
import type { CompositorClip, ClipRole } from "../compositor/types";
import { expandCompoundClips } from "./compoundClips";

/**
 * Convert legacy Clip to CompositorClip.
 * Infers compositor metadata from track information.
 *
 * @param clip - Legacy clip
 * @param tracks - All tracks (for index lookup)
 * @returns CompositorClip with inferred metadata
 */
export function toCompositorClip(clip: Clip, tracks: readonly Track[]): CompositorClip {
  const track = tracks.find((t) => t.id === clip.trackId);

  // Get track index (for compositing order)
  const trackIndex = tracks.findIndex((t) => t.id === clip.trackId);

  // Use explicit clip role when available, otherwise infer from track position.
  const role = clip.role ?? inferRoleFromTrackPosition(track, trackIndex, tracks);

  // Preserve an explicit clip z-index when one has been persisted. Track order is
  // still the cross-track ordering rule; this value only resolves clips that
  // share the same role and track. Falling back to the track index retains the
  // legacy ordering for clips created before z-index was stored on the clip.
  const persistedZIndex = clip.zIndex;
  const zIndex = typeof persistedZIndex === "number" && Number.isFinite(persistedZIndex)
    ? persistedZIndex
    : Math.max(0, trackIndex);
  const evaluationPriority = Number.isFinite(clip.evaluationPriority)
    ? clip.evaluationPriority!
    : 0;

  // Resolve kind if missing or incorrect
  const kind = clip.kind ?? (track?.type === "filter" ? "filter" : clip.id.startsWith("filter-clip-") ? "filter" : undefined);

  return {
    ...clip,
    kind,
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
  return expandCompoundClips(clips).map((clip) => toCompositorClip(clip, tracks));
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
export function inferRoleFromTrackPosition(track: Track | undefined, trackIndex: number, tracks: readonly Track[]): ClipRole {
  if (!track) return "overlay";

  if (track.type === "audio") return "audio";
  if (track.type === "text") return "text";
  if (track.type === "sticker") return "overlay";

  // All video tracks are overlays.
  // Z-order is handled by trackIndex sorting, not by role distinction.
  return "overlay";
}

/**
 * Convert a runtime compositor clip back to persisted clip state.
 * Track index is derived from the current timeline order and is deliberately
 * not stored; role, z-index, and priority are first-class clip metadata.
 */
export function fromCompositorClip(compositorClip: CompositorClip): Clip {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { trackIndex, ...clip } = compositorClip;
  return clip;
}
