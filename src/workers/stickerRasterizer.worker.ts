/**
 * Sticker Rasterizer Web Worker
 *
 * Renders animated Lottie stickers entirely off the main thread using OffscreenCanvas.
 * Eliminates the UI thread freezes and GC pauses that occurred when Program Preview
 * evaluated Lottie DOM animations and synchronous canvas readbacks during playback.
 *
 * Architecture:
 *   Main thread                     Worker
 *   RENDER_STICKER_FRAME   ───►     load/seek on OffscreenCanvas
 *                                       ↓
 *   STICKER_FRAME_READY    ◄───     postMessage(..., [imageData.data.buffer])  [zero-copy transfer]
 */

import "./workerDomShim";

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

let lottieInstance: any = null;

async function getLottie(): Promise<any> {
  if (lottieInstance) return lottieInstance;
  const mod = await import("lottie-web");
  const lottie = resolveLottie(mod);
  if (typeof lottie?.loadAnimation !== "function") {
    throw new Error(
      `lottie.loadAnimation is not a function. Export keys: ${Object.keys(mod || {})}`,
    );
  }
  lottieInstance = lottie;
  return lottieInstance;
}

export interface WorkerRenderStickerFrameMessage {
  type: "RENDER_STICKER_FRAME";
  id: string;
  stickerSourceId: string;
  animationData: any;
  frame: number;
  width: number;
  height: number;
}

export interface WorkerInitStickerMessage {
  type: "INIT_STICKER";
  id: string;
  stickerSourceId: string;
  animationData: any;
  width: number;
  height: number;
}

export interface WorkerDisposeStickerMessage {
  type: "DISPOSE_STICKER";
  stickerSourceId: string;
}

export interface WorkerDisposeMessage {
  type: "DISPOSE";
}

export type WorkerStickerInboundMessage =
  | WorkerRenderStickerFrameMessage
  | WorkerInitStickerMessage
  | WorkerDisposeStickerMessage
  | WorkerDisposeMessage;

export interface WorkerStickerFrameReadyMessage {
  type: "STICKER_FRAME_READY";
  id: string;
  stickerSourceId: string;
  frame: number;
  width: number;
  height: number;
  totalFrames: number;
  frameRate: number;
  buffer: ArrayBuffer;
  workerRasterMs: number;
}

export interface WorkerStickerInitReadyMessage {
  type: "STICKER_INIT_READY";
  id: string;
  stickerSourceId: string;
  totalFrames: number;
  frameRate: number;
}

export interface WorkerStickerFrameFailedMessage {
  type: "STICKER_FRAME_FAILED";
  id: string;
  error: string;
}

export type WorkerStickerOutboundMessage =
  | WorkerStickerFrameReadyMessage
  | WorkerStickerInitReadyMessage
  | WorkerStickerFrameFailedMessage;

interface CachedStickerAnimation {
  stickerSourceId: string;
  animationData: any;
  animation: any;
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
  totalFrames: number;
  frameRate: number;
}

const MAX_CACHED_STICKER_ANIMATIONS = 16;
const stickerCache = new Map<string, CachedStickerAnimation>();

