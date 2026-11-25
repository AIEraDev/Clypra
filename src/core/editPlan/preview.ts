import type { Clip } from "@/types";
import { compileEditPlanWithTrace, type CompileEditPlanOptions, type TimelineState } from "./compile";
import type { EditOp, EditPlan, EditPlanError } from "./types";

export interface PlanPreviewRow {
  opIndex: number;
  op: EditOp;
  enabled: boolean;
  toggleGroupId: number;
  startMs: number | null;
  endMs: number | null;
  affectedClipIds: string[];
  durationDeltaMs: number;
}

export interface PlanPreviewTotals {
  durationBeforeMs: number;
  durationAfterMs: number;
  durationDeltaMs: number;
  cutCount: number;
  enabledOpCount: number;
  totalOpCount: number;
}

export interface PlanPreview {
  planId: string;
  baseEpoch: number;
  isStale: boolean;
  intent: string;
  rows: PlanPreviewRow[];
  totals: PlanPreviewTotals;
  warnings: string[];
  isValid: boolean;
  error?: EditPlanError;
  filteredPlan: EditPlan;
}

export interface PreviewMarkerRange {
  opIndex: number;
  startMs: number;
  endMs: number;
  kind: EditOp["op"];
}

function timelineDurationMs(clips: Clip[]): number {
  if (clips.length === 0) return 0;
  let maxEnd = 0;
  for (const c of clips) {
    const end = c.startTime + c.duration;
    if (end > maxEnd) maxEnd = end;
  }
  return Math.round(maxEnd * 1000);
}

function getOpTimeRange(op: EditOp): { startMs: number | null; endMs: number | null } {
  switch (op.op) {
    case "deleteRange":
      return { startMs: op.startMs, endMs: op.endMs };
    case "split":
      return { startMs: op.atMs, endMs: op.atMs };
    case "trim":
      return { startMs: op.startMs ?? null, endMs: op.endMs ?? null };
    case "addText":
      return { startMs: op.atMs, endMs: op.atMs + op.durationMs };
  }
}

/**
 * Assigns connected-component group IDs so ops linked via `ref` toggle together,
 * while independent ops (such as `deleteRange`) toggle individually.
 */
export function computeToggleGroups(ops: EditOp[]): number[] {
  const parent = ops.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const refProducer = new Map<string, number>();
  ops.forEach((op, idx) => {
    if (op.op === "split" && op.as) {
      refProducer.set(op.as[0], idx);
      refProducer.set(op.as[1], idx);
    }
  });

  ops.forEach((op, idx) => {
    if ("target" in op && "ref" in op.target) {
      const producer = refProducer.get(op.target.ref);
      if (producer !== undefined) {
        union(producer, idx);
      }
    }
  });

  return ops.map((_, i) => find(i));
}

function diffAffectedClipIds(before: Clip[], after: Clip[]): string[] {
  const beforeMap = new Map(before.map((c) => [c.id, c]));
  const afterMap = new Map(after.map((c) => [c.id, c]));
  const ids = new Set<string>();

  for (const [id, b] of beforeMap) {
    const a = afterMap.get(id);
    if (!a || a.startTime !== b.startTime || a.duration !== b.duration || a.trimIn !== b.trimIn) {
      ids.add(id);
    }
  }
  for (const id of afterMap.keys()) {
    if (!beforeMap.has(id)) ids.add(id);
  }
  return Array.from(ids);
}

/**
 * Computes `PlanPreview` from the compiler's own dry-run trace, never from
 * model-written text.
 */
