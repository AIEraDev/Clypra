import type { ClipFitModeExtended } from "./timelineClip";
import type { Clip, MediaAsset, Track } from "@/types";

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
export function resolveDefaultFitModeForAsset(asset: Pick<MediaAsset, "type">): ClipFitModeExtended {
  if (asset.type === "image") return "contain";
  if (asset.type === "video") return "cover";
  return DEFAULT_PLACEMENT_POLICY.defaultVisualFitMode;
}

export function resolveTargetTrackType(asset: { type: MediaAsset["type"]; id?: string }): "video" | "audio" | "sticker" {
  if (asset.id?.startsWith("sticker-")) return "sticker";
  return asset.type === "audio" ? "audio" : "video";
}

export function resolvePreferredTrackId(params: { tracks: Track[]; asset: { type: MediaAsset["type"]; id?: string }; preferTrackId?: string | null }): string | null {
  const { tracks, asset, preferTrackId } = params;
  const targetType = resolveTargetTrackType(asset);

  if (preferTrackId) {
    const preferred = tracks.find((t) => t.id === preferTrackId && !t.locked && t.type === targetType);
    if (preferred) return preferred.id;
  }

  const firstUnlocked = tracks.find((t) => t.type === targetType && !t.locked);
  return firstUnlocked?.id ?? null;
}

export function resolveClipStartTime(params: {
  intent: PlacementIntent;
  timelineEndTime: number;
  trackClips?: Clip[];
  dropTime?: number;
}): number {
  const { intent, timelineEndTime, trackClips = [], dropTime = 0 } = params;

  if (intent === "drop") return Math.max(0, dropTime);
  if (intent === "track_end") {
    if (trackClips.length === 0) return 0;
    return Math.max(...trackClips.map((c) => c.startTime + c.duration), 0);
  }
  return Math.max(0, timelineEndTime);
}

interface ResolveAddPlacementParams {
  asset: { type: MediaAsset["type"]; id?: string };
  tracks: Track[];
  clips: Clip[];
  playheadTime: number;
  sequenceEndTime: number;
  preferTrackId?: string | null;
}

interface AddPlacementDecision {
  intent: AddPlacementIntent;
  trackType: "video" | "audio" | "sticker";
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
  const { asset, tracks, clips, playheadTime, sequenceEndTime, preferTrackId } = params;
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

  const targetTrackClips = clips.filter((clip) => clip.trackId === preferredTrackId);
  const occupied = isTrackOccupiedAtTime(targetTrackClips, clampedStartTime);

  return {
    intent: "playhead",
    trackType,
    startTime: clampedStartTime,
    targetTrackId: occupied ? null : preferredTrackId,
    shouldCreateTrack: occupied,
  };
}
