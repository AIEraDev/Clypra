/**
 * React hook for using the compositor engine.
 * Bridges React components with the pure compositor functions.
 */

import { useMemo } from "react";
import { useTimelineStore } from "../store/timelineStore";
import { resolveRenderStack, validateTimeline, toCompositorClips } from "../core";
import type { RenderStack, TimelineValidation } from "../core";

/**
 * Hook to resolve render stack at a specific time.
 *
 * @param time - Timeline time in seconds
 * @returns Render stack at that time
 */
export function useRenderStack(time: number): RenderStack {
  const clips = useTimelineStore((state) => state.clips);
  const tracks = useTimelineStore((state) => state.tracks);

  return useMemo(() => {
    const compositorClips = toCompositorClips(clips, tracks);
    return resolveRenderStack(time, compositorClips);
  }, [time, clips, tracks]);
}

/**
 * Hook to get timeline validation.
 *
 * @param sampleRate - How often to sample for gap detection (default 0.1s)
 * @returns Timeline validation result
 */
export function useTimelineValidation(sampleRate: number = 0.1): TimelineValidation {
  const clips = useTimelineStore((state) => state.clips);
  const tracks = useTimelineStore((state) => state.tracks);

  return useMemo(() => {
    const compositorClips = toCompositorClips(clips, tracks);
    return validateTimeline(compositorClips, sampleRate);
  }, [clips, tracks, sampleRate]);
}

/**
 * Hook to check if timeline has content at a specific time.
 *
 * @param time - Timeline time in seconds
 * @returns True if any content exists at that time
 */
export function useHasContentAtTime(time: number): boolean {
  const renderStack = useRenderStack(time);
  return renderStack.hasContent;
}
