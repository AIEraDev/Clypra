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
