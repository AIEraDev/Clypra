import { EDIT_PLAN_MAX_OPS, type EditOp, type EditPlan, type Target, type ValidationResult } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNonNeg(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateTarget(target: unknown): target is Target {
  if (!isRecord(target)) return false;
  if ("clipId" in target) {
    return typeof target.clipId === "string" && target.clipId.length > 0 && Object.keys(target).length === 1;
  }
  if ("ref" in target) {
    return typeof target.ref === "string" && target.ref.length > 0 && Object.keys(target).length === 1;
  }
  if ("track" in target && "atMs" in target) {
    return (
      typeof target.track === "string" &&
      target.track.length > 0 &&
      isFiniteNonNeg(target.atMs) &&
      Object.keys(target).length === 2
    );
  }
  if ("track" in target && "index" in target) {
    return (
      typeof target.track === "string" &&
      target.track.length > 0 &&
      typeof target.index === "number" &&
      Number.isInteger(target.index) &&
      target.index >= 0 &&
      Object.keys(target).length === 2
    );
  }
  return false;
}

function validateOp(op: unknown, index: number): ValidationResult | null {
  if (!isRecord(op) || typeof op.op !== "string") {
    return {
      ok: false,
      error: { code: "INVALID_SCHEMA", message: `Op ${index} must be an object with an op string`, opIndex: index },
    };
  }

  switch (op.op) {
    case "split": {
      if (!validateTarget(op.target) || !isFiniteNonNeg(op.atMs)) {
        return {
          ok: false,
          error: { code: "INVALID_RANGE", message: `Invalid split op at index ${index}`, opIndex: index },
        };
      }
      if (op.as !== undefined) {
        if (!Array.isArray(op.as) || op.as.length !== 2 || typeof op.as[0] !== "string" || typeof op.as[1] !== "string") {
          return {
            ok: false,
            error: { code: "INVALID_SCHEMA", message: `Invalid split 'as' tuple at index ${index}`, opIndex: index },
          };
        }
      }
      return null;
    }
    case "trim": {
      if (!validateTarget(op.target)) {
        return {
          ok: false,
          error: { code: "INVALID_SCHEMA", message: `Invalid trim target at index ${index}`, opIndex: index },
        };
      }
      if (op.startMs === undefined && op.endMs === undefined) {
        return {
          ok: false,
          error: { code: "INVALID_RANGE", message: `Trim op at index ${index} requires startMs or endMs`, opIndex: index },
        };
      }
      if ((op.startMs !== undefined && !isFiniteNonNeg(op.startMs)) || (op.endMs !== undefined && !isFiniteNonNeg(op.endMs))) {
        return {
          ok: false,
          error: { code: "INVALID_RANGE", message: `Invalid trim bounds at index ${index}`, opIndex: index },
        };
      }
      return null;
    }
    case "deleteRange": {
      if (
        typeof op.track !== "string" ||
        op.track.length === 0 ||
        !isFiniteNonNeg(op.startMs) ||
        !isFiniteNonNeg(op.endMs) ||
        op.endMs <= op.startMs ||
        typeof op.ripple !== "boolean"
      ) {
        return {
          ok: false,
          error: { code: "INVALID_RANGE", message: `Invalid deleteRange op at index ${index}`, opIndex: index },
        };
      }
      return null;
    }
    case "addText": {
      if (
        typeof op.track !== "string" ||
        op.track.length === 0 ||
        !isFiniteNonNeg(op.atMs) ||
        !isFiniteNonNeg(op.durationMs) ||
        op.durationMs <= 0 ||
        typeof op.text !== "string" ||
        op.text.length === 0
      ) {
        return {
          ok: false,
          error: { code: "INVALID_RANGE", message: `Invalid addText op at index ${index}`, opIndex: index },
        };
      }
      return null;
    }
    default:
      return {
        ok: false,
        error: { code: "UNKNOWN_OP", message: `Unknown op '${op.op}' at index ${index}`, opIndex: index },
      };
  }
}

export interface ValidateEditPlanOptions {
  maxOps?: number;
}

export function validateEditPlan(input: unknown, options?: ValidateEditPlanOptions): ValidationResult {
  const maxOps = options?.maxOps ?? EDIT_PLAN_MAX_OPS;
  if (!isRecord(input)) {
    return { ok: false, error: { code: "INVALID_SCHEMA", message: "Plan must be an object" } };
  }
  if (input.schemaVersion !== 1) {
    return { ok: false, error: { code: "INVALID_SCHEMA", message: "Unsupported schemaVersion" } };
  }
  if (typeof input.planId !== "string" || input.planId.length === 0) {
    return { ok: false, error: { code: "INVALID_SCHEMA", message: "planId must be a non-empty string" } };
  }
  if (typeof input.baseEpoch !== "number" || !Number.isInteger(input.baseEpoch) || input.baseEpoch < 0) {
    return { ok: false, error: { code: "INVALID_SCHEMA", message: "baseEpoch must be a non-negative integer" } };
  }
  if (typeof input.intent !== "string") {
    return { ok: false, error: { code: "INVALID_SCHEMA", message: "intent must be a string" } };
  }
  if (!Array.isArray(input.ops)) {
    return { ok: false, error: { code: "INVALID_SCHEMA", message: "ops must be an array" } };
  }
  if (input.ops.length > maxOps) {
    return {
      ok: false,
      error: { code: "OP_CAP_EXCEEDED", message: `Plan exceeds maximum of ${maxOps} ops` },
    };
  }

  for (let i = 0; i < input.ops.length; i++) {
    const err = validateOp(input.ops[i], i);
    if (err) return err;
  }

  return { ok: true, plan: input as unknown as EditPlan };
}
