/**
 * Native raster bridge
 *
 * The native compositor is the rendering authority. Some editor constructs
 * (Studio text, gradient/shader backgrounds, and Lottie stickers) still need a
 * DOM-compatible evaluator to produce pixels. This bridge makes those pixels
 * immutable native raster assets that both preview and export reference by id.
 * It is deliberately instance-scoped: preview and each export job own a
 * bounded cache and dispose any Lottie DOM resources when their work ends.
 */

import type { EvaluatedMediaLayer, EvaluatedScene } from "@/core/evaluation/types";
import { drawCanvasBackground } from "@/core/render/canvasBackground";
import { SmartOverlayRenderer } from "@/features/smart-overlays/renderer/SmartOverlayRenderer";
import type { SmartOverlayClip } from "@/types/smartOverlay";
import { isTauriRuntime, registerNativeImageAsset, registerNativeRasterAsset } from "@/lib/platform/tauri";
import type { NativeRasterLayerSnapshot } from "@/lib/platform/nativeCore";
import { buildNativeImageAssetId } from "@/core/render/nativeRasterAssetIds";
import {
  buildNativeTextRasterKey,
  rasterizeTextLayerForNative,
  type NativeTextRasterAsset,
} from "@/components/editor/preview/nativeTextPreview";
import type { TextRenderTracePhase } from "@/core/render/textRenderTrace";
import {
  NativeAnimatedStickerRenderer,
  type NativeAnimatedStickerRaster,
} from "@/components/editor/preview/nativeStickerPreview";

type UploadableNativeRaster = NativeRasterLayerSnapshot & {
  rgba: number[];
  /** Text-only metadata used to reapply current compositor placement. */
  bleedX?: number;
  bleedY?: number;
};

interface NativeRasterBridgeOptions {
  frameKey: number;
  phase?: TextRenderTracePhase;
}

const MAX_TEXT_CACHE_ENTRIES = 96;
const MAX_REGISTERED_ASSETS = 256;

function evictOldest<TKey, TValue>(cache: Map<TKey, TValue>, maxEntries: number): void {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value as TKey | undefined;
    if (oldestKey === undefined) return;
    cache.delete(oldestKey);
  }
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function snapshot(asset: UploadableNativeRaster): NativeRasterLayerSnapshot {
  const { rgba: _rgba, bleedX: _bleedX, bleedY: _bleedY, ...reference } = asset;
  return reference;
}

/**
 * Produces and registers all raster assets that can be derived from an
 * EvaluatedScene alone. Unsupported raster sources remain explicit native
 * contract failures rather than falling back to the browser compositor.
 */
export class NativeRasterBridge {
  private readonly textCache = new Map<string, Promise<NativeTextRasterAsset>>();
  private readonly imageCache = new Map<string, Promise<void>>();
  private readonly imageSourcesById = new Map<string, { sourcePath: string; width: number; height: number }>();
  private readonly assetsById = new Map<string, UploadableNativeRaster>();
  private readonly registeredAssetIds = new Set<string>();
  private readonly animatedStickerRenderer = new NativeAnimatedStickerRenderer();

  async rasterize(scene: EvaluatedScene, options: NativeRasterBridgeOptions): Promise<NativeRasterLayerSnapshot[]> {
    if (!isTauriRuntime()) return [];

    // Studio text effects are authored and evaluated by the shared Canvas engine.
    // Keep those pixels intact and let native own only final composition; the
    // native SDF path remains a compatibility fallback for frames that cannot
    // be rasterized in the WebView.
    const [text, background, animatedStickers, images] = await Promise.all([
      this.rasterizeText(scene, options.phase ?? "visible-playback"),
      this.rasterizeBackground(scene, options.frameKey),
      this.rasterizeAnimatedStickers(scene),
      this.rasterizeImages(scene),
    ]);
    return [...background, ...text, ...animatedStickers, ...images];
  }

  /**
   * Warm only the text path for an upcoming timeline boundary. This is kept
   * separate from `rasterize` so playback can prepare a font/effect without
   * also decoding or uploading unrelated media for a frame that is not yet
   * visible.
   */
  async prewarmTextAssets(
    scene: EvaluatedScene,
    phase: TextRenderTracePhase = "text-prefetch",
  ): Promise<void> {
    if (!isTauriRuntime()) return;
    await this.rasterizeText(scene, phase);
  }

