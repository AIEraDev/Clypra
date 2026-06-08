/**
 * Timeline validation - diagnostic only, never blocks operations.
 *
 * Philosophy:
 * - Validation is informational, not enforcement
 * - Detects gaps, coverage, and potential issues
 * - Never prevents user actions
 * - Provides actionable warnings
 */

import type { CompositorClip, TimelineValidation, TimeRange } from "./types";
import { hasContentAtTime } from "./resolver";
import { getClipEndTime, getTimelineContentEnd } from "@/lib/timelineClip";

/**
 * Validate timeline and return diagnostic information.
 * This is purely informational - it never blocks operations.
 *
 * @param clips - All clips in the timeline
 * @param sampleRate - How often to sample (in seconds) for gap detection
 * @returns Validation result with ranges and warnings
 */
export function validateTimeline(clips: CompositorClip[], sampleRate: number = 0.1): TimelineValidation {
  if (clips.length === 0) {
    return {
      renderableRanges: [],
      gapRanges: [],
      primaryVideoRanges: [],
      audioOnlyRanges: [],
      overlayOnlyRanges: [],
      warnings: ["Timeline is empty"],
      totalDuration: 0,
    };
  }

  // Calculate total duration using existing utility
  const totalDuration = getTimelineContentEnd(clips);

  // Sample timeline to find ranges
  const renderableRanges = findRenderableRanges(clips, totalDuration, sampleRate);
  const gapRanges = findGapRanges(clips, totalDuration, sampleRate);
  const primaryVideoRanges = findPrimaryVideoRanges(clips, totalDuration, sampleRate);
  const audioOnlyRanges = findAudioOnlyRanges(clips, totalDuration, sampleRate);
  const overlayOnlyRanges = findOverlayOnlyRanges(clips, totalDuration, sampleRate);

  // Generate warnings
  const warnings = generateWarnings(clips, gapRanges, primaryVideoRanges, totalDuration);

  return {
    renderableRanges,
    gapRanges,
    primaryVideoRanges,
    audioOnlyRanges,
    overlayOnlyRanges,
    warnings,
    totalDuration,
  };
}

/**
 * Find ranges where any content exists (renderable).
 */
function findRenderableRanges(clips: CompositorClip[], duration: number, sampleRate: number): TimeRange[] {
  return findRangesWhere(duration, sampleRate, (time) => hasContentAtTime(time, clips));
}

/**
 * Find ranges with no content (gaps).
 */
function findGapRanges(clips: CompositorClip[], duration: number, sampleRate: number): TimeRange[] {
  return findRangesWhere(duration, sampleRate, (time) => !hasContentAtTime(time, clips));
}

/**
 * Find ranges with primary video content.
 * Note: After z-order fix, inferred video tracks use role="overlay".
 * This function now detects explicitly-assigned primary layers only.
 */
function findPrimaryVideoRanges(clips: CompositorClip[], duration: number, sampleRate: number): TimeRange[] {
  return findRangesWhere(duration, sampleRate, (time) => {
    return clips.some((clip) => {
      const clipEnd = getClipEndTime(clip);
      return clip.role === "primary" && clip.startTime <= time && time < clipEnd;
    });
  });
}

/**
 * Find ranges with only audio (no video).
 */
function findAudioOnlyRanges(clips: CompositorClip[], duration: number, sampleRate: number): TimeRange[] {
  return findRangesWhere(duration, sampleRate, (time) => {
    const hasAudio = clips.some((clip) => {
      const clipEnd = getClipEndTime(clip);
      return clip.role === "audio" && clip.startTime <= time && time < clipEnd;
    });

    const hasVideo = clips.some((clip) => {
      const clipEnd = getClipEndTime(clip);
      const isVideo = clip.role === "primary" || clip.role === "overlay" || clip.role === "background";
      return isVideo && clip.startTime <= time && time < clipEnd;
    });

    return hasAudio && !hasVideo;
  });
}

/**
 * Find ranges with only overlays/text (no primary video).
 */
function findOverlayOnlyRanges(clips: CompositorClip[], duration: number, sampleRate: number): TimeRange[] {
  return findRangesWhere(duration, sampleRate, (time) => {
    const hasOverlay = clips.some((clip) => {
      const clipEnd = getClipEndTime(clip);
      const isOverlay = clip.role === "overlay" || clip.role === "text";
      return isOverlay && clip.startTime <= time && time < clipEnd;
    });

    const hasPrimary = clips.some((clip) => {
      const clipEnd = getClipEndTime(clip);
      return clip.role === "primary" && clip.startTime <= time && time < clipEnd;
    });

    return hasOverlay && !hasPrimary;
  });
}

