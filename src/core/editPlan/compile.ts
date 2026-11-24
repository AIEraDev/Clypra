import type { Command } from "@/core/history/Command";
import type { CommandJournal } from "@/core/history/CommandJournal";
import { SplitClipCommand } from "@/core/history/commands/SplitClipCommand";
import { TrimClipCommand } from "@/core/history/commands/TrimClipCommand";
import { RippleDeleteRangeCommand } from "@/core/history/commands/RippleDeleteRangeCommand";
import { AddClipCommand, DeleteClipCommand } from "@/core/history/commands/DeleteClipCommand";
import type { Clip, Track } from "@/types";
import { validateEditPlan } from "./validate";
import type { ApplyResult, CompileResult, EditOp, EditPlan, EditPlanError, Target } from "./types";

export interface TimelineState {
  tracks: Track[];
  clips: Clip[];
  transitions: unknown[];
  gaps: unknown[];
  selectedClipIds: string[];
  epoch: number;
  frameRate?: number;
}

function cloneState(state: TimelineState): TimelineState {
  if (typeof structuredClone === "function") return structuredClone(state);
  return JSON.parse(JSON.stringify(state)) as TimelineState;
}

function getFrameRate(state: TimelineState): number {
  const rate = state.frameRate;
  return typeof rate === "number" && rate > 0 ? rate : 30;
}

function resolveTarget(
  target: Target,
  state: TimelineState,
  refs: Map<string, string>,
): Clip | null {
  if ("clipId" in target) {
    return state.clips.find((c) => c.id === target.clipId) ?? null;
  }
  if ("ref" in target) {
    const id = refs.get(target.ref);
    if (!id) return null;
    return state.clips.find((c) => c.id === id) ?? null;
  }
  if ("atMs" in target) {
    const sec = target.atMs / 1000;
    return (
      state.clips.find(
        (c) => c.trackId === target.track && sec >= c.startTime && sec < c.startTime + c.duration,
      ) ?? null
    );
  }
  if ("index" in target) {
    const onTrack = state.clips
      .filter((c) => c.trackId === target.track)
      .sort((a, b) => a.startTime - b.startTime);
    return onTrack[target.index] ?? null;
  }
  return null;
}

function statesEqual(a: TimelineState, b: TimelineState): boolean {
  if (a === b) return true;
  if (a.clips.length !== b.clips.length) return false;
  for (let i = 0; i < a.clips.length; i++) {
    const ca = a.clips[i];
    const cb = b.clips[i];
    if (
      ca.id !== cb.id ||
      ca.trackId !== cb.trackId ||
      ca.startTime !== cb.startTime ||
      ca.duration !== cb.duration ||
      ca.trimIn !== cb.trimIn ||
      ca.trimOut !== cb.trimOut
    ) {
      return false;
    }
  }
  return true;
}

const EPS = 0.001;

/**
 * Executes a single op by building fresh command(s) against the current state
 * and applying them via `runCommand`. Handles sub-clip splitting for `deleteRange`
 * (including linked clips) so only `[startMs, endMs]` is removed.
 */
