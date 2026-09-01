import type { PreviewInteractionToken } from "./PreviewInteractionCoordinator";
import { createLatestFrameQueue, type CoalescedFrameQueue } from "./coalescedPointerDrag";

export type TextInvalidationClass = "paint" | "layout" | "raster" | "transform";

export interface InteractiveTextEditMeta {
  operation: "content-edit" | "property-edit" | "resize";
  property?: string;
  invalidation: TextInvalidationClass;
  interactionId: number;
  generation: number;
}

export interface InteractiveTextEditToken {
  readonly clipId: string;
  readonly interactionId: number;
  readonly generation: number;
}

export interface InteractiveTextEditCallbacks {
  apply: (clipId: string, latest: Record<string, unknown>, meta: InteractiveTextEditMeta) => void;
  commit: (
    clipId: string,
    before: Record<string, unknown>,
    latest: Record<string, unknown>,
    meta: InteractiveTextEditMeta & {
      durationMs: number;
      inputToPreviewMs?: number;
      appliedFrames: number;
      renderCount: number;
      cacheHits: number;
      cacheMisses: number;
      stageTimings?: TextInteractionStageTimings;
      stageCoverage: "complete" | "partial" | "unattributed";
      unattributedTimeMs: number;
    },
  ) => void;
}

export interface TextInteractionStageTimings {
  fontWaitMs?: number;
  compileMs?: number;
  rasterMs?: number;
  readbackMs?: number;
  transferMs?: number;
  paintMs?: number;
  totalMs?: number;
}

interface ActiveEdit {
  token: InteractiveTextEditToken;
  previewToken?: PreviewInteractionToken;
  before: Record<string, unknown>;
  latest: Record<string, unknown>;
  meta: InteractiveTextEditMeta;
  startedAtMs: number;
  firstPreviewAtMs?: number;
  appliedFrames: number;
  invalidation: TextInvalidationClass;
  stageSamples: TextInteractionStageTimings[];
  cacheHits: number;
  cacheMisses: number;
}

const INVALIDATION_PRIORITY: Record<TextInvalidationClass, number> = {
  transform: 0,
  paint: 1,
  layout: 2,
  raster: 3,
};

let activeTextCoordinator: InteractiveTextRenderCoordinator | null = null;

/** Called by the render trace after a real interactive preview render. */
export function observeInteractiveTextRender(sample: TextInteractionStageTimings & { cacheHit?: boolean }): void {
  activeTextCoordinator?.observeRender(sample);
}

/**
 * Classifies the cheapest safe invalidation for a text edit. This is kept
 * independent from the raster engine so property editors, WebView scheduling
 * and Native render telemetry share one contract.
 */
export function classifyTextInvalidation(fields: Record<string, unknown>): TextInvalidationClass {
  let result: TextInvalidationClass = "transform";
  for (const key of Object.keys(fields)) {
    const normalized = key.toLowerCase();
    let candidate: TextInvalidationClass;
    if (["x", "y", "rotation", "opacity", "position", "scale"].includes(normalized)) {
      candidate = "transform";
    } else if (["color", "fill", "opacity"].includes(normalized)) {
      candidate = "paint";
    } else if ([
      "text", "maxwidth", "width", "height", "fontfamily", "fontsize",
      "fontweight", "fontstyle", "lineheight", "letterspacing", "align",
      "valign", "textalign", "verticalalign",
    ].includes(normalized)) {
      candidate = "layout";
    } else {
      candidate = "raster";
    }
    if (INVALIDATION_PRIORITY[candidate] > INVALIDATION_PRIORITY[result]) result = candidate;
  }
  return result;
}

/**
 * Single-owner transaction coordinator for high-frequency text editing.
 *
 * It owns only the edit draft and frame coalescing. Store writes happen once
 * per RAF through `apply`; history happens once through `commit`. Transport
 * pause/resume remains owned by PreviewInteractionCoordinator.
 */
export class InteractiveTextRenderCoordinator {
  private callbacks: InteractiveTextEditCallbacks;
  private active: ActiveEdit | null = null;
  private nextId = 0;
  private readonly frameQueue: CoalescedFrameQueue<{ version: number }>;

  constructor(callbacks: InteractiveTextEditCallbacks) {
    this.callbacks = callbacks;
    this.frameQueue = createLatestFrameQueue(() => this.applyLatest());
  }

  setCallbacks(callbacks: InteractiveTextEditCallbacks): void {
    this.callbacks = callbacks;
  }

  begin(input: {
    clipId: string;
    previewToken?: PreviewInteractionToken;
    operation: ActiveEdit["meta"]["operation"];
    property?: string;
    generation?: number;
  }): InteractiveTextEditToken {
    this.cancel();
    const interactionId = input.previewToken?.interactionId ?? ++this.nextId;
    const generation = input.previewToken?.generation ?? input.generation ?? interactionId;
    const token: InteractiveTextEditToken = {
      clipId: input.clipId,
      interactionId,
      generation,
    };
    const invalidation = input.property ? classifyTextInvalidation({ [input.property]: true }) : "raster";
    this.active = {
      token,
      previewToken: input.previewToken,
      before: {},
      latest: {},
      meta: {
        operation: input.operation,
        property: input.property,
        invalidation,
        interactionId,
        generation,
      },
      startedAtMs: typeof performance !== "undefined" ? performance.now() : Date.now(),
      appliedFrames: 0,
      invalidation,
      stageSamples: [],
      cacheHits: 0,
      cacheMisses: 0,
    };
    activeTextCoordinator = this;
    return token;
  }

