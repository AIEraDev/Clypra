/**
 * Text Rasterizer Worker Client
 *
 * Main-thread façade over the OffscreenCanvas worker that renders animated
 * text templates and styled text effects off the main JS thread.
 *
 * Why only templates and effects (not plain text):
 *   Plain text is static — its raster key excludes `time`, so it rasterizes
 *   once and the cached result is reused for the entire clip duration. A Worker
 *   round-trip (~0.1ms overhead) would exceed the rendering cost (~1–2ms).
 *   Templates and effects can be animated (per-frame cache misses) and their
 *   render cost is 20–100ms, making off-thread rendering essential.
 *
 * API:
 *   client.rasterize(layer, rasterKey, phase)
 *     → Promise<NativeTextRasterAsset>   — template path
 *
 *   client.rasterizeEffect(layer, resolvedSceneDoc, rasterKey, phase)
 *     → Promise<NativeTextRasterAsset>   — effect path
 *     The caller (nativeTextPreview / nativeRasterBridge) resolves the
 *     SceneDocument on the main thread before passing it here, so the worker
 *     never needs to access Zustand stores.
 *
 * Fallback:
 *   When OffscreenCanvas or Worker is unavailable (test env, old browser),
 *   both methods fall back to the main-thread rasterizer transparently.
 *
 * Deduplication:
 *   An `inFlight` map keyed by rasterKey ensures the same frame is never
 *   rendered twice concurrently, regardless of how many callers await it.
 */

import { resolveTextTemplateArtifact } from "@clypra-studio/engine";
import type { EvaluatedTextLayer } from "@/core/evaluation/types";
import {
  type TextRenderTracePhase,
  traceTextRenderCacheHit,
} from "@/core/render/textRenderTrace";
import { resolveTemplateControlValues } from "@/lib/text/templateControls";
import type { NativeTextRasterAsset } from "@/components/editor/preview/nativeTextPreview";
import {
  buildNativeTextLayoutKey,
  getCachedLayoutMetrics,
  getTemplateCropCacheKey,
  cropTemplateAsset,
  _clearTemplateCropGeometryCache,
} from "@/components/editor/preview/nativeTextPreview";
import type {
  WorkerRenderTemplateMessage,
  WorkerRenderEffectMessage,
  WorkerOutboundMessage,
} from "@/workers/templateRasterizer.worker";

export { _clearTemplateCropGeometryCache };

// ─── Control value resolution (mirrors textRasterizer.ts templateControlValues) ──

function resolveControlValues(
  layer: EvaluatedTextLayer,
  artifact: NonNullable<ReturnType<typeof resolveTextTemplateArtifact>>,
): Record<string, unknown> {
  return resolveTemplateControlValues(artifact, {
    customization: layer.customization,
    templateControlValues: layer.templateControlValues,
    fallbackText: layer.text,
  });
}

// ─── ImageBitmap → Uint8ClampedArray readback ─────────────────────────────────

/**
 * Draw an ImageBitmap to a temporary OffscreenCanvas and read back pixels.
 * Runs once per unique raster key (deduped by `inFlight`), not every frame.
 * Cost: ~1ms for a typical 640×360 raster — negligible vs. off-thread savings.
 */
function imageBitmapToRgba(bitmap: ImageBitmap): Uint8ClampedArray {
  const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = offscreen.getContext("2d", { alpha: true })!;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
}

// ─── Shared result builder ────────────────────────────────────────────────────

