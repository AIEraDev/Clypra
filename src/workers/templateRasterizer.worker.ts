/**
 * Text Rasterizer Worker
 *
 * Renders text templates and styled text effects entirely off the main thread
 * using OffscreenCanvas. Eliminates the main-thread stalls that caused Program
 * Preview to freeze during animated text playback.
 *
 * Rendering paths handled here:
 *   RENDER_TEMPLATE — renderTextTemplateToCanvas (animated text templates)
 *   RENDER_EFFECT   — renderTextEffectToCanvas   (styled text effects with animations)
 *
 * Plain text (no templateId, no styleId) is NOT routed here — it is static,
 * rasterizes once, and costs <2ms. The main-thread overhead of a Worker
 * round-trip would exceed the savings.
 *
 * Architecture (same for both types):
 *   Main thread          →  Worker
 *   RENDER_* msg         →  render on OffscreenCanvas
 *                              ↓
 *   FRAME_READY msg      ←  transferToImageBitmap()   [zero-copy GPU transfer]
 *
 * The worker is stateless between frames — each message is independent.
 * The LatestTextPreparationScheduler on the main thread enforces
 * at most one active + one pending job, preventing queue buildup.
 *
 * ── Message protocol ─────────────────────────────────────────────────────────
 *
 * Main → Worker:
 *   RENDER_TEMPLATE  { id, artifact, localTime, clipDuration, canvasWidth,
 *                      canvasHeight, controlValues }
 *   RENDER_EFFECT    { id, sceneDocument, time, canvasWidth, canvasHeight }
 *   DISPOSE
 *
 * Worker → Main:
 *   FRAME_READY      { id, bitmap, canvasWidth, canvasHeight }
 *   FRAME_FAILED     { id, error }
 */

import {
  renderTextTemplateToCanvas,
  renderTextEffectToCanvas,
  type TextTemplateArtifact,
} from "@clypra-studio/engine";

// ─── Message types ────────────────────────────────────────────────────────────

export interface WorkerRenderTemplateMessage {
  type: "RENDER_TEMPLATE";
  id: string;
  artifact: TextTemplateArtifact;
  localTime: number;
  clipDuration: number | undefined;
  layerWidth: number;
  layerHeight: number;
  bleedX: number;
  bleedY: number;
  rasterWidth: number;
  rasterHeight: number;
  controlValues: Record<string, unknown>;
}

export interface WorkerRenderEffectMessage {
  type: "RENDER_EFFECT";
  id: string;
  /**
   * The fully-resolved SceneDocument with all text/typography fields already
   * injected by the main thread. The worker does NOT touch stores or perform
   * any data resolution — it only calls renderTextEffectToCanvas.
   */
  sceneDocument: Record<string, unknown>;
  /** Playhead time for animated effects (layer.time ?? 0). */
  time: number;
  evalWidth: number;
  evalHeight: number;
  rasterWidth: number;
  rasterHeight: number;
  bleedX: number;
  bleedY: number;
}

export interface WorkerDisposeMessage {
  type: "DISPOSE";
}

export type WorkerInboundMessage =
  | WorkerRenderTemplateMessage
  | WorkerRenderEffectMessage
  | WorkerDisposeMessage;

export interface WorkerFrameReadyMessage {
  type: "FRAME_READY";
  id: string;
  bitmap: ImageBitmap;
  canvasWidth: number;
  canvasHeight: number;
  /** How long renderTextTemplateToCanvas / renderTextEffectToCanvas took inside the worker (ms). */
  workerRasterMs: number;
}

export interface WorkerFrameFailedMessage {
  type: "FRAME_FAILED";
  id: string;
  error: string;
}

export type WorkerOutboundMessage =
  | WorkerFrameReadyMessage
  | WorkerFrameFailedMessage;

// ─── Worker implementation ────────────────────────────────────────────────────