  isActive(token?: InteractiveTextEditToken): boolean {
    return Boolean(this.active && (!token || this.active.token.interactionId === token.interactionId));
  }

  update(token: InteractiveTextEditToken, patch: Record<string, unknown>, before: Record<string, unknown> = {}): boolean {
    if (!this.active || this.active.token.interactionId !== token.interactionId || this.active.token.clipId !== token.clipId) return false;
    for (const [key, value] of Object.entries(before)) {
      if (!(key in this.active.before)) this.active.before[key] = value;
    }
    Object.assign(this.active.latest, patch);
    const invalidation = classifyTextInvalidation(patch);
    if (INVALIDATION_PRIORITY[invalidation] > INVALIDATION_PRIORITY[this.active.invalidation]) {
      this.active.invalidation = invalidation;
      this.active.meta.invalidation = invalidation;
    }
    this.frameQueue.push({ version: Object.keys(this.active.latest).length + this.active.appliedFrames + Date.now() });
    return true;
  }

  flush(): void {
    if (!this.active) return;
    this.frameQueue.flush();
  }

  finish(commit = true): void {
    const active = this.active;
    if (!active) return;
    this.flush();
    this.active = null;
    if (activeTextCoordinator === this) activeTextCoordinator = null;
    if (!commit) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();

    // Determine stage coverage quality before building the commit payload.
    //
    // "complete": every sample has at minimum rasterMs + totalMs — the render
    //   trace captured a per-stage breakdown for the full interaction.
    // "partial": at least one sample carries a named stage field (raster, compile
    //   or fontWait), but not all samples are fully instrumented.
    // "unattributed": no samples at all, or samples only carry totalMs with no
    //   stage breakdown — nothing useful to attribute.
    const hasSamples = active.stageSamples.length > 0;
    const allHaveCoreStages = hasSamples && active.stageSamples.every(
      (s) => s.rasterMs !== undefined && s.totalMs !== undefined,
    );
    const anyHasNamedStage = hasSamples && active.stageSamples.some(
      (s) =>
        s.rasterMs !== undefined ||
        s.compileMs !== undefined ||
        s.fontWaitMs !== undefined,
    );
    const stageCoverage: "complete" | "partial" | "unattributed" = allHaveCoreStages
      ? "complete"
      : anyHasNamedStage
        ? "partial"
        : "unattributed";

    // unattributedTimeMs is the wall-clock interaction time that cannot be
    // explained by the collected stage samples. It is 0 only when every
    // stage is accounted for (complete coverage). For partial or unattributed
    // coverage the whole duration is considered unaccounted for — this is
    // conservative but avoids falsely claiming attribution that was never measured.
    const unattributedTimeMs = stageCoverage === "complete"
      ? 0
      : Math.max(0, now - active.startedAtMs);

    this.callbacks.commit(active.token.clipId, active.before, active.latest, {
      ...active.meta,
      durationMs: Math.max(0, now - active.startedAtMs),
      inputToPreviewMs: active.firstPreviewAtMs === undefined ? undefined : Math.max(0, active.firstPreviewAtMs - active.startedAtMs),
      appliedFrames: active.appliedFrames,
      renderCount: active.stageSamples.length,
      cacheHits: active.cacheHits,
      cacheMisses: active.cacheMisses,
      stageTimings: percentileStages(active.stageSamples),
      stageCoverage,
      unattributedTimeMs,
    });
  }

  cancel(): void {
    this.frameQueue.cancel();
    if (activeTextCoordinator === this) activeTextCoordinator = null;
    this.active = null;
  }

  dispose(): void {
    this.frameQueue.dispose();
    this.active = null;
  }

  getPreviewToken(): PreviewInteractionToken | undefined {
    return this.active?.previewToken;
  }

  getActiveToken(): InteractiveTextEditToken | undefined {
    return this.active?.token;
  }

  private applyLatest(): void {
    const active = this.active;
    if (!active || Object.keys(active.latest).length === 0) return;
    if (active.firstPreviewAtMs === undefined) {
      active.firstPreviewAtMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    }
    active.appliedFrames += 1;
    this.callbacks.apply(active.token.clipId, { ...active.latest }, {
      ...active.meta,
      invalidation: active.invalidation,
    });
  }

  observeRender(sample: TextInteractionStageTimings & { cacheHit?: boolean }): void {
    if (!this.active) return;
    this.active.stageSamples.push(sample);
    if (sample.cacheHit) this.active.cacheHits += 1;
    else this.active.cacheMisses += 1;
    if (this.active.firstPreviewAtMs === undefined) {
      this.active.firstPreviewAtMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    }
  }
}

function percentileStages(samples: TextInteractionStageTimings[]): TextInteractionStageTimings | undefined {
  if (samples.length === 0) return undefined;
  const result: TextInteractionStageTimings = {};
  for (const key of ["fontWaitMs", "compileMs", "rasterMs", "readbackMs", "transferMs", "paintMs", "totalMs"] as const) {
    const values = samples.map((sample) => sample[key]).filter((value): value is number => typeof value === "number");
    if (values.length === 0) continue;
    values.sort((a, b) => a - b);
    result[key] = values[Math.min(values.length - 1, Math.round((values.length - 1) * 0.95))];
  }
  return result;
}
