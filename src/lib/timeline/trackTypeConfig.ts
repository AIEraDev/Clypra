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
 * - "below-video"  → immediately after the first video track
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
  /** Optional height for the primary visual row of this type. */
  primaryHeight?: number;
  /** Optional height for secondary visual rows of this type. */
  secondaryHeight?: number;
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

/** Visual role used by the timeline UI. This is intentionally separate from
 * TrackType because video tracks can be either the primary A-roll or a
 * secondary B-roll track. */
export type TrackVisualRole = "a-roll" | "b-roll" | Exclude<TrackType, "video">;

export interface TrackVisualSpec {
  role: TrackVisualRole;
  label: string;
  height: number;
  opacity: number;
  tone: "primary" | "secondary" | "audio" | "auxiliary";
}

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * Canonical metadata for every TrackType.
 * TypeScript will surface a compile error if a TrackType value is missing here.
 */
export const TRACK_TYPE_CONFIG: Record<TrackType, TrackTypeConfig> = {
  video: {
    height: 80,
    primaryHeight: 80,
    secondaryHeight: 60,
    placement: "top",
    reuseStrategy: "primary",
    autoPrune: true,
    displayName: "Video",
  },
  audio: {
    height: 60,
    // Audio is a bottom-of-timeline lane. Keeping it after every visual row
    // makes the Main Track boundary deterministic even when overlays are
    // added after audio has already been placed.
    placement: "bottom",
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

/**
 * Resolves the display role for a track without relying on array position.
 * mainVideoTrackId is authoritative; the first video track is the compatibility
 * fallback for older or partially hydrated projects.
 */
export function getTrackVisualSpec(
  track: Pick<Track, "id" | "type">,
  tracks: Array<Pick<Track, "id" | "type">>,
  mainVideoTrackId?: string | null,
): TrackVisualSpec {
  if (track.type === "video") {
    const configuredPrimaryIsVideo = tracks.some(
      (candidate) =>
        candidate.id === mainVideoTrackId && candidate.type === "video",
    );
    const primaryVideoId = configuredPrimaryIsVideo
      ? mainVideoTrackId
      : tracks.find((candidate) => candidate.type === "video")?.id;
    const isARoll = track.id === primaryVideoId;

    return {
      role: isARoll ? "a-roll" : "b-roll",
      label: isARoll ? "A-Roll (Main)" : "B-Roll",
      // Keep the main A-roll readable while keeping secondary video rows compact.
      // ClipFilmstrip derives its canvas height from this row height.
      height: isARoll
        ? (TRACK_TYPE_CONFIG.video.primaryHeight ??
          TRACK_TYPE_CONFIG.video.height)
        : (TRACK_TYPE_CONFIG.video.secondaryHeight ??
          TRACK_TYPE_CONFIG.video.height),
      opacity: 1,
      tone: isARoll ? "primary" : "secondary",
    };
  }

  const config = TRACK_TYPE_CONFIG[track.type];
  const labels: Record<Exclude<TrackType, "video">, string> = {
    audio: "Audio",
    text: "Text",
    sticker: "Sticker",
    filter: "Filter",
    "video-effect": "Video Effect",
    "body-effect": "Body Effect",
    "animated-overlay": "Animated Overlay",
  };

  return {
    role: track.type,
    label: labels[track.type],
    height: config.height,
    opacity: 1,
    tone: track.type === "audio" ? "audio" : "auxiliary",
  };
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Returns true if an empty track should be automatically removed.
 * Protects the primary video track (mainVideoTrackId / first video track) from auto-pruning.
 * All other empty tracks (secondary video, audio, text, overlay, etc.) are auto-pruned.
 */
export function shouldAutoPruneTrack(
  track: { id: string; type: string },
  tracksOrPrimaryId?: Track[] | string | null,
  mainVideoTrackId?: string | null,
): boolean {
  let primaryId: string | null = null;
  if (typeof tracksOrPrimaryId === "string") {
    primaryId = tracksOrPrimaryId;
  } else if (typeof mainVideoTrackId === "string") {
    primaryId = mainVideoTrackId;
  } else if (Array.isArray(tracksOrPrimaryId)) {
    const videoTracks = tracksOrPrimaryId.filter((t) => t.type === "video");
    if (videoTracks.length === 1) {
      primaryId = videoTracks[0].id;
    } else if (videoTracks.length > 1) {
      // In top-insertion order, overlay tracks are inserted at the top (index 0).
      // The primary / main video track is the bottommost video track before audio.
      primaryId = videoTracks[videoTracks.length - 1].id;
    }
  }

  if (primaryId && track.id === primaryId) {
    return false; // Protect primary video track
  }

  const config = (TRACK_TYPE_CONFIG as Record<string, TrackTypeConfig>)[
    track.type
  ];
  return config?.autoPrune ?? true;
}

/**
 * Calculates the array insertion index for a brand-new track of `trackType`
 * given the current ordered `tracks` list.
 *
 * Replaces the scattered `getInsertIndexForNewTrack` if-chain.
 */
export function getTrackInsertionIndex(
  tracks: Track[],
  trackType: TrackType,
): number {
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

/**
 * Returns the authoritative main-video index, with a compatibility fallback
 * for projects that do not yet have mainVideoTrackId metadata.
 */
export function getMainVideoTrackIndex(
  tracks: Array<Pick<Track, "id" | "type">>,
  mainVideoTrackId?: string | null,
): number {
  const configuredIndex = mainVideoTrackId
    ? tracks.findIndex(
        (track) => track.id === mainVideoTrackId && track.type === "video",
      )
    : -1;
  return configuredIndex >= 0
    ? configuredIndex
    : tracks.findIndex((track) => track.type === "video");
}

/** Returns true when a track is below the main video row. */
export function isTrackBelowMainVideo(
  tracks: Array<Pick<Track, "id" | "type">>,
  trackId: string,
  mainVideoTrackId?: string | null,
): boolean {
  const mainIndex = getMainVideoTrackIndex(tracks, mainVideoTrackId);
  const trackIndex = tracks.findIndex((track) => track.id === trackId);
  return mainIndex >= 0 && trackIndex > mainIndex;
}

/**
 * Clamp a proposed insertion so audio always lands at the bottom of the
 * timeline and visual rows stay above the main video track. This is the final
 * ordering guard used by drop and history paths, so UI hit-testing cannot
 * bypass it.
 */
export function getSafeTrackInsertionIndex(
  tracks: Array<Pick<Track, "id" | "type">>,
  trackType: TrackType,
  proposedIndex: number,
  mainVideoTrackId?: string | null,
): number {
  const clamped = Math.max(0, Math.min(proposedIndex, tracks.length));
  if (trackType === "audio") return tracks.length;

  const mainIndex = getMainVideoTrackIndex(tracks, mainVideoTrackId);
  return mainIndex >= 0 ? Math.min(clamped, mainIndex) : clamped;
}

/**
 * Repairs legacy ordering in memory. All non-audio rows are kept above the
 * main video row and every audio row is moved to the bottom, preserving the
 * relative order within each group. Callers can persist the normalized result
 * normally.
 */
export function normalizeTrackOrderForMainVideo<
  T extends Pick<Track, "id" | "type">,
>(tracks: T[], mainVideoTrackId?: string | null): T[] {
  const nonAudioTracks = tracks.filter((track) => track.type !== "audio");
  const audioTracks = tracks.filter((track) => track.type === "audio");
  const mainIndex = getMainVideoTrackIndex(tracks, mainVideoTrackId);
  if (mainIndex < 0) return [...nonAudioTracks, ...audioTracks];

  const mainTrack = tracks[mainIndex];
  const nonAudioAboveMain = nonAudioTracks.filter(
    (track) => track.id !== mainTrack.id,
  );

  return [
    ...nonAudioAboveMain,
    mainTrack,
    ...audioTracks,
  ];
}
