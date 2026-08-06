/**
 * Gap Engine
 *
 * Core logic for gap detection, creation, manipulation, and validation.
 * Gaps are first-class timeline entities alongside clips.
 */

import type { Clip } from "@/types";
import type { Gap, GapType, GapSource, GapValidation, GapOperationResult } from "@/types/gap";
import { generateId } from "../utils/id";

/**
 * Detect gaps between clips on a track
 *
 * @param clips - Sorted clips on the track
 * @param preserveExisting - Existing gaps to preserve (won't recreate)
 * @returns Array of detected gaps
 */
export function detectGaps(clips: Clip[], preserveExisting: Gap[] = []): Gap[] {
  if (clips.length === 0) return [];

  const sortedClips = [...clips].sort((a, b) => a.startTime - b.startTime);
  const detectedGaps: Gap[] = [];
  const existingGapSet = new Set(preserveExisting.map((g) => `${g.startTime}-${g.duration}`));

  // Check for gap at start (before first clip)
  const firstClip = sortedClips[0];
  if (firstClip.startTime > 0) {
    const gapKey = `0-${firstClip.startTime}`;
    if (!existingGapSet.has(gapKey)) {
      detectedGaps.push(
        createGap({
          trackId: firstClip.trackId,
          startTime: 0,
          duration: firstClip.startTime,
          type: "auto",
          source: "unknown",
        }),
      );
    }
  }

  // Check for gaps between clips
  for (let i = 0; i < sortedClips.length - 1; i++) {
    const currentClip = sortedClips[i];
    const nextClip = sortedClips[i + 1];

    const gapStart = currentClip.startTime + currentClip.duration;
    const gapEnd = nextClip.startTime;

    if (gapEnd > gapStart + 0.001) {
      // Small epsilon for floating point
      const gapDuration = gapEnd - gapStart;
      const gapKey = `${gapStart}-${gapDuration}`;

      if (!existingGapSet.has(gapKey)) {
        detectedGaps.push(
          createGap({
            trackId: currentClip.trackId,
            startTime: gapStart,
            duration: gapDuration,
            type: "auto",
            source: "unknown",
          }),
        );
      }
    }
  }

  return detectedGaps;
}

/**
 * Create a new gap
 */
export function createGap(params: { trackId: string; startTime: number; duration: number; type: GapType; source: GapSource; protected?: boolean; metadata?: Gap["metadata"] }): Gap {
  return {
    id: generateId("gap"),
    trackId: params.trackId,
    startTime: params.startTime,
    duration: params.duration,
    type: params.type,
    source: params.source,
    protected: params.protected ?? (params.type === "manual" || params.type === "protected"),
    metadata: params.metadata,
  };
}

/**
 * Validate gap placement (check for conflicts with clips)
 */
export function validateGap(gap: Pick<Gap, "trackId" | "startTime" | "duration">, clips: Clip[]): GapValidation {
  const gapEnd = gap.startTime + gap.duration;
  const conflicts: GapValidation["conflicts"] = [];

  for (const clip of clips) {
    if (clip.trackId !== gap.trackId) continue;

    const clipEnd = clip.startTime + clip.duration;

    // Check for overlap
    const overlapStart = Math.max(gap.startTime, clip.startTime);
    const overlapEnd = Math.min(gapEnd, clipEnd);

    if (overlapStart < overlapEnd) {
      conflicts.push({
        clipId: clip.id,
        overlap: { start: overlapStart, end: overlapEnd },
      });
    }
  }

  if (conflicts.length > 0) {
    return {
      valid: false,
      reason: `Gap overlaps with ${conflicts.length} clip(s)`,
      conflicts,
    };
  }

  return { valid: true };
}

/**
 * Insert a gap at specified position, shifting clips right
 * Respects protected gaps - clips won't shift through them
 */
export function insertGapWithRipple(trackId: string, startTime: number, duration: number, clips: Clip[], existingGaps: Gap[] = [], source: GapSource = "user-insert"): GapOperationResult {
  // Validate inputs
  if (duration <= 0) {
    return { success: false, error: "Gap duration must be positive" };
  }

  if (startTime < 0) {
    return { success: false, error: "Gap start time cannot be negative" };
  }

  // Create the gap
  const gap = createGap({
    trackId,
    startTime,
    duration,
    type: "manual",
    source,
    metadata: {
      createdAt: Date.now(),
      userCreated: true,
    },
  });

  // Find protected gaps on this track after the insertion point
  const protectedGapsAfter = existingGaps.filter((g) => g.trackId === trackId && g.protected && g.startTime >= startTime).sort((a, b) => a.startTime - b.startTime);

  // If there's a protected gap, only shift clips up to that gap
  let shiftBoundary = Infinity;
  if (protectedGapsAfter.length > 0) {
    const firstProtectedGap = protectedGapsAfter[0];
    shiftBoundary = firstProtectedGap.startTime;
  }

  // Find clips that need to shift (only those before the protected gap boundary)
  const affectedClipIds = clips.filter((c) => c.trackId === trackId && c.startTime >= startTime && c.startTime < shiftBoundary).map((c) => c.id);

  return {
    success: true,
    gap,
    affectedClipIds,
  };
}

/**
 * Remove a gap, shifting clips left (ripple delete)
 * Respects protected gaps - clips won't shift through them
 */
