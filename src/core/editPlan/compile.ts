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
  const rate = (state as unknown as { frameRate?: number }).frameRate;
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

function buildCommandsForOp(
  op: EditOp,
  opIndex: number,
  state: TimelineState,
  refs: Map<string, string>,
): { commands: Command[]; afterApply?: (prev: TimelineState, next: TimelineState) => void } | { error: EditPlanError } {
  switch (op.op) {
    case "split": {
      const clip = resolveTarget(op.target, state, refs);
      if (!clip) {
        return { error: { code: "TARGET_NOT_FOUND", message: `Split target not found at op ${opIndex}`, opIndex } };
      }
      const cmd = new SplitClipCommand(clip.id, op.atMs / 1000, getFrameRate(state), clip);
      return {
        commands: [cmd],
        afterApply: (prev, next) => {
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
        },
      };
    }
    case "trim": {
      const clip = resolveTarget(op.target, state, refs);
      if (!clip) {
        return { error: { code: "TARGET_NOT_FOUND", message: `Trim target not found at op ${opIndex}`, opIndex } };
      }
      const oldTrimIn = clip.trimIn ?? 0;
      const oldTrimOut = clip.trimOut ?? clip.duration;
      const oldDuration = clip.duration;
      const newStartSec = op.startMs !== undefined ? op.startMs / 1000 : clip.startTime;
      const newEndSec = op.endMs !== undefined ? op.endMs / 1000 : clip.startTime + clip.duration;
      const newDuration = newEndSec - newStartSec;
      if (newDuration <= 0) {
        return { error: { code: "INVALID_RANGE", message: `Trim results in non-positive duration at op ${opIndex}`, opIndex } };
      }
      const deltaIn = newStartSec - clip.startTime;
      const newTrimIn = Math.max(0, oldTrimIn + deltaIn);
      const newTrimOut = newTrimIn + newDuration;
      const cmd = new TrimClipCommand(
        clip.id,
        oldTrimIn,
        oldTrimOut,
        oldDuration,
        newTrimIn,
        newTrimOut,
        newDuration,
      );
      return { commands: [cmd] };
    }
    case "deleteRange": {
      const startSec = op.startMs / 1000;
      const endSec = op.endMs / 1000;
      const matching = state.clips.filter(
        (c) =>
          c.trackId === op.track &&
          c.startTime + c.duration > startSec &&
          c.startTime < endSec,
      );
      if (matching.length === 0) {
        return { error: { code: "TARGET_NOT_FOUND", message: `No clips in deleteRange at op ${opIndex}`, opIndex } };
      }
      if (op.ripple) {
        return { commands: [new RippleDeleteRangeCommand(matching.map((c) => c.id))] };
      }
      return { commands: matching.map((c) => new DeleteClipCommand(c.id)) };
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
      return { commands: [new AddClipCommand(textClip)] };
    }
  }
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

/**
 * Dry-run compile: validates schema, checks staleness, builds fresh commands
 * against a cloned working state, and verifies every op produces an effect.
 */
export function compileEditPlan(plan: EditPlan, liveState: TimelineState): CompileResult {
  const validation = validateEditPlan(plan);
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
    const built = buildCommandsForOp(plan.ops[i], i, working, refs);
    if ("error" in built) {
      return { ok: false, error: built.error };
    }

    const prev = working;
    let next = working;
    for (const cmd of built.commands) {
      next = cmd.apply(next);
    }

    if (statesEqual(prev, next)) {
      return {
        ok: false,
        error: {
          code: "NO_OP_EFFECT",
          message: `Op ${i} (${plan.ops[i].op}) produced no state change`,
          opIndex: i,
        },
      };
    }

    built.afterApply?.(prev, next);
    working = next;
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
): ApplyResult {
  const dryRun = compileEditPlan(plan, getState());
  if (!dryRun.ok) return dryRun;

  const refs = new Map<string, string>();
  journal.beginTransaction(`AI: ${plan.intent}`);

  try {
    for (let i = 0; i < plan.ops.length; i++) {
      const current = getState();
      const built = buildCommandsForOp(plan.ops[i], i, current, refs);
      if ("error" in built) {
        const rolledBack = journal.rollbackTransaction(current);
        if (rolledBack) setState(rolledBack);
        return { ok: false, error: built.error };
      }

      for (const cmd of built.commands) {
        const prev = getState();
        const next = journal.execute(cmd, prev);
        if (statesEqual(prev, next)) {
          const rolledBack = journal.rollbackTransaction(prev);
          if (rolledBack) setState(rolledBack);
          return {
            ok: false,
            error: {
              code: "NO_OP_EFFECT",
              message: `Op ${i} (${plan.ops[i].op}) produced no state change during apply`,
              opIndex: i,
            },
          };
        }
        setState(next);
        built.afterApply?.(prev, next);
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
