/**
 * Shared Export Utilities
 */

import type { Clip, MediaAsset, TransitionTimelineItem } from "../../types";

/**
 * Resolves all active video clips for a given timeline time, accounting for:
 * 1. Direct time bounds: startTime <= time < (startTime + duration)
 * 2. Active transition windows: clips participating as outgoing (from) or incoming (to)
 *    in a transition where transitionStart <= time <= transitionEnd.
 *
 * @param time - Timeline time in seconds
 * @param clips - All timeline clips
 * @param assets - All media assets
 * @param transitions - Timeline transition items
 * @returns Array of active video clips required for rendering at the given time
 */
export function getActiveVideoClipsForTime(
  time: number,
  clips: Clip[],
  assets: MediaAsset[],
  transitions: TransitionTimelineItem[] = []
): Clip[] {
  // Find active transition windows at current time
  const activeTransitions = transitions.filter((t) => {
    const start = t.placement.startTime;
    const duration = t.placement.duration;
    const end = start + duration;
    return duration > 0 && time >= start && time <= end;
  });

  const transitionClipIds = new Set<string>();
  for (const t of activeTransitions) {
    if (t.fromItemId) transitionClipIds.add(t.fromItemId);
    if (t.toItemId) transitionClipIds.add(t.toItemId);
  }

  return clips.filter((clip) => {
    const asset = assets.find((a) => a.id === clip.mediaId);
    if (asset?.type !== "video") return false;

    const clipEnd = clip.startTime + clip.duration;
    const isInTimeBounds = time >= clip.startTime && time < clipEnd;
    const isInTransition = transitionClipIds.has(clip.id);

    return isInTimeBounds || isInTransition;
  });
}
