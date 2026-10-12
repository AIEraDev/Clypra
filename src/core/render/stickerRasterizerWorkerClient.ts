/**
 * Sticker Rasterizer Worker Client
 *
 * Façade over the stickerRasterizer.worker Web Worker that renders animated
 * Lottie stickers off the main JS thread using OffscreenCanvas.
 *
 * Responsibilities:
 * - Spawns and manages the Web Worker lifecycle.
 * - Deduplicates in-flight rasterization promises by raster key.
 * - Tracks GPU residency fast-path so repeated frames don't incur rasterization or IPC overhead.
 * - Emits structured telemetry samples to telemetryCollector for API performance tracking.
 * - Falls back transparently to main-thread rendering if Worker or OffscreenCanvas is unavailable.
 */

import { appCacheDir, join } from "@tauri-apps/api/path";
import { useStickersStore } from "@/features/stickers/store/stickersStore";
import { stickerCacheManager } from "@/features/stickers/cache/stickerCache";
import type { EvaluatedMediaLayer } from "@/core/evaluation/types";
import {
  telemetryCollector,
  type TelemetryStickerPhase,
} from "@/services/telemetryCollector";
import { workerPerfCollector } from "@/core/monitoring/WorkerPerfCollector";
import type {
  WorkerStickerInboundMessage,
  WorkerStickerOutboundMessage,
  WorkerStickerFrameReadyMessage,
} from "@/workers/stickerRasterizer.worker";
import type { NativeAnimatedStickerRaster } from "@/components/editor/preview/nativeStickerPreview";

let nextRequestId = 0;

function resolveLottie(mod: any): any {
  if (mod?.default) {
    if (typeof mod.default.loadAnimation === "function") return mod.default;
    if (typeof mod.default.default?.loadAnimation === "function") return mod.default.default;
  }
  try {
    if (typeof mod?.loadAnimation === "function") return mod;
  } catch {
    // Vitest strict mock guard
  }
  return mod?.default || mod;
}

interface CachedFallbackAnimation {
  container: HTMLDivElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  animation: any;
  stickerSourceId: string;
  width: number;
  height: number;
}

export class StickerRasterizerWorkerClient {
  private worker: Worker | null = null;
  private workerFailed = false;
  private disposed = false;
  private readonly inFlight = new Map<string, Promise<NativeAnimatedStickerRaster | null>>();
  private readonly registeredFrames = new Set<string>();
  private readonly fallbackAnimations = new Map<string, CachedFallbackAnimation>();
  private readonly pendingRequests = new Map<
    string,
    {
      resolve: (value: NativeAnimatedStickerRaster | null) => void;
      reject: (error: Error) => void;
      layer: EvaluatedMediaLayer;
      animationData: any;
      frame: number;
      assetId: string;
      phase: TelemetryStickerPhase;
      startTime: number;
      width: number;
      height: number;
    }
  >();

  constructor() {
    this.initWorker();
  }

  private initWorker(): void {
    if (
      typeof Worker === "undefined" ||
      typeof OffscreenCanvas === "undefined" ||
      this.disposed
    ) {
      this.worker = null;
      return;
    }

    try {
      this.worker = new Worker(
        new URL("../../workers/stickerRasterizer.worker.ts", import.meta.url),
        { type: "module" },
      );

      this.worker.onmessage = (event: MessageEvent<WorkerStickerOutboundMessage>) => {
        this.handleWorkerMessage(event.data);
      };

      this.worker.onerror = (error) => {
        console.error("[StickerRasterizerWorkerClient] Worker error:", error);
        this.workerFailed = true;
        workerPerfCollector.recordError(
          "StickerRasterizerWorker",
          error.message || "Worker error occurred",
        );
        telemetryCollector.recordFallbackEvent(
          "sticker-worker-offscreen",
          "sticker-main-thread-raster",
          "sticker-worker-runtime-error",
        );
        this.drainPendingWithError(new Error("Worker error occurred"));
      };
    } catch (err) {
      console.warn(
        "[StickerRasterizerWorkerClient] Failed to initialize worker, fallback will be used:",
        err,
      );
      this.worker = null;
      this.workerFailed = true;
      workerPerfCollector.recordError(
        "StickerRasterizerWorker",
        err instanceof Error ? err.message : String(err),
        "INITIALIZATION",
      );
      telemetryCollector.recordFallbackEvent(
        "sticker-worker-offscreen",
        "sticker-main-thread-raster",
        "sticker-worker-initialization-failed",
      );
    }
  }

