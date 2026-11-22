/**
 * Backpressure policy for native visible-frame demands during an active scrub.
 *
 * This intentionally controls dispatch frequency only. Playback position stays
 * owned by PlaybackClock; the final released seek still uses the normal exact
 * generation fence.
 */
export const NATIVE_FORWARD_SCRUB_DEMAND_INTERVAL_MS = 50;

export interface NativeScrubDemandPacingState {
  frameIndex: number;
  dispatchedAtMs: number;
}

export function decideNativeScrubDemandDispatch(
  previous: NativeScrubDemandPacingState | null,
  frameIndex: number,
  isScrubbing: boolean,
  nowMs: number,
): {
  shouldDispatch: boolean;
  next: NativeScrubDemandPacingState | null;
} {
  // The release frame is an exact seek and must never be delayed.
  if (!isScrubbing) {
    return {
      shouldDispatch: true,
      next: null,
    };
  }

  if (
    previous === null ||
    frameIndex <= previous.frameIndex ||
    nowMs - previous.dispatchedAtMs >= NATIVE_FORWARD_SCRUB_DEMAND_INTERVAL_MS
  ) {
    return {
      shouldDispatch: true,
      next: { frameIndex, dispatchedAtMs: nowMs },
    };
  }

  // Keep the current native decode alive; the next render tick will submit
  // the most recent forward target when the bounded interval elapses.
  return {
    shouldDispatch: false,
    next: previous,
  };
}
