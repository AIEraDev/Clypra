/**
 * Clip Position Calculation
 *
 * Single source of truth for clip display positions during drag and final positions after drop.
 * Used by both Track.tsx (visual rendering) and timelineStore.ts (state commit).
 *
 * Algorithm: Two-pointer prefix sum with gap injection
 * - Removes dragged clip(s) from track (closes departure gap)
 * - Calculates tight packing (prefix sum, no gaps)
 * - Injects gap at insertion index (opens arrival gap)
 * - Shifts all clips at or after insertion by gap width
 *
 * This handles same-track moves correctly: removing the dragged clip automatically
 * closes the hole it left behind, then the gap injection opens space at the target.
 */

import type { Clip } from "@/types";
import { timeToPixel } from "./timelineViewport";


export interface DisplayPositionsInput {
  /** All clips on track, sorted by startTime */
  trackClips: Clip[];
  /** IDs of clips being dragged (excluded from position calculation) */
  draggedClipIds: string[];
  /** Total duration of dragged clip block (for gap width) */
  draggedBlockDuration: number;
  /** Where to insert the dragged block (index into rest list, NOT original list) */
  insertionIndex: number;
}

export interface OriginalClipPlacement {
  trackId: string;
  startTime: number;
  index: number;
}

/**
 * Calculate the committed positions after dragged clips leave a track.
 *
 * Only the time occupied by the removed block is closed. Any gap before the
 * block is preserved, so moving a clip does not unexpectedly pack the entire
 * source track to time zero.
 */
export function calculateDepartureClosurePositions(input: {
  trackClips: Clip[];
  draggedClipIds: string[];
  originalPlacements: Record<string, OriginalClipPlacement>;
}): Map<string, number> {
  const { trackClips, draggedClipIds, originalPlacements } = input;
  const draggedSet = new Set(draggedClipIds);
  const draggedClips = trackClips.filter((clip) => draggedSet.has(clip.id));
  if (draggedClips.length === 0) return new Map();

  const blockStart = Math.min(
    ...draggedClips.map((clip) => originalPlacements[clip.id]?.startTime ?? clip.startTime),
  );
  const blockEnd = Math.max(
    ...draggedClips.map((clip) => {
      const startTime = originalPlacements[clip.id]?.startTime ?? clip.startTime;
      return startTime + clip.duration;
    }),
  );
  const removedDuration = Math.max(0, blockEnd - blockStart);
  const positions = new Map<string, number>();

  for (const clip of trackClips) {
    if (draggedSet.has(clip.id)) continue;
    const shouldShift = clip.startTime >= blockEnd - 0.001;
    positions.set(clip.id, shouldShift ? Math.max(0, clip.startTime - removedDuration) : clip.startTime);
  }

  return positions;
}

/**
 * Calculate display positions for all clips on a track during drag.
 *
 * Returns a map of clipId → displayStartTime.
 * The dragged clip itself is NOT included in the output — it renders at the pointer position.
 */
export function calculateDisplayPositions(input: DisplayPositionsInput): Map<string, number> {
  const { trackClips, draggedClipIds, draggedBlockDuration, insertionIndex } = input;

  const draggedSet = new Set(draggedClipIds);
  const displayMap = new Map<string, number>();

  // Step 1: Build rest list (clips without dragged clips)
  const rest = trackClips.filter((c) => !draggedSet.has(c.id));

  // Step 2: Prefix sum (tight packing, no gaps)
  let currentTime = 0;
  for (let i = 0; i < rest.length; i++) {
    const clip = rest[i];
    displayMap.set(clip.id, currentTime);
    currentTime += clip.duration;
  }

  // Step 3: Inject gap at insertion index
  // All clips at or after insertionIndex shift right by draggedBlockDuration
  if (insertionIndex < rest.length) {
    for (let i = insertionIndex; i < rest.length; i++) {
      const clip = rest[i];
      const currentPos = displayMap.get(clip.id) ?? 0;
      displayMap.set(clip.id, currentPos + draggedBlockDuration);
    }
  }

  // Step 4: Calculate gap start time (where dragged block should land)
  let gapStartTime = 0;
  if (insertionIndex === 0) {
    gapStartTime = 0;
  } else if (insertionIndex >= rest.length) {
    // Append to end: gap starts after last clip
    gapStartTime = currentTime;
  } else {
    // Gap starts at the (now-shifted) position of the clip at insertionIndex
    const clipAtInsertion = rest[insertionIndex];
    gapStartTime = (displayMap.get(clipAtInsertion.id) ?? 0) - draggedBlockDuration;
  }

  return displayMap;
}

