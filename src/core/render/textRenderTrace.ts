import {
  telemetryCollector,
  type TelemetryTextKind,
  type TelemetryTextRendererPath,
  type TelemetryTextPhase,
} from "@/services/telemetryCollector";

export interface TextRenderTraceLayer {
  id?: string;
  type?: string;
  enabled?: boolean;
  opacity?: number;
  params?: Record<string, unknown>;
}

export interface TextRenderTraceScene {
  schemaVersion?: number;
  revision?: {
    assetId?: string;
    revisionId?: string;
    contentHash?: string;
    rendererVersion?: string;
  };
  canvas?: {
    width?: number;
    height?: number;
    background?: string;
    backgroundConfig?: unknown;
  };
  text?: {
    content?: string;
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
  };
  compositor?: unknown;
  effectLayers?: TextRenderTraceLayer[];
  legacyConfig?: unknown;
}

export interface TextRenderTraceContext {
  path: "source-preview" | "program-preview" | "export";
  assetId?: string;
  category?: string;
  revisionId?: string;
  contentHash?: string;
  time?: number;
}

export type TextRenderTracePhase = Exclude<TelemetryTextPhase, "interactive-preview">;
export type TextRenderKind = TelemetryTextKind;
export type TextRenderPath = TelemetryTextRendererPath;

/**
 * Text diagnostics are intentionally silent. Text performance is captured by
 * the structured native telemetry path; console tracing here caused large
 * object serialization and made first-use playback less representative.
 */
export function traceTextRenderScene(
  scene: TextRenderTraceScene,
  context: TextRenderTraceContext,
): void {
  void scene;
  void context;
}

export function resetTextRenderTrace(): void {
  // Kept as a compatibility no-op for existing render call sites.
}

/** Preserve the call-site contract without emitting console diagnostics. */
export function traceTextRenderGeometry(input: {
  path: TextRenderTraceContext["path"];
  assetId?: string;
  revisionId?: string;
  contentHash?: string;
  layer: Record<string, unknown>;
  render: Record<string, unknown>;
  authoredCanvas?: unknown;
}): void {
  void input;
}

export function traceTextRenderTiming(input: {
  phase: TextRenderTracePhase;
  kind: TextRenderKind;
  rendererPath: TextRenderPath;
  assetId?: string;
  layerId?: string;
  fontFamily?: string;
  fontWaitMs: number;
  rasterMs: number;
  readbackMs?: number;
  transferMs?: number;
  paintMs?: number;
  outputPixels?: number;
  cacheHit?: boolean;
  totalMs: number;
}): void {
  const activeSession = (globalThis as { __activeProjectSession?: { sessionId?: string } }).__activeProjectSession;
  telemetryCollector.recordTextRender({
    kind: input.kind,
    rendererPath: input.rendererPath,
    phase: input.phase,
    sessionId: activeSession?.sessionId,
    fontWaitUs: Math.round(Math.max(0, input.fontWaitMs) * 1000),
    rasterUs: Math.round(Math.max(0, input.rasterMs) * 1000),
    readbackUs: input.readbackMs === undefined ? undefined : Math.round(Math.max(0, input.readbackMs) * 1000),
    transferUs: input.transferMs === undefined ? undefined : Math.round(Math.max(0, input.transferMs) * 1000),
    paintUs: input.paintMs === undefined ? undefined : Math.round(Math.max(0, input.paintMs) * 1000),
    outputPixels: input.outputPixels,
    cacheHit: input.cacheHit ?? false,
    totalTimeUs: Math.round(Math.max(0, input.totalMs) * 1000),
  });
}

export function traceTextRenderCacheHit(input: {
  kind: TextRenderKind;
  rendererPath: TextRenderPath;
  phase: TextRenderTracePhase;
}): void {
  const activeSession = (globalThis as { __activeProjectSession?: { sessionId?: string } }).__activeProjectSession;
  telemetryCollector.recordTextCacheHit({ ...input, sessionId: activeSession?.sessionId });
}