  private handleWorkerMessage(msg: WorkerStickerOutboundMessage): void {
    if (msg.type === "STICKER_FRAME_READY") {
      const pending = this.pendingRequests.get(msg.id);
      if (!pending) return;
      this.pendingRequests.delete(msg.id);

      const totalMs = performance.now() - pending.startTime;
      const transferMs = Math.max(0, totalMs - msg.workerRasterMs);
      const rgba = new Uint8ClampedArray(msg.buffer);

      this.registeredFrames.add(pending.assetId);
      if (this.registeredFrames.size > 512) {
        const first = this.registeredFrames.values().next().value;
        if (first) this.registeredFrames.delete(first);
      }

      workerPerfCollector.record({
        domain: "StickerRasterizerWorker",
        operation: "STICKER_FRAME_READY",
        durationMs: totalMs,
        workerDurationMs: msg.workerRasterMs,
        itemsCount: msg.width * msg.height,
        overBudget: totalMs > 16.67,
      });

      telemetryCollector.recordStickerRender({
        format: "lottie",
        rendererPath: "worker-offscreen",
        phase: pending.phase,
        operation: "render",
        rasterUs: Math.round(msg.workerRasterMs * 1000),
        transferUs: Math.round(transferMs * 1000),
        totalTimeUs: Math.round(totalMs * 1000),
        outputPixels: msg.width * msg.height,
        cacheHit: false,
      });

      const raster: NativeAnimatedStickerRaster = {
        assetId: pending.assetId,
        rgba,
        width: msg.width,
        height: msg.height,
        x: pending.layer.x,
        y: pending.layer.y,
        rotation: pending.layer.rotation,
        opacity: pending.layer.opacity,
        zIndex: pending.layer.zIndex,
        blendMode: pending.layer.blendMode,
        isText: false,
      };

      pending.resolve(raster);
    } else if (msg.type === "STICKER_FRAME_FAILED") {
      const pending = this.pendingRequests.get(msg.id);
      if (!pending) return;
      this.pendingRequests.delete(msg.id);
      workerPerfCollector.recordError(
        "StickerRasterizerWorker",
        msg.error || "Failed to render frame",
        "STICKER_FRAME_FAILED",
      );
      console.warn(
        `[StickerRasterizerWorkerClient] Worker failed to render frame, falling back to main-thread:`,
        msg.error,
      );
      this.workerFailed = true;
      telemetryCollector.recordFallbackEvent(
        "sticker-worker-offscreen",
        "sticker-main-thread-raster",
        "sticker-worker-frame-failed",
      );
      this.renderFallback(
        pending.layer,
        pending.animationData,
        pending.frame,
        pending.width,
        pending.height,
        pending.assetId,
        pending.phase,
      )
        .then(pending.resolve)
        .catch(pending.reject);
    }
  }