async function getOrCreateStickerAnimation(
  stickerSourceId: string,
  animationData: any,
  width: number,
  height: number,
): Promise<CachedStickerAnimation> {
  const cacheKey = `${stickerSourceId}:${width}x${height}`;
  const existing = stickerCache.get(cacheKey);
  if (
    existing &&
    existing.width === width &&
    existing.height === height &&
    existing.animationData === animationData
  ) {
    // Refresh LRU order
    stickerCache.delete(cacheKey);
    stickerCache.set(cacheKey, existing);
    return existing;
  }

  if (existing) {
    try {
      existing.animation.destroy();
    } catch {
      // Best-effort cleanup
    }
    stickerCache.delete(cacheKey);
  }

  // Bound cache size to prevent memory leaks while supporting multi-instance/resized stickers
  while (stickerCache.size >= MAX_CACHED_STICKER_ANIMATIONS) {
    const oldestKey = stickerCache.keys().next().value;
    if (!oldestKey) break;
    const oldest = stickerCache.get(oldestKey);
    if (oldest) {
      try {
        oldest.animation.destroy();
      } catch {
        // Best-effort cleanup
      }
    }
    stickerCache.delete(oldestKey);
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) {
    throw new Error(`Failed to create 2d context on OffscreenCanvas (${width}x${height})`);
  }

  // Clone animation data to avoid mutations across calls
  const parsedData =
    typeof animationData === "string"
      ? JSON.parse(animationData)
      : JSON.parse(JSON.stringify(animationData));

  const lottie = await getLottie();
  const animation = lottie.loadAnimation({
    renderer: "canvas",
    loop: false,
    autoplay: false,
    animationData: parsedData,
    rendererSettings: {
      context: ctx as unknown as CanvasRenderingContext2D,
      clearCanvas: true,
    },
  });

  const totalFrames = Math.max(1, Math.floor(Number(animation.totalFrames || 1)));
  const frameRate = Number(animation.frameRate || 30);

  const entry: CachedStickerAnimation = {
    stickerSourceId,
    animationData,
    animation,
    canvas,
    ctx,
    width,
    height,
    totalFrames,
    frameRate,
  };

  stickerCache.set(cacheKey, entry);
  return entry;
}

async function handleRenderFrame(msg: WorkerRenderStickerFrameMessage): Promise<void> {
  const rasterStart = performance.now();
  const entry = await getOrCreateStickerAnimation(
    msg.stickerSourceId,
    msg.animationData,
    Math.max(1, Math.ceil(msg.width)),
    Math.max(1, Math.ceil(msg.height)),
  );

  const totalFrames = entry.totalFrames;
  const clampedFrame = Math.max(0, Math.min(Math.floor(msg.frame), totalFrames - 1));

  entry.ctx.clearRect(0, 0, entry.width, entry.height);
  entry.animation.goToAndStop(clampedFrame, true);

  const imageData = entry.ctx.getImageData(0, 0, entry.width, entry.height);
  const workerRasterMs = performance.now() - rasterStart;
  const rawBuffer = imageData.data.buffer;

  (self as unknown as Worker).postMessage(
    {
      type: "STICKER_FRAME_READY",
      id: msg.id,
      stickerSourceId: msg.stickerSourceId,
      frame: clampedFrame,
      width: entry.width,
      height: entry.height,
      totalFrames: entry.totalFrames,
      frameRate: entry.frameRate,
      buffer: rawBuffer,
      workerRasterMs,
    } satisfies WorkerStickerFrameReadyMessage,
    [rawBuffer],
  );
}

async function handleInit(msg: WorkerInitStickerMessage): Promise<void> {
  const entry = await getOrCreateStickerAnimation(
    msg.stickerSourceId,
    msg.animationData,
    Math.max(1, Math.ceil(msg.width)),
    Math.max(1, Math.ceil(msg.height)),
  );

  (self as unknown as Worker).postMessage({
    type: "STICKER_INIT_READY",
    id: msg.id,
    stickerSourceId: msg.stickerSourceId,
    totalFrames: entry.totalFrames,
    frameRate: entry.frameRate,
  } satisfies WorkerStickerInitReadyMessage);
}

self.onmessage = async (event: MessageEvent<WorkerStickerInboundMessage>): Promise<void> => {
  const msg = event.data;

  if (msg.type === "DISPOSE") {
    for (const entry of stickerCache.values()) {
      try {
        entry.animation.destroy();
      } catch {
        // Ignore
      }
    }
    stickerCache.clear();
    self.close();
    return;
  }

  if (msg.type === "DISPOSE_STICKER") {
    for (const [key, entry] of stickerCache.entries()) {
      if (entry.stickerSourceId === msg.stickerSourceId) {
        try {
          entry.animation.destroy();
        } catch {
          // Ignore
        }
        stickerCache.delete(key);
      }
    }
    return;
  }

  try {
    if (msg.type === "RENDER_STICKER_FRAME") {
      await handleRenderFrame(msg);
    } else if (msg.type === "INIT_STICKER") {
      await handleInit(msg);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: "STICKER_FRAME_FAILED",
      id: (msg as { id: string }).id,
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerStickerFrameFailedMessage);
  }
};
