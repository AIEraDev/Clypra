import type {
  EvaluatedScene,
  EvaluatedTextLayer,
} from "@/core/evaluation/types";
import { resolveTextTemplateArtifact } from "@clypra-studio/engine";
import { effectBleed, resolveTextEffectDefinition } from "@/lib/text/textClip";
import {
  getTextRenderMetrics,
  normalizeFontSize,
} from "@/lib/utils/fixedSizing";
import { rasterizeTextLayer } from "@/core/render/textRasterizer";
import { getFontLoader } from "@/core/fonts/FontLoader";
import {
  traceTextRenderGeometry,
  traceTextRenderCacheHit,
  traceTextRenderTiming,
  type TextRenderKind,
  type TextRenderPath,
  type TextRenderTracePhase,
  type TextRenderOperation,
} from "@/core/render/textRenderTrace";

export interface NativeTextRasterAsset {
  assetId: string;
  rgba: number[];
  width: number;
  height: number;
  x: number;
  y: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  blendMode: string;
  isText: true;
  /** Cropped template textures use absolute project-space placement. */
  positionMode?: "centered" | "absolute";
  /** Internal geometry metadata; not part of the native wire snapshot. */
  bleedX?: number;
  bleedY?: number;
  /** Internal timing carried to the WebView painter; never sent to Native. */
  timing?: {
    phase: TextRenderTracePhase;
    kind: TextRenderKind;
    rendererPath: TextRenderPath;
    fontWaitMs: number;
    rasterMs: number;
    readbackMs: number;
    totalMs: number;
    outputPixels: number;
    operation?: TextRenderOperation;
    contentLength?: number;
    lineCount?: number;
    layoutWidth?: number;
    layoutHeight?: number;
  };
}

/**
 * Browser program-preview bridge for text layers. Desktop uses the native
 * compositor, while localhost/browser preview still needs a real paint path.
 * It intentionally reuses rasterizeTextLayerForNative, so template/effect
 * semantics remain package-owned and only final bitmap placement lives here.
 */
export async function paintTextLayersToCanvas(
  canvas: HTMLCanvasElement,
  scene: EvaluatedScene,
  phase: TextRenderTracePhase = "visible-playback",
): Promise<void> {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const layers = scene.visualLayers
    .filter(
      (layer): layer is EvaluatedTextLayer =>
        layer.layerType === "text" && layer.opacity > 0,
    )
    .sort((a, b) => a.zIndex - b.zIndex);
  const activeLayerIds = new Set(layers.map((layer) => layer.layerId));
  for (const layerId of browserTextAssetByLayerId.keys()) {
    if (!activeLayerIds.has(layerId)) {
      browserTextAssetByLayerId.delete(layerId);
      browserTextAssetKeyByLayerId.delete(layerId);
    }
  }

  const rasterResults = await Promise.allSettled(
    layers.map(async (layer) => {
      const rasterKey = buildNativeTextRasterKey(layer);
      let rasterPromise = browserTextRasterCache.get(rasterKey);
      if (!rasterPromise) {
        rasterPromise = rasterizeTextLayerForNative(layer, {
          phase,
          rendererPath: "webview-canvas",
          deferTelemetry: true,
        });
        browserTextRasterCache.set(rasterKey, rasterPromise);
        while (browserTextRasterCache.size > MAX_BROWSER_TEXT_RASTER_ENTRIES) {
          const oldestKey = browserTextRasterCache.keys().next().value as
            | string
            | undefined;
          if (!oldestKey) break;
          browserTextRasterCache.delete(oldestKey);
        }
        void rasterPromise.catch(() => {
          if (browserTextRasterCache.get(rasterKey) === rasterPromise)
            browserTextRasterCache.delete(rasterKey);
        });
      } else {
        traceTextRenderCacheHit({ kind: getTextRenderKind(layer), rendererPath: "webview-canvas", phase });
      }

      const previous = browserTextAssetByLayerId.get(layer.layerId);
      if (
        phase === "visible-playback" &&
        previous &&
        browserTextAssetKeyByLayerId.get(layer.layerId) !== rasterKey
      ) {
        // A WebView playback frame is also latest-value work. Keep painting
        // the last complete bitmap while a changed font/content/layout is
        // rasterized, instead of blocking the visible loop on Canvas/font
        // work. Paused/interactive renders remain strict below.
        void rasterPromise
          .then((asset) => {
            browserTextAssetByLayerId.set(layer.layerId, asset);
            browserTextAssetKeyByLayerId.set(layer.layerId, rasterKey);
          })
          .catch(() => undefined);
        return { layer, asset: previous };
      }
      const asset = await rasterPromise;
      browserTextAssetByLayerId.set(layer.layerId, asset);
      browserTextAssetKeyByLayerId.set(layer.layerId, rasterKey);
      return { layer, asset };
    }),
  );

  for (const result of rasterResults) {
    if (result.status === "rejected") {
      console.error(
        "[browser-preview] text-layer-raster-failed",
        result.reason,
      );
      continue;
    }
    const { layer, asset } = result.value;
    const bitmapCanvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(asset.width, asset.height)
        : document.createElement("canvas");
    bitmapCanvas.width = asset.width;
    bitmapCanvas.height = asset.height;
    const bitmapContext = bitmapCanvas.getContext("2d");
    if (!bitmapContext) continue;
    const transferStartedAt = performance.now();
    const image = bitmapContext.createImageData(asset.width, asset.height);
    image.data.set(asset.rgba);
    bitmapContext.putImageData(image, 0, 0);
    const transferMs = performance.now() - transferStartedAt;
    const paintStartedAt = performance.now();
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    const isAbsolute = asset.positionMode === "absolute";
    const centerX = isAbsolute
      ? asset.x + asset.width / 2
      : layer.x + layer.width / 2;
    const centerY = isAbsolute
      ? asset.y + asset.height / 2
      : layer.y + layer.height / 2;
    ctx.translate(centerX, centerY);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.drawImage(
      bitmapCanvas as unknown as CanvasImageSource,
      -asset.width / 2,
      -asset.height / 2,
    );
    ctx.restore();
    const paintMs = performance.now() - paintStartedAt;
    if (asset.timing) {
      traceTextRenderTiming({
        ...asset.timing,
        transferMs,
        paintMs,
        totalMs: asset.timing.totalMs + transferMs + paintMs,
      });
    }
  }
}