export function buildPlanPreview(
  plan: EditPlan,
  liveState: TimelineState,
  disabledOpIndices: ReadonlySet<number> = new Set(),
  options?: CompileEditPlanOptions,
): PlanPreview {
  const groups = computeToggleGroups(plan.ops);
  const enabledIndices: number[] = [];
  const enabledOps: EditOp[] = [];

  plan.ops.forEach((op, idx) => {
    if (!disabledOpIndices.has(idx)) {
      enabledIndices.push(idx);
      enabledOps.push(op);
    }
  });

  const filteredPlan: EditPlan = {
    ...plan,
    ops: enabledOps,
  };

  const durationBeforeMs = timelineDurationMs(liveState.clips);
  const isStale = liveState.epoch !== plan.baseEpoch;
  const warnings: string[] = [];

  const compiled = compileEditPlanWithTrace(filteredPlan, liveState, options);
  if (!compiled.ok) {
    warnings.push(compiled.error.message);
    const rows: PlanPreviewRow[] = plan.ops.map((op, opIndex) => {
      const { startMs, endMs } = getOpTimeRange(op);
      return {
        opIndex,
        op,
        enabled: !disabledOpIndices.has(opIndex),
        toggleGroupId: groups[opIndex],
        startMs,
        endMs,
        affectedClipIds: [],
        durationDeltaMs: 0,
      };
    });

    return {
      planId: plan.planId,
      baseEpoch: plan.baseEpoch,
      isStale,
      intent: plan.intent,
      rows,
      totals: {
        durationBeforeMs,
        durationAfterMs: durationBeforeMs,
        durationDeltaMs: 0,
        cutCount: 0,
        enabledOpCount: enabledOps.length,
        totalOpCount: plan.ops.length,
      },
      warnings,
      isValid: false,
      error: compiled.error,
      filteredPlan,
    };
  }

  const traceByOrigIndex = new Map<number, (typeof compiled.trace)[number]>();
  compiled.trace.forEach((entry, filteredIdx) => {
    traceByOrigIndex.set(enabledIndices[filteredIdx], entry);
  });

  const rows: PlanPreviewRow[] = plan.ops.map((op, opIndex) => {
    const { startMs, endMs } = getOpTimeRange(op);
    const entry = traceByOrigIndex.get(opIndex);
    if (!entry) {
      return {
        opIndex,
        op,
        enabled: false,
        toggleGroupId: groups[opIndex],
        startMs,
        endMs,
        affectedClipIds: [],
        durationDeltaMs: 0,
      };
    }
    const beforeMs = timelineDurationMs(entry.beforeClips);
    const afterMs = timelineDurationMs(entry.afterClips);
    return {
      opIndex,
      op,
      enabled: true,
      toggleGroupId: groups[opIndex],
      startMs,
      endMs,
      affectedClipIds: diffAffectedClipIds(entry.beforeClips, entry.afterClips),
      durationDeltaMs: afterMs - beforeMs,
    };
  });

  const durationAfterMs = timelineDurationMs(compiled.finalState.clips);
  const cutCount = enabledOps.filter((op) => op.op === "deleteRange" || op.op === "split").length;

  return {
    planId: plan.planId,
    baseEpoch: plan.baseEpoch,
    isStale,
    intent: plan.intent,
    rows,
    totals: {
      durationBeforeMs,
      durationAfterMs,
      durationDeltaMs: durationAfterMs - durationBeforeMs,
      cutCount,
      enabledOpCount: enabledOps.length,
      totalOpCount: plan.ops.length,
    },
    warnings,
    isValid: true,
    filteredPlan,
  };
}

/**
 * Toggles an op (and any `ref`-linked ops in the same toggle group) and
 * recompiles the filtered plan.
 */
export function togglePlanOp(
  plan: EditPlan,
  liveState: TimelineState,
  disabledOpIndices: ReadonlySet<number>,
  opIndex: number,
  options?: CompileEditPlanOptions,
): { disabledOpIndices: Set<number>; preview: PlanPreview } {
  const groups = computeToggleGroups(plan.ops);
  const targetGroup = groups[opIndex];
  const nextDisabled = new Set(disabledOpIndices);
  const willEnable = nextDisabled.has(opIndex);

  groups.forEach((g, idx) => {
    if (g === targetGroup) {
      if (willEnable) {
        nextDisabled.delete(idx);
      } else {
        nextDisabled.add(idx);
      }
    }
  });

  const preview = buildPlanPreview(plan, liveState, nextDisabled, options);
  return { disabledOpIndices: nextDisabled, preview };
}

/**
 * Extracts pre-edit timeline marker ranges from enabled cuts/splits.
 */
export function getPreviewMarkerRanges(preview: PlanPreview): PreviewMarkerRange[] {
  return preview.rows
    .filter((row) => row.enabled && row.startMs !== null && row.endMs !== null && (row.op.op === "deleteRange" || row.op.op === "split"))
    .map((row) => ({
      opIndex: row.opIndex,
      startMs: row.startMs!,
      endMs: row.endMs!,
      kind: row.op.op,
    }));
}