  private drainPendingWithError(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  /**
   * Primary entry point for sticker frame rasterization.
   * Deduplicates concurrent in-flight requests synchronously so concurrent
   * callers for the same layer frame share the identical Promise instance.
   */
  /**
   * Primary entry point for sticker frame rasterization.
   * Deduplicates concurrent in-flight requests synchronously so concurrent
   * callers for the same layer frame share the identical Promise instance.
   */
  render(
    layer: EvaluatedMediaLayer,
    phase: TelemetryStickerPhase = "visible-playback",
    forcePixels = false,
  ): Promise<NativeAnimatedStickerRaster | null> {
    if (layer.clipKind !== "sticker" || layer.stickerFormat !== "lottie") {
      return Promise.resolve(null);
    }

    const stickerId = layer.stickerSourceId || layer.mediaId.replace("sticker-", "");
    const width = Math.max(1, Math.ceil(layer.width));
    const height = Math.max(1, Math.ceil(layer.height));
    const speed = Number(layer.stickerSettings?.speed ?? 1);
    const loop = layer.stickerSettings?.loop ?? true;
    const flightKey = `flight:${layer.layerId}:${stickerId}:${layer.sourceTime}:${width}x${height}:${speed}:${loop}${forcePixels ? ":force" : ""}`;

    const existingPromise = this.inFlight.get(flightKey);
    if (existingPromise) return existingPromise;

    const promise = this.doRender(
      layer,
      stickerId,
      width,
      height,
      speed,
      loop,
      phase,
      forcePixels,
    ).finally(() => {
      this.inFlight.delete(flightKey);
    });

    this.inFlight.set(flightKey, promise);
    return promise;
  }

  private async doRender(
    layer: EvaluatedMediaLayer,
    stickerId: string,
    width: number,
    height: number,
    speed: number,
    loop: boolean,
    phase: TelemetryStickerPhase,
    forcePixels = false,
  ): Promise<NativeAnimatedStickerRaster | null> {
    let cachedSticker = useStickersStore.getState().getCachedSticker(stickerId);
    if (!cachedSticker) {
      await useStickersStore.getState().initializeCache();
      cachedSticker = useStickersStore.getState().getCachedSticker(stickerId);
    }

    let animationData = cachedSticker?.lottieData;
    if (!animationData) {
      let sourcePath = cachedSticker?.localAnimationPath ?? layer.stickerAnimationPath ?? "";
      if (!sourcePath) return null;
      if (
        !sourcePath.startsWith("/") &&
        !sourcePath.startsWith("file:") &&
        !sourcePath.startsWith("asset://") &&
        !sourcePath.startsWith("bundled://")
      ) {
        sourcePath = await join(await appCacheDir(), sourcePath);
      }
      animationData = await stickerCacheManager.readLottieJson(sourcePath);
    }

    if (!animationData) return null;

    const totalFrames = Math.max(1, Math.floor(Number((animationData as any)?.op || (animationData as any)?.totalFrames || 60)));
    const frameRate = Number((animationData as any)?.fr || (animationData as any)?.frameRate || 30);
    const rawFrame = Math.max(0, Math.floor(layer.sourceTime * Math.max(0, speed) * frameRate));
    const frame = loop ? rawFrame % totalFrames : Math.min(rawFrame, totalFrames - 1);

    const assetId = `native-sticker:${layer.layerId}:${frame}:${width}x${height}`;

    // Fast-path: if this frame has already been registered in the GPU texture cache
    if (!forcePixels && this.registeredFrames.has(assetId)) {
      telemetryCollector.recordStickerCacheHit({
        format: "lottie",
        rendererPath: this.worker && !this.workerFailed ? "worker-offscreen" : "native-raster",
        phase,
      });

      return {
        assetId,
        rgba: [],
        width,
        height,
        x: layer.x,
        y: layer.y,
        rotation: layer.rotation,
        opacity: layer.opacity,
        zIndex: layer.zIndex,
        blendMode: layer.blendMode,
        isText: false,
      };
    }

    return this.dispatchRender(
      layer,
      stickerId,
      animationData,
      frame,
      width,
      height,
      assetId,
      phase,
    );
  }

  private async dispatchRender(
    layer: EvaluatedMediaLayer,
    stickerSourceId: string,
    animationData: any,
    frame: number,
    width: number,
    height: number,
    assetId: string,
    phase: TelemetryStickerPhase,
  ): Promise<NativeAnimatedStickerRaster | null> {
    if (!this.worker || this.workerFailed) {
      return this.renderFallback(layer, animationData, frame, width, height, assetId, phase);
    }

    const id = `req_${++nextRequestId}_${Date.now()}`;
    const startTime = performance.now();

    return new Promise<NativeAnimatedStickerRaster | null>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve,
        reject,
        layer,
        animationData,
        frame,
        assetId,
        phase,
        startTime,
        width,
        height,
      });

      const message: WorkerStickerInboundMessage = {
        type: "RENDER_STICKER_FRAME",
        id,
        stickerSourceId,
        animationData,
        frame,
        width,
        height,
      };