/**
 * Calculate the gap start time for the dragged clip block.
 * This is where the dragged clip(s) should render during the drag.
 */
export function calculateGapStartTime(input: DisplayPositionsInput): number {
  const { trackClips, draggedClipIds, draggedBlockDuration, insertionIndex } = input;

  const draggedSet = new Set(draggedClipIds);
  const rest = trackClips.filter((c) => !draggedSet.has(c.id));

  if (rest.length === 0) {
    return 0; // Empty track: gap at start
  }

  if (insertionIndex === 0) {
    return 0; // Insert at start
  }

  if (insertionIndex >= rest.length) {
    // Append to end: sum all durations
    return rest.reduce((sum, c) => sum + c.duration, 0);
  }

  // Insert between clips: sum durations up to insertionIndex
  let time = 0;
  for (let i = 0; i < insertionIndex; i++) {
    time += rest[i].duration;
  }
  return time;
}

/**
 * Find the insertion index given a pointer position.
 *
 * Uses gap-center detection with hysteresis to prevent jitter.
 * Returns the index into the rest list (clips without dragged clips).
 */
export function findInsertionIndex(input: {
  /** Clips on track (sorted, without dragged clips) */
  restClips: Clip[];
  /** Pointer X position in content coordinates (px) */
  pointerX: number;
  /** Pixels per second */
  pixelsPerSecond: number;
  /** Current insertion index (for hysteresis), or null if none */
  currentInsertionIndex: number | null;
  /** Hysteresis threshold in pixels */
  hysteresisThreshold?: number;
}): number {
  const { restClips, pointerX, pixelsPerSecond, currentInsertionIndex, hysteresisThreshold = 8 } = input;

  if (restClips.length === 0) {
    return 0; // Empty track
  }

  // Build display positions (tight packed, no gaps)
  const positions: number[] = [];
  let time = 0;
  for (const clip of restClips) {
    positions.push(time);
    time += clip.duration;
  }
  positions.push(time); // End boundary

  // Convert to pixels via timeToPixel so gap-center positions match rendered clip boundaries.
  const positionsPx = positions.map((t) => timeToPixel(t, pixelsPerSecond));


  // Calculate gap centers between adjacent clips
  const gapCenters: number[] = [];
  for (let i = 0; i < positionsPx.length - 1; i++) {
    const leftEdge = positionsPx[i];
    const rightEdge = positionsPx[i + 1];
    gapCenters.push((leftEdge + rightEdge) / 2);
  }

  // Find insertion index based on which gap center the pointer is closest to
  let newInsertionIndex = 0;
  for (let i = 0; i < gapCenters.length; i++) {
    if (pointerX >= gapCenters[i]) {
      newInsertionIndex = i + 1;
    } else {
      break;
    }
  }

  // Apply hysteresis: only change if pointer moves past threshold from current boundary
  if (currentInsertionIndex !== null && Math.abs(newInsertionIndex - currentInsertionIndex) <= 1) {
    const currentBoundaryX = gapCenters[Math.min(currentInsertionIndex, gapCenters.length - 1)] ?? pointerX;
    const distanceFromBoundary = Math.abs(pointerX - currentBoundaryX);
    if (distanceFromBoundary < hysteresisThreshold) {
      return currentInsertionIndex; // Stay in dead zone
    }
  }

  return newInsertionIndex;
}

/**
 * Calculate the duration of a multi-clip selection block.
 * Treats the selection as a rigid unit with internal gaps preserved.
 */
export function calculateDraggedBlockDuration(clips: Clip[], draggedClipIds: string[]): number {
  const draggedClips = clips.filter((c) => draggedClipIds.includes(c.id));
  if (draggedClips.length === 0) return 0;
  if (draggedClips.length === 1) return draggedClips[0].duration;

  // Sort by startTime
  const sorted = [...draggedClips].sort((a, b) => a.startTime - b.startTime);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  // Block duration = span from first clip start to last clip end
  return last.startTime + last.duration - first.startTime;
}