export function removeGapWithRipple(gap: Gap, clips: Clip[], existingGaps: Gap[] = []): GapOperationResult {
  const gapEnd = gap.startTime + gap.duration;

  // Find protected gaps on this track before the removed gap
  const protectedGapsBefore = existingGaps.filter((g) => g.trackId === gap.trackId && g.protected && g.id !== gap.id && g.startTime < gap.startTime).sort((a, b) => b.startTime - a.startTime); // Sort descending (closest first)

  // If there's a protected gap before, only shift clips after the removed gap
  // up until they would collide with the protected gap
  let shiftBoundary = 0;
  if (protectedGapsBefore.length > 0) {
    const lastProtectedGap = protectedGapsBefore[0];
    const protectedGapEnd = lastProtectedGap.startTime + lastProtectedGap.duration;
    shiftBoundary = protectedGapEnd;
  }

  // Find clips that need to shift
  // Only shift clips that are after the removed gap and won't cross the protected gap boundary
  const affectedClipIds = clips
    .filter((c) => {
      if (c.trackId !== gap.trackId || c.startTime < gapEnd) return false;

      // Check if shifting would cross the protected gap boundary
      const newStartTime = c.startTime - gap.duration;
      return newStartTime >= shiftBoundary;
    })
    .map((c) => c.id);

  return {
    success: true,
    gap,
    affectedClipIds,
  };
}

/**
 * Resize a gap (change duration)
 * Respects protected gaps - clips won't shift through them
 */
export function resizeGap(gap: Gap, newDuration: number, clips: Clip[], existingGaps: Gap[] = []): GapOperationResult {
  if (newDuration <= 0) {
    return { success: false, error: "Gap duration must be positive" };
  }

  const deltaTime = newDuration - gap.duration;
  const gapEnd = gap.startTime + gap.duration;

  // Find protected gaps after this gap
  const protectedGapsAfter = existingGaps.filter((g) => g.trackId === gap.trackId && g.protected && g.id !== gap.id && g.startTime >= gapEnd).sort((a, b) => a.startTime - b.startTime);

  // If expanding the gap, check if we'd hit a protected gap
  let shiftBoundary = Infinity;
  if (deltaTime > 0 && protectedGapsAfter.length > 0) {
    const firstProtectedGap = protectedGapsAfter[0];
    shiftBoundary = firstProtectedGap.startTime;
  }

  // Find clips that need to shift
  // Only shift clips that won't cross the protected gap boundary
  const affectedClipIds = clips
    .filter((c) => {
      if (c.trackId !== gap.trackId || c.startTime < gapEnd) return false;

      // If expanding, don't shift clips beyond protected gap
      if (deltaTime > 0) {
        return c.startTime < shiftBoundary;
      }

      // If shrinking, always safe to shift clips left
      return true;
    })
    .map((c) => c.id);

  const resizedGap: Gap = {
    ...gap,
    duration: newDuration,
  };

  return {
    success: true,
    gap: resizedGap,
    affectedClipIds,
  };
}

/**
 * Get all timeline items (clips + gaps) in chronological order
 */
export function getTimelineItems(clips: Clip[], gaps: Gap[], trackId: string): Array<{ type: "clip" | "gap"; item: Clip | Gap; startTime: number; endTime: number }> {
  const trackClips = clips.filter((c) => c.trackId === trackId);
  const trackGaps = gaps.filter((g) => g.trackId === trackId);

  const items: Array<{ type: "clip" | "gap"; item: Clip | Gap; startTime: number; endTime: number }> = [
    ...trackClips.map((clip) => ({
      type: "clip" as const,
      item: clip,
      startTime: clip.startTime,
      endTime: clip.startTime + clip.duration,
    })),
    ...trackGaps.map((gap) => ({
      type: "gap" as const,
      item: gap,
      startTime: gap.startTime,
      endTime: gap.startTime + gap.duration,
    })),
  ];

  return items.sort((a, b) => a.startTime - b.startTime);
}

/**
 * Merge gaps that are adjacent or overlapping
 */
export function mergeAdjacentGaps(gaps: Gap[]): Gap[] {
  if (gaps.length <= 1) return gaps;

  const sorted = [...gaps].sort((a, b) => a.startTime - b.startTime);
  const merged: Gap[] = [];
  let current = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    const currentEnd = current.startTime + current.duration;

    // Check if gaps are on the same track and are adjacent or overlapping
    if (current.trackId === next.trackId && (Math.abs(currentEnd - next.startTime) < 0.001 || currentEnd > next.startTime)) {
      // Merge gaps
      const mergedEnd = Math.max(currentEnd, next.startTime + next.duration);
      current = {
        ...current,
        duration: mergedEnd - current.startTime,
        type: current.type === "protected" || next.type === "protected" ? "protected" : current.type,
        protected: current.protected || next.protected,
      };
    } else {
      merged.push(current);
      current = next;
    }
  }

  merged.push(current);
  return merged;
}

/**
 * Remove all unprotected gaps from a track (pack track)
 */
export function packTrack(trackId: string, clips: Clip[], gaps: Gap[]): { remainingGaps: Gap[]; affectedClipIds: string[] } {
  const trackClips = clips.filter((c) => c.trackId === trackId).sort((a, b) => a.startTime - b.startTime);
  const trackGaps = gaps.filter((g) => g.trackId === trackId);

  // Keep only protected gaps
  const remainingGaps = trackGaps.filter((g) => g.protected);

  // All clips need to be repositioned (packed tight)
  const affectedClipIds = trackClips.map((c) => c.id);

  return { remainingGaps, affectedClipIds };
}
