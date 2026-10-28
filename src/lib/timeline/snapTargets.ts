/**
 * Snap Targets System
 *
 * Separate from editing logic - handles magnetic snapping to timeline features.
 * Snap targets are represented uniformly (timeline-start, clip edges, playhead).
 */

import type { Clip } from "@/types";

export type SnapTarget =
  | { type: "timeline-start" }
  | { type: "clip-start"; clipId: string; time: number }
  | { type: "clip-end"; clipId: string; time: number }
  | { type: "playhead"; time: number }
  | { type: "keyframe"; clipId: string; time: number; propertyKey?: string };

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

export interface KeyframeSnapCandidate {
  clipId: string;
  time: number; // Absolute timeline timestamp: clip.startTime + kf.time
  propertyKey?: string;
}

/**
 * Collects all unique keyframe timestamps across all clips in the timeline.
 * Only includes keyframes within the valid clip duration [0, clip.duration].
 */
export function collectTimelineKeyframes(
  clips: readonly Clip[],
): KeyframeSnapCandidate[] {
  const candidates: KeyframeSnapCandidate[] = [];
  if (!clips || clips.length === 0) return candidates;

  for (const clip of clips) {
    if (typeof clip.startTime !== "number" || isNaN(clip.startTime)) continue;
    const duration =
      typeof clip.duration === "number" && !isNaN(clip.duration)
        ? clip.duration
        : 0;

    // Visual keyframes (Position, Scale, Rotation, Opacity)
    const vk = clip.visualKeyframes;
    if (vk) {
      const visualProps = [
        "x",
        "y",
        "width",
        "height",
        "rotation",
        "opacity",
      ] as const;
      for (const prop of visualProps) {
        const kfs = vk[prop];
        if (Array.isArray(kfs)) {
          for (const kf of kfs) {
            if (
              typeof kf?.time === "number" &&
              !isNaN(kf.time) &&
              kf.time >= -0.001 &&
              kf.time <= duration + 0.001
            ) {
              const absTime = clip.startTime + Math.max(0, Math.min(kf.time, duration));
              if (!candidates.some((c) => Math.abs(c.time - absTime) < 0.001)) {
                candidates.push({
                  clipId: clip.id,
                  time: absTime,
                  propertyKey: prop,
                });
              }
            }
          }
        }
      }
    }

    // Audio volume keyframes
    if (Array.isArray(clip.volumeKeyframes)) {
      for (const kf of clip.volumeKeyframes) {
        if (
          typeof kf?.time === "number" &&
          !isNaN(kf.time) &&
          kf.time >= -0.001 &&
          kf.time <= duration + 0.001
        ) {
          const absTime = clip.startTime + Math.max(0, Math.min(kf.time, duration));
          if (!candidates.some((c) => Math.abs(c.time - absTime) < 0.001)) {
            candidates.push({
              clipId: clip.id,
              time: absTime,
              propertyKey: "volume",
            });
          }
        }
      }
    }
  }

  return candidates.sort((a, b) => a.time - b.time);
}

export interface FindKeyframeSnapInput {
  candidateTime: number;
  clips: readonly Clip[];
  snapEnabled: boolean;
  snapThresholdPx?: number;
  pixelsPerSecond?: number;
  snapThresholdSeconds?: number;
}

export interface KeyframeSnapResult {
  snapped: boolean;
  originalTime: number;
  snappedTime?: number;
  snapTarget?: {
    clipId: string;
    time: number;
    propertyKey?: string;
  };
}

/**
 * Checks whether candidateTime is within magnetic snap distance of an inline keyframe diamond center.
 * Threshold defaults to 8px screen distance.
 */
export function findKeyframeSnap(
  input: FindKeyframeSnapInput,
): KeyframeSnapResult {
  const {
    candidateTime,
    clips,
    snapEnabled,
    snapThresholdPx = 8,
    pixelsPerSecond,
    snapThresholdSeconds: explicitSeconds,
  } = input;

  if (
    !snapEnabled ||
    !clips ||
    clips.length === 0 ||
    !Number.isFinite(candidateTime)
  ) {
    return { snapped: false, originalTime: candidateTime };
  }

  const thresholdSeconds =
    typeof explicitSeconds === "number" && !isNaN(explicitSeconds)
      ? explicitSeconds
      : typeof pixelsPerSecond === "number" &&
          !isNaN(pixelsPerSecond) &&
          pixelsPerSecond > 0
        ? snapThresholdPx / pixelsPerSecond
        : 0.1;

  const keyframes = collectTimelineKeyframes(clips);
  let bestMatch: KeyframeSnapCandidate | null = null;
  let minDistance = thresholdSeconds;

  for (const kf of keyframes) {
    const dist = Math.abs(kf.time - candidateTime);
    if (dist <= minDistance) {
      minDistance = dist;
      bestMatch = kf;
    }
  }

  if (bestMatch) {
    return {
      snapped: true,
      originalTime: candidateTime,
      snappedTime: bestMatch.time,
      snapTarget: {
        clipId: bestMatch.clipId,
        time: bestMatch.time,
        propertyKey: bestMatch.propertyKey,
      },
    };
  }

  return { snapped: false, originalTime: candidateTime };
}