/**
 * Generic range finder - samples timeline and groups consecutive matching times.
 */
function findRangesWhere(duration: number, sampleRate: number, predicate: (time: number) => boolean): TimeRange[] {
  const ranges: TimeRange[] = [];
  let currentRange: TimeRange | null = null;

  for (let time = 0; time <= duration; time += sampleRate) {
    const matches = predicate(time);

    if (matches) {
      if (!currentRange) {
        // Start new range
        currentRange = { start: time, end: time };
      } else {
        // Extend current range
        currentRange.end = time;
      }
    } else {
      if (currentRange) {
        // Close current range
        ranges.push(currentRange);
        currentRange = null;
      }
    }
  }

  // Close final range if still open
  if (currentRange) {
    ranges.push(currentRange);
  }

  return mergeAdjacentRanges(ranges, sampleRate);
}

/**
 * Merge adjacent ranges that are within tolerance of each other.
 */
function mergeAdjacentRanges(ranges: TimeRange[], tolerance: number): TimeRange[] {
  if (ranges.length === 0) return [];

  const merged: TimeRange[] = [];
  let current = { ...ranges[0] };

  for (let i = 1; i < ranges.length; i++) {
    const next = ranges[i];

    // If ranges are adjacent (within tolerance), merge them
    if (next.start - current.end <= tolerance) {
      current.end = next.end;
    } else {
      // Otherwise, save current and start new range
      merged.push(current);
      current = { ...next };
    }
  }

  merged.push(current);
  return merged;
}

/**
 * Generate user-facing warnings based on timeline state.
 */
function generateWarnings(clips: CompositorClip[], gapRanges: TimeRange[], primaryVideoRanges: TimeRange[], totalDuration: number): string[] {
  const warnings: string[] = [];

  // Warn about gaps (informational only)
  if (gapRanges.length > 0) {
    const totalGapDuration = gapRanges.reduce((sum, range) => sum + (range.end - range.start), 0);
    if (totalGapDuration > 1) {
      // Only warn if gaps are significant
      warnings.push(`Timeline has ${gapRanges.length} gap(s) totaling ${totalGapDuration.toFixed(1)}s`);
    }
  }

  // Warn if no video content at all (informational only)
  // Note: After z-order fix, inferred video tracks use role="overlay", not "primary"
  if (primaryVideoRanges.length === 0) {
    const hasAnyVideo = clips.some((c) => c.role === "primary" || c.role === "overlay" || c.role === "background");
    if (!hasAnyVideo) {
      warnings.push("Timeline has no video content");
    }
    // Don't warn about missing "primary" role specifically — overlay is now the default for video tracks
  }

  // Warn about very short clips (potential issues)
  const shortClips = clips.filter((c) => c.duration < 0.1);
  if (shortClips.length > 0) {
    warnings.push(`${shortClips.length} clip(s) are very short (<0.1s) and may cause playback issues`);
  }

  // Warn about clips with invalid trim ranges
  const invalidTrims = clips.filter((c) => c.trimIn >= c.trimOut || c.trimOut - c.trimIn !== c.duration);
  if (invalidTrims.length > 0) {
    warnings.push(`${invalidTrims.length} clip(s) have invalid trim ranges`);
  }

  return warnings;
}

/**
 * Check if timeline is valid for export.
 * More strict than general validation.
 *
 * @param clips - All clips in the timeline
 * @returns Object with isValid flag and reasons if invalid
 */
export function validateForExport(clips: CompositorClip[]): { isValid: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (clips.length === 0) {
    reasons.push("Timeline is empty");
    return { isValid: false, reasons };
  }

  // Check for any renderable content
  const hasVisualContent = clips.some((c) => c.role !== "audio");
  if (!hasVisualContent) {
    reasons.push("Timeline has no visual content (audio-only exports may require special handling)");
  }

  // Check for invalid clips
  const invalidClips = clips.filter((c) => c.duration <= 0 || c.trimIn >= c.trimOut);
  if (invalidClips.length > 0) {
    reasons.push(`${invalidClips.length} clip(s) have invalid durations or trim ranges`);
  }

  return {
    isValid: reasons.length === 0,
    reasons,
  };
}
