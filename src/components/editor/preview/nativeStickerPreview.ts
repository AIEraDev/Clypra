import lottie from "lottie-web";
import { appCacheDir, join } from "@tauri-apps/api/path";
import { useStickersStore } from "@/features/stickers/store/stickersStore";
import { stickerCacheManager } from "@/features/stickers/cache/stickerCache";
import type { EvaluatedMediaLayer } from "@/core/evaluation/types";
import type { NativeRasterLayerSnapshot } from "@/lib/platform/nativeCore";

export type NativeAnimatedStickerRaster = NativeRasterLayerSnapshot & { rgba: number[] };

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
 * Lottie evaluation remains in the Studio-compatible JS engine for now, but
 * Pixi never receives the resulting frame. The pixels are registered once in
 * the native GPU cache and the native graph owns transforms, blending, and
 * presentation. This is the migration seam until a Rust font/vector Lottie
 * evaluator is available on every target OS.
 */
export class NativeAnimatedStickerRenderer {
  private readonly entries = new Map<string, StickerRendererEntry>();

  async render(layer: EvaluatedMediaLayer): Promise<NativeAnimatedStickerRaster | null> {
    if (layer.clipKind !== "sticker" || layer.stickerFormat !== "lottie") return null;
    if (typeof document === "undefined") return null;

    const stickerId = layer.stickerSourceId || layer.mediaId.replace("sticker-", "");
    let cachedSticker = useStickersStore.getState().getCachedSticker(stickerId);
    if (!cachedSticker) {
      await useStickersStore.getState().initializeCache();
      cachedSticker = useStickersStore.getState().getCachedSticker(stickerId);
    }

    let sourcePath = cachedSticker?.localAnimationPath ?? layer.stickerAnimationPath ?? "";
    if (!sourcePath) return null;
    if (!sourcePath.startsWith("/") && !sourcePath.startsWith("file:") && !sourcePath.startsWith("asset://")) {
      sourcePath = await join(await appCacheDir(), sourcePath);
    }

    const width = Math.max(1, Math.ceil(layer.width));
    const height = Math.max(1, Math.ceil(layer.height));
    let entry = this.entries.get(layer.layerId);
    if (!entry || entry.sourcePath !== sourcePath || entry.width !== width || entry.height !== height) {
      if (entry) this.destroyEntry(entry);
      const animationData = await stickerCacheManager.readLottieJson(sourcePath);
      const container = document.createElement("div");
      container.style.position = "absolute";
      container.style.left = "-100000px";
      container.style.top = "-100000px";
      container.style.width = `${width}px`;
      container.style.height = `${height}px`;
      container.style.overflow = "hidden";
      document.body.appendChild(container);
      const animation = lottie.loadAnimation({
        container,
        renderer: "canvas",
        autoplay: false,
        loop: false,
        animationData: JSON.parse(JSON.stringify(animationData)),
      });
      animation.goToAndStop(0, true);
      await Promise.resolve();
      const canvas = container.querySelector("canvas") as HTMLCanvasElement | null;
      if (!canvas) {
        animation.destroy();
        container.remove();
        return null;
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
    entry.animation.goToAndStop(frame, true);
    await Promise.resolve();

    const context = entry.canvas.getContext("2d");
    if (!context || entry.canvas.width === 0 || entry.canvas.height === 0) return null;
    const rgba = Array.from(context.getImageData(0, 0, entry.canvas.width, entry.canvas.height).data);
    return {
      assetId: `native-sticker:${layer.layerId}:${frame}:${entry.canvas.width}x${entry.canvas.height}`,
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

  dispose(): void {
    for (const entry of this.entries.values()) this.destroyEntry(entry);
    this.entries.clear();
  }

  private destroyEntry(entry: StickerRendererEntry): void {
    try {
      entry.animation.destroy();
    } catch {
      // Lottie destroy is best-effort during React effect teardown.
    }
    entry.container.remove();
  }
}
