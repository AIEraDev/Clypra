/**
 * Clypra Caption Time & Word Assignment Engine
 *
 * Provides pure functions for resolving source-media playback timestamps
 * and assigning transcript words to timeline caption clips.
 */

import { resolveClipSourceTime } from "./sourceTime";
import type { PlaybackMapping } from "@/types";

export interface CaptionClipTimeContext {
  startTime: number;
  duration: number;
  trimIn: number;
  trimOut: number;
  speed?: number;
  playbackMapping?: PlaybackMapping;
}

/**
 * Computes the exact source-relative time in milliseconds for a caption clip
 * at timeline position `timelineTime` (in seconds).
 *
 * Uses the canonical `resolveClipSourceTime` so that speed changes, trims,
 * splits, and variable playback mappings match audio/video source frames
 * to within one frame.
 *
 * @param clip The caption clip time context
 * @param timelineTime Current timeline playhead position in seconds
 * @returns Source media time in milliseconds
 */
export function captionSourceTime(
  clip: CaptionClipTimeContext,
  timelineTime: number,
): number {
  const { sourceTime } = resolveClipSourceTime(clip, timelineTime);
  return Math.max(0, Math.round(sourceTime * 1000));
}

/**
 * Determines whether a transcript word belongs to a caption clip based on word start time.
 *
 * ── Word Start Assignment Rule ─────────────────────────────────────────────
 * A word belongs to a caption clip if and only if its start time falls within
 * the clip's source range:
 *
 *   word.startMs >= round(clip.trimIn * 1000) &&
 *   word.startMs < round(clip.trimOut * 1000)
 *
 * Edge Behavior:
 * 1. Word starts inside clip, ends after clip.trimOut:
 *    Assigned to this clip. The word began in this segment. Its display is bounded
 *    by the clip's duration on the timeline.
 * 2. Word starts before clip.trimIn, ends inside clip:
 *    NOT assigned to this clip. It belongs to the preceding clip where it started.
 *    This invariant guarantees that every word in a continuous transcript is owned
 *    by exactly ONE clip on the timeline, preventing duplicate words across split cuts.
 * 3. Exact boundary:
 *    Inclusive lower bound, exclusive upper bound [trimInMs, trimOutMs).
 *    A word starting exactly at trimOutMs belongs to the subsequent clip.
 * ───────────────────────────────────────────────────────────────────────────
 */
export function isWordInClipRange(
  word: { startMs: number; endMs: number },
  clip: { trimIn: number; trimOut: number },
): boolean {
  const clipStartMs = Math.round(clip.trimIn * 1000);
  const clipEndMs = Math.round(clip.trimOut * 1000);
  return word.startMs >= clipStartMs && word.startMs < clipEndMs;
}

/**
 * Filters a transcript word list to those owned by the given clip range.
 */
export function getWordsForClip<T extends { startMs: number; endMs: number }>(
  words: readonly T[],
  clip: { trimIn: number; trimOut: number },
): T[] {
  return words.filter((w) => isWordInClipRange(w, clip));
}

/**
 * Finds the index of the word spoken at sourceTimeMs.
 * Returns -1 if no word is active at this timestamp (e.g. during a pause).
 */
export function findActiveWordIndex(
  words: readonly { startMs: number; endMs: number }[],
  sourceTimeMs: number,
): number {
  for (let i = 0; i < words.length; i++) {
    if (sourceTimeMs >= words[i].startMs && sourceTimeMs < words[i].endMs) {
      return i;
    }
  }
  return -1;
}
