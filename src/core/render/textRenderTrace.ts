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

export type TextRenderTracePhase =
  | "session-prewarm"
  | "text-prefetch"
  | "visible-playback";

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

/**
 * Record the expensive part of native text preparation without logging every
 * cheap cached lookup. The phase identifies whether the work raced playback.
 */
export function traceTextRenderTiming(input: {
  phase: TextRenderTracePhase;
  assetId?: string;
  layerId?: string;
  fontFamily?: string;
  fontWaitMs: number;
  rasterMs: number;
  totalMs: number;
}): void {
  void input;
}
