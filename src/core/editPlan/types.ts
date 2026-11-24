export const EDIT_PLAN_MAX_OPS = 200;

export interface EditPlan {
  schemaVersion: 1;
  planId: string;
  baseEpoch: number;
  intent: string;
  ops: EditOp[];
}

export type Target =
  | { clipId: string }
  | { track: string; atMs: number }
  | { track: string; index: number }
  | { ref: string };

export type EditOp =
  | { op: "split"; target: Target; atMs: number; as?: [string, string] }
  | { op: "trim"; target: Target; startMs?: number; endMs?: number }
  | { op: "deleteRange"; track: string; startMs: number; endMs: number; ripple: boolean }
  | { op: "addText"; track: string; atMs: number; durationMs: number; text: string; templateId?: string };

export type EditPlanErrorCode =
  | "INVALID_SCHEMA"
  | "OP_CAP_EXCEEDED"
  | "UNKNOWN_OP"
  | "INVALID_RANGE"
  | "STALE_EPOCH"
  | "TARGET_NOT_FOUND"
  | "NO_OP_EFFECT"
  | "APPLY_FAILED";

export interface EditPlanError {
  code: EditPlanErrorCode;
  message: string;
  opIndex?: number;
}

export type ValidationResult =
  | { ok: true; plan: EditPlan }
  | { ok: false; error: EditPlanError };

export type CompileResult =
  | { ok: true; opCount: number }
  | { ok: false; error: EditPlanError };

export type ApplyResult =
  | { ok: true; opCount: number; newEpoch: number }
  | { ok: false; error: EditPlanError };
