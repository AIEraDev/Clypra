export type ScrubTraceIntent = "scrub" | "playback" | "seek";

export interface ScrubTraceDemand {
  targetFrame: number;
  atMs: number;
  intent: ScrubTraceIntent;
  released?: boolean;
  lateForAudio?: boolean;
}

export interface ScrubTracePresentation {
  frameIndex: number;
  atMs: number;
  exact: boolean;
}

export interface ScrubTraceTerminal {
  targetFrame: number;
  outcome: "presented" | "superseded" | "dropped-before-present";
  reason?: "late-for-audio";
}

export interface ScrubTraceReplayResult {
  presentations: ScrubTracePresentation[];
  terminals: ScrubTraceTerminal[];
}

/**
 * Deterministic latest-target replay used by the scrub contract suite.
 *
 * A real decoder can be swapped in later, but the scheduler contract stays
 * independent from codec timing: one active decode, one replaceable mailbox,
 * and an exact final target after pointer release.
 */
export function replayScrubTrace(
  trace: readonly ScrubTraceDemand[],
  decodeLatencyMs: number,
): ScrubTraceReplayResult {
  if (!Number.isFinite(decodeLatencyMs) || decodeLatencyMs <= 0) {
    throw new Error("decodeLatencyMs must be positive");
  }

  const presentations: ScrubTracePresentation[] = [];
  const terminals: ScrubTraceTerminal[] = [];
  let active:
    | { demand: ScrubTraceDemand; completesAtMs: number }
    | undefined;
  let pending: ScrubTraceDemand | undefined;

  const startPending = (nowMs: number) => {
    if (active || !pending) return;
    const demand = pending;
    pending = undefined;
    active = { demand, completesAtMs: nowMs + decodeLatencyMs };
  };

  const completeThrough = (nowMs: number) => {
    while (active && active.completesAtMs <= nowMs) {
      const completed = active;
      active = undefined;
      presentations.push({
        frameIndex: completed.demand.targetFrame,
        atMs: completed.completesAtMs,
        exact: true,
      });
      terminals.push({
        targetFrame: completed.demand.targetFrame,
        outcome: "presented",
      });
      startPending(completed.completesAtMs);
    }
  };

  for (const demand of [...trace].sort((a, b) => a.atMs - b.atMs)) {
    completeThrough(demand.atMs);

    if (shouldDropForAudioLateness(demand.intent, demand.lateForAudio === true)) {
      terminals.push({
        targetFrame: demand.targetFrame,
        outcome: "dropped-before-present",
        reason: "late-for-audio",
      });
      continue;
    }

    if (pending) {
      terminals.push({
        targetFrame: pending.targetFrame,
        outcome: "superseded",
      });
    }
    pending = demand;
    startPending(demand.atMs);
  }

  // Drain the active decode and the final mailbox. This is the release/settle
  // boundary: no exact target may remain unresolved after it.
  while (active || pending) {
    const nextTime = active?.completesAtMs ?? Number.POSITIVE_INFINITY;
    completeThrough(nextTime);
    startPending(nextTime);
  }

  return { presentations, terminals };
}

export function scrubTraceHasMonotonicPresentation(
  presentations: readonly ScrubTracePresentation[],
): boolean {
  return presentations.every(
    (presentation, index) =>
      index === 0 ||
      presentation.frameIndex >= presentations[index - 1].frameIndex,
  );
}

export function shouldDropForAudioLateness(
  intent: ScrubTraceIntent,
  lateForAudio: boolean,
): boolean {
  // Audio lateness is a playback policy. Interactive scrubs and released seeks
  // must still reach the decoder even when the audio clock is stale.
  return intent === "playback" && lateForAudio;
}
