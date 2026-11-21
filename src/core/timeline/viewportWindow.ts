/**
 * viewportWindow.ts — Timeline Viewport Windowing Utilities
 *
 * Phase 3 of the Multi-Tier Optimization: Decouple mounted DOM node count from
 * project duration by clipping the rendered clip list to the visible time window.
 *
 * Key invariants maintained:
 *   - Only clips whose time range overlaps [windowStart - buffer, windowEnd + buffer]
 *     are returned, dramatically reducing DOM node count on large projects.
 *   - A generous default buffer (DEFAULT_VIEWPORT_BUFFER_SECS) prevents pop-in
 *     during fast scrolling and drag operations.
 *   - All clips are always returned when dragging is active on a track, so ghost
 *     previews are never clipped mid-drag.
 *   - Selected clips on a track are always included so `revealSelectedClip` can
 *     find their DOM node regardless of scroll position.
 *
 * Performance contract:
 *   - `computeViewportWindow` is O(1) — pure arithmetic.
 *   - `filterClipsInWindow` with a prebuilt `TimelineIntervalTree` is O(log N + K)
 *     where K is the number of clips in the window (typically ≪ N).
 *   - Fallback linear scan when no tree is available degrades to O(N) but remains
 *     functionally correct so callers never need to null-guard the tree.
 *   - Both functions are side-effect free and referentially transparent.
 */

import {
  TimelineIntervalTree,
  type TimelineIntervalItem,
} from "@/core/evaluation/spatialIndex";
import { viewportTelemetry } from "./viewportTelemetry";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The resolved visible time window, expressed in seconds.
 * Includes the safety buffer on both sides.
 */
export interface ViewportWindow {
  /** First visible second (inclusive), clamped to 0. Includes safety buffer. */
  windowStart: number;
  /** Last visible second (exclusive). Includes safety buffer. */
  windowEnd: number;
}

/**
 * Minimum clip-like shape required by filterClipsInWindow.
 * Satisfies `TimelineIntervalItem` so the tree's generic constraint is met.
 */
export interface ClipBounds extends TimelineIntervalItem {
  id: string;
  startTime: number;
  duration: number;
  trackId: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Default safety buffer added on each side of the viewport window.
 * 3 seconds at 100 px/s = 300 px off-screen: enough to absorb fast drags,
 * momentum scrolling, and large-thumbnail filmstrip pre-fetching.
 */
export const DEFAULT_VIEWPORT_BUFFER_SECS = 3.0;

// ─── Core Utilities ───────────────────────────────────────────────────────────

/**
 * Compute the buffered time window for the current scroll position.
 *
 * @param scrollLeft         Current horizontal scroll offset in pixels.
 * @param viewportWidthPx    Visible lane width in pixels (excluding label column).
 * @param pixelsPerSecond    Current zoom scale.
 * @param clipStartOffsetPx  `TIMELINE_CLIP_START_OFFSET_PX` — left-padding before t=0.
 * @param bufferSecs         Safety margin added on each side (default 3s).
 */
export function computeViewportWindow(
  scrollLeft: number,
  viewportWidthPx: number,
  pixelsPerSecond: number,
  clipStartOffsetPx: number,
  bufferSecs: number = DEFAULT_VIEWPORT_BUFFER_SECS,
): ViewportWindow {
  if (pixelsPerSecond <= 0 || viewportWidthPx <= 0) {
    return { windowStart: 0, windowEnd: Infinity };
  }

  // Convert scroll position to timeline seconds.
  // `clipStartOffsetPx` shifts pixel 0 → t=0; subtract it before dividing.
  const rawStart = (scrollLeft - clipStartOffsetPx) / pixelsPerSecond;
  const rawEnd = rawStart + viewportWidthPx / pixelsPerSecond;

  return {
    windowStart: Math.max(0, rawStart - bufferSecs),
    windowEnd: rawEnd + bufferSecs,
  };
}

/**
 * Filter a clips array to only those overlapping the given time window.
 *
 * Uses the prebuilt `TimelineIntervalTree` for O(log N + K) queries when
 * provided. Falls back to a linear scan when `tree` is null/undefined so
 * the caller never needs to gate on tree availability.
 *
 * @param clips          Full set of clips for one track (already filtered by trackId).
 * @param windowStart    Start of the visible window in seconds (buffered).
 * @param windowEnd      End of the visible window in seconds (buffered).
 * @param tree           Optional prebuilt interval tree over ALL compositor clips.
 *                       When provided, queryRange replaces the linear scan.
 *
 * @returns              A new array containing only clips that overlap the window.
 *                       Returns `clips` unchanged when the window covers everything.
 */
export function filterClipsInWindow<C extends ClipBounds>(
  clips: C[],
  windowStart: number,
  windowEnd: number,
  tree?: TimelineIntervalTree<C> | null,
): C[] {
  // Fast path: nothing to window
  if (clips.length === 0) return clips;

  // Fast path: window covers everything (e.g. short project, wide viewport)
  if (windowStart <= 0 && windowEnd === Infinity) {
    viewportTelemetry.recordWindowComputation(clips.length, clips.length);
    return clips;
  }

  const result = tree
    ? (tree.queryRange(windowStart, windowEnd) as C[])
    : clips.filter((c) => c.startTime < windowEnd && c.startTime + c.duration > windowStart);

  viewportTelemetry.recordWindowComputation(clips.length, result.length);
  return result;
}

/**
 * Filter a clips array WITHOUT a tree, for callers that don't have one.
 * This is a simple, branch-free linear scan — equivalent to the fallback
 * inside `filterClipsInWindow` but exposed explicitly for use in tests.
 */
export function filterClipsLinear<C extends ClipBounds>(
  clips: C[],
  windowStart: number,
  windowEnd: number,
): C[] {
  return clips.filter(
    (c) => c.startTime < windowEnd && c.startTime + c.duration > windowStart,
  );
}

/**
 * Determine whether viewport windowing should be bypassed for a given track.
 *
 * Returns `true` (meaning: skip windowing) when:
 *   - A drag is active on this track (dragging clips must remain mounted)
 *   - A clip on this track is in `selectedClipIds` (revealSelectedClip needs DOM node)
 *   - `forceAll` is explicitly requested by the caller
 *
 * @param trackClipsOrIds  Set of clip IDs on this track OR the track's clips array.
 * @param draggingClipIds  Clip IDs currently being dragged (may be on this track).
 * @param selectedClipIds  Clip IDs currently selected in the UI store.
 * @param forceAll         Explicit bypass flag from parent.
 */
function isIdSet(
  x: ReadonlySet<string> | readonly { id: string }[],
): x is ReadonlySet<string> {
  return x instanceof Set;
}

export function shouldBypassWindowing(
  trackClipsOrIds: ReadonlySet<string> | readonly { id: string }[],
  draggingClipIds: readonly string[],
  selectedClipIds: readonly string[],
  forceAll = false,
): boolean {
  if (forceAll) return true;

  if (isIdSet(trackClipsOrIds)) {
    for (const id of draggingClipIds) {
      if (trackClipsOrIds.has(id)) return true;
    }
    for (const id of selectedClipIds) {
      if (trackClipsOrIds.has(id)) return true;
    }
    return false;
  }

  // Array of clips: single pass checking membership
  if (trackClipsOrIds.length === 0) return false;
  for (let i = 0; i < trackClipsOrIds.length; i++) {
    const id = trackClipsOrIds[i].id;
    if (draggingClipIds.includes(id) || selectedClipIds.includes(id)) {
      return true;
    }
  }

  return false;
}
