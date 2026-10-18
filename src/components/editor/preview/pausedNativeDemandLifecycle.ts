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
}

export function shouldFallbackForPausedNativeDemand(
  dispatchedAtMs: number,
  nowMs: number,
): boolean {
  return nowMs - dispatchedAtMs >= PAUSED_NATIVE_DEMAND_ACK_TIMEOUT_MS;
}

/**
 * Native surface events are asynchronous and may arrive after a newer seek.
 * Only the exact operation that installed the pending slot may settle it.
 */
export function matchesPausedNativeDemand(
  pending: PendingPausedNativeDemandIdentity | null,
  presentation: Pick<NativeSurfacePresentation, "requestId" | "generation">,
): boolean {
  return (
    pending !== null &&
    presentation.requestId === pending.requestId &&
    (presentation.generation === undefined ||
      presentation.generation === pending.generation)
  );
}
