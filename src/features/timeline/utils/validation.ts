/**
 * Validation utilities for Timeline Engine v1
 */

import type { Clip, Track } from "../types/core";
import { TimelineError, ErrorCodes } from "../types/errors";

/**
 * Validates clip duration constraints
 * @param duration - Clip duration in seconds
 * @param minDuration - Minimum allowed duration (default: 0.1)
 * @throws TimelineError if duration is invalid
 */
export function validateClipDuration(duration: number, minDuration: number = 0.1): void {
  if (duration < minDuration) {
    throw new TimelineError(`Clip duration must be at least ${minDuration} seconds`, ErrorCodes.INVALID_TRIM, true);
  }
}

/**
 * Validates clip start time constraints
 * @param startTime - Clip start time in seconds
 * @throws TimelineError if start time is invalid
 */
export function validateClipStartTime(startTime: number): void {
  if (startTime < 0) {
    throw new TimelineError("Clip start time cannot be negative", ErrorCodes.INVALID_TRIM, true);
  }
}

/**
 * Validates clip end time constraints
 * @param endTime - Clip end time in seconds
 * @param timelineDuration - Total timeline duration
 * @throws TimelineError if end time exceeds timeline duration
 */
export function validateClipEndTime(endTime: number, timelineDuration: number): void {
  if (endTime > timelineDuration) {
    throw new TimelineError("Clip end time exceeds timeline duration", ErrorCodes.INVALID_TRIM, true);
  }
}

/**
 * Validates that a clip exists
 * @param clip - Clip to validate
 * @param clipId - Clip ID for error message
 * @throws TimelineError if clip is null or undefined
 */
export function validateClipExists(clip: Clip | undefined, clipId: string): asserts clip is Clip {
  if (!clip) {
    throw new TimelineError(`Clip ${clipId} not found`, ErrorCodes.CLIP_NOT_FOUND, false);
  }
}

/**
 * Validates that a track exists
 * @param track - Track to validate
 * @param trackId - Track ID for error message
 * @throws TimelineError if track is null or undefined
 */
export function validateTrackExists(track: Track | undefined, trackId: string): asserts track is Track {
  if (!track) {
    throw new TimelineError(`Track ${trackId} not found`, ErrorCodes.TRACK_NOT_FOUND, false);
  }
}

/**
 * Validates track type compatibility with clip type
 * @param clipType - Type of the clip
 * @param trackType - Type of the track
 * @throws TimelineError if types are incompatible
 */
export function validateTrackTypeCompatibility(clipType: Clip["type"], trackType: Track["type"]): void {
  // Video clips can go on video tracks
  if (clipType === "video" && trackType === "video") {
    return;
  }

  // Audio clips can go on audio tracks
  if (clipType === "audio" && trackType === "audio") {
    return;
  }

  // Text clips can go on text tracks
  if (clipType === "text" && trackType === "text") {
    return;
  }

  // Video clips can go on audio tracks (audio will be extracted)
  if (clipType === "video" && trackType === "audio") {
    return;
  }

  throw new TimelineError(`Cannot place ${clipType} clip on ${trackType} track`, ErrorCodes.INVALID_TRACK_TYPE, true);
}

/**
 * Validates zoom level constraints
 * @param pxPerSec - Pixels per second zoom level
 * @param minZoom - Minimum zoom level (default: 16)
 * @param maxZoom - Maximum zoom level (default: 320)
 * @returns Clamped zoom level
 */
export function validateZoomLevel(pxPerSec: number, minZoom: number = 16, maxZoom: number = 320): number {
  return Math.min(Math.max(pxPerSec, minZoom), maxZoom);
}