function executeOp(
  op: EditOp,
  opIndex: number,
  getState: () => TimelineState,
  runCommand: (cmd: Command) => TimelineState,
  refs: Map<string, string>,
): { ok: true } | { ok: false; error: EditPlanError } {
  const state = getState();

  switch (op.op) {
    case "split": {
      const clip = resolveTarget(op.target, state, refs);
      if (!clip) {
        return { ok: false, error: { code: "TARGET_NOT_FOUND", message: `Split target not found at op ${opIndex}`, opIndex } };
      }
      const prev = state;
      const cmd = new SplitClipCommand(clip.id, op.atMs / 1000, getFrameRate(state), clip);
      const next = runCommand(cmd);
      if (statesEqual(prev, next)) {
        return { ok: false, error: { code: "NO_OP_EFFECT", message: `Op ${opIndex} (split) produced no state change`, opIndex } };
      }
      if (op.as) {
        const prevIds = new Set(prev.clips.map((c) => c.id));
        const created = next.clips
          .filter((c) => !prevIds.has(c.id))
          .sort((a, b) => a.startTime - b.startTime);
        if (created.length >= 2) {
          refs.set(op.as[0], created[0].id);
          refs.set(op.as[1], created[1].id);
        }
      }
      return { ok: true };
    }

    case "trim": {
      const clip = resolveTarget(op.target, state, refs);
      if (!clip) {
        return { ok: false, error: { code: "TARGET_NOT_FOUND", message: `Trim target not found at op ${opIndex}`, opIndex } };
      }
      const oldTrimIn = clip.trimIn ?? 0;
      const oldTrimOut = clip.trimOut ?? clip.duration;
      const oldDuration = clip.duration;
      const newStartSec = op.startMs !== undefined ? op.startMs / 1000 : clip.startTime;
      const newEndSec = op.endMs !== undefined ? op.endMs / 1000 : clip.startTime + clip.duration;
      const newDuration = newEndSec - newStartSec;
      if (newDuration <= 0) {
        return { ok: false, error: { code: "INVALID_RANGE", message: `Trim results in non-positive duration at op ${opIndex}`, opIndex } };
      }
      const deltaIn = newStartSec - clip.startTime;
      const newTrimIn = Math.max(0, oldTrimIn + deltaIn);
      const newTrimOut = newTrimIn + newDuration;
      const prev = state;
      const cmd = new TrimClipCommand(
        clip.id,
        oldTrimIn,
        oldTrimOut,
        oldDuration,
        newTrimIn,
        newTrimOut,
        newDuration,
      );
      const next = runCommand(cmd);
      if (statesEqual(prev, next)) {
        return { ok: false, error: { code: "NO_OP_EFFECT", message: `Op ${opIndex} (trim) produced no state change`, opIndex } };
      }
      return { ok: true };
    }

    case "deleteRange": {
      const startSec = op.startMs / 1000;
      const endSec = op.endMs / 1000;
      const frameRate = getFrameRate(state);

      // Find matching clips on the target track, plus any linked clips on other tracks
      const onTrack = state.clips.filter(
        (c) =>
          c.trackId === op.track &&
          c.startTime + c.duration > startSec + EPS &&
          c.startTime < endSec - EPS,
      );
      if (onTrack.length === 0) {
        return { ok: false, error: { code: "TARGET_NOT_FOUND", message: `No clips in deleteRange at op ${opIndex}`, opIndex } };
      }

      const targetIds = new Set(onTrack.map((c) => c.id));
      for (const c of onTrack) {
        const linkedId = (c as { linkedClipId?: string }).linkedClipId;
        if (linkedId) {
          const linked = state.clips.find((l) => l.id === linkedId);
          if (linked && linked.startTime + linked.duration > startSec + EPS && linked.startTime < endSec - EPS) {
            targetIds.add(linked.id);
          }
        }
      }

      // Split any clip that extends outside [startSec, endSec] so only the interior is deleted
      const idsToDelete: string[] = [];
      for (const initialId of targetIds) {
        let currentClip = getState().clips.find((c) => c.id === initialId);
        if (!currentClip) continue;

        if (currentClip.startTime < startSec - EPS) {
          const prev = getState();
          const splitLeft = new SplitClipCommand(currentClip.id, startSec, frameRate, currentClip);
          const next = runCommand(splitLeft);
          const prevIds = new Set(prev.clips.map((c) => c.id));
          const created = next.clips
            .filter((c) => !prevIds.has(c.id))
            .sort((a, b) => a.startTime - b.startTime);
          if (created.length >= 2) {
            currentClip = created[1];
          }
        }

        if (currentClip.startTime + currentClip.duration > endSec + EPS) {
          const prev = getState();
          const splitRight = new SplitClipCommand(currentClip.id, endSec, frameRate, currentClip);
          const next = runCommand(splitRight);
          const prevIds = new Set(prev.clips.map((c) => c.id));
          const created = next.clips
            .filter((c) => !prevIds.has(c.id))
            .sort((a, b) => a.startTime - b.startTime);
          if (created.length >= 2) {
            currentClip = created[0];
          }
        }

        idsToDelete.push(currentClip.id);
      }

      if (idsToDelete.length === 0) {
        return { ok: false, error: { code: "NO_OP_EFFECT", message: `Op ${opIndex} (deleteRange) produced no segments to delete`, opIndex } };
      }

      const prevBeforeDelete = getState();
      if (op.ripple) {
        const next = runCommand(new RippleDeleteRangeCommand(idsToDelete));
        if (statesEqual(prevBeforeDelete, next)) {
          return { ok: false, error: { code: "NO_OP_EFFECT", message: `Op ${opIndex} (deleteRange) produced no state change`, opIndex } };
        }
      } else {
        for (const id of idsToDelete) {
          const prev = getState();
          const next = runCommand(new DeleteClipCommand(id));
          if (statesEqual(prev, next)) {
            return { ok: false, error: { code: "NO_OP_EFFECT", message: `Op ${opIndex} (deleteRange) produced no state change`, opIndex } };
          }
        }
      }
      return { ok: true };
    }

    case "addText": {
      const id = `ai-text-${Date.now()}-${opIndex}-${Math.random().toString(36).slice(2, 7)}`;
      const durationSec = op.durationMs / 1000;
      const textClip: Clip = {
        id,
        mediaId: "",
        trackId: op.track,
        name: op.text.slice(0, 32),
        startTime: op.atMs / 1000,
        duration: durationSec,
        trimIn: 0,
        trimOut: durationSec,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        rotation: 0,
        opacity: 1,
      };
      const prev = state;
      const next = runCommand(new AddClipCommand(textClip));
      if (statesEqual(prev, next)) {
        return { ok: false, error: { code: "NO_OP_EFFECT", message: `Op ${opIndex} (addText) produced no state change`, opIndex } };
      }
      return { ok: true };
    }
  }
}