      try {
        this.worker!.postMessage(message);
      } catch (err) {
        this.pendingRequests.delete(id);
        console.warn("[StickerRasterizerWorkerClient] postMessage failed, using fallback:", err);
        resolve(this.renderFallback(layer, animationData, frame, width, height, assetId, phase));
      }
    });
  }

  /**
   * High-performance main-thread fallback when Web Worker or OffscreenCanvas
   * is unavailable or fails. Caches active animation DOM containers per sticker
   * to eliminate garbage collection and Lottie re-parsing overhead.
   */
  private async renderFallback(
    layer: EvaluatedMediaLayer,
    animationData: any,
    frame: number,
    width: number,
    height: number,
    assetId: string,
    phase: TelemetryStickerPhase,
  ): Promise<NativeAnimatedStickerRaster | null> {
    if (typeof document === "undefined") return null;

    const startTime = performance.now();
    const stickerSourceId = layer.stickerSourceId || layer.mediaId;
    const cacheKey = `${stickerSourceId}:${width}x${height}`;
    let cached = this.fallbackAnimations.get(cacheKey);

    if (!cached) {
      const lottieModule = await import("lottie-web");
      const lottie = resolveLottie(lottieModule);
      if (typeof lottie?.loadAnimation !== "function") {
        console.error("[StickerRasterizerWorkerClient] lottie.loadAnimation is unavailable");
        return null;
      }

      const container = document.createElement("div");
      container.style.position = "absolute";
      container.style.left = "-100000px";
      container.style.top = "-100000px";
      container.style.width = `${width}px`;
      container.style.height = `${height}px`;
      container.style.overflow = "hidden";
      if (typeof document !== "undefined" && document.body) {
        document.body.appendChild(container);
      }

      const parsedData =
        typeof animationData === "string"
          ? JSON.parse(animationData)
          : JSON.parse(JSON.stringify(animationData));

      const animation = lottie.loadAnimation({
        container,
        renderer: "canvas",
        loop: false,
        autoplay: false,
        animationData: parsedData,
        rendererSettings: {
          clearCanvas: true,
        },
      });

      const canvas = container.querySelector("canvas") || document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        try {
          animation.destroy();
        } catch {
          // Ignore
        }
        container.remove();
        return null;
      }

      cached = {
        container,
        canvas,
        ctx,
        animation,
        stickerSourceId,
        width,
        height,
      };
      this.fallbackAnimations.set(cacheKey, cached);
    }

    cached.animation.goToAndStop(frame, true);
    await Promise.resolve();

    const rasterMs = performance.now() - startTime;
    const imageData = cached.ctx.getImageData(0, 0, width, height);
    const rgba = new Uint8ClampedArray(imageData.data);

    this.registeredFrames.add(assetId);
    if (this.registeredFrames.size > 512) {
      const first = this.registeredFrames.values().next().value;
      if (first) this.registeredFrames.delete(first);
    }

    const totalMs = performance.now() - startTime;
    telemetryCollector.recordStickerRender({
      format: "lottie",
      rendererPath: "native-raster",
      phase,
      operation: "render",
      rasterUs: Math.round(rasterMs * 1000),
      transferUs: 0,
      totalTimeUs: Math.round(totalMs * 1000),
      outputPixels: width * height,
      cacheHit: false,
    });

    return {
      assetId,
      rgba,
      width,
      height,
      x: layer.x,
      y: layer.y,
      rotation: layer.rotation,
      opacity: layer.opacity,
      zIndex: layer.zIndex,
      blendMode: layer.blendMode,
      isText: false,
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.worker) {
      try {
        this.worker.postMessage({ type: "DISPOSE" });
        this.worker.terminate();
      } catch {
        // Ignore
      }
      this.worker = null;
    }
    for (const cached of this.fallbackAnimations.values()) {
      try {
        cached.animation.destroy();
        cached.container.remove();
      } catch {
        // Ignore
      }
    }
    this.fallbackAnimations.clear();
    this.drainPendingWithError(new Error("StickerRasterizerWorkerClient disposed"));
    this.inFlight.clear();
    this.registeredFrames.clear();
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  hasRegisteredFrame(assetId: string): boolean {
    return this.registeredFrames.has(assetId);
  }

  evictFrame(assetId: string): void {
    this.registeredFrames.delete(assetId);
  }

  clearRegisteredFrames(): void {
    this.registeredFrames.clear();
  }
}
