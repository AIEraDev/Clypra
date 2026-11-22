/**
 * Separates an interactive pointer target from the native cancellation fence.
 *
 * Forward scrub targets are replaceable: keeping their epoch stable lets the
 * native worker finish the decode it already owns. Reversal and release are
 * correctness boundaries, so they establish a fresh epoch.
 */
export interface NativeScrubDemandLifecycleState {
  cancellationEpoch: number;
  lastFrameIndex: number;
  wasScrubbing: boolean;
}

export type NativeScrubDirection = "forward" | "backward" | "stationary";

export function resolveNativeScrubDirection(
  previousFrameIndex: number | null,
  frameIndex: number,
): NativeScrubDirection {
  if (previousFrameIndex === null || frameIndex === previousFrameIndex) {
    return "stationary";
  }
  return frameIndex > previousFrameIndex ? "forward" : "backward";
}

export interface NativeScrubIntentBoundary {
  time: number;
  isScrubbing: boolean;
}

/**
 * Returns whether a seek intent must advance the native cancellation fence.
 * Forward pointer movement is a replaceable target within the current decode
 * epoch; reversal, release, and a new interaction are correctness boundaries.
 */
export function shouldInvalidateNativeScrubDemand(
  previous: NativeScrubIntentBoundary | null,
  current: NativeScrubIntentBoundary,
): boolean {
  return !(
    previous !== null &&
    previous.isScrubbing &&
    current.isScrubbing &&
    current.time >= previous.time
  );
}

export function resolveNativeScrubDemandLifecycle(
  previous: NativeScrubDemandLifecycleState | null,
  targetGeneration: number,
  frameIndex: number,
  isScrubbing: boolean,
): {
  cancellationEpoch: number;
  next: NativeScrubDemandLifecycleState;
} {
  const requiresCancellationBoundary =
    previous === null ||
    !isScrubbing ||
    !previous.wasScrubbing ||
    frameIndex < previous.lastFrameIndex;
  const cancellationEpoch = requiresCancellationBoundary
    ? targetGeneration
    : previous.cancellationEpoch;

  return {
    cancellationEpoch,
    next: {
      cancellationEpoch,
      lastFrameIndex: frameIndex,
      wasScrubbing: isScrubbing,
    },
  };
}
