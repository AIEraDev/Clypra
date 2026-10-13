import lottie from "lottie-web";
import { appCacheDir, join } from "@tauri-apps/api/path";
import { useStickersStore } from "@/features/stickers/store/stickersStore";
import { stickerCacheManager } from "@/features/stickers/cache/stickerCache";
import { STARTER_STICKERS } from "@/features/stickers/starterStickers";
import type { EvaluatedMediaLayer } from "@/core/evaluation/types";
import type { NativeRasterLayerSnapshot } from "@/lib/platform/nativeCore";
import type { TelemetryStickerPhase } from "@/services/telemetryCollector";

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

export type NativeAnimatedStickerRaster = NativeRasterLayerSnapshot & {
  rgba: Uint8ClampedArray | number[];
};

interface StickerRendererEntry {
  sourcePath: string;
  width: number;
  height: number;
  container: HTMLDivElement;
  animation: any;
  canvas: HTMLCanvasElement;
}

/**
 * Canvas-backed Lottie frame bridge for the native compositor.
 *
 * Renders animated Lottie sticker frames via an offscreen DOM canvas,
 * returning zero-copy Uint8ClampedArray pixel buffers to the native Tauri
 * GPU texture cache.
 */
export class NativeAnimatedStickerRenderer {
  private readonly entries = new Map<string, StickerRendererEntry>();
  private readonly registeredFrames = new Set<string>();

  getCanvas(layerId: string): HTMLCanvasElement | null {
    return this.entries.get(layerId)?.canvas ?? null;
  }

  async render(
    layer: EvaluatedMediaLayer,
    _phase: TelemetryStickerPhase = "visible-playback",
  ): Promise<NativeAnimatedStickerRaster | null> {
    if (layer.clipKind !== "sticker" || layer.stickerFormat !== "lottie") return null;
    if (typeof document === "undefined") return null;

    const stickerId = layer.stickerSourceId || layer.mediaId.replace("sticker-", "");
    let animationData = (layer as any).lottieData;
    let sourcePath = layer.stickerAnimationPath ?? "";

    if (!animationData) {
      const starter = STARTER_STICKERS.find((s) => s.id === stickerId);
      if (starter) {
        animationData = starter.lottieData;
        if (!sourcePath) sourcePath = `bundled://${starter.id}.json`;
      }
    }

    if (!animationData) {
      let cachedSticker: any = null;
      try {
        cachedSticker = useStickersStore.getState().getCachedSticker(stickerId);
        if (!cachedSticker) {
          await useStickersStore.getState().initializeCache();
          cachedSticker = useStickersStore.getState().getCachedSticker(stickerId);
        }
      } catch {
        // Best-effort in headless/test environments
      }
      if (cachedSticker?.lottieData) {
        animationData = cachedSticker.lottieData;
      }
      if (!sourcePath && cachedSticker?.localAnimationPath) {
        sourcePath = cachedSticker.localAnimationPath;
      }
    }

    if (!animationData) {
      if (!sourcePath) return null;
      if (
        !sourcePath.startsWith("/") &&
        !sourcePath.startsWith("file:") &&
        !sourcePath.startsWith("asset://") &&
        !sourcePath.startsWith("bundled://")
      ) {
        try {
          sourcePath = await join(await appCacheDir(), sourcePath);
        } catch {
          // ignore
        }
      }
      try {
        animationData = await stickerCacheManager.readLottieJson(sourcePath);
      } catch {
        animationData = null;
      }
    }
    if (!animationData) return null;

    const width = Math.max(1, Math.ceil(layer.width));
    const height = Math.max(1, Math.ceil(layer.height));
    let entry = this.entries.get(layer.layerId);
    if (
      !entry ||
      entry.sourcePath !== sourcePath ||
      entry.width !== width ||
      entry.height !== height
    ) {
      if (entry) this.destroyEntry(entry);

      const container = document.createElement("div");
      container.style.position = "absolute";
      container.style.left = "-100000px";
      container.style.top = "-100000px";
      container.style.width = `${width}px`;
      container.style.height = `${height}px`;
      container.style.overflow = "hidden";
      document.body.appendChild(container);

      const parsedData =
        typeof animationData === "string"
          ? JSON.parse(animationData)
          : JSON.parse(JSON.stringify(animationData));

      const lottieInstance = resolveLottie(lottie);
      const animation = lottieInstance.loadAnimation({
        container,
        renderer: "canvas",
        autoplay: false,
        loop: false,
        animationData: parsedData,
        rendererSettings: {
          clearCanvas: true,
        },
      });
      animation.goToAndStop(0, true);
      await Promise.resolve();
      let canvas = container.querySelector("canvas") as HTMLCanvasElement | null;
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        container.appendChild(canvas);
      }
      entry = { sourcePath, width, height, container, animation, canvas };
      this.entries.set(layer.layerId, entry);
    }

    const frameRate = Number(entry.animation.frameRate || 30);
    const totalFrames = Math.max(1, Math.floor(Number(entry.animation.totalFrames || 1)));
    const speed = Number(layer.stickerSettings?.speed ?? 1);
    const rawFrame = Math.max(0, Math.floor(layer.sourceTime * Math.max(0, speed) * frameRate));
    const loop = layer.stickerSettings?.loop ?? true;
    const frame = loop ? rawFrame % totalFrames : Math.min(rawFrame, totalFrames - 1);
    const assetId = `native-sticker:${layer.layerId}:${frame}:${entry.canvas.width}x${entry.canvas.height}`;

    // Fast-path: if this frame has already been registered in the GPU texture cache,
    // skip canvas rasterization and return empty rgba payload
    if (this.registeredFrames.has(assetId)) {
      return {
        assetId,
        rgba: [],
        width: entry.canvas.width,
        height: entry.canvas.height,
        x: layer.x,
        y: layer.y,
        rotation: layer.rotation,
        opacity: layer.opacity,
        zIndex: layer.zIndex,
        blendMode: layer.blendMode,
        isText: false,
      };
    }

    entry.animation.goToAndStop(frame, true);
    await Promise.resolve();

    const context = entry.canvas.getContext("2d");
    if (!context || entry.canvas.width === 0 || entry.canvas.height === 0) return null;
    const rgba = context.getImageData(0, 0, entry.canvas.width, entry.canvas.height).data;
    this.registeredFrames.add(assetId);
    if (this.registeredFrames.size > 512) {
      const first = this.registeredFrames.values().next().value;
      if (first) this.registeredFrames.delete(first);
    }

    return {
      assetId,
      rgba,
      width: entry.canvas.width,
      height: entry.canvas.height,
      x: layer.x,
      y: layer.y,
      rotation: layer.rotation,
      opacity: layer.opacity,
      zIndex: layer.zIndex,
      blendMode: layer.blendMode,
      isText: false,
    };
  }

  async prewarm(
    layer: EvaluatedMediaLayer,
    phase: TelemetryStickerPhase = "sticker-prefetch",
  ): Promise<void> {
    await this.render(layer, phase);
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.destroyEntry(entry);
    this.entries.clear();
    this.registeredFrames.clear();
  }

  private destroyEntry(entry: StickerRendererEntry): void {
    try {
      entry.animation.destroy();
    } catch {
      // ignore
    }
    entry.container.remove();
  }
}

let _sharedStickerRenderer: NativeAnimatedStickerRenderer | null = null;
export function getNativeAnimatedStickerRenderer(): NativeAnimatedStickerRenderer {
  if (!_sharedStickerRenderer) {
    _sharedStickerRenderer = new NativeAnimatedStickerRenderer();
  }
  return _sharedStickerRenderer;
}