async function handleRenderTemplate(
  msg: WorkerRenderTemplateMessage,
): Promise<void> {
  const {
    id,
    artifact,
    localTime,
    clipDuration,
    layerWidth,
    layerHeight,
    bleedX,
    bleedY,
    rasterWidth,
    rasterHeight,
    controlValues,
  } = msg;

  const offscreen = new OffscreenCanvas(rasterWidth, rasterHeight);
  const ctx = offscreen.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("OffscreenCanvas 2D context not available");

  ctx.clearRect(0, 0, rasterWidth, rasterHeight);

  // renderTextTemplateToCanvas uses only Canvas 2D APIs — Worker-safe.
  const rasterStart = performance.now();
  ctx.save();
  ctx.translate(bleedX, bleedY);
  renderTextTemplateToCanvas(ctx, {
    artifact,
    context: {
      environment: "editor",
      time: localTime,
      clipDuration,
      width: layerWidth,
      height: layerHeight,
      controlValues,
    },
  });
  ctx.restore();
  const workerRasterMs = performance.now() - rasterStart;

  const bitmap = offscreen.transferToImageBitmap();
  console.log(`[TextRasterizerWorker] Template frame rendered (id=${id}, time=${localTime.toFixed(3)}s, size=${rasterWidth}x${rasterHeight}, rasterMs=${workerRasterMs.toFixed(2)}ms)`);

  (self as unknown as Worker).postMessage(
    {
      type: "FRAME_READY",
      id,
      bitmap,
      canvasWidth: rasterWidth,
      canvasHeight: rasterHeight,
      workerRasterMs,
    } satisfies WorkerFrameReadyMessage,
    [bitmap],
  );
}

async function handleRenderEffect(
  msg: WorkerRenderEffectMessage,
): Promise<void> {
  const {
    id,
    sceneDocument,
    time,
    evalWidth,
    evalHeight,
    rasterWidth,
    rasterHeight,
  } = msg;

  const rasterStart = performance.now();
  // 1. Render the canonical effect to an evalWidth x evalHeight canvas
  const evalCanvas = new OffscreenCanvas(evalWidth, evalHeight);
  const evalCtx = evalCanvas.getContext("2d", { alpha: true });
  if (!evalCtx) throw new Error("OffscreenCanvas 2D context not available");
  evalCtx.clearRect(0, 0, evalWidth, evalHeight);

  renderTextEffectToCanvas(evalCtx, {
    source: sceneDocument as any,
    context: {
      environment: "editor",
      time,
      width: evalWidth,
      height: evalHeight,
    },
  });

  // 2. Draw centered onto the target rasterWidth x rasterHeight canvas
  const targetCanvas = new OffscreenCanvas(rasterWidth, rasterHeight);
  const targetCtx = targetCanvas.getContext("2d", { alpha: true });
  if (!targetCtx) throw new Error("OffscreenCanvas 2D context not available");
  targetCtx.clearRect(0, 0, rasterWidth, rasterHeight);
  targetCtx.drawImage(
    evalCanvas,
    (rasterWidth - evalWidth) / 2,
    (rasterHeight - evalHeight) / 2,
  );
  const workerRasterMs = performance.now() - rasterStart;

  const bitmap = targetCanvas.transferToImageBitmap();
  console.log(`[TextRasterizerWorker] Effect frame rendered (id=${id}, time=${time.toFixed(3)}s, size=${rasterWidth}x${rasterHeight}, rasterMs=${workerRasterMs.toFixed(2)}ms)`);

  (self as unknown as Worker).postMessage(
    {
      type: "FRAME_READY",
      id,
      bitmap,
      canvasWidth: rasterWidth,
      canvasHeight: rasterHeight,
      workerRasterMs,
    } satisfies WorkerFrameReadyMessage,
    [bitmap],
  );
}

self.onmessage = async (
  event: MessageEvent<WorkerInboundMessage>,
): Promise<void> => {
  const msg = event.data;

  if (msg.type === "DISPOSE") {
    console.log("[TextRasterizerWorker] Disposing worker");
    self.close();
    return;
  }

  try {
    if (msg.type === "RENDER_TEMPLATE") {
      await handleRenderTemplate(msg);
    } else if (msg.type === "RENDER_EFFECT") {
      await handleRenderEffect(msg);
    }
  } catch (error) {
    console.error(`[TextRasterizerWorker] Render failed for ${msg.type} (id=${(msg as { id: string }).id}):`, error);
    (self as unknown as Worker).postMessage({
      type: "FRAME_FAILED",
      id: (msg as { id: string }).id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies WorkerFrameFailedMessage);
  }
};
