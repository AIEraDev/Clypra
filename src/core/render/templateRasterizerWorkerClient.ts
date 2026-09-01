/**
 * Template Rasterizer Worker Client
 *
 * Main-thread façade over the OffscreenCanvas worker that renders animated
 * text templates. Moves renderTextTemplateToCanvas off the JS main thread so
 * it can never stall React, RAF scheduling, or Tauri IPC during playback.
 *
 * API contract:
 *   client.rasterize(layer, rasterKey, phase) → Promise<NativeTextRasterAsset>
 *
 * The returned NativeTextRasterAsset is identical in shape to what
 * rasterizeTextLayerForNative produces — existing callers in nativeRasterBridge
 * require no type changes.
 *
 * Internal flow:
 *   1. Resolve artifact from layer.templateSnapshot (sync, main thread)
 *   2. Compute bleed/geometry via getCachedLayoutMetrics (sync, 32-entry LRU)
 *   3. Compute control values from layer customization (sync)
 *   4. Send RENDER_FRAME to Worker → Worker renders on OffscreenCanvas
 *   5. Receive ImageBitmap (zero-copy GPU transfer from Worker)
 *   6. Draw ImageBitmap to a local OffscreenCanvas → getImageData → Uint8ClampedArray
 *      (this readback is ~1ms and happens once per unique raster key, not every frame)
 *   7. Apply cached crop geometry (no per-frame pixel scan)
 *   8. Return NativeTextRasterAsset
 *
 * Deduplication:
 *   Requests with the same rasterKey share one promise — the worker only
 *   renders each unique key once regardless of how many callers await it.
 *   (Same semantics as the existing textCache in NativeRasterBridge.)
 *
 * Fallback:
 *   If OffscreenCanvas or Worker is unavailable (old browser / test env),
 *   falls back to rasterizeTextLayerForNative on the main thread. The caller
 *   cannot observe the difference.
 */

import { resolveTextTemplateArtifact } from "@clypra-studio/engine";
import type { EvaluatedTextLayer } from "@/core/evaluation/types";
import type { TextRenderTracePhase } from "@/core/render/textRenderTrace";
import type { NativeTextRasterAsset } from "@/components/editor/preview/nativeTextPreview";
import {
  buildNativeTextRasterKey,
  buildNativeTextLayoutKey,
  getCachedLayoutMetrics,
  getTemplateCropCacheKey,
  cropTemplateAsset,
  _clearTemplateCropGeometryCache,
} from "@/components/editor/preview/nativeTextPreview";
import type {
  WorkerRenderFrameMessage,
  WorkerOutboundMessage,
} from "@/workers/templateRasterizer.worker";

export { _clearTemplateCropGeometryCache };

// ─── Control value resolution (mirrors textRasterizer.ts templateControlValues) ──

function resolveControlValues(
  layer: EvaluatedTextLayer,
  artifact: NonNullable<ReturnType<typeof resolveTextTemplateArtifact>>,
): Record<string, unknown> {
  const customization = layer.customization;
  const values: Record<string, unknown> = { ...(layer.templateControlValues || {}) };
  for (const control of artifact.controls) {
    if (control.type !== "text" && control.type !== "color") continue;
    const node = artifact.document.nodes.find(
      (candidate: any) => candidate.id === control.target.nodeId,
    ) as any;
    const role = node?.role || "";
    if (control.type === "text") {
      values[control.id] =
        customization?.layerTexts?.[control.target.nodeId] ??
        (role === "primary"
          ? customization?.primaryText
          : role === "secondary"
            ? customization?.secondaryText
            : role === "accent"
              ? customization?.accentText
              : undefined) ??
        values[control.id] ??
        control.defaultValue;
    } else {
      values[control.id] =
        customization?.layerColors?.[control.target.nodeId] ??
        (role === "secondary"
          ? customization?.secondaryColor
          : customization?.primaryColor) ??
        values[control.id] ??
        control.defaultValue;
    }
  }
  return values;
}

// ─── ImageBitmap → Uint8ClampedArray readback ─────────────────────────────────

/**
 * Draw an ImageBitmap to a temporary OffscreenCanvas and read back its pixels.
 * This is the only place we touch pixel memory on the main thread for templates.
 * It runs once per unique raster key (deduped by the pending map) — not every frame.
 */
