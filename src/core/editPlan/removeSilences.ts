import type { Clip } from "@/types";
import type { EditOp, EditPlan } from "./types";

export const REMOVE_SILENCES_MAX_OPS = 1000;

export interface SilenceRangeInput {
  start_time: number;
  end_time: number;
  duration?: number;
}

export interface JumpCutPlanInput {
  silence_ranges: SilenceRangeInput[];
}

export interface RemoveSilencesOptions {
  planId: string;
  baseEpoch: number;
  clip: Pick<Clip, "trackId" | "startTime" | "duration" | "trimIn" | "speed">;
  jumpCutPlan: JumpCutPlanInput;
  /** Optional safety padding (in seconds) kept on each side of speech. Default 0. */
  paddingSec?: number;
  /** Optional minimum silence duration (in seconds) after padding/clipping. Default 0. */
  minSilenceDurationSec?: number;
  intent?: string;
}

interface TimeRange {
  startSec: number;
  endSec: number;
}

/**
 * Maps `detect_silence_ranges` output (media source time) into timeline-time
 * `deleteRange` ops with `ripple: true`:
 * 1. Subtract clip's source in-point (`trimIn`), divide by `speed`, add `startTime`.
 * 2. Apply optional padding and clip to `[clip.startTime, clip.startTime + clip.duration]`.
 * 3. Drop ranges outside the visible clip or shorter than `minSilenceDurationSec`.
 * 4. Merge adjacent/overlapping ranges.
 * 5. Fail clearly if merged op count exceeds `EDIT_PLAN_MAX_OPS`.
 * 6. Emit in reverse chronological order so earlier timestamps stay valid during ripple.
 */
export function buildRemoveSilencesPlan(options: RemoveSilencesOptions): EditPlan {
  const {
    planId,
    baseEpoch,
    clip,
    jumpCutPlan,
    paddingSec = 0,
    minSilenceDurationSec = 0,
    intent = "Remove silences",
  } = options;

  const sourceIn = clip.trimIn ?? 0;
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  const clipStart = clip.startTime;
  const clipEnd = clip.startTime + clip.duration;

  const mapped: TimeRange[] = [];
  for (const r of jumpCutPlan.silence_ranges) {
    if (r.end_time <= r.start_time) continue;
    const rawStart = clipStart + (r.start_time - sourceIn) / speed + paddingSec;
    const rawEnd = clipStart + (r.end_time - sourceIn) / speed - paddingSec;
    const clippedStart = Math.max(clipStart, rawStart);
    const clippedEnd = Math.min(clipEnd, rawEnd);
    if (clippedEnd - clippedStart <= Math.max(0.001, minSilenceDurationSec)) {
      continue;
    }
    mapped.push({ startSec: clippedStart, endSec: clippedEnd });
  }

  // Merge adjacent or overlapping ranges in ascending order
  mapped.sort((a, b) => a.startSec - b.startSec);
  const merged: TimeRange[] = [];
  for (const range of mapped) {
    const prev = merged[merged.length - 1];
    if (prev && range.startSec <= prev.endSec + 0.001) {
      prev.endSec = Math.max(prev.endSec, range.endSec);
    } else {
      merged.push({ ...range });
    }
  }

  if (merged.length > REMOVE_SILENCES_MAX_OPS) {
    throw new RangeError(
      `Silence removal produced ${merged.length} ops, exceeding REMOVE_SILENCES_MAX_OPS (${REMOVE_SILENCES_MAX_OPS})`,
    );
  }

  // Reverse chronological order so earlier ripple deletes don't shift later timestamps
  const ops: EditOp[] = merged
    .sort((a, b) => b.startSec - a.startSec)
    .map((r) => ({
      op: "deleteRange",
      track: clip.trackId,
      startMs: Math.round(r.startSec * 1000),
      endMs: Math.round(r.endSec * 1000),
      ripple: true,
    }));

  return {
    schemaVersion: 1,
    planId,
    baseEpoch,
    intent,
    ops,
  };
}
