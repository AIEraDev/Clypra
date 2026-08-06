import { Sprite } from "pixi.js";
import type { EvaluatedMediaLayer } from "../evaluation/types.js";
import { useStickersStore } from "../../features/stickers/store/stickersStore.js";
import { normalizeIconSize } from "../../lib/utils/fixedSizing.js";


import {
  beginStickerFrame as engineBeginStickerFrame,
  renderStickerLayerBridged as engineRenderStickerLayerBridged,
  unmountStickerLayerBridge as engineUnmountStickerLayerBridge,
  endStickerFrame as engineEndStickerFrame,
  clearAllStickerBridges as engineClearAllStickerBridges
} from "@clypra-studio/engine";

export function beginStickerFrame(container: import("pixi.js").Container): void {
  engineBeginStickerFrame(container);
}

export async function renderStickerLayerBridged(
  layer: EvaluatedMediaLayer,
  frameId: number,
  container: import("pixi.js").Container,
  viewport: { scale: number; offsetX: number; offsetY: number; pixelRatio: number },
  renderOrder: number,
): Promise<Sprite | null> {
  const stickerId = layer.stickerSourceId || layer.mediaId.replace("sticker-", "");
  let cachedSticker = useStickersStore.getState().getCachedSticker(stickerId);
  if (!cachedSticker) {
    await useStickersStore.getState().initializeCache();
    cachedSticker = useStickersStore.getState().getCachedSticker(stickerId);
  }

  const lottieSourcePath = cachedSticker?.localAnimationPath ?? layer.stickerAnimationPath;
  if (!lottieSourcePath) return null;

  // Decoupled Lottie JSON reading
  const { stickerCacheManager } = await import("@/features/stickers/cache/stickerCache");
  let absoluteLottiePath = lottieSourcePath;
  if (!absoluteLottiePath.startsWith("/") && !absoluteLottiePath.startsWith("file:") && !absoluteLottiePath.startsWith("asset://")) {
    const { appCacheDir, join } = await import("@tauri-apps/api/path");
    const appCache = await appCacheDir();
    absoluteLottiePath = await join(appCache, absoluteLottiePath);
  }

  const lottieData = await stickerCacheManager.readLottieJson(absoluteLottiePath);

  const normalizedBounds = normalizeIconSize(layer.width, layer.height);
  const normalizedLayer = {
    ...layer,
    width: normalizedBounds.width,
    height: normalizedBounds.height,
  };

  return engineRenderStickerLayerBridged(
    normalizedLayer,
    lottieData,
    frameId,
    container,
    viewport,
    renderOrder,
    stickerId
  );

}

export function unmountStickerLayerBridge(layerId: string, container: import("pixi.js").Container): void {
  engineUnmountStickerLayerBridge(layerId, container);
}

export function endStickerFrame(frameId: number, container: import("pixi.js").Container): void {
  engineEndStickerFrame(frameId, container);
}

export function clearAllStickerBridges(container?: import("pixi.js").Container): void {
  engineClearAllStickerBridges(container);
}