function buildAsset(
  bitmap: ImageBitmap,
  layer: EvaluatedTextLayer,
  offsetX: number,
  offsetY: number,
  rasterKey: string,
  phase: TextRenderTracePhase,
  kind: "template" | "effect",
  evalWidth: number,
  evalHeight: number,
  totalMs: number,
  workerRasterMs: number,
  transferMs: number,
): NativeTextRasterAsset {
  const readbackStart = performance.now();
  const rgba = imageBitmapToRgba(bitmap);
  const readbackMs = performance.now() - readbackStart;
  const width = bitmap.width;
  const height = bitmap.height;
  bitmap.close();

  let x: number;
  let y: number;

  if (kind === "template") {
    x = layer.x + offsetX;
    y = layer.y + offsetY;
  } else {
    // For effects: the uncropped evalCanvas center was (evalWidth/2, evalHeight/2)
    // which aligns with project space center (layer.x + layer.width/2, layer.y + layer.height/2).
    const evalCanvasOriginX = layer.x + layer.width / 2 - evalWidth / 2;
    const evalCanvasOriginY = layer.y + layer.height / 2 - evalHeight / 2;
    x = evalCanvasOriginX + offsetX;
    y = evalCanvasOriginY + offsetY;
  }

  return {
    assetId: `native-text:${layer.layerId}:${hashRasterKey(rasterKey)}`,
    rgba,
    width,
    height,
    x,
    y,
    rotation: layer.rotation,
    opacity: layer.opacity,
    zIndex: layer.zIndex,
    blendMode: layer.blendMode,
    isText: true,
    positionMode: "absolute",
    bleedX: 0,
    bleedY: 0,
    timing: {
      phase,
      kind,
      rendererPath: "native-raster",
      fontWaitMs: 0,
      rasterMs: workerRasterMs,
      readbackMs,
      transferMs,
      totalMs,
      outputPixels: width * height,
      operation: layer.animationOperation ?? "render",
      contentLength: layer.text.length,
      lineCount: Math.max(1, layer.text.split("\n").length),
      layoutWidth: layer.width,
      layoutHeight: layer.height,
    },
  };
}

// ─── TemplateRasterizerWorkerClient ──────────────────────────────────────────

let nextRequestId = 0;

function isWorkerEnvironmentAvailable(): boolean {
  return (
    typeof OffscreenCanvas !== "undefined" && typeof Worker !== "undefined"
  );
}

export class TemplateRasterizerWorkerClient {
  private worker: Worker | null = null;
  private readonly pending = new Map<
    string,
    {
      resolve: (result: {
        bitmap: ImageBitmap;
        offsetX: number;
        offsetY: number;
        croppedWidth: number;
        croppedHeight: number;
        workerRasterMs: number;
      }) => void;
      reject: (err: Error) => void;
    }
  >();
  /**
   * Dedup map: rasterKey → in-flight Promise<NativeTextRasterAsset>.
   * Shared by both rasterize() and rasterizeEffect() so a template and an
   * effect with the same key can never race each other.
   */
  private readonly inFlight = new Map<string, Promise<NativeTextRasterAsset>>();
  private disposed = false;
  /** Exposed for tests. */
  readonly isWorkerAvailable: () => boolean;

  constructor() {
    const available = isWorkerEnvironmentAvailable();
    this.isWorkerAvailable = () =>
      available && !this.disposed && this.worker !== null;
    if (available) this.initWorker();
  }