export interface CompileEditPlanOptions {
  maxOps?: number;
}

export interface ApplyEditPlanOptions extends CompileEditPlanOptions {
  /** Rejects apply while a live drag/scrub preview with _skipEpochIncrement is active. */
  isLiveEditActive?: () => boolean;
}

/**
 * Dry-run compile: validates schema, checks staleness, builds fresh commands
 * against a cloned working state, and verifies every op produces an effect.
 */
export function compileEditPlan(
  plan: EditPlan,
  liveState: TimelineState,
  options?: CompileEditPlanOptions,
): CompileResult {
  const validation = validateEditPlan(plan, { maxOps: options?.maxOps });
  if (!validation.ok) return validation;

  if (liveState.epoch !== plan.baseEpoch) {
    return {
      ok: false,
      error: {
        code: "STALE_EPOCH",
        message: `Plan baseEpoch (${plan.baseEpoch}) does not match live epoch (${liveState.epoch})`,
      },
    };
  }

  let working = cloneState(liveState);
  const refs = new Map<string, string>();

  for (let i = 0; i < plan.ops.length; i++) {
    const res = executeOp(
      plan.ops[i],
      i,
      () => working,
      (cmd) => {
        working = cmd.apply(working);
        return working;
      },
      refs,
    );
    if (!res.ok) return res;
  }

  return { ok: true, opCount: plan.ops.length };
}

/**
 * Dry-run compiles first, then recompiles with fresh command instances inside
 * a single CommandJournal transaction. Rolls back on any mid-plan failure.
 */
export function applyEditPlan(
  plan: EditPlan,
  getState: () => TimelineState,
  setState: (next: TimelineState) => void,
  journal: CommandJournal,
  options?: ApplyEditPlanOptions,
): ApplyResult {
  if (options?.isLiveEditActive?.()) {
    return {
      ok: false,
      error: {
        code: "LIVE_EDIT_IN_PROGRESS",
        message: "Cannot apply EditPlan while a live property edit is in progress",
      },
    };
  }

  const dryRun = compileEditPlan(plan, getState(), { maxOps: options?.maxOps });
  if (!dryRun.ok) return dryRun;

  if (plan.ops.length === 0) {
    return { ok: true, opCount: 0, newEpoch: getState().epoch };
  }

  const refs = new Map<string, string>();
  journal.beginTransaction(`AI: ${plan.intent}`);

  try {
    for (let i = 0; i < plan.ops.length; i++) {
      const res = executeOp(
        plan.ops[i],
        i,
        getState,
        (cmd) => {
          const next = journal.execute(cmd, getState());
          setState(next);
          return next;
        },
        refs,
      );
      if (!res.ok) {
        const rolledBack = journal.rollbackTransaction(getState());
        if (rolledBack) setState(rolledBack);
        return res;
      }
    }

    journal.commitTransaction(getState());
    return { ok: true, opCount: plan.ops.length, newEpoch: getState().epoch };
  } catch (err) {
    const rolledBack = journal.rollbackTransaction(getState());
    if (rolledBack) setState(rolledBack);
    return {
      ok: false,
      error: {
        code: "APPLY_FAILED",
        message: err instanceof Error ? err.message : "Unknown apply failure",
      },
    };
  }
}
