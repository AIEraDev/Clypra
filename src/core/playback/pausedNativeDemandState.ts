/**
 * Decides whether the UI may send another paused native demand.
 *
 * Acknowledgement only proves that Rust accepted a mailbox update. Keeping a
 * single active target until its terminal event prevents RAF ticks from
 * continuously replacing the only operation that can settle a seek.
 */
export interface PausedNativeDemandIdentity {
  requestKey: string;
  generation: number;
  frameIndex: number;
  cancellationEpoch: number;
  isScrubbing: boolean;
}

export type PausedNativeDemandAction = "dispatch" | "hold" | "replace";

export function decidePausedNativeDemandAction(
  active: PausedNativeDemandIdentity | null,
  desired: PausedNativeDemandIdentity,
): PausedNativeDemandAction {
  if (active === null) return "dispatch";

  // Re-evaluation of the same target must not manufacture a fresh operation.
  if (
    active.requestKey === desired.requestKey &&
    active.cancellationEpoch === desired.cancellationEpoch
  ) {
    return "hold";
  }

  // A forward scrub remains within one cancellation epoch. Let the active
  // native decode reach its terminal event; the next RAF publishes the latest
  // desired target. This maintains a single liveness owner.
  if (
    active.isScrubbing &&
    desired.isScrubbing &&
    active.cancellationEpoch === desired.cancellationEpoch &&
    desired.frameIndex >= active.frameIndex
  ) {
    return "hold";
  }

  // Release, reverse scrub, source/snapshot change, and any new epoch are
  // correctness boundaries. The caller must explicitly terminalize the old
  // frontend record before sending the replacement.
  return "replace";
}