function imageBitmapToRgba(
  bitmap: ImageBitmap,
): Uint8ClampedArray {
  const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = offscreen.getContext("2d", { alpha: true })!;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
}

// ─── TemplateRasterizerWorkerClient ──────────────────────────────────────────

// Auto-incrementing ID for correlating request/response messages.
let nextRequestId = 0;

/** Whether the current environment supports OffscreenCanvas + Worker. */
function isWorkerEnvironmentAvailable(): boolean {
  return (
    typeof OffscreenCanvas !== "undefined" &&
    typeof Worker !== "undefined"
  );
}

export class TemplateRasterizerWorkerClient {
  private worker: Worker | null = null;
  /** Pending promises keyed by request ID. */
  private readonly pending = new Map<
    string,
    { resolve: (bitmap: ImageBitmap) => void; reject: (err: Error) => void }
  >();
  /**
   * Deduplication: maps rasterKey → in-flight Promise<NativeTextRasterAsset>.
   * Multiple callers awaiting the same raster key share one worker round-trip.
   */
  private readonly inFlight = new Map<
    string,
    Promise<NativeTextRasterAsset>
  >();
  private disposed = false;
  private workerAvailable: boolean;

  constructor() {
    this.workerAvailable = isWorkerEnvironmentAvailable();
    if (this.workerAvailable) {
      this.initWorker();
    }
  }

