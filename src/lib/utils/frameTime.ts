/**
 * Frame Time Utilities
 *
 * Provides deterministic frame boundary calculations to ensure
 * splits, seeks, and playback align with real decoder frame positions.
 */

/**
 * Snap a time to the nearest frame boundary.
 *
 * @param timeSeconds - Arbitrary time in seconds
 * @param frameRate - Project frame rate (fps)
 * @returns Time snapped to nearest frame boundary
 */
export function snapToFrameBoundary(timeSeconds: number, frameRate: number): number {
  const frameIndex = Math.round(timeSeconds * frameRate);
  return frameIndex / frameRate;
}

/**
 * Snap a time to the previous frame boundary (floor).
 */
export function snapToFrameFloor(timeSeconds: number, frameRate: number): number {
  const frameIndex = Math.floor(timeSeconds * frameRate);
  return frameIndex / frameRate;
}

/**
 * Snap a time to the next frame boundary (ceil).
 */
export function snapToFrameCeil(timeSeconds: number, frameRate: number): number {
  const frameIndex = Math.ceil(timeSeconds * frameRate);
  return frameIndex / frameRate;
}

/**
 * Get the frame index for a given time.
 */
export function getFrameIndex(timeSeconds: number, frameRate: number): number {
  return Math.round(timeSeconds * frameRate);
}

/**
 * Return the frame that owns a timeline time.
 *
 * Frame ownership is defined by half-open intervals:
 * [N / frameRate, (N + 1) / frameRate).
 *
 * This is intentionally separate from getFrameIndex(), which preserves the
 * older nearest-frame behavior used by editing operations.
 */
export function getFrameIndexAtTime(timeSeconds: number, frameRate: number): number {
  if (!Number.isFinite(timeSeconds) || !Number.isFinite(frameRate) || frameRate <= 0) {
    return 0;
  }

  // A tiny tolerance prevents exact frame boundaries such as 1 / 30 from
  // becoming the preceding frame because of floating-point representation.
  const boundaryTolerance = 1e-9;
  return Math.max(0, Math.floor(Math.max(0, timeSeconds) * frameRate + boundaryTolerance));
}

/**
 * Convert a continuous timeline time to the canonical start time of its frame.
 */
export function getFrameStartTime(timeSeconds: number, frameRate: number): number {
  return getTimeFromFrame(getFrameIndexAtTime(timeSeconds, frameRate), frameRate);
}

/**
 * Get time from frame index.
 */
export function getTimeFromFrame(frameIndex: number, frameRate: number): number {
  return frameIndex / frameRate;
}
