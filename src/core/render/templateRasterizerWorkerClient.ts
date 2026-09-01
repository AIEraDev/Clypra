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
import type { TextRenderTracePhase } from "@/core/render/textRenderTrace";
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
  const customization = layer.customization;
  const values: Record<string, unknown> = {
    ...(layer.templateControlValues || {}),
  };
  for (const control of artifact.controls) {
    if (control.type !== "text" && control.type !== "color") continue;
    const node = artifact.document.nodes.find(
      (candidate: any) => candidate.id === control.target.nodeId,
    ) as any;
    const role: string = node?.role || "";
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
  bleedX: number,
  bleedY: number,
  canvasWidth: number,
  canvasHeight: number,
  rasterKey: string,
  phase: TextRenderTracePhase,
  kind: "template" | "effect",
  totalMs: number,
  workerRasterMs: number,
  transferMs: number,
): NativeTextRasterAsset {
  const readbackStart = performance.now();
  const rgba = imageBitmapToRgba(bitmap);
  const readbackMs = performance.now() - readbackStart;
  bitmap.close();

  const cropKey = kind === "template" ? getTemplateCropCacheKey(layer) : null;
  const cropped = cropKey
    ? cropTemplateAsset(rgba, canvasWidth, canvasHeight, cropKey)
    : null;

  return {
    assetId: `native-text:${layer.layerId}:${hashRasterKey(rasterKey)}`,
    rgba: cropped?.rgba ?? rgba,
    width: cropped?.width ?? canvasWidth,
    height: cropped?.height ?? canvasHeight,
    x: cropped ? layer.x - bleedX + cropped.offsetX : layer.x - bleedX,
    y: cropped ? layer.y - bleedY + cropped.offsetY : layer.y - bleedY,
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
      kind,
      rendererPath: "native-raster",
      fontWaitMs: 0,
      // Stage breakdown — each number is measured, not derived:
      //   rasterMs    = renderTextTemplate/EffectToCanvas inside the Worker
      //   readbackMs  = ImageBitmap → Uint8ClampedArray on main thread
      //   transferMs  = structured-clone + message channel round-trip latency
      //   totalMs     = full wall-clock (rasterMs + readbackMs + transferMs +
      //                 resolveArtifact + getCachedLayoutMetrics ≈ <1ms combined)
      rasterMs: workerRasterMs,
      readbackMs,
      transferMs,
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
      console.log("[TemplateRasterizerWorkerClient] Worker initialized successfully");
    } catch (err) {
      console.warn("[TemplateRasterizerWorkerClient] Failed to initialize worker, fallback will be used:", err);
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
        workerRasterMs: msg.workerRasterMs,
      });
    } else {
      console.error(`[TemplateRasterizerWorkerClient] Worker returned error for frame ${msg.id}:`, msg.error);
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
      console.log(`[TemplateRasterizerWorkerClient] Dedup hit for template ${layer.layerId} (key=${rasterKey.slice(0, 32)}...)`);
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
      console.log(`[TemplateRasterizerWorkerClient] No embedded snapshot for template ${layer.layerId}, falling back to main thread`);
      // No embedded snapshot — fall back to full main-thread rasterizer
      // which handles lazy-loading from the catalog.
      const { rasterizeTextLayerForNative } =
        await import("@/components/editor/preview/nativeTextPreview");
      return rasterizeTextLayerForNative(layer, { phase });
    }

    const layoutKey = buildNativeTextLayoutKey(layer);
    const { bleedX, bleedY, rasterWidth, rasterHeight } =
      getCachedLayoutMetrics(layer, layoutKey);

    if (this.worker && !this.disposed) {
      try {
        const sendAt = performance.now();
        const { bitmap, workerRasterMs } = await this._sendMessage({
          type: "RENDER_TEMPLATE",
          artifact,
          localTime:
            layer.time !== undefined && layer.clipStartTime !== undefined
              ? layer.time - layer.clipStartTime
              : 0,
          clipDuration: layer.clipDuration,
          layerWidth: layer.width,
          layerHeight: layer.height,
          bleedX,
          bleedY,
          rasterWidth,
          rasterHeight,
          controlValues: resolveControlValues(layer, artifact),
        } as Omit<WorkerRenderTemplateMessage, "id">);
        const transferMs = Math.max(
          0,
          performance.now() - sendAt - workerRasterMs,
        );
        const totalMs = performance.now() - totalStartedAt;
        console.log(`[TemplateRasterizerWorkerClient] Template rendered off-thread (layer=${layer.layerId}, workerMs=${workerRasterMs.toFixed(2)}ms, transferMs=${transferMs.toFixed(2)}ms, totalMs=${totalMs.toFixed(2)}ms)`);

        return buildAsset(
          bitmap,
          layer,
          bleedX,
          bleedY,
          rasterWidth,
          rasterHeight,
          rasterKey,
          phase,
          "template",
          totalMs,
          workerRasterMs,
          transferMs,
        );
      } catch (workerErr) {
        console.warn(`[TemplateRasterizerWorkerClient] Off-thread template render failed, falling back to main-thread:`, workerErr);
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
      console.log(`[TemplateRasterizerWorkerClient] Dedup hit for effect ${layer.layerId} (key=${rasterKey.slice(0, 32)}...)`);
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

    const layoutKey = buildNativeTextLayoutKey(layer);
    const { bleedX, bleedY, rasterWidth, rasterHeight } =
      getCachedLayoutMetrics(layer, layoutKey);

    if (this.worker && !this.disposed) {
      try {
        const sendAt = performance.now();
        const { bitmap, workerRasterMs } = await this._sendMessage({
          type: "RENDER_EFFECT",
          sceneDocument: sceneDoc,
          time: layer.time ?? 0,
          evalWidth: canvasWidth,
          evalHeight: canvasHeight,
          rasterWidth,
          rasterHeight,
          bleedX,
          bleedY,
        } as Omit<WorkerRenderEffectMessage, "id">);
        const transferMs = Math.max(
          0,
          performance.now() - sendAt - workerRasterMs,
        );
        const totalMs = performance.now() - totalStartedAt;
        console.log(`[TemplateRasterizerWorkerClient] Effect rendered off-thread (layer=${layer.layerId}, workerMs=${workerRasterMs.toFixed(2)}ms, transferMs=${transferMs.toFixed(2)}ms, totalMs=${totalMs.toFixed(2)}ms)`);

        return buildAsset(
          bitmap,
          layer,
          bleedX,
          bleedY,
          rasterWidth,
          rasterHeight,
          rasterKey,
          phase,
          "effect",
          totalMs,
          workerRasterMs,
          transferMs,
        );
      } catch (workerErr) {
        console.warn(`[TemplateRasterizerWorkerClient] Off-thread effect render failed, falling back to main-thread:`, workerErr);
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
  ): Promise<{ bitmap: ImageBitmap; workerRasterMs: number }> {
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
