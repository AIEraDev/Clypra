/**
 * Audio Clip Utilities
 *
 * Extracted from videoExport.ts to create
 * a single source of truth for timeline audio clip queries.
 *
 * This logic was previously duplicated in export and likely other subsystems.
 * Now centralized for reusability and testability.
 */

import type { Clip, Track, MediaAsset } from "@/types";
import { toNativePath } from "@/lib/platform/pathConversion";

export interface ExportAudioClipConfig {
  /** Absolute local file path (normalized for native FS) */
  path: string;

  /** Start time in seconds (relative to export video start) */
  startTime: number;

  /** Duration in seconds to play */
  duration: number;

  /** Trim in offset in seconds inside the source media file */
  trimIn: number;

  /** Volume multiplier (0.0 to 1.0) */
  volume: number;

  /** Fade-in duration in seconds */
  fadeIn: number;

  /** Fade-out duration in seconds */
  fadeOut: number;
}

/**
 * Get all active audio clips for a given time range.
 *
 * This handles:
 * - Filtering by muted tracks
 * - Filtering by asset type (audio or video with audio track)
 * - Calculating overlap with export time range
 * - Computing relative times for export
 * - Normalizing file paths for native FS access
 * - Clamping fade durations to clip duration
 *
 * @param clips - All timeline clips
 * @param tracks - All timeline tracks
 * @param assets - All media assets
 * @param startTime - Export start time in seconds
 * @param endTime - Export end time in seconds
 * @returns Array of audio clip configurations ready for FFmpeg
 */
export function getActiveAudioClips(clips: Clip[], tracks: Track[], assets: MediaAsset[], startTime: number, endTime: number): ExportAudioClipConfig[] {
  // Build map of track IDs to track objects (for muted status and track volume)
  const trackMap = new Map(tracks.map((t) => [t.id, t]));
  const activeTracks = new Set(tracks.filter((t) => !t.muted).map((t) => t.id));

  return clips
    .filter((clip) => {
      // Skip clips on muted tracks
      if (!activeTracks.has(clip.trackId)) return false;

      // Find asset
      const asset = assets.find((a) => a.id === clip.mediaId);
      const directAudioPath = (clip as any).audioPath as string | undefined;
      const isAudioClip = asset?.type === "audio" || asset?.type === "video" || (clip.kind === "audio" && !!directAudioPath);

      if (!isAudioClip) return false;

      // Check if clip overlaps with export time range
      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + clip.duration;
      return clipStart < endTime && clipEnd > startTime;
    })
    .map((clip) => {
      const asset = assets.find((a) => a.id === clip.mediaId);
      const directAudioPath = (clip as any).audioPath as string | undefined;
      const rawPath = asset ? asset.path : directAudioPath!;
      const track = trackMap.get(clip.trackId);

      // Calculate overlap with export time range
      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + clip.duration;
      const overlapStart = Math.max(clipStart, startTime);
      const overlapEnd = Math.min(clipEnd, endTime);

      // Calculate relative times (relative to export start, not timeline start)
      const relativeStartTime = overlapStart - startTime;
      const relativeDuration = overlapEnd - overlapStart;

      // Calculate trim offset accounting for clip overlap
      const relativeTrimIn = (clip.trimIn || 0) + (overlapStart - clipStart);

      // Calculate effective slice fade-in and fade-out relative to export overlap range
      const rawFadeIn = Math.max(0, (clip as any).fadeIn ?? 0);
      const rawFadeOut = Math.max(0, (clip as any).fadeOut ?? 0);

      const originalFadeInEnd = clipStart + rawFadeIn;
      let fadeIn = Math.max(0, Math.min(relativeDuration, originalFadeInEnd - overlapStart));

      const originalFadeOutStart = clipEnd - rawFadeOut;
      let fadeOut = Math.max(0, Math.min(relativeDuration, overlapEnd - Math.max(overlapStart, originalFadeOutStart)));

      // Ensure combined fade duration does not exceed slice duration
      if (fadeIn + fadeOut > relativeDuration && relativeDuration > 0) {
        const scale = relativeDuration / (fadeIn + fadeOut);
        fadeIn *= scale;
        fadeOut *= scale;
      }

      // Calculate combined effective volume (clip.volume * track.volume), allowing boost up to 300% (3.0)
      const clipVolume = clip.volume ?? 1.0;
      const trackVolume = track?.volume ?? 1.0;
      const volume = Math.max(0, Math.min(3.0, clipVolume * trackVolume));

      return {
        // Normalize to native FS path — asset.path or directAudioPath may be an asset:// or file:// URL
        path: toNativePath(rawPath),
        startTime: relativeStartTime,
        duration: relativeDuration,
        trimIn: relativeTrimIn,
        volume,
        fadeIn,
        fadeOut,
      };
    });
}
