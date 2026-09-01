/**
 * Template Rasterizer Worker
 *
 * Runs renderTextTemplateToCanvas entirely off the main thread using
 * OffscreenCanvas. Eliminates the main-thread stall that caused Program
 * Preview to freeze during animated text template playback.
 *
 * Architecture:
 *   Main thread          →  Worker
 *   RENDER_FRAME msg     →  renderTextTemplateToCanvas (OffscreenCanvas)
 *                              ↓
 *   FRAME_READY msg      ←  transferToImageBitmap()   [zero-copy GPU transfer]
 *
 * The worker is stateless between frames — each RENDER_FRAME message is
 * independent. The LatestTextPreparationScheduler on the main thread ensures
 * at most one active + one pending job, preventing queue buildup.
 *
 * Message protocol (main → worker):
 *   { type: 'RENDER_FRAME'; id: string; artifact: TextTemplateArtifact;
 *     localTime: number; clipDuration: number | undefined;
 *     canvasWidth: number; canvasHeight: number;
 *     controlValues: Record<string, unknown>; }
 *   { type: 'DISPOSE' }
 *
 * Message protocol (worker → main):
 *   { type: 'FRAME_READY'; id: string; bitmap: ImageBitmap;
 *     canvasWidth: number; canvasHeight: number; }
 *   { type: 'FRAME_FAILED'; id: string; error: string; }
 */

import {
  renderTextTemplateToCanvas,
  type TextTemplateArtifact,
} from "@clypra-studio/engine";

// ─── Message types ────────────────────────────────────────────────────────────

export interface WorkerRenderFrameMessage {
  type: "RENDER_FRAME";
  /** Opaque request ID — echoed back in the response so the caller can match it. */
  id: string;
  /** The resolved TextTemplateArtifact from the clip's embedded templateSnapshot. */
  artifact: TextTemplateArtifact;
  /** layer.time - layer.clipStartTime — the local playback offset within the clip. */
  localTime: number;
  /** layer.clipDuration — used by the template engine for animation timing. */
  clipDuration: number | undefined;
  /** Canvas dimensions (bleed-inclusive raster size). */
  canvasWidth: number;
  canvasHeight: number;
  /**
   * Resolved control values (text content, colors) from the clip's
   * customization + templateControlValues merged by the evaluator.
   */
  controlValues: Record<string, unknown>;
}

export interface WorkerDisposeMessage {
  type: "DISPOSE";
}

export type WorkerInboundMessage = WorkerRenderFrameMessage | WorkerDisposeMessage;

export interface WorkerFrameReadyMessage {
  type: "FRAME_READY";
  id: string;
  /** Zero-copy GPU-resident bitmap. Transferred, not copied. */
  bitmap: ImageBitmap;
  canvasWidth: number;
  canvasHeight: number;
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

self.onmessage = async (
  event: MessageEvent<WorkerInboundMessage>,
): Promise<void> => {
  const msg = event.data;

  if (msg.type === "DISPOSE") {
    self.close();
    return;
  }

  if (msg.type !== "RENDER_FRAME") return;

  const {
    id,
    artifact,
    localTime,
    clipDuration,
    canvasWidth,
    canvasHeight,
    controlValues,
  } = msg;

  try {
    // OffscreenCanvas is available in all Worker contexts on modern browsers
    // and the WKWebView runtime used by Tauri.
    const offscreen = new OffscreenCanvas(canvasWidth, canvasHeight);
    const ctx = offscreen.getContext("2d", { alpha: true });
    if (!ctx) {
      throw new Error("OffscreenCanvas 2D context not available in worker");
    }

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // renderTextTemplateToCanvas uses only Canvas 2D APIs — no DOM, no window,
    // no document. It is fully Worker-safe.
    renderTextTemplateToCanvas(ctx, {
      artifact,
      context: {
        environment: "editor",
        time: localTime,
        clipDuration,
        width: canvasWidth,
        height: canvasHeight,
        controlValues,
      },
    });

    // transferToImageBitmap() is a zero-copy GPU transfer — the OffscreenCanvas
    // pixel data moves to the ImageBitmap without touching the JS heap.
    // The ImageBitmap is then transferred back to the main thread via
    // postMessage transfer list, again zero-copy.
    const bitmap = offscreen.transferToImageBitmap();

    const response: WorkerFrameReadyMessage = {
      type: "FRAME_READY",
      id,
      bitmap,
      canvasWidth,
      canvasHeight,
    };

    // Transfer the bitmap ownership to the main thread.
    // After this, `bitmap` is neutered in the worker.
    (self as unknown as Worker).postMessage(response, [bitmap]);
  } catch (error) {
    const response: WorkerFrameFailedMessage = {
      type: "FRAME_FAILED",
      id,
      error: error instanceof Error ? error.message : String(error),
    };
    (self as unknown as Worker).postMessage(response);
  }
};
