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
  options: { shouldPaint?: () => boolean } = {},
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
      browserTextLayoutKeyByLayerId.delete(layerId);
    }
  }

  const rasterResults = await Promise.allSettled(
    layers.map(async (layer) => {
      const rasterKey = buildNativeTextRasterKey(layer);
      const layoutKey = buildNativeTextLayoutKey(layer);
      const previous = browserTextAssetByLayerId.get(layer.layerId);
      if (
        previous &&
        browserTextAssetKeyByLayerId.get(layer.layerId) !== rasterKey &&
        browserTextLayoutKeyByLayerId.get(layer.layerId) === layoutKey
      ) {
        const recolored = recolorPlainTextAsset(previous, layer.color, layer);
        if (recolored) {
          browserTextAssetByLayerId.set(layer.layerId, recolored);
          browserTextAssetKeyByLayerId.set(layer.layerId, rasterKey);
          traceTextRenderCacheHit({
            kind: "plain",
            rendererPath: "webview-canvas",
            phase,
          });
          return { layer, asset: recolored };
        }
      }
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
        traceTextRenderCacheHit({
          kind: getTextRenderKind(layer),
          rendererPath: "webview-canvas",
          phase,
        });
      }

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
      browserTextLayoutKeyByLayerId.set(layer.layerId, layoutKey);
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
    if (options.shouldPaint && !options.shouldPaint()) return;
    const { layer, asset } = result.value;
    const bitmap = getBrowserTextBitmap(asset);
    if (!bitmap) continue;
    const transferMs = bitmap.transferMs;
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
    ctx.drawImage(bitmap.source, -asset.width / 2, -asset.height / 2);
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
const browserTextLayoutKeyByLayerId = new Map<string, string>();
const browserTextBitmapCache = new Map<
  string,
  {
    source: CanvasImageSource;
    transferMs: number;
  }
>();

function getBrowserTextBitmap(
  asset: NativeTextRasterAsset,
): { source: CanvasImageSource; transferMs: number } | null {
  const cached = browserTextBitmapCache.get(asset.assetId);
  if (cached) return { ...cached, transferMs: 0 };
  const bitmapCanvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(asset.width, asset.height)
      : typeof document !== "undefined"
        ? document.createElement("canvas")
        : null;
  if (!bitmapCanvas) return null;
  bitmapCanvas.width = asset.width;
  bitmapCanvas.height = asset.height;
  const bitmapContext = bitmapCanvas.getContext("2d");
  if (!bitmapContext) return null;
  const transferStartedAt = performance.now();
  const image = bitmapContext.createImageData(asset.width, asset.height);
  image.data.set(asset.rgba);
  bitmapContext.putImageData(image, 0, 0);
  const value = {
    source: bitmapCanvas as unknown as CanvasImageSource,
    transferMs: performance.now() - transferStartedAt,
  };
  browserTextBitmapCache.set(asset.assetId, value);
  while (browserTextBitmapCache.size > MAX_BROWSER_TEXT_RASTER_ENTRIES) {
    const oldest = browserTextBitmapCache.keys().next().value as
      | string
      | undefined;
    if (!oldest) break;
    browserTextBitmapCache.delete(oldest);
  }
  return value;
}

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
        timeoutId = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } catch {
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
  if (
    revisionId ||
    contentHash ||
    definition.id ||
    definition.version !== undefined
  ) {
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
  return JSON.stringify(buildNativeTextKeyObject(layer, true));
}

function buildNativeTextKeyObject(
  layer: EvaluatedTextLayer,
  includeColor: boolean,
): Record<string, unknown> {
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

  return {
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
    color: includeColor ? layer.color : undefined,
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
  };
}

/** Identity for glyph/layout/effect work, excluding a plain fill color. */
export function buildNativeTextLayoutKey(layer: EvaluatedTextLayer): string {
  return JSON.stringify(buildNativeTextKeyObject(layer, false));
}

function parseSolidColor(
  value: string | undefined,
): [number, number, number] | null {
  const match = value?.trim().match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!match) return null;
  const hex =
    match[1].length === 3
      ? match[1]
          .split("")
          .map((part) => part + part)
          .join("")
      : match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function recolorPlainTextAsset(
  previous: NativeTextRasterAsset,
  color: string | undefined,
  layer: EvaluatedTextLayer,
): NativeTextRasterAsset | null {
  if (
    layer.styleId ||
    layer.templateId ||
    layer.stroke ||
    layer.shadow ||
    layer.background ||
    layer.runs
  )
    return null;
  const rgb = parseSolidColor(color);
  if (!rgb) return null;
  const rgba = previous.rgba.slice();
  for (let index = 0; index < rgba.length; index += 4) {
    if (rgba[index + 3] === 0) continue;
    rgba[index] = rgb[0];
    rgba[index + 1] = rgb[1];
    rgba[index + 2] = rgb[2];
  }
  return {
    ...previous,
    assetId: `native-text:${layer.layerId}:${hashTextRasterKey(buildNativeTextRasterKey(layer))}`,
    rgba,
    timing: undefined,
  };
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

// ─── Text layout/metrics cache ────────────────────────────────────────────────
//
// Computing effectDefinition + bleed + metrics is deterministic for a given
// set of styling inputs and does not depend on time, color, or opacity.
// Cache it keyed on `buildNativeTextLayoutKey` (excludes color) to avoid
// redundant object allocations and function calls on every rasterize call
// for static text layers during playback.
//
// The cache is intentionally small (32 entries). Static text layers hit
// the same key on every frame, so a tiny cache is sufficient.

interface TextLayoutMetrics {
  bleedX: number;
  bleedY: number;
  rasterWidth: number;
  rasterHeight: number;
  effectDefinition: ReturnType<typeof resolveNativeTextEffectDefinition>;
}

const MAX_LAYOUT_CACHE_ENTRIES = 32;
const textLayoutMetricsCache = new Map<string, TextLayoutMetrics>();

function getCachedLayoutMetrics(
  layer: EvaluatedTextLayer,
  layoutKey: string,
): TextLayoutMetrics {
  const cached = textLayoutMetricsCache.get(layoutKey);
  if (cached) return cached;

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
  const rasterWidth = Math.max(1, Math.ceil(layer.width + bleedX * 2));
  const rasterHeight = Math.max(1, Math.ceil(layer.height + bleedY * 2));

  const result: TextLayoutMetrics = {
    bleedX,
    bleedY,
    rasterWidth,
    rasterHeight,
    effectDefinition,
  };

  // LRU eviction: remove the oldest entry if at capacity.
  if (textLayoutMetricsCache.size >= MAX_LAYOUT_CACHE_ENTRIES) {
    const oldest = textLayoutMetricsCache.keys().next().value as
      | string
      | undefined;
    if (oldest) textLayoutMetricsCache.delete(oldest);
  }
  textLayoutMetricsCache.set(layoutKey, result);
  return result;
}

/** Exported for testing only — clears the layout metrics cache. */
export function _clearTextLayoutMetricsCache(): void {
  textLayoutMetricsCache.clear();
}

/**
 * Rasterize one evaluated text layer through the exact Clypra Studio engine
 * path used by the native text bridge. The returned bitmap is positioned in
 * project space including the same effect bleed as the browser renderer.
 */
export async function rasterizeTextLayerForNative(
  layer: EvaluatedTextLayer,
  options: {
    phase?: TextRenderTracePhase;
    rendererPath?: TextRenderPath;
    deferTelemetry?: boolean;
  } = {},
): Promise<NativeTextRasterAsset> {
  const totalStartedAt = performance.now();
  let fontWaitMs = 0;
  // The raster must use the same font variant as Studio/source preview before
  // any glyph metrics or effect bounds are computed.
  if (layer.fontFamily) {
    const fontDescriptor = {
      family: layer.fontFamily,
      weight: layer.fontWeight,
      style: layer.fontStyle,
    };
    // Fast path: system fonts and all prewarmed project fonts are already
    // loaded — skip both boundedPreviewWait calls so fontWaitMs stays 0.
    if (!getFontLoader().isLoaded(fontDescriptor)) {
      const fontStartedAt = performance.now();
      try {
        await boundedPreviewWait(
          getFontLoader().ensureFont(fontDescriptor),
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
      } catch {
        // The rasterizer continues with the browser fallback font. The failure
        // is intentionally represented by telemetry rather than console noise.
      }
      fontWaitMs = performance.now() - fontStartedAt;
    }
  }

  const layoutKey = buildNativeTextLayoutKey(layer);
  const {
    bleedX,
    bleedY,
    rasterWidth: width,
    rasterHeight: height,
    effectDefinition,
  } = getCachedLayoutMetrics(layer, layoutKey);
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
    readbackMs:
      (options.rendererPath ?? "native-raster") === "webview-canvas"
        ? readbackMs
        : 0,
    outputPixels: width * height,
    totalMs: performance.now() - totalStartedAt,
    operation:
      layer.animationOperation ??
      ((options.phase === "session-prewarm" || options.phase === "text-prefetch"
        ? "prefetch"
        : "render") as TextRenderOperation),
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
