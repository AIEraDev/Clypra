import type { ClipFitModeExtended } from "./timelineClip";
import type { Clip, MediaAsset, Track, TrackType } from "@/types";

export interface PlacementPolicy {
  defaultVisualFitMode: ClipFitModeExtended;
  centerAnchor: boolean;
  autoAdaptSequenceForFirstVisualClip: boolean;
}

/**
 * Centralized NLE placement policy used by all media insertion paths.
 * Keep this as the single source of truth for default placement behavior.
 */
export const DEFAULT_PLACEMENT_POLICY: PlacementPolicy = {
  defaultVisualFitMode: "cover",
  centerAnchor: true,
  autoAdaptSequenceForFirstVisualClip: true,
};

export type PlacementIntent = "timeline_end" | "track_end" | "drop";
export type AddPlacementIntent = "playhead";

/**
 * Professional default fit policy by media class:
 * - Video: cover (full-frame editorial baseline)
 * - Image: contain (preserve full still content by default)
 */
export function resolveDefaultFitModeForAsset(asset: Pick<MediaAsset, "type"> & { id?: string }): ClipFitModeExtended {
  if (asset.id?.startsWith("sticker-")) return "original";
  if (asset.type === "image") return "contain";
  if (asset.type === "video") return "cover";
  return DEFAULT_PLACEMENT_POLICY.defaultVisualFitMode;
}

export function resolveTargetTrackType(asset: { type: MediaAsset["type"]; id?: string; trackType?: TrackType }): "video" | "audio" | "sticker" | "text" | "filter" | "video-effect" | "body-effect" | "animated-overlay" {
  // Allow explicit track type override (for text, filter, effect, and overlay clips)
  if (asset.trackType) return asset.trackType;
  if (asset.id?.startsWith("sticker-")) return "sticker";
  return asset.type === "audio" ? "audio" : "video";
}

export function resolvePreferredTrackId(params: { tracks: Track[]; asset: { type: MediaAsset["type"]; id?: string; trackType?: TrackType }; preferTrackId?: string | null }): string | null {
  const { tracks, asset, preferTrackId } = params;
  const targetType = resolveTargetTrackType(asset);

  if (preferTrackId) {
    const preferred = tracks.find((t) => t.id === preferTrackId && !t.locked && t.type === targetType);
    if (preferred) return preferred.id;
  }

  const firstUnlocked = tracks.find((t) => t.type === targetType && !t.locked);
  return firstUnlocked?.id ?? null;
}

export function resolveClipStartTime(params: { intent: PlacementIntent; timelineEndTime: number; trackClips?: Clip[]; dropTime?: number }): number {
  const { intent, timelineEndTime, trackClips = [], dropTime = 0 } = params;

  if (intent === "drop") return Math.max(0, dropTime);
  if (intent === "track_end") {
    if (trackClips.length === 0) return 0;
    return Math.max(...trackClips.map((c) => c.startTime + c.duration), 0);
  }
  return Math.max(0, timelineEndTime);
}

interface ResolveAddPlacementParams {
  asset: { type: MediaAsset["type"]; id?: string; trackType?: TrackType };
  tracks: Track[];
  clips: Clip[];
  playheadTime: number;
  sequenceEndTime: number;
  /** Duration is required to guarantee that insertion does not overlap a later clip. */
  duration?: number;
  preferTrackId?: string | null;
}

interface AddPlacementDecision {
  intent: AddPlacementIntent;
  trackType: "video" | "audio" | "sticker" | "text" | "filter" | "video-effect" | "body-effect" | "animated-overlay";
  startTime: number;
  targetTrackId: string | null;
  shouldCreateTrack: boolean;
}

function isTrackOccupiedAtTime(trackClips: Clip[], time: number): boolean {
  return trackClips.some((clip) => {
    const clipEnd = clip.startTime + clip.duration;
    return clip.startTime <= time && time < clipEnd;
  });
}

function isTrackOccupiedDuring(trackClips: Clip[], startTime: number, duration: number): boolean {
  const endTime = startTime + Math.max(0, duration);
  return trackClips.some((clip) => {
    const clipEnd = clip.startTime + clip.duration;
    return clip.startTime < endTime && clipEnd > startTime;
  });
}

/**
 * Unified Add-to-Timeline resolver (playhead-first, CapCut-style).
 *
 * Rules:
 * - Start time is clamped playhead time.
 * - Preferred unlocked target track by asset type.
 * - If target track is occupied at start time, create a new track.
 * - No overwrite/ripple side effects.
 */
export function resolveAddToTimelinePlacement(params: ResolveAddPlacementParams): AddPlacementDecision {
  const { asset, tracks, clips, playheadTime, sequenceEndTime, duration = 0, preferTrackId } = params;
  const trackType = resolveTargetTrackType(asset);
  const clampedStartTime = Math.max(0, Math.min(playheadTime, Math.max(0, sequenceEndTime)));
  const preferredTrackId = resolvePreferredTrackId({ tracks, asset, preferTrackId });

  if (!preferredTrackId) {
    return {
      intent: "playhead",
      trackType,
      startTime: clampedStartTime,
      targetTrackId: null,
      shouldCreateTrack: true,
    };
  }

  // Search every unlocked track of the requested semantic type. This is what
  // makes a template behave like text/effect content: a gap on an existing
  // text lane is reusable, while a collision creates a new lane. The old
  // point-only check could place a long clip in a gap and overlap the clip
  // immediately after that gap.
  const candidateTracks = tracks
    .filter((track) => track.type === trackType && !track.locked)
    .sort((a, b) => (a.id === preferredTrackId ? -1 : b.id === preferredTrackId ? 1 : 0));
  const availableTrack = candidateTracks.find((track) => {
    const trackClips = clips.filter((clip) => clip.trackId === track.id);
    return duration > 0
      ? !isTrackOccupiedDuring(trackClips, clampedStartTime, duration)
      : !isTrackOccupiedAtTime(trackClips, clampedStartTime);
  });

  return {
    intent: "playhead",
    trackType,
    startTime: clampedStartTime,
    targetTrackId: availableTrack?.id ?? null,
    shouldCreateTrack: !availableTrack,
  };
}
