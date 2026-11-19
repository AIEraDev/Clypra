import type { NativeSurfacePresentation } from "@/lib/platform/nativeCore";

/**
 * A retained-surface demand must be acknowledged promptly. Past this bound we
 * deliberately return to the direct presentation path, which has an explicit
 * response boundary and cannot leave a paused preview permanently pending.
 */
export const PAUSED_NATIVE_DEMAND_ACK_TIMEOUT_MS = 750;

/** A compact diagnostic token; never log the serialized native request. */
export function telemetryRequestToken(requestKey: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < requestKey.length; index += 1) {
    hash ^= requestKey.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `rk-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function createNativeDemandOperationId(
  requestId: string,
  generation: number,
  sequence: number,
): string {
  return `${requestId}:op-${generation}-${sequence}`;
}

export interface PendingPausedNativeDemandIdentity {
  requestId: string;
  generation: number;
  frameIndex?: number;
}

export function shouldFallbackForPausedNativeDemand(
  dispatchedAtMs: number,
  nowMs: number,
): boolean {
  return nowMs - dispatchedAtMs >= PAUSED_NATIVE_DEMAND_ACK_TIMEOUT_MS;
}

/**
 * A superseded mailbox entry has no matching presentation event. Release the
 * frontend liveness owner immediately so the newest forward scrub target can
 * be submitted on the next render tick. Successful and dropped-before-present
 * outcomes still emit a paired presentation event and must remain pending.
 */
export function shouldClearPendingPausedNativeDemandOnTerminal(terminal: {
  disposition: string;
  stage: string;
  reason?: string;
}): boolean {
  if (
    terminal.disposition === "presented" ||
    terminal.disposition === "dropped-before-present"
  ) {
    return false;
  }
  // A duplicate target is terminalized for accounting, but it deliberately
  // does not own the mailbox. The original request remains active and will
  // emit the presentation acknowledgement that settles the frontend owner.
  if (terminal.reason === "duplicate-mailbox") {
    return false;
  }
  return terminal.disposition === "superseded" || terminal.stage === "presentation";
}

/**
 * Native surface events are asynchronous and may arrive after a newer seek.
 * Exact operation IDs settle normally; when the native mailbox intentionally
 * retains an older duplicate target, the same target base/frame/generation may
 * settle the replacement frontend owner without accepting a stale frame.
 */
export function matchesPausedNativeDemand(
  pending: PendingPausedNativeDemandIdentity | null,
  presentation: Pick<NativeSurfacePresentation, "requestId" | "generation"> & {
    frameIndex?: number;
  },
): boolean {
  const targetOf = (requestId: string): string =>
    requestId.split(":op-", 1)[0] ?? requestId;
  const sameRetainedTarget =
    pending !== null &&
    pending.frameIndex !== undefined &&
    presentation.frameIndex === pending.frameIndex &&
    targetOf(presentation.requestId) === targetOf(pending.requestId);

  return (
    pending !== null &&
    (presentation.requestId === pending.requestId ||
      sameRetainedTarget) &&
    (presentation.generation === undefined ||
      presentation.generation === pending.generation)
  );
}
