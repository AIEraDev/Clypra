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
  controlValues: Record<string, unknown>;
}

export interface WorkerRenderEffectMessage {
  type: "RENDER_EFFECT";
  id: string;
  sceneDocument: Record<string, unknown>;
  time: number;
  evalWidth: number;
  evalHeight: number;
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
  offsetX: number;
  offsetY: number;
  croppedWidth: number;
  croppedHeight: number;
  /** How long renderTextTemplateToCanvas / renderTextEffectToCanvas + cropping took inside the worker (ms). */
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

function findVisibleBounds(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  padding = 8,
): { left: number; top: number; width: number; height: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (rgba[rowOffset + x * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;

  const left = Math.max(0, minX - padding);
  const top = Math.max(0, minY - padding);
  const right = Math.min(width - 1, maxX + padding);
  const bottom = Math.min(height - 1, maxY + padding);

  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

function createBlankBitmap(): ImageBitmap {
  const blank = new OffscreenCanvas(1, 1);
  const ctx = blank.getContext("2d", { alpha: true });
  ctx?.clearRect(0, 0, 1, 1);
  return blank.transferToImageBitmap();
}

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
    controlValues,
  } = msg;

  const width = Math.max(1, Math.round(layerWidth));
  const height = Math.max(1, Math.round(layerHeight));

  const offscreen = new OffscreenCanvas(width, height);
  const ctx = offscreen.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("OffscreenCanvas 2D context not available");

  ctx.clearRect(0, 0, width, height);

  const rasterStart = performance.now();
  renderTextTemplateToCanvas(ctx, {
    artifact,
    context: {
      environment: "editor",
      time: localTime,
      clipDuration,
      width,
      height,
      controlValues,
    },
  });

  const imgData = ctx.getImageData(0, 0, width, height);
  const bounds = findVisibleBounds(imgData.data, width, height, 8);

  let bitmap: ImageBitmap;
  let offsetX = 0;
  let offsetY = 0;
  let croppedWidth = 1;
  let croppedHeight = 1;

  if (!bounds) {
    bitmap = createBlankBitmap();
  } else {
    offsetX = bounds.left;
    offsetY = bounds.top;
    croppedWidth = Math.max(1, bounds.width);
    croppedHeight = Math.max(1, bounds.height);

    const cropped = new OffscreenCanvas(croppedWidth, croppedHeight);
    const croppedCtx = cropped.getContext("2d", { alpha: true });
    if (croppedCtx) {
      croppedCtx.drawImage(
        offscreen,
        offsetX,
        offsetY,
        croppedWidth,
        croppedHeight,
        0,
        0,
        croppedWidth,
        croppedHeight,
      );
      bitmap = cropped.transferToImageBitmap();
    } else {
      bitmap = offscreen.transferToImageBitmap();
    }
  }

  const workerRasterMs = performance.now() - rasterStart;
  console.log(`[TextRasterizerWorker] Template frame rendered (id=${id}, time=${localTime.toFixed(3)}s, cropped=${croppedWidth}x${croppedHeight}, offset=(${offsetX},${offsetY}), workerMs=${workerRasterMs.toFixed(2)}ms)`);

  (self as unknown as Worker).postMessage(
    {
      type: "FRAME_READY",
      id,
      bitmap,
      offsetX,
      offsetY,
      croppedWidth,
      croppedHeight,
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
  } = msg;

  const width = Math.max(1, Math.round(evalWidth));
  const height = Math.max(1, Math.round(evalHeight));

  const rasterStart = performance.now();
  const evalCanvas = new OffscreenCanvas(width, height);
  const evalCtx = evalCanvas.getContext("2d", { alpha: true });
  if (!evalCtx) throw new Error("OffscreenCanvas 2D context not available");
  evalCtx.clearRect(0, 0, width, height);

  renderTextEffectToCanvas(evalCtx, {
    source: sceneDocument as any,
    context: {
      environment: "editor",
      time,
      width,
      height,
    },
  });

  const imgData = evalCtx.getImageData(0, 0, width, height);
  const bounds = findVisibleBounds(imgData.data, width, height, 16);

  let bitmap: ImageBitmap;
  let offsetX = 0;
  let offsetY = 0;
  let croppedWidth = 1;
  let croppedHeight = 1;

  if (!bounds) {
    bitmap = createBlankBitmap();
    offsetX = Math.round(width / 2);
    offsetY = Math.round(height / 2);
  } else {
    offsetX = bounds.left;
    offsetY = bounds.top;
    croppedWidth = Math.max(1, bounds.width);
    croppedHeight = Math.max(1, bounds.height);

    const cropped = new OffscreenCanvas(croppedWidth, croppedHeight);
    const croppedCtx = cropped.getContext("2d", { alpha: true });
    if (croppedCtx) {
      croppedCtx.drawImage(
        evalCanvas,
        offsetX,
        offsetY,
        croppedWidth,
        croppedHeight,
        0,
        0,
        croppedWidth,
        croppedHeight,
      );
      bitmap = cropped.transferToImageBitmap();
    } else {
      bitmap = evalCanvas.transferToImageBitmap();
    }
  }

  const workerRasterMs = performance.now() - rasterStart;
  console.log(`[TextRasterizerWorker] Effect frame rendered (id=${id}, time=${time.toFixed(3)}s, cropped=${croppedWidth}x${croppedHeight}, offset=(${offsetX},${offsetY}), workerMs=${workerRasterMs.toFixed(2)}ms)`);

  (self as unknown as Worker).postMessage(
    {
      type: "FRAME_READY",
      id,
      bitmap,
      offsetX,
      offsetY,
      croppedWidth,
      croppedHeight,
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
