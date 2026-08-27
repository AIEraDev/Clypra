/**
 * Core compositor resolver - time-based frame resolution.
 * This is the heart of the NLE engine.
 *
 * Philosophy:
 * - Time-centric, not track-centric
 * - Returns compositing stacks, not single clips
 * - Deterministic ordering rules
 * - Pure functions, no side effects
 */

import type { CompositorClip, RenderLayer, RenderStack, EvaluatedClip } from "./types";
import { compareCompositorClips } from "./ordering";
import { getClipEndTime } from "@/lib/timeline/timelineClip";

/**
 * Resolve the complete render stack at a specific time.
 * Returns all active layers ordered for compositing (bottom to top).
 *
 * Compositing order (deterministic):
 * 1. Layer type (background < primary < overlay < text < effect)
 * 2. Track index (HIGHER index renders BELOW - top track in UI renders on top)
 * 3. Z-index (explicit layer ordering)
 * 4. Evaluation priority (tie-breaker)
 *
 * @param time - Timeline time in seconds
 * @param clips - All clips in the timeline
 * @returns Ordered render stack (background to foreground)
 */
export function resolveRenderStack(time: number, clips: CompositorClip[]): RenderStack {
  // Find all clips that are active at this time
  // Uses existing getClipEndTime utility for consistency
  const activeCandidates = clips.filter((clip) => {
    const clipEnd = getClipEndTime(clip);
    return clip.startTime <= time && time < clipEnd;
  });

  if (activeCandidates.length === 0) {
    return {
      time,
      layers: [],
      hasContent: false,
    };
  }

  // Evaluate each clip at this time
  const evaluatedLayers = activeCandidates.map((clip) => evaluateClipAtTime(clip, time)).filter((layer) => layer.opacity > 0); // Skip fully transparent layers

  // Sort by the shared preview/export compositing contract.
  const sortedLayers = evaluatedLayers.sort((a, b) => compareCompositorClips(a.clip, b.clip));

  return {
    time,
    layers: sortedLayers,
    hasContent: sortedLayers.length > 0,
  };
}

/**
 * Evaluate a clip's state at a specific time.
 * Accounts for transitions, fades, transforms, etc.
 *
 * @param clip - The clip to evaluate
 * @param time - Timeline time in seconds
 * @returns Render layer with evaluated state
 */
export function evaluateClipAtTime(clip: CompositorClip, time: number): RenderLayer {
  const localTime = time - clip.startTime;

  // TODO: Future enhancements
  // - Fade in/out detection
  // - Transition evaluation
  // - Keyframe interpolation
  // - Speed ramp calculation

  // For now, return basic state
  return {
    clip,
    localTime,
    opacity: clip.opacity,
    transform: {
      x: clip.x,
      y: clip.y,
      width: clip.width,
      height: clip.height,
      rotation: clip.rotation,
    },
    inTransition: false,
  };
}

/**
 * Evaluate a clip's full state at a specific time.
 * More detailed than evaluateClipAtTime - includes effects, speed ramps, etc.
 *
 * @param clip - The clip to evaluate
 * @param time - Timeline time in seconds
 * @returns Complete evaluated state
 */
export function evaluateClip(clip: CompositorClip, time: number): EvaluatedClip {
  const clipEnd = getClipEndTime(clip);
  const isActive = clip.startTime <= time && time < clipEnd;

  if (!isActive) {
    return {
      clip,
      isActive: false,
      localTime: 0,
      opacity: 0,
      transform: {
        x: clip.x,
        y: clip.y,
        width: clip.width,
        height: clip.height,
        rotation: clip.rotation,
        scale: 1,
      },
      effects: [],
    };
  }

  const localTime = time - clip.startTime;

  // TODO: Future enhancements
  // - Speed ramp calculation
  // - Keyframe interpolation
  // - Effect evaluation
  // - Mask evaluation

  return {
    clip,
    isActive: true,
    localTime,
    opacity: clip.opacity,
    transform: {
      x: clip.x,
      y: clip.y,
      width: clip.width,
      height: clip.height,
      rotation: clip.rotation,
      scale: 1,
    },
    effects: [],
  };
}

/**
 * Get all clips that overlap a time range.
 * Useful for batch operations, export, etc.
 *
 * @param startTime - Range start in seconds
 * @param endTime - Range end in seconds
 * @param clips - All clips to check
 * @returns Clips that overlap the range
 */
export function getClipsInRange(startTime: number, endTime: number, clips: CompositorClip[]): CompositorClip[] {
  return clips.filter((clip) => {
    const clipEnd = getClipEndTime(clip);
    // Check for overlap: clip starts before range ends AND clip ends after range starts
    return clip.startTime < endTime && clipEnd > startTime;
  });
}

/**
 * Check if a specific time has any renderable content.
 *
 * @param time - Timeline time in seconds
 * @param clips - All clips to check
 * @returns True if any clip is active at this time
 */
export function hasContentAtTime(time: number, clips: CompositorClip[]): boolean {
  return clips.some((clip) => {
    const clipEnd = getClipEndTime(clip);
    return clip.startTime <= time && time < clipEnd;
  });
}
