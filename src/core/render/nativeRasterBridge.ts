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

import type {
  EvaluatedMediaLayer,
  EvaluatedScene,
} from "@/core/evaluation/types";
import { drawCanvasBackground } from "@/core/render/canvasBackground";
import { SmartOverlayRenderer } from "@/features/smart-overlays/renderer/SmartOverlayRenderer";
import type { SmartOverlayClip } from "@/types/smartOverlay";
import {
  isTauriRuntime,
  registerNativeImageAsset,
  registerNativeRasterAsset,
} from "@/lib/platform/tauri";
import type { NativeRasterLayerSnapshot } from "@/lib/platform/nativeCore";
import { buildNativeImageAssetId } from "@/core/render/nativeRasterAssetIds";
import {
  buildNativeTextRasterKey,
  rasterizeTextLayerForNative,
  type NativeTextRasterAsset,
} from "@/components/editor/preview/nativeTextPreview";
import {
  traceTextRenderTiming,
  type TextRenderTracePhase,
} from "@/core/render/textRenderTrace";
import { LatestTextPreparationScheduler } from "@/core/render/latestTextPreparationScheduler";
import {
  NativeAnimatedStickerRenderer,
  type NativeAnimatedStickerRaster,
} from "@/components/editor/preview/nativeStickerPreview";
import { TemplateRasterizerWorkerClient } from "@/core/render/templateRasterizerWorkerClient";

type UploadableNativeRaster = NativeRasterLayerSnapshot & {
  /**
   * Pixel data as Uint8ClampedArray (from rasterizeTextLayerForNative) or
   * number[] (from legacy smart-overlay / background paths). The register()
   * method converts to number[] only at the Tauri IPC boundary.
   */
  rgba: Uint8ClampedArray | number[];
  /** Text-only metadata used to reapply current compositor placement. */
  bleedX?: number;
  bleedY?: number;
  positionMode?: "centered" | "absolute";
  timing?: NativeTextRasterAsset["timing"];
};

interface NativeRasterBridgeOptions {
  frameKey: number;
  phase?: TextRenderTracePhase;
  /**
   * Playback is a real-time stream. Cold text assets must never make the
   * visible frame wait for font loading, Canvas rasterization, or readback.
   * Paused/seeked renders leave this false so the requested frame is exact.
   */
  nonBlockingText?: boolean;
}

const MAX_TEXT_CACHE_ENTRIES = 96;
const MAX_REGISTERED_ASSETS = 256;
const PLAYBACK_TEXT_OBSERVATION_INTERVAL_MS = 250;