  /**
   * Smart overlays are evaluated as timeline entities rather than visual scene
   * layers. Keep that distinction explicit while giving preview and export the
   * same native raster representation.
   */
  async rasterizeSmartOverlays(
    activeClips: SmartOverlayClip[],
    time: number,
    width: number,
    height: number,
    options: NativeRasterBridgeOptions,
  ): Promise<NativeRasterLayerSnapshot[]> {
    if (!isTauriRuntime() || activeClips.length === 0) return [];
    if (typeof document === "undefined") {
      throw new Error("Native smart-overlay rasterization requires a canvas-capable desktop runtime");
    }

    const rasterWidth = Math.max(1, Math.round(width));
    const rasterHeight = Math.max(1, Math.round(height));
    // The rendered pixels are time-dependent, so this cache is intentionally
    // frame-addressed. The preview scheduler is responsible for ensuring that
    // only the newest playback frame reaches this method; callers must not
    // turn this into an unbounded background queue.
    const assetId = `native-smart-overlay:${options.frameKey}:${stableSerialize(activeClips)}`;
    const existing = this.assetsById.get(assetId);
    if (existing) {
      await this.register(existing);
      return [snapshot(existing)];
    }

    const canvas = document.createElement("canvas");
    canvas.width = rasterWidth;
    canvas.height = rasterHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to create a 2D context for native smart-overlay rasterization");
    context.clearRect(0, 0, rasterWidth, rasterHeight);
    for (const clip of activeClips) {
      new SmartOverlayRenderer(clip).draw(context, time - clip.startTime, rasterWidth, rasterHeight);
    }

    const rgba = Array.from(context.getImageData(0, 0, rasterWidth, rasterHeight).data);
    if (!rgba.some((value, index) => index % 4 === 3 && value > 0)) return [];
    const asset: UploadableNativeRaster = {
      assetId,
      rgba,
      width: rasterWidth,
      height: rasterHeight,
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 1,
      zIndex: 1_000_000,
      blendMode: "normal",
      isText: false,
    };
    await this.register(asset);
    return [snapshot(asset)];
  }

  /** Re-upload request assets after native device/cache recovery. */
  async reregister(references: NativeRasterLayerSnapshot[]): Promise<boolean> {
    const registrations = references.map((reference) => {
      const imageSource = this.imageSourcesById.get(reference.assetId);
      if (imageSource) {
        return registerNativeImageAsset({
          assetId: reference.assetId,
          ...imageSource,
        }).then(() => {
          this.registeredAssetIds.add(reference.assetId);
        });
      }
      const asset = this.assetsById.get(reference.assetId);
      return asset ? this.register(asset, true) : null;
    });
    if (registrations.some((registration) => registration === null)) return false;
    await Promise.all(registrations as Promise<void>[]);
    return true;
  }

  dispose(): void {
    this.textCache.clear();
    this.imageCache.clear();
    this.imageSourcesById.clear();
    this.assetsById.clear();
    this.registeredAssetIds.clear();
    this.animatedStickerRenderer.dispose();
  }

  private async rasterizeText(
    scene: EvaluatedScene,
    phase: TextRenderTracePhase,
  ): Promise<NativeRasterLayerSnapshot[]> {
    const layers = scene.visualLayers.filter((layer) => layer.layerType === "text");
    const pendingAssets = layers.map(async (layer) => {
      const key = buildNativeTextRasterKey(layer);
      let raster = this.textCache.get(key);
      if (!raster) {
        raster = rasterizeTextLayerForNative(layer, { phase });
        this.textCache.set(key, raster);
        evictOldest(this.textCache, MAX_TEXT_CACHE_ENTRIES);
        void raster.catch(() => {
          if (this.textCache.get(key) === raster) this.textCache.delete(key);
        });
      }
      const asset = await raster;
      // Pixels are immutable; placement is not. Entry/leave motion and
      // opacity must be expressed as native compositor uniforms instead of
      // causing a new Canvas raster and GPU upload every frame.
      return {
        ...asset,
        x: typeof layer.x === "number" ? layer.x - (asset.bleedX ?? 0) : asset.x,
        y: typeof layer.y === "number" ? layer.y - (asset.bleedY ?? 0) : asset.y,
        rotation: typeof layer.rotation === "number" ? layer.rotation : asset.rotation,
        opacity: typeof layer.opacity === "number" ? layer.opacity : asset.opacity,
        zIndex: typeof layer.zIndex === "number" ? layer.zIndex : asset.zIndex,
        blendMode: typeof layer.blendMode === "string" ? layer.blendMode : asset.blendMode,
      };
    });

    // Keep a single unsupported/malformed text layer from taking down the
    // complete native frame. Its absence intentionally selects the native
    // text snapshot fallback in buildNativeVideoProjectRequest.
    const rasterResults = await Promise.allSettled(pendingAssets);
    const assets = rasterResults
      .filter((result): result is PromiseFulfilledResult<NativeTextRasterAsset> => result.status === "fulfilled")
      .map((result) => result.value);

    const registrationResults = await Promise.allSettled(
      assets.map(async (asset) => {
        await this.register(asset);
        return asset;
      }),
    );
    return registrationResults
      .filter((result): result is PromiseFulfilledResult<NativeTextRasterAsset> => result.status === "fulfilled")
      .map((result) => snapshot(result.value));
  }