  private initWorker(): void {
    try {
      this.worker = new Worker(
        new URL("../../workers/templateRasterizer.worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = this.handleMessage.bind(this);
      this.worker.onerror = (e) => {
        console.error("[TemplateRasterizerWorkerClient] Worker error:", e);
        for (const [, { reject }] of this.pending) {
          reject(new Error("Worker error: " + e.message));
        }
        this.pending.clear();
        this.inFlight.clear();
        this.worker = null;
      };
      console.log(
        "[TemplateRasterizerWorkerClient] Worker initialized successfully",
      );
    } catch (err) {
      console.warn(
        "[TemplateRasterizerWorkerClient] Failed to initialize worker, fallback will be used:",
        err,
      );
      this.worker = null;
    }
  }

  private handleMessage(event: MessageEvent<WorkerOutboundMessage>): void {
    const msg = event.data;
    const callbacks = this.pending.get(msg.id);
    if (!callbacks) return;
    this.pending.delete(msg.id);
    if (msg.type === "FRAME_READY") {
      callbacks.resolve({
        bitmap: msg.bitmap,
        offsetX: msg.offsetX,
        offsetY: msg.offsetY,
        croppedWidth: msg.croppedWidth,
        croppedHeight: msg.croppedHeight,
        workerRasterMs: msg.workerRasterMs,
      });
    } else {
      console.error(
        `[TemplateRasterizerWorkerClient] Worker returned error for frame ${msg.id}:`,
        msg.error,
      );
      callbacks.reject(new Error(msg.error));
    }
  }

  // ─── Template rasterization ────────────────────────────────────────────────

  /**
   * Rasterize an animated text template layer.
   * The artifact is resolved from layer.templateSnapshot on the main thread
   * before sending to the worker — no store access needed in the worker.
   */
  rasterize(
    layer: EvaluatedTextLayer,
    rasterKey: string,
    phase: TextRenderTracePhase,
  ): Promise<NativeTextRasterAsset> {
    const existing = this.inFlight.get(rasterKey);
    if (existing) {
      traceTextRenderCacheHit({
        kind: "template",
        rendererPath: "native-raster",
        phase,
      });
      return existing;
    }
    const promise = this._doRasterizeTemplate(layer, rasterKey, phase);
    this.inFlight.set(rasterKey, promise);
    void promise.finally(() => this.inFlight.delete(rasterKey));
    return promise;
  }

  private async _doRasterizeTemplate(
    layer: EvaluatedTextLayer,
    rasterKey: string,
    phase: TextRenderTracePhase,
  ): Promise<NativeTextRasterAsset> {
    const totalStartedAt = performance.now();

    const artifact = resolveTextTemplateArtifact(layer.templateSnapshot);
    if (!artifact) {
      // No embedded snapshot — fall back to full main-thread rasterizer
      // which handles lazy-loading from the catalog.
      const { rasterizeTextLayerForNative } =
        await import("@/components/editor/preview/nativeTextPreview");
      return rasterizeTextLayerForNative(layer, { phase });
    }

    if (this.worker && !this.disposed) {
      try {
        const sendAt = performance.now();
        const { bitmap, offsetX, offsetY, workerRasterMs } =
          await this._sendMessage({
            type: "RENDER_TEMPLATE",
            artifact,
            localTime:
              layer.time !== undefined && layer.clipStartTime !== undefined
                ? layer.time - layer.clipStartTime
                : 0,
            clipDuration: layer.clipDuration,
            layerWidth: layer.width,
            layerHeight: layer.height,
            controlValues: resolveControlValues(layer, artifact),
          } as Omit<WorkerRenderTemplateMessage, "id">);
        const transferMs = Math.max(
          0,
          performance.now() - sendAt - workerRasterMs,
        );
        const totalMs = performance.now() - totalStartedAt;

        return buildAsset(
          bitmap,
          layer,
          offsetX,
          offsetY,
          rasterKey,
          phase,
          "template",
          layer.width,
          layer.height,
          totalMs,
          workerRasterMs,
          transferMs,
        );
      } catch (workerErr) {
        console.warn(
          `[TemplateRasterizerWorkerClient] Off-thread template render failed, falling back to main-thread:`,
          workerErr,
        );
      }
    }

    // Worker unavailable or failed — fall back to main-thread rasterizer.
    const { rasterizeTextLayerForNative } =
      await import("@/components/editor/preview/nativeTextPreview");
    return rasterizeTextLayerForNative(layer, { phase });
  }

  // ─── Effect rasterization ──────────────────────────────────────────────────

  /**
   * Rasterize a styled text effect layer using a pre-resolved scene document.
   *
   * The caller is responsible for resolving the SceneDocument on the main
   * thread (including text/typography injection) before passing it here.
   * The worker receives fully-prepared data and only calls
   * renderTextEffectToCanvas — it never touches Zustand stores.
   *
   * @param layer       - The evaluated text layer (for geometry + placement)
   * @param sceneDoc    - Fully-resolved SceneDocument with text/font overrides applied
   * @param canvasWidth - Render canvas width (from getCachedLayoutMetrics or caller)
   * @param canvasHeight - Render canvas height
   * @param rasterKey   - The precomputed raster cache key
   * @param phase       - Telemetry phase label
   */
  rasterizeEffect(
    layer: EvaluatedTextLayer,
    sceneDoc: Record<string, unknown>,
    canvasWidth: number,
    canvasHeight: number,
    rasterKey: string,
    phase: TextRenderTracePhase,
  ): Promise<NativeTextRasterAsset> {
    const existing = this.inFlight.get(rasterKey);
    if (existing) {
      traceTextRenderCacheHit({
        kind: "effect",
        rendererPath: "native-raster",
        phase,
      });
      return existing;
    }
    const promise = this._doRasterizeEffect(
      layer,
      sceneDoc,
      canvasWidth,
      canvasHeight,
      rasterKey,
      phase,
    );
    this.inFlight.set(rasterKey, promise);
    void promise.finally(() => this.inFlight.delete(rasterKey));
    return promise;
  }

  private async _doRasterizeEffect(
    layer: EvaluatedTextLayer,
    sceneDoc: Record<string, unknown>,
    canvasWidth: number,
    canvasHeight: number,
    rasterKey: string,
    phase: TextRenderTracePhase,
  ): Promise<NativeTextRasterAsset> {
    const totalStartedAt = performance.now();

    if (this.worker && !this.disposed) {
      try {
        const sendAt = performance.now();
        const { bitmap, offsetX, offsetY, workerRasterMs } =
          await this._sendMessage({
            type: "RENDER_EFFECT",
            sceneDocument: sceneDoc,
            time: layer.time ?? 0,
            evalWidth: canvasWidth,
            evalHeight: canvasHeight,
          } as Omit<WorkerRenderEffectMessage, "id">);
        const transferMs = Math.max(
          0,
          performance.now() - sendAt - workerRasterMs,
        );
        const totalMs = performance.now() - totalStartedAt;

        return buildAsset(
          bitmap,
          layer,
          offsetX,
          offsetY,
          rasterKey,
          phase,
          "effect",
          canvasWidth,
          canvasHeight,
          totalMs,
          workerRasterMs,
          transferMs,
        );
      } catch (workerErr) {
        console.warn(
          `[TemplateRasterizerWorkerClient] Off-thread effect render failed, falling back to main-thread:`,
          workerErr,
        );
      }
    }

    // Worker unavailable or failed — fall back to main-thread rasterizer.
    const { rasterizeTextLayerForNative } =
      await import("@/components/editor/preview/nativeTextPreview");
    return rasterizeTextLayerForNative(layer, { phase });
  }

  // ─── Shared worker messaging ───────────────────────────────────────────────

  private _sendMessage(
    params:
      | Omit<WorkerRenderTemplateMessage, "id">
      | Omit<WorkerRenderEffectMessage, "id">,
  ): Promise<{
    bitmap: ImageBitmap;
    offsetX: number;
    offsetY: number;
    croppedWidth: number;
    croppedHeight: number;
    workerRasterMs: number;
  }> {
    return new Promise((resolve, reject) => {
      if (!this.worker || this.disposed) {
        reject(new Error("Worker not available"));
        return;
      }
      const id = String(++nextRequestId);
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...params, id });
    });
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

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

  /** Number of in-flight requests. Exposed for tests. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Number of deduplicated in-flight asset promises. Exposed for tests. */
  get inFlightCount(): number {
    return this.inFlight.size;
  }
}

// ─── FNV-1a 32-bit hash ───────────────────────────────────────────────────────

function hashRasterKey(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