function evictOldest<TKey, TValue>(
  cache: Map<TKey, TValue>,
  maxEntries: number,
): void {
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
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function snapshot(asset: UploadableNativeRaster): NativeRasterLayerSnapshot {
  const {
    rgba: _rgba,
    bleedX: _bleedX,
    bleedY: _bleedY,
    positionMode: _positionMode,
    timing: _timing,
    ...reference
  } = asset;
  return reference;
}

type NativeTextLayer = Parameters<typeof buildNativeTextRasterKey>[0];
type TextPreparationInput = {
  layer: NativeTextLayer;
  key: string;
  phase: TextRenderTracePhase;
  generation: number;
};

function textKind(layer: NativeTextLayer): "plain" | "effect" | "template" {
  return layer.templateId || layer.clipKind === "text-template"
    ? "template"
    : layer.styleId
      ? "effect"
      : "plain";
}

/**
 * Produces and registers all raster assets that can be derived from an
 * EvaluatedScene alone. Unsupported raster sources remain explicit native
 * contract failures rather than falling back to the browser compositor.
 */
export class NativeRasterBridge {
  private readonly textCache = new Map<
    string,
    Promise<NativeTextRasterAsset>
  >();
  /** Last registered frame per layer, used as a non-blocking playback fallback. */
  private readonly textSnapshotsByLayerId = new Map<
    string,
    NativeRasterLayerSnapshot
  >();
  private readonly textSnapshotKeysByLayerId = new Map<string, string>();
  private readonly lastTextPlaybackObservationAtByLayerId = new Map<
    string,
    number
  >();
  /**
   * Bleed and position-mode metadata stripped by snapshot() but needed to
   * recompute placement from current layer coordinates in the non-blocking path.
   */
  private readonly textSnapshotBleedByLayerId = new Map<
    string,
    {
      bleedX: number;
      bleedY: number;
      positionMode: "centered" | "absolute";
    }
  >();
  private readonly imageCache = new Map<string, Promise<void>>();
  private readonly imageSourcesById = new Map<
    string,
    { sourcePath: string; width: number; height: number }
  >();
  private readonly assetsById = new Map<string, UploadableNativeRaster>();
  private readonly registeredAssetIds = new Set<string>();
  private readonly animatedStickerRenderer =
    new NativeAnimatedStickerRenderer();
  private textPreparationGeneration = 0;
  /** One active raster plus one latest replacement for real-time playback. */
  private readonly textPreparationScheduler =
    new LatestTextPreparationScheduler<TextPreparationInput>(
      (input) => this.prepareTextAsset(input),
      (error, input) =>
        console.error("[NativeRasterBridge] background text frame failed", {
          layerId: input.layer.layerId,
          templateId: input.layer.templateId,
          revisionId: input.layer.templateRevisionId,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  /**
   * Off-thread renderer for animated text templates.
   * Routes renderTextTemplateToCanvas to a Worker via OffscreenCanvas so the
   * main JS thread is never blocked by template pixel generation.
   */
  private readonly templateRasterizerWorkerClient =
    new TemplateRasterizerWorkerClient();

  async rasterize(
    scene: EvaluatedScene,
    options: NativeRasterBridgeOptions,
  ): Promise<NativeRasterLayerSnapshot[]> {
    if (!isTauriRuntime()) return [];

    const hasVisualLayers =
      Array.isArray(scene.visualLayers) && scene.visualLayers.length > 0;
    const bg = scene.metadata?.canvasBackground;
    const hasComplexBg = Boolean(
      bg &&
      !bg.isTransparent &&
      bg.type !== "solid" &&
      (bg.type === "gradient" || bg.type === "shader"),
    );

    if (!hasVisualLayers && !hasComplexBg) {
      return [];
    }

    // Studio text effects are authored and evaluated by the shared Canvas engine.
    // Keep those pixels intact and let native own only final composition; the
    // native SDF path remains a compatibility fallback for frames that cannot
    // be rasterized in the WebView.
    const [text, background, animatedStickers, images] = await Promise.all([
      hasVisualLayers
        ? this.rasterizeText(
            scene,
            options.phase ?? "visible-playback",
            options.nonBlockingText === true,
          )
        : Promise.resolve([]),
      hasComplexBg
        ? this.rasterizeBackground(scene, options.frameKey)
        : Promise.resolve([]),
      hasVisualLayers
        ? this.rasterizeAnimatedStickers(scene)
        : Promise.resolve([]),
      hasVisualLayers ? this.rasterizeImages(scene) : Promise.resolve([]),
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
    await this.rasterizeText(scene, phase, false);
  }

  /**
   * Register still-image assets before they become visible. Image decoding is
   * native-owned, so doing this during session initialization prevents the
   * first image boundary from competing with the playback presenter.
   */
  async prewarmImageAssets(scene: EvaluatedScene): Promise<void> {
    if (!isTauriRuntime()) return;
    await this.rasterizeImages(scene);
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
      throw new Error(
        "Native smart-overlay rasterization requires a canvas-capable desktop runtime",
      );
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
    if (!context)
      throw new Error(
        "Unable to create a 2D context for native smart-overlay rasterization",
      );
    context.clearRect(0, 0, rasterWidth, rasterHeight);
    for (const clip of activeClips) {
      new SmartOverlayRenderer(clip).draw(
        context,
        time - clip.startTime,
        rasterWidth,
        rasterHeight,
      );
    }

    const rgba = Array.from(
      context.getImageData(0, 0, rasterWidth, rasterHeight).data,
    );
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
    if (registrations.some((registration) => registration === null))
      return false;
    await Promise.all(registrations as Promise<void>[]);
    return true;
  }

  dispose(): void {
    this.textPreparationGeneration += 1;
    this.textPreparationScheduler.dispose();
    this.templateRasterizerWorkerClient.dispose();
    this.textCache.clear();
    this.textSnapshotsByLayerId.clear();
    this.textSnapshotKeysByLayerId.clear();
    this.textSnapshotBleedByLayerId.clear();
    this.lastTextPlaybackObservationAtByLayerId.clear();
    this.imageCache.clear();
    this.imageSourcesById.clear();
    this.assetsById.clear();
    this.registeredAssetIds.clear();
    this.animatedStickerRenderer.dispose();
  }

  private async rasterizeText(
    scene: EvaluatedScene,
    phase: TextRenderTracePhase,
    nonBlocking: boolean,
  ): Promise<NativeRasterLayerSnapshot[]> {
    const layers = scene.visualLayers.filter(
      (layer) => layer.layerType === "text",
    );
    if (layers.length === 0) return [];
    const pendingAssets = layers.map(async (layer) => {
      const key = buildNativeTextRasterKey(layer);
      // During playback, never make the transport wait for a new animated
      // texture upload. The previous frame is already registered with the
      // native compositor and is a deterministic visual fallback while this
      // timestamp's texture is rasterized/uploaded in the background. The
      // first frame has no fallback and is awaited during session prewarm or
      // the initial visible render.
      const previous = this.textSnapshotsByLayerId.get(layer.layerId);
      const hasCurrentSnapshot =
        this.textSnapshotKeysByLayerId.get(layer.layerId) === key;
      if (nonBlocking && phase === "visible-playback") {
        const now = Date.now();
        const lastObservationAt =
          this.lastTextPlaybackObservationAtByLayerId.get(layer.layerId) ?? 0;
        if (
          (hasCurrentSnapshot || previous) &&
          now - lastObservationAt >= PLAYBACK_TEXT_OBSERVATION_INTERVAL_MS
        ) {
          this.lastTextPlaybackObservationAtByLayerId.set(layer.layerId, now);
          // Reuse is still a real playback observation. Without this sample,
          // the Admin page only sees cold raster completions and cannot tell
          // whether a visible text clip was advancing on a cached bitmap.
          traceTextRenderTiming({
            phase,
            kind: textKind(layer),
            rendererPath: "native-raster",
            assetId: previous?.assetId,
            layerId: layer.layerId,
            fontFamily: layer.fontFamily,
            fontWaitMs: 0,
            rasterMs: 0,
            readbackMs: 0,
            transferMs: 0,
            paintMs: 0,
            outputPixels: previous ? previous.width * previous.height : 0,
            // A previous complete bitmap is a valid cache/reuse hit even
            // while the latest animated key is still being prepared.
            cacheHit: Boolean(previous),
            totalMs: 0,
            operation: layer.animationOperation ?? "render",
            contentLength: layer.text.length,
            lineCount: layer.text.split(/\r?\n/).length,
            layoutWidth: layer.width,
            layoutHeight: layer.height,
          });
        }

        if (!hasCurrentSnapshot) {
          this.textPreparationScheduler.enqueue(key, {
            layer,
            key,
            phase,
            generation: this.textPreparationGeneration,
          });
        }
        // The pixel buffer is immutable — no re-raster needed. But placement
        // (x, y, rotation, opacity, zIndex) is time-varying: the non-blocking
        // path must apply the current frame's layer properties to the cached
        // snapshot, otherwise the text renders at pause-time coordinates for
        // the entire duration of playback (text invisible or at wrong position).
        if (previous) {
          const bleed = this.textSnapshotBleedByLayerId.get(layer.layerId);
          const updatedSnapshot: NativeRasterLayerSnapshot = {
            ...previous,
            x:
              bleed?.positionMode === "absolute"
                ? previous.x
                : typeof layer.x === "number"
                  ? layer.x - (bleed?.bleedX ?? 0)
                  : previous.x,
            y:
              bleed?.positionMode === "absolute"
                ? previous.y
                : typeof layer.y === "number"
                  ? layer.y - (bleed?.bleedY ?? 0)
                  : previous.y,
            rotation:
              typeof layer.rotation === "number"
                ? layer.rotation
                : previous.rotation,
            opacity:
              typeof layer.opacity === "number"
                ? layer.opacity
                : previous.opacity,
            zIndex:
              typeof layer.zIndex === "number" ? layer.zIndex : previous.zIndex,
            blendMode:
              typeof layer.blendMode === "string"
                ? layer.blendMode
                : previous.blendMode,
          };
          this.textSnapshotsByLayerId.set(layer.layerId, updatedSnapshot);
          return updatedSnapshot;
        }
        return null;
      }

      const asset = await this.getTextRaster(layer, key, phase);
      // Pixels are immutable; placement is not. Entry/leave motion and
      // opacity must be expressed as native compositor uniforms instead of
      // causing a new Canvas raster and GPU upload every frame.
      const positioned = {
        ...asset,
        x:
          asset.positionMode === "absolute"
            ? asset.x
            : typeof layer.x === "number"
              ? layer.x - (asset.bleedX ?? 0)
              : asset.x,
        y:
          asset.positionMode === "absolute"
            ? asset.y
            : typeof layer.y === "number"
              ? layer.y - (asset.bleedY ?? 0)
              : asset.y,
        rotation:
          typeof layer.rotation === "number" ? layer.rotation : asset.rotation,
        opacity:
          typeof layer.opacity === "number" ? layer.opacity : asset.opacity,
        zIndex: typeof layer.zIndex === "number" ? layer.zIndex : asset.zIndex,
        blendMode:
          typeof layer.blendMode === "string"
            ? layer.blendMode
            : asset.blendMode,
      };
      await this.register(positioned);
      const result = snapshot(positioned);
      this.textSnapshotsByLayerId.set(layer.layerId, result);
      this.textSnapshotKeysByLayerId.set(layer.layerId, key);
      this.textSnapshotBleedByLayerId.set(layer.layerId, {
        bleedX: asset.bleedX ?? 0,
        bleedY: asset.bleedY ?? 0,
        positionMode: asset.positionMode ?? "centered",
      });
      return positioned;
    });

    // Keep a single unsupported/malformed text layer from taking down the
    // complete native frame. Its absence intentionally selects the native
    // text snapshot fallback in buildNativeVideoProjectRequest.
    const rasterResults = await Promise.allSettled(pendingAssets);
    const assets = rasterResults
      .filter(
        (
          result,
        ): result is PromiseFulfilledResult<NativeTextRasterAsset | null> => {
          if (result.status === "rejected") {
            console.error(
              "[NativeRasterBridge] text-layer-raster-failed",
              result.reason,
            );
            return false;
          }
          return true;
        },
      )
      .map((result) => result.value)
      .filter((asset): asset is NativeTextRasterAsset => asset !== null);

    return assets.map((asset) => snapshot(asset));
  }

  private getTextRaster(
    layer: NativeTextLayer,
    key: string,
    phase: TextRenderTracePhase,
  ): Promise<NativeTextRasterAsset> {
    let raster = this.textCache.get(key);
    if (!raster) {
      // Template layers are rendered off-thread via TemplateRasterizerWorkerClient
      // so the main JS thread is never blocked by renderTextTemplateToCanvas.
      // Plain and effect text layers continue using the existing synchronous path.
      const isTemplate =
        Boolean(layer.templateId) || layer.clipKind === "text-template";
      raster = isTemplate
        ? this.templateRasterizerWorkerClient.rasterize(layer, key, phase)
        : rasterizeTextLayerForNative(layer, { phase });
      this.textCache.set(key, raster);
      evictOldest(this.textCache, MAX_TEXT_CACHE_ENTRIES);
      void raster.catch(() => {
        if (this.textCache.get(key) === raster) this.textCache.delete(key);
      });
    }
    return raster;
  }

  private async prepareTextAsset(input: TextPreparationInput): Promise<void> {
    const asset = await this.getTextRaster(input.layer, input.key, input.phase);
    if (input.generation !== this.textPreparationGeneration) return;
    await this.register(asset);
    if (input.generation !== this.textPreparationGeneration) return;
    const positioned = {
      ...asset,
      x:
        asset.positionMode === "absolute"
          ? asset.x
          : typeof input.layer.x === "number"
            ? input.layer.x - (asset.bleedX ?? 0)
            : asset.x,
      y:
        asset.positionMode === "absolute"
          ? asset.y
          : typeof input.layer.y === "number"
            ? input.layer.y - (asset.bleedY ?? 0)
            : asset.y,
      rotation:
        typeof input.layer.rotation === "number"
          ? input.layer.rotation
          : asset.rotation,
      opacity:
        typeof input.layer.opacity === "number"
          ? input.layer.opacity
          : asset.opacity,
      zIndex:
        typeof input.layer.zIndex === "number"
          ? input.layer.zIndex
          : asset.zIndex,
      blendMode:
        typeof input.layer.blendMode === "string"
          ? input.layer.blendMode
          : asset.blendMode,
    };
    this.textSnapshotsByLayerId.set(input.layer.layerId, snapshot(positioned));
    this.textSnapshotKeysByLayerId.set(input.layer.layerId, input.key);
    this.textSnapshotBleedByLayerId.set(input.layer.layerId, {
      bleedX: asset.bleedX ?? 0,
      bleedY: asset.bleedY ?? 0,
      positionMode: asset.positionMode ?? "centered",
    });
  }

  private async rasterizeAnimatedStickers(
    scene: EvaluatedScene,
  ): Promise<NativeRasterLayerSnapshot[]> {
    const layers = scene.visualLayers.filter(
      (layer): layer is EvaluatedMediaLayer =>
        layer.layerType === "media" &&
        layer.clipKind === "sticker" &&
        layer.stickerFormat === "lottie",
    );
    if (layers.length === 0) return [];
    const assets = await Promise.all(
      layers.map((layer) => this.animatedStickerRenderer.render(layer)),
    );
    const resolved = assets.filter(
      (asset): asset is NativeAnimatedStickerRaster => asset !== null,
    );
    await Promise.all(resolved.map((asset) => this.register(asset)));
    return resolved.map(snapshot);
  }

  /**
   * Still images are native RGBA assets, not YUV video layers. Keeping this
   * distinction at the raster bridge preserves PNG/WebP alpha while allowing
   * the native compositor to own the final transform and blend operation.
   */
  private async rasterizeImages(
    scene: EvaluatedScene,
  ): Promise<NativeRasterLayerSnapshot[]> {
    const layers = scene.visualLayers.filter(
      (layer): layer is EvaluatedMediaLayer =>
        layer.layerType === "media" &&
        layer.mediaType === "image" &&
        layer.stickerFormat !== "gif" &&
        layer.stickerFormat !== "lottie",
    );
    if (layers.length === 0) return [];
    const assets = await Promise.all(
      layers.map((layer) => {
        // Placement changes on every transform frame; the source texture does
        // not. Registering by display dimensions caused a fresh decode/upload
        // for every resize. Keep the immutable source resource keyed by source
        // dimensions and send placement dimensions separately to the compositor.
        const width = Math.max(1, Math.round(layer.sourceWidth ?? layer.width));
        const height = Math.max(
          1,
          Math.round(layer.sourceHeight ?? layer.height),
        );
        const displayWidth = Math.max(1, layer.width);
        const displayHeight = Math.max(1, layer.height);
        const assetId = buildNativeImageAssetId(
          layer.sourcePath,
          width,
          height,
        );
        this.imageSourcesById.set(assetId, {
          sourcePath: layer.sourcePath,
          width,
          height,
        });
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
            if (this.imageCache.get(assetId) === registration)
              this.imageCache.delete(assetId);
            this.registeredAssetIds.delete(assetId);
          });
        }
        return registration.then(() => ({
          assetId,
          width,
          height,
          ...(displayWidth !== width ? { displayWidth } : {}),
          ...(displayHeight !== height ? { displayHeight } : {}),
          x: layer.x,
          y: layer.y,
          rotation: layer.rotation,
          opacity: layer.opacity,
          zIndex: layer.zIndex,
          blendMode: layer.blendMode,
          isText: false,
        }));
      }),
    );

    return assets;
  }

  private async rasterizeBackground(
    scene: EvaluatedScene,
    frameKey: number,
  ): Promise<NativeRasterLayerSnapshot[]> {
    const background = scene.metadata.canvasBackground;
    if (
      !background ||
      background.isTransparent ||
      background.type === "solid" ||
      (background.type !== "gradient" && background.type !== "shader")
    )
      return [];
    if (typeof document === "undefined") {
      throw new Error(
        "Native raster background requires a canvas-capable desktop runtime",
      );
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
    if (!context)
      throw new Error(
        "Unable to create a 2D context for native background rasterization",
      );
    drawCanvasBackground(
      context,
      background,
      width,
      height,
      scene.metadata.time,
    );
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

  private async register(
    asset: UploadableNativeRaster,
    force = false,
  ): Promise<void> {
    this.assetsById.delete(asset.assetId);
    this.assetsById.set(asset.assetId, asset);
    while (this.assetsById.size > MAX_REGISTERED_ASSETS) {
      const oldestId = this.assetsById.keys().next().value as
        | string
        | undefined;
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