  private async rasterizeAnimatedStickers(scene: EvaluatedScene): Promise<NativeRasterLayerSnapshot[]> {
    const layers = scene.visualLayers.filter(
      (layer): layer is EvaluatedMediaLayer =>
        layer.layerType === "media" && layer.clipKind === "sticker" && layer.stickerFormat === "lottie",
    );
    const assets = await Promise.all(layers.map((layer) => this.animatedStickerRenderer.render(layer)));
    const resolved = assets.filter((asset): asset is NativeAnimatedStickerRaster => asset !== null);
    await Promise.all(resolved.map((asset) => this.register(asset)));
    return resolved.map(snapshot);
  }

  /**
   * Still images are native RGBA assets, not YUV video layers. Keeping this
   * distinction at the raster bridge preserves PNG/WebP alpha while allowing
   * the native compositor to own the final transform and blend operation.
   */
  private async rasterizeImages(scene: EvaluatedScene): Promise<NativeRasterLayerSnapshot[]> {
    const layers = scene.visualLayers.filter(
      (layer): layer is EvaluatedMediaLayer =>
        layer.layerType === "media" &&
        layer.mediaType === "image" &&
        layer.stickerFormat !== "gif" &&
        layer.stickerFormat !== "lottie",
    );
    const assets = await Promise.all(layers.map((layer) => {
      const width = Math.max(1, Math.round(layer.width));
      const height = Math.max(1, Math.round(layer.height));
      const assetId = buildNativeImageAssetId(layer.sourcePath, width, height);
      this.imageSourcesById.set(assetId, { sourcePath: layer.sourcePath, width, height });
      let registration = this.imageCache.get(assetId);
      if (!registration) {
        registration = registerNativeImageAsset({
          assetId,
          sourcePath: layer.sourcePath,
          width,
          height,
        }).then(() => {
          this.registeredAssetIds.add(assetId);
        });
        this.imageCache.set(assetId, registration);
        void registration.catch(() => {
          if (this.imageCache.get(assetId) === registration) this.imageCache.delete(assetId);
          this.registeredAssetIds.delete(assetId);
        });
      }
      return registration.then(() => ({
        assetId,
        width,
        height,
        x: layer.x,
        y: layer.y,
        rotation: layer.rotation,
        opacity: layer.opacity,
        zIndex: layer.zIndex,
        blendMode: layer.blendMode,
        isText: false,
      }));
    }));

    return assets;
  }

  private async rasterizeBackground(scene: EvaluatedScene, frameKey: number): Promise<NativeRasterLayerSnapshot[]> {
    const background = scene.metadata.canvasBackground;
    if (
      !background ||
      background.isTransparent ||
      background.type === "solid" ||
      (background.type !== "gradient" && background.type !== "shader")
    ) return [];
    if (typeof document === "undefined") {
      throw new Error("Native raster background requires a canvas-capable desktop runtime");
    }

    const width = Math.max(1, Math.round(scene.metadata.canvasWidth));
    const height = Math.max(1, Math.round(scene.metadata.canvasHeight));
    // Gradients are immutable for a given configuration and dimensions. The
    // old frame-keyed identity forced a full-canvas getImageData() and native
    // upload on every playback frame even though the pixels never changed.
    // Shaders are time-dependent and remain frame-addressed until they have a
    // native procedural implementation.
    const backgroundIdentity = stableSerialize(background);
    const timeDependent = background.type === "shader";
    const assetId = timeDependent
      ? `native-background:${frameKey}:${backgroundIdentity}`
      : `native-background:${backgroundIdentity}:${width}x${height}`;
    const existing = this.assetsById.get(assetId);
    if (existing) {
      await this.register(existing);
      return [snapshot(existing)];
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to create a 2D context for native background rasterization");
    drawCanvasBackground(context, background, width, height, scene.metadata.time);
    const asset: UploadableNativeRaster = {
      assetId,
      rgba: Array.from(context.getImageData(0, 0, width, height).data),
      width,
      height,
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 1,
      zIndex: -1_000_000,
      blendMode: "normal",
      isText: false,
    };
    await this.register(asset);
    return [snapshot(asset)];
  }

  private async register(asset: UploadableNativeRaster, force = false): Promise<void> {
    this.assetsById.delete(asset.assetId);
    this.assetsById.set(asset.assetId, asset);
    while (this.assetsById.size > MAX_REGISTERED_ASSETS) {
      const oldestId = this.assetsById.keys().next().value as string | undefined;
      if (!oldestId) break;
      this.assetsById.delete(oldestId);
      this.registeredAssetIds.delete(oldestId);
    }
    if (!force && this.registeredAssetIds.has(asset.assetId)) return;
    if (asset.rgba && asset.rgba.length > 0) {
      await registerNativeRasterAsset(asset);
    }
    this.registeredAssetIds.add(asset.assetId);
  }
}
