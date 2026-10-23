/**
 * Responsive Time Anchoring (In / Out Architecture).
 *
 * Provides dynamic time-pinning for animation keyframes:
 * - In ("start"): Keyframes remain anchored relative to clip start (t = 0).
 * - Out ("end"): Keyframes dynamically project backwards from clip duration (t = clip.duration - offset).
 * - Absolute ("absolute"): Keyframes maintain unscaled timeline timestamps.
 *
 * Includes an elastic compression guard:
 * If a clip is trimmed shorter than (introDuration + outroDuration), keyframe timing
 * scales proportionally so animations compress gracefully rather than colliding or clipping.
 */

import type { KeyframeTimeAnchor } from "@/types/keyframes";

export interface ResponsiveKeyframePoint {
  time: number;
  anchor?: KeyframeTimeAnchor;
  [key: string]: any;
}

export type ResolvedKeyframe<T extends ResponsiveKeyframePoint> = T & {
  resolvedTime: number;
};

/**
 * Resolves the effective time of a single keyframe point given clip duration.
 */
export function resolveAnchorTime(
  time: number,
  anchor?: KeyframeTimeAnchor,
  clipDuration?: number,
): number {
  if (anchor === "end" && clipDuration != null && clipDuration > 0) {
    return Math.max(0, clipDuration - Math.abs(time));
  }
  return time;
}

/**
 * Resolves, compresses (if trimmed beyond safety margin), and sorts a collection
 * of keyframes relative to clip duration.
 *
 * @param keyframes Collection of keyframes containing `time` and optional `anchor`.
 * @param clipDuration Total length of the clip in seconds.
 * @returns Array of keyframes with calculated `resolvedTime`, sorted monotonically.
 */
export function resolveResponsiveKeyframes<T extends ResponsiveKeyframePoint>(
  keyframes: readonly T[] | undefined,
  clipDuration?: number,
): ResolvedKeyframe<T>[] {
  if (!keyframes || keyframes.length === 0) {
    return [];
  }

  // Fast path: if no clip duration or 1 keyframe without end-anchor
  if (clipDuration == null || clipDuration <= 0) {
    return [...keyframes]
      .map((kf) => ({
        ...kf,
        resolvedTime: kf.time,
      }))
      .sort((a, b) => a.resolvedTime - b.resolvedTime);
  }

  // Partition keyframes by anchor type
  const introKfs: T[] = [];
  const outroKfs: T[] = [];
  const absoluteKfs: T[] = [];

  for (const kf of keyframes) {
    const anchor = kf.anchor ?? "start";
    if (anchor === "end") {
      outroKfs.push(kf);
    } else if (anchor === "absolute") {
      absoluteKfs.push(kf);
    } else {
      introKfs.push(kf);
    }
  }

  // If there are no outro keyframes, anchor times are straightforward
  if (outroKfs.length === 0) {
    return [...keyframes]
      .map((kf) => ({
        ...kf,
        resolvedTime: kf.time,
      }))
      .sort((a, b) => a.resolvedTime - b.resolvedTime);
  }

  // Calculate span of intro and outro
  let maxIntroTime = 0;
  for (const kf of introKfs) {
    if (kf.time > maxIntroTime) maxIntroTime = kf.time;
  }

  let maxOutroOffset = 0;
  for (const kf of outroKfs) {
    const offset = Math.abs(kf.time);
    if (offset > maxOutroOffset) maxOutroOffset = offset;
  }

  // Elastic Compression Guard:
  // If the clip duration is shorter than the sum of intro and outro spans,
  // compress both spans proportionally so they meet smoothly in the middle.
  const totalRequiredSpan = maxIntroTime + maxOutroOffset;
  const needsCompression =
    totalRequiredSpan > clipDuration && maxIntroTime > 0 && maxOutroOffset > 0;
  const compressionRatio = needsCompression
    ? clipDuration / totalRequiredSpan
    : 1.0;

  const resolved: ResolvedKeyframe<T>[] = [];

  // 1. Resolve Intro Keyframes
  for (const kf of introKfs) {
    const resolvedTime = kf.time * compressionRatio;
    resolved.push({
      ...kf,
      resolvedTime,
    });
  }

  // 2. Resolve Outro Keyframes
  for (const kf of outroKfs) {
    const offset = Math.abs(kf.time) * compressionRatio;
    const resolvedTime = Math.max(0, clipDuration - offset);
    resolved.push({
      ...kf,
      resolvedTime,
    });
  }

  // 3. Resolve Absolute Keyframes (unscaled)
  for (const kf of absoluteKfs) {
    resolved.push({
      ...kf,
      resolvedTime: kf.time,
    });
  }

  // Sort monotonically by resolved presentation time
  return resolved.sort((a, b) => a.resolvedTime - b.resolvedTime);
}
