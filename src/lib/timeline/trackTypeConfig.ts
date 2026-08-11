/**
 * Track Type Configuration Registry
 *
 * Single source of truth for all per-type metadata.
 * Every decision that varies by TrackType must derive from this file —
 * no more scattered if-chains or hard-coded magic strings.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Adding a new TrackType?                                                │
 * │  1. Add it to TrackType in src/types/index.ts                          │
 * │  2. Add an entry here — TypeScript will error until you do             │
 * │  3. Everything else (insertion, reuse, pruning) flows automatically    │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import type { Track, TrackType } from "@/types";

// ─── Value types ─────────────────────────────────────────────────────────────

/**
 * Where a new track of this type is inserted in the timeline.
 * - "top"          → index 0 (above everything, including the main video track)
 * - "below-video"  → immediately after the first video track (e.g. audio)
 * - "bottom"       → appended after all existing tracks
 */
export type TrackPlacement = "top" | "below-video" | "bottom";

/**
 * How find-or-create (ensureTrackForType) works for this track type.
 * - "primary"         → always returns mainVideoTrackId; never creates a new track
 * - "shared"          → all clips of this type share ONE track; create it if absent
 * - "per-clip"        → always create a fresh track for every new clip
 * - "per-media-group" → one track per unique mediaId; clips with the same mediaId share a track
 */
export type TrackReuseStrategy =
  | "primary"
  | "shared"
  | "per-clip"
  | "per-media-group";

export interface TrackTypeConfig {
  /** Timeline row height in pixels. */
  height: number;
  /** Where a newly created track of this type is inserted. */
  placement: TrackPlacement;
  /** Controls how ensureTrackForType() finds or creates a track. */
  reuseStrategy: TrackReuseStrategy;
  /**
   * Whether the track is automatically removed when its last clip is deleted.
   * Set to false for tracks that must always exist (e.g. the primary video track).
   */
  autoPrune: boolean;
  /** Human-readable label used when auto-naming a new track. */
  displayName: string;
}

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * Canonical metadata for every TrackType.
 * TypeScript will surface a compile error if a TrackType value is missing here.
 */
export const TRACK_TYPE_CONFIG: Record<TrackType, TrackTypeConfig> = {
  video: {
    height: 68,
    placement: "top",
    reuseStrategy: "primary",
    autoPrune: true,
    displayName: "Video",
  },
  audio: {
    height: 52,
    placement: "below-video",
    reuseStrategy: "per-clip",
    autoPrune: true,
    displayName: "Audio",
  },
  text: {
    height: 30,
    placement: "top",
    reuseStrategy: "per-clip",
    autoPrune: true,
    displayName: "Text",
  },
  sticker: {
    height: 30,
    placement: "top",
    reuseStrategy: "per-clip",
    autoPrune: true,
    displayName: "Sticker",
  },
  filter: {
    height: 30,
    placement: "top",
    reuseStrategy: "per-media-group",
    autoPrune: true,
    displayName: "Filter",
  },
  "video-effect": {
    height: 30,
    placement: "top",
    reuseStrategy: "per-media-group",
    autoPrune: true,
    displayName: "Effect",
  },
  "body-effect": {
    height: 30,
    placement: "top",
    reuseStrategy: "per-media-group",
    autoPrune: true,
    displayName: "Body Effect",
  },
  "animated-overlay": {
    height: 30,
    placement: "top",
    reuseStrategy: "shared",
    autoPrune: true,
    displayName: "Overlays",
  },
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Returns true if an empty track should be automatically removed.
 * Protects the primary video track (mainVideoTrackId / first video track) from auto-pruning.
 * All other empty tracks (secondary video, audio, text, overlay, etc.) are auto-pruned.
 */
export function shouldAutoPruneTrack(
  track: { id: string; type: string },
  tracksOrPrimaryId?: Track[] | string | null,
): boolean {
  let primaryId: string | null = null;
  if (Array.isArray(tracksOrPrimaryId)) {
    primaryId = tracksOrPrimaryId.find((t) => t.type === "video")?.id ?? null;
  } else if (typeof tracksOrPrimaryId === "string") {
    primaryId = tracksOrPrimaryId;
  }

  if (primaryId && track.id === primaryId) {
    return false; // Protect primary video track
  }

  const config = (TRACK_TYPE_CONFIG as Record<string, TrackTypeConfig>)[track.type];
  return config?.autoPrune ?? true;
}

/**
 * Calculates the array insertion index for a brand-new track of `trackType`
 * given the current ordered `tracks` list.
 *
 * Replaces the scattered `getInsertIndexForNewTrack` if-chain.
 */
export function getTrackInsertionIndex(tracks: Track[], trackType: TrackType): number {
  const config = TRACK_TYPE_CONFIG[trackType];

  switch (config.placement) {
    case "top":
      return 0;

    case "below-video": {
      const videoIdx = tracks.findIndex((t) => t.type === "video");
      return videoIdx >= 0 ? videoIdx + 1 : tracks.length;
    }

    case "bottom":
      return tracks.length;
  }
}

/**
 * Like getTrackInsertionIndex but with mediaId-aware grouping for
 * "per-media-group" types (filter, video-effect, body-effect).
 * Inserts immediately after the last track of the same type that already
 * carries a clip with the matching mediaId.
 */
export function getTrackInsertionIndexGrouped(
  tracks: Track[],
  clips: { trackId: string; mediaId: string }[],
  trackType: TrackType,
  mediaId?: string,
): number {
  const config = TRACK_TYPE_CONFIG[trackType];

  if (config.reuseStrategy === "per-media-group" && mediaId) {
    const siblingIndices: number[] = [];
    tracks.forEach((track, i) => {
      if (track.type === trackType) {
        const hasMatch = clips.some(
          (c) => c.trackId === track.id && c.mediaId === mediaId,
        );
        if (hasMatch) siblingIndices.push(i);
      }
    });
    if (siblingIndices.length > 0) {
      return Math.max(...siblingIndices) + 1;
    }
  }

  return getTrackInsertionIndex(tracks, trackType);
}
