/**
 * Track Region Detection (Layer 1: Geometry)
 *
 * Answers: "Where is the pointer in timeline space?"
 *
 * Uses screen-space hit detection for stable behavior at any zoom level.
 * Edge detection uses pixel thresholds, not time-based thresholds.
 */

import type { Clip } from "@/types";
import { timeToPixel } from "./timelineViewport";


export type ClipRegion = "left-edge" | "body" | "right-edge";
// Future: "trim-in" | "trim-out" | "slip" | "slide"

export type TrackRegion =
  | { type: "before-first" }
  | {
      type: "clip";
      clipId: string;
      clipTime: number; // Time offset within clip
      region: ClipRegion;
    }
  | {
      type: "gap";
      leftClipId?: string; // Clip before gap (if exists)
      rightClipId?: string; // Clip after gap (if exists)
      startTime: number;
      endTime: number;
    }
  | {
      type: "after-last";
      leftClipId: string; // Last clip on track
      startTime: number;
    };

export interface LocateRegionInput {
  trackClips: Clip[];
  draggedClipIds: string[];
  pointerTimeSeconds: number;
  pointerTrackX: number; // Screen-space X position in track
  pixelsPerSecond: number; // For screen-space calculations
  edgeHitWidthPx?: number; // Screen-space edge detection (default 8px)
}

export function locateTrackRegion(input: LocateRegionInput): TrackRegion {
  const { trackClips, draggedClipIds, pointerTimeSeconds, pointerTrackX, pixelsPerSecond, edgeHitWidthPx = 8 } = input;

  const draggedSet = new Set(draggedClipIds);
  const rest = trackClips.filter((c) => !draggedSet.has(c.id));

  // Empty track
  if (rest.length === 0) {
    return { type: "before-first" };
  }

  const firstClip = rest[0];
  const lastClip = rest[rest.length - 1];
  const lastClipEnd = lastClip.startTime + lastClip.duration;

  // Before first clip
  if (pointerTimeSeconds < firstClip.startTime) {
    return {
      type: "gap",
      rightClipId: firstClip.id,
      startTime: 0,
      endTime: firstClip.startTime,
    };
  }

  // After last clip
  if (pointerTimeSeconds >= lastClipEnd) {
    return {
      type: "after-last",
      leftClipId: lastClip.id,
      startTime: lastClipEnd,
    };
  }

  // Over a clip or in a gap
  for (let i = 0; i < rest.length; i++) {
    const clip = rest[i];
    const clipEnd = clip.startTime + clip.duration;

    // Pointer is over this clip
    if (pointerTimeSeconds >= clip.startTime && pointerTimeSeconds < clipEnd) {
      const clipTime = pointerTimeSeconds - clip.startTime;

      // Screen-space edge detection (stable at any zoom level).
      // timeToPixel is used here so hit-test coordinates match the rendered clip
      // boundary pixels exactly (both use Math.round), preventing a ≤1px cursor gap.
      const clipLeftPx = timeToPixel(clip.startTime, pixelsPerSecond);
      const clipRightPx = timeToPixel(clipEnd, pixelsPerSecond);


      let region: ClipRegion = "body";
      if (pointerTrackX < clipLeftPx + edgeHitWidthPx) {
        region = "left-edge";
      } else if (pointerTrackX > clipRightPx - edgeHitWidthPx) {
        region = "right-edge";
      }

      return {
        type: "clip",
        clipId: clip.id,
        clipTime,
        region,
      };
    }

    // Pointer is in gap between clips
    if (i < rest.length - 1) {
      const nextClip = rest[i + 1];
      if (pointerTimeSeconds >= clipEnd && pointerTimeSeconds < nextClip.startTime) {
        return {
          type: "gap",
          leftClipId: clip.id,
          rightClipId: nextClip.id,
          startTime: clipEnd,
          endTime: nextClip.startTime,
        };
      }
    }
  }

  // Fallback
  return {
    type: "after-last",
    leftClipId: lastClip.id,
    startTime: lastClipEnd,
  };
}