const MAX_BROWSER_TEXT_RASTER_ENTRIES = 96;
const browserTextRasterCache = new Map<
  string,
  Promise<NativeTextRasterAsset>
>();
const browserTextAssetByLayerId = new Map<string, NativeTextRasterAsset>();
const browserTextAssetKeyByLayerId = new Map<string, string>();

/**
 * Preview rendering is a real-time stream. Font discovery is a preparation
 * concern and must never hold the frame scheduler indefinitely (particularly
 * for a catalog font that is unavailable offline). The renderer still uses
 * the requested family when the promise completes, but a frame may proceed
 * with the browser's deterministic font fallback after this deadline.
 */
async function boundedPreviewWait<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T | undefined> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timeoutId = setTimeout(() => {
          console.warn(
            `[NativeTextPreview] ${label} exceeded ${timeoutMs}ms; continuing with fallback`,
          );
          resolve(undefined);
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    console.warn(
      `[NativeTextPreview] ${label} failed; continuing with fallback`,
      error,
    );
    return undefined;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function hashTextRasterKey(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const objectKeyCache = new WeakMap<object, string>();
function getObjectKey(obj: unknown): string | undefined {
  if (obj === null || obj === undefined) return undefined;
  if (typeof obj !== "object") return String(obj);
  let key = objectKeyCache.get(obj);
  if (!key) {
    key = JSON.stringify(obj);
    objectKeyCache.set(obj, key);
  }
  return key;
}

function getStyleRasterIdentity(layer: EvaluatedTextLayer): string | undefined {
  const definition = layer.styleDefinition as
    | (Record<string, unknown> & {
        revisionId?: string;
        contentHash?: string;
        version?: number;
        revision?: { revisionId?: string; contentHash?: string };
      })
    | undefined;
  if (!definition) return undefined;

  // Evaluating a timeline scene creates a small wrapper object for a style on
  // every frame. Serializing that complete definition here made the cache-key
  // path scale with the entire effect graph and could consume the playback
  // budget. Published effects already have stable revision/content identity;
  // retain a serialized fallback only for legacy definitions without one.
  const revisionId =
    layer.styleRevisionId ??
    definition.revisionId ??
    definition.revision?.revisionId;
  const contentHash =
    layer.styleContentHash ??
    definition.contentHash ??
    definition.revision?.contentHash;
  if (revisionId || contentHash || definition.id || definition.version !== undefined) {
    return JSON.stringify({
      id: definition.id,
      version: definition.version,
      revisionId,
      contentHash,
    });
  }
  return getObjectKey(definition);
}

/**
 * This key deliberately follows the inputs consumed by the Clypra Studio
 * text engine. It is used for native upload caching. Layout dimensions affect
 * wrapping and therefore remain in the key; placement and presentation
 * controls are compositor uniforms and deliberately do not.
 */
export function buildNativeTextRasterKey(layer: EvaluatedTextLayer): string {
  const animation = layer.styleDefinition?.animation as
    | { type?: string }
    | undefined;
  const templateArtifact = layer.templateId
    ? resolveTextTemplateArtifact(layer.templateSnapshot)
    : null;
  const templateAnimated = Boolean(
    templateArtifact?.document.nodes.some((node: any) => {
      const nodeAnimation = node.animation;
      return (
        nodeAnimation &&
        ((nodeAnimation.in && nodeAnimation.in !== "none") ||
          (nodeAnimation.out && nodeAnimation.out !== "none") ||
          Boolean(nodeAnimation.propertyKeyframes) ||
          Boolean(node.splitAnimator))
      );
    }),
  );
  const timeDependent = Boolean(
    templateAnimated ||
    (animation && animation.type && animation.type !== "none"),
  );

  return JSON.stringify({
    layerId: layer.layerId,
    text: layer.text,
    textRole: layer.textRole,
    maxWidth: layer.maxWidth,
    time: timeDependent ? layer.time : undefined,
    width: layer.width,
    height: layer.height,
    fontFamily: layer.fontFamily,
    fontSize: layer.fontSize,
    fontWeight: layer.fontWeight,
    fontStyle: layer.fontStyle,
    color: layer.color,
    textAlign: layer.textAlign,
    verticalAlign: layer.verticalAlign,
    lineHeight: layer.lineHeight,
    letterSpacing: layer.letterSpacing,
    styleId: layer.styleId,
    styleVersion: layer.styleVersion,
    parameterOverrides: getObjectKey(layer.parameterOverrides),
    templateId: layer.templateId,
    templateRevisionId: layer.templateRevisionId,
    templateContentHash: layer.templateContentHash,
    templateControlValues: getObjectKey(layer.templateControlValues),
    templateDependencySnapshot: getObjectKey(layer.templateDependencySnapshot),
    customization: getObjectKey(layer.customization),
    runs: getObjectKey(layer.runs),
    stroke: getObjectKey(layer.stroke),
    shadow: getObjectKey(layer.shadow),
    background: getObjectKey(layer.background),
    styleDefinition: getStyleRasterIdentity(layer),
  });
}

/** Resolve the immutable clip snapshot before consulting the live catalog. */
export function resolveNativeTextEffectDefinition(layer: EvaluatedTextLayer) {
  return resolveTextEffectDefinition(layer.styleId, layer.styleDefinition);
}

function createCanvas(
  width: number,
  height: number,
): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error(
    "Native text rasterization requires a canvas-capable runtime",
  );
}

function cropTransparentBounds(
  rgba: number[],
  width: number,
  height: number,
  padding = 8,
): {
  rgba: number[];
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
} | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] > 8) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  const left = Math.max(0, minX - padding);
  const top = Math.max(0, minY - padding);
  const right = Math.min(width - 1, maxX + padding);
  const bottom = Math.min(height - 1, maxY + padding);
  const croppedWidth = right - left + 1;
  const croppedHeight = bottom - top + 1;
  const cropped = new Array<number>(croppedWidth * croppedHeight * 4);
  for (let y = 0; y < croppedHeight; y += 1) {
    const sourceStart = ((top + y) * width + left) * 4;
    const targetStart = y * croppedWidth * 4;
    for (let x = 0; x < croppedWidth * 4; x += 1) {
      cropped[targetStart + x] = rgba[sourceStart + x];
    }
  }
  return {
    rgba: cropped,
    width: croppedWidth,
    height: croppedHeight,
    offsetX: left,
    offsetY: top,
  };
}

