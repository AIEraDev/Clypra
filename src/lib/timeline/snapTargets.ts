/**
 * Snap Targets System
 *
 * Separate from editing logic - handles magnetic snapping to timeline features.
 * Snap targets are represented uniformly (timeline-start, clip edges, playhead).
 */

import type { Clip } from "@/types";

export type SnapTarget = { type: "timeline-start" } | { type: "clip-start"; clipId: string; time: number } | { type: "clip-end"; clipId: string; time: number } | { type: "playhead"; time: number }; // Future

export interface SnapResult {
  snapped: boolean;
  originalTime: number;
  snappedTime?: number;
  snapTarget?: SnapTarget;
}

export interface FindSnapInput {
  candidateTime: number;
  trackClips: Clip[];
  draggedClipIds: string[];
  snapEnabled: boolean;
  snapThresholdSeconds?: number;
  snapThresholdPx?: number;
  pixelsPerSecond?: number;
  playheadTime?: number; // Future: snap to playhead
}

export function findSnap(input: FindSnapInput): SnapResult {
  const {
    candidateTime,
    trackClips,
    draggedClipIds,
    snapEnabled,
    snapThresholdPx = 8,
    pixelsPerSecond,
    snapThresholdSeconds: explicitSeconds,
    playheadTime,
  } = input;

  if (!snapEnabled) {
    return { snapped: false, originalTime: candidateTime };
  }

  const snapThresholdSeconds =
    typeof explicitSeconds === "number" && !isNaN(explicitSeconds)
      ? explicitSeconds
      : typeof pixelsPerSecond === "number" && !isNaN(pixelsPerSecond) && pixelsPerSecond > 0
        ? snapThresholdPx / pixelsPerSecond
        : 0.1;

  const draggedSet = new Set(draggedClipIds);
  const rest = trackClips.filter((c) => !draggedSet.has(c.id));

  let closestSnap: { distance: number; target: SnapTarget; time: number } | null = null;

  // Timeline start
  const distToStart = Math.abs(candidateTime);
  if (distToStart < snapThresholdSeconds) {
    closestSnap = { distance: distToStart, target: { type: "timeline-start" }, time: 0 };
  }

  // Clip edges
  for (const clip of rest) {
    // Clip start
    const distToClipStart = Math.abs(candidateTime - clip.startTime);
    if (distToClipStart < snapThresholdSeconds && (!closestSnap || distToClipStart < closestSnap.distance)) {
      closestSnap = {
        distance: distToClipStart,
        target: { type: "clip-start", clipId: clip.id, time: clip.startTime },
        time: clip.startTime,
      };
    }

    // Clip end
    const clipEnd = clip.startTime + clip.duration;
    const distToClipEnd = Math.abs(candidateTime - clipEnd);
    if (distToClipEnd < snapThresholdSeconds && (!closestSnap || distToClipEnd < closestSnap.distance)) {
      closestSnap = {
        distance: distToClipEnd,
        target: { type: "clip-end", clipId: clip.id, time: clipEnd },
        time: clipEnd,
      };
    }
  }

  // Future: Playhead snap
  if (playheadTime !== undefined) {
    const distToPlayhead = Math.abs(candidateTime - playheadTime);
    if (distToPlayhead < snapThresholdSeconds && (!closestSnap || distToPlayhead < closestSnap.distance)) {
      closestSnap = {
        distance: distToPlayhead,
        target: { type: "playhead", time: playheadTime },
        time: playheadTime,
      };
    }
  }

  if (closestSnap) {
    return {
      snapped: true,
      originalTime: candidateTime,
      snappedTime: closestSnap.time,
      snapTarget: closestSnap.target,
    };
  }

  return { snapped: false, originalTime: candidateTime };
}

/**
 * Asynchronously finds the closest snap target using the background TimelineSnap worker.
 */
export async function findSnapAsync(
  draggedClipId: string,
  proposedStartTime: number,
  trackId: string,
  options: {
    snapEnabled?: boolean;
    snapRadiusSeconds?: number;
    playheadTime?: number;
  } = {},
): Promise<import("@/workers/types").SnapResult> {
  const { getTimelineSnapWorkerClient } = await import(
    "@/core/workers/timelineSnapWorkerClient"
  );
  return getTimelineSnapWorkerClient().querySnap(
    draggedClipId,
    proposedStartTime,
    trackId,
    options,
  );
}