  private initWorker(): void {
    try {
      // Vite bundles the worker via the `?worker` import convention but we
      // use the explicit URL form here so the worker is code-split by Vite
      // (same pattern as the mediapipe worker in this project).
      this.worker = new Worker(
        new URL("@/workers/templateRasterizer.worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = this.handleMessage.bind(this);
      this.worker.onerror = (e) => {
        console.error("[TemplateRasterizerWorkerClient] Worker error:", e);
        // Reject all pending requests so callers fall back.
        for (const [, { reject }] of this.pending) {
          reject(new Error("Worker error: " + e.message));
        }
        this.pending.clear();
        this.inFlight.clear();
        // Mark unavailable — rasterize() will fall back to main-thread path.
        this.workerAvailable = false;
        this.worker = null;
      };
    } catch {
      this.workerAvailable = false;
    }
  }

  private handleMessage(event: MessageEvent<WorkerOutboundMessage>): void {
    const msg = event.data;
    const callbacks = this.pending.get(msg.id);
    if (!callbacks) return;
    this.pending.delete(msg.id);

    if (msg.type === "FRAME_READY") {
      callbacks.resolve(msg.bitmap);
    } else {
      callbacks.reject(new Error(msg.error));
    }
  }

  /**
   * Rasterize one EvaluatedTextLayer (template path only).
   *
   * Returns a NativeTextRasterAsset with the same shape as the existing
   * rasterizeTextLayerForNative output. Falls back to main-thread rasterization
   * when the worker is unavailable.
   */
  async rasterize(
    layer: EvaluatedTextLayer,
    rasterKey: string,
    phase: TextRenderTracePhase,
  ): Promise<NativeTextRasterAsset> {
    // Deduplication: return the existing promise for the same raster key.
    const existing = this.inFlight.get(rasterKey);
    if (existing) return existing;

    const promise = this._rasterizeOnce(layer, rasterKey, phase);
    this.inFlight.set(rasterKey, promise);
    void promise.finally(() => this.inFlight.delete(rasterKey));
    return promise;
  }

  private async _rasterizeOnce(
    layer: EvaluatedTextLayer,
    rasterKey: string,
    phase: TextRenderTracePhase,
  ): Promise<NativeTextRasterAsset> {
    const totalStartedAt = performance.now();

    // ── Resolve artifact (sync, main thread) ────────────────────────────────
    const artifact = resolveTextTemplateArtifact(layer.templateSnapshot);
    if (!artifact) {
      // No embedded snapshot — fall back to full main-thread rasterizer
      // which handles lazy-loading from catalog.
      const { rasterizeTextLayerForNative } = await import(
        "@/components/editor/preview/nativeTextPreview"
      );
      return rasterizeTextLayerForNative(layer, { phase });
    }

    // ── Geometry (sync, 32-entry LRU cache) ─────────────────────────────────
    const layoutKey = buildNativeTextLayoutKey(layer);
    const { bleedX, bleedY, rasterWidth, rasterHeight } =
      getCachedLayoutMetrics(layer, layoutKey);

    // The worker renders using composition-space (0,0) coordinates, applying
    // the same translate(-width/2, -height/2) as renderTemplateArtifact in
    // textRasterizer.ts. Pass the full raster canvas dimensions.
    const canvasWidth = rasterWidth;
    const canvasHeight = rasterHeight;

    // ── Worker path ──────────────────────────────────────────────────────────
    if (this.workerAvailable && this.worker && !this.disposed) {
      const bitmap = await this.sendToWorker({
        artifact,
        localTime:
          layer.time !== undefined && layer.clipStartTime !== undefined
            ? layer.time - layer.clipStartTime
            : 0,
        clipDuration: layer.clipDuration,
        canvasWidth,
        canvasHeight,
        controlValues: resolveControlValues(layer, artifact),
      });

      // Readback: ImageBitmap → Uint8ClampedArray (once per unique raster key)
      const rgba = imageBitmapToRgba(bitmap);
      bitmap.close(); // Release GPU memory; we have the pixel copy.

      // Apply cached crop geometry (no per-frame pixel scan)
      const cropKey = getTemplateCropCacheKey(layer);
      const cropped = cropKey
        ? cropTemplateAsset(rgba, canvasWidth, canvasHeight, cropKey)
        : null;

      const totalMs = performance.now() - totalStartedAt;

      return {
        assetId: `native-text:${layer.layerId}:${hashRasterKey(rasterKey)}`,
        rgba: cropped?.rgba ?? rgba,
        width: cropped?.width ?? canvasWidth,
        height: cropped?.height ?? canvasHeight,
        x: cropped
          ? layer.x - bleedX + cropped.offsetX
          : layer.x - bleedX,
        y: cropped
          ? layer.y - bleedY + cropped.offsetY
          : layer.y - bleedY,
        rotation: layer.rotation,
        opacity: layer.opacity,
        zIndex: layer.zIndex,
        blendMode: layer.blendMode,
        isText: true,
        ...(cropped ? { positionMode: "absolute" as const } : {}),
        bleedX,
        bleedY,
        timing: {
          phase,
          kind: "template",
          rendererPath: "native-raster",
          fontWaitMs: 0,
          rasterMs: totalMs,
          readbackMs: 0,
          totalMs,
          outputPixels: canvasWidth * canvasHeight,
          operation: layer.animationOperation ?? "render",
          contentLength: layer.text.length,
          lineCount: Math.max(1, layer.text.split("\n").length),
          layoutWidth: layer.width,
          layoutHeight: layer.height,
        },
      };
    }

    // ── Fallback: main-thread rasterizer (worker unavailable) ────────────────
    const { rasterizeTextLayerForNative } = await import(
      "@/components/editor/preview/nativeTextPreview"
    );
    return rasterizeTextLayerForNative(layer, { phase });
  }

  /**
   * Send a render request to the Worker and await the ImageBitmap response.
   */
  private sendToWorker(
    params: Omit<WorkerRenderFrameMessage, "type" | "id">,
  ): Promise<ImageBitmap> {
    return new Promise<ImageBitmap>((resolve, reject) => {
      if (!this.worker || this.disposed) {
        reject(new Error("Worker not available"));
        return;
      }
      const id = String(++nextRequestId);
      this.pending.set(id, { resolve, reject });
      const msg: WorkerRenderFrameMessage = { type: "RENDER_FRAME", id, ...params };
      this.worker.postMessage(msg);
    });
  }

  /**
   * Terminate the Worker and reject all pending requests.
   * Call when the owning session is disposed.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [, { reject }] of this.pending) {
      reject(new Error("TemplateRasterizerWorkerClient disposed"));
    }
    this.pending.clear();
    this.inFlight.clear();
    if (this.worker) {
      this.worker.postMessage({ type: "DISPOSE" });
      this.worker.terminate();
      this.worker = null;
    }
  }
}

// ─── FNV-1a 32-bit hash (matches hashTextRasterKey in nativeTextPreview.ts) ──

function hashRasterKey(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