/**
 * Rasterize one evaluated text layer through the exact Clypra Studio engine
 * path used by the native text bridge. The returned bitmap is positioned in
 * project space including the same effect bleed as the browser renderer.
 */
export async function rasterizeTextLayerForNative(
  layer: EvaluatedTextLayer,
  options: { phase?: TextRenderTracePhase; rendererPath?: TextRenderPath; deferTelemetry?: boolean } = {},
): Promise<NativeTextRasterAsset> {
  const totalStartedAt = performance.now();
  let fontWaitMs = 0;
  // The raster must use the same font variant as Studio/source preview before
  // any glyph metrics or effect bounds are computed.
  if (layer.fontFamily) {
    const fontStartedAt = performance.now();
    try {
      await boundedPreviewWait(
        getFontLoader().ensureFont({
          family: layer.fontFamily,
          weight: layer.fontWeight,
          style: layer.fontStyle,
        }),
        750,
        `font "${layer.fontFamily}"`,
      );
      if (typeof document !== "undefined" && document.fonts) {
        await boundedPreviewWait(
          document.fonts.ready,
          250,
          "document.fonts.ready",
        );
      }
    } catch (error) {
      console.warn(
        `[NativeTextPreview] Failed to pre-load font "${layer.fontFamily}":`,
        error,
      );
    }
    fontWaitMs = performance.now() - fontStartedAt;
  }

  const effectDefinition = resolveNativeTextEffectDefinition(layer);
  const normalizedFontSize = normalizeFontSize(layer.fontSize);
  const metrics = getTextRenderMetrics(normalizedFontSize);
  const bleed = effectBleed({
    styleId: layer.styleId,
    effectDefinition,
    stroke: layer.stroke,
    shadow: layer.shadow
      ? {
          blur: layer.shadow.blur,
          offsetX: layer.shadow.offsetX,
          offsetY: layer.shadow.offsetY,
        }
      : undefined,
    background: layer.background,
  });
  const bleedX = Math.max(metrics.paddingX, bleed.x);
  const bleedY = Math.max(metrics.paddingY, bleed.y);
  const width = Math.max(1, Math.ceil(layer.width + bleedX * 2));
  const height = Math.max(1, Math.ceil(layer.height + bleedY * 2));
  traceTextRenderGeometry({
    path: "program-preview",
    assetId: layer.templateId ?? layer.styleId,
    revisionId: layer.templateRevisionId ?? layer.styleRevisionId,
    contentHash: layer.templateContentHash ?? layer.styleContentHash,
    layer: {
      layerId: layer.layerId,
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height,
      fontFamily: layer.fontFamily,
      fontSize: layer.fontSize,
      fontWeight: layer.fontWeight,
      fontStyle: layer.fontStyle,
      textAlign: layer.textAlign,
      verticalAlign: layer.verticalAlign,
    },
    render: {
      bleedX,
      bleedY,
      rasterWidth: width,
      rasterHeight: height,
      rasterX: layer.x - bleedX,
      rasterY: layer.y - bleedY,
      renderer: "shared-text-effect-engine -> native-raster-composite",
    },
    authoredCanvas: (effectDefinition as any)?.scene?.canvas,
  });
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx)
    throw new Error(
      "Unable to create a 2D context for native text rasterization",
    );

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(layer.width / 2 + bleedX, layer.height / 2 + bleedY);
  const rasterStartedAt = performance.now();
  await rasterizeTextLayer(ctx, layer, layer.width, layer.height, 1, 1);
  const rasterMs = performance.now() - rasterStartedAt;
  ctx.restore();

  const readbackStartedAt = performance.now();
  const rgba = Array.from(ctx.getImageData(0, 0, width, height).data);
  const readbackMs = performance.now() - readbackStartedAt;
  const templateArtifact = resolveTextTemplateArtifact(layer.templateSnapshot);
  const croppedTemplate = templateArtifact
    ? cropTransparentBounds(rgba, width, height)
    : null;
  const cacheKey = buildNativeTextRasterKey(layer);
  const timing = {
    phase: options.phase ?? "visible-playback",
    kind: getTextRenderKind(layer),
    rendererPath: options.rendererPath ?? "native-raster",
    assetId: layer.templateId ?? layer.styleId,
    layerId: layer.layerId,
    fontFamily: layer.fontFamily,
    fontWaitMs,
    rasterMs,
    readbackMs: (options.rendererPath ?? "native-raster") === "webview-canvas" ? readbackMs : 0,
    outputPixels: width * height,
    totalMs: performance.now() - totalStartedAt,
    operation: layer.animationOperation ?? (options.phase === "session-prewarm" || options.phase === "text-prefetch" ? "prefetch" : "render") as TextRenderOperation,
    contentLength: layer.text.length,
    lineCount: Math.max(1, layer.text.split("\n").length),
    layoutWidth: layer.width,
    layoutHeight: layer.height,
  };
  if (!options.deferTelemetry) traceTextRenderTiming(timing);

  return {
    assetId: `native-text:${layer.layerId}:${hashTextRasterKey(cacheKey)}`,
    rgba: croppedTemplate?.rgba ?? rgba,
    width: croppedTemplate?.width ?? width,
    height: croppedTemplate?.height ?? height,
    x: croppedTemplate
      ? layer.x - bleedX + croppedTemplate.offsetX
      : layer.x - bleedX,
    y: croppedTemplate
      ? layer.y - bleedY + croppedTemplate.offsetY
      : layer.y - bleedY,
    rotation: layer.rotation,
    opacity: layer.opacity,
    zIndex: layer.zIndex,
    blendMode: layer.blendMode,
    isText: true,
    ...(croppedTemplate ? { positionMode: "absolute" as const } : {}),
    bleedX,
    bleedY,
    timing,
  };
}

function getTextRenderKind(layer: EvaluatedTextLayer): TextRenderKind {
  if (layer.templateId || layer.clipKind === "text-template") return "template";
  if (layer.styleId) return "effect";
  return "plain";
}
