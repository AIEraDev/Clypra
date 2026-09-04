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

// ─── Module-level worker client singleton ────────────────────────────────────
//
// One TemplateRasterizerWorkerClient is shared across all calls to
// rasterizeTextLayerForNative and paintTextLayersToCanvas in this module.
// It is created lazily on first template render and lives for the process
// lifetime — Worker startup cost (~5ms) is paid once, not per session.
//
// NativeRasterBridge owns its own reference and calls dispose() on session
// end. This module-level instance handles the browser (non-Tauri) canvas
// path where no bridge is involved.
let _templateWorkerClient:
  | import("@/core/render/templateRasterizerWorkerClient").TemplateRasterizerWorkerClient
  | null = null;

function getTemplateWorkerClient():
  | import("@/core/render/templateRasterizerWorkerClient").TemplateRasterizerWorkerClient
  | null {
  if (!_templateWorkerClient) {
    // Dynamic import to avoid a circular dependency at module load time.
    // The void-and-assign fires immediately as a module side-effect so the
    // client is ready well before the first actual template render.
    void import("@/core/render/templateRasterizerWorkerClient").then((mod) => {
      _templateWorkerClient = new mod.TemplateRasterizerWorkerClient();
    });
    // Null on the very first synchronous call (only). Callers fall through
    // to the main-thread path for that one frame, then use the worker.
    return null;
  }
  return _templateWorkerClient;
}

/** Exported for testing — resets the module-level worker client. */
export function _resetTemplateWorkerClient(): void {
  _templateWorkerClient?.dispose();
  _templateWorkerClient = null;
}

export interface NativeTextRasterAsset {
  assetId: string;
  /**
   * Raw RGBA pixel data.
   *
   * Kept as Uint8ClampedArray throughout the rasterization and scheduling
   * pipeline to avoid the O(W×H) Array.from() copy that occurred on every
   * animated template frame. Converted to number[] only at the Tauri IPC
   * boundary (registerNativeRasterAsset) where the JSON serializer requires
   * a plain array.
   *
   * Consumers that draw via canvas (paintTextLayersToCanvas) use
   * createImageData which accepts Uint8ClampedArray directly — zero copy.
   */
  layerId?: string;
  rgba: Uint8ClampedArray | number[];
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
    transferMs?: number;
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
    if (layer.blendMode && layer.blendMode !== "normal") {
      ctx.globalCompositeOperation =
        layer.blendMode === "add"
          ? "lighter"
          : layer.blendMode === "subtract"
            ? "difference"
            : (layer.blendMode as GlobalCompositeOperation);
    }
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

/** Exported for testing only. */
export function _clearBrowserTextRasterCache(): void {
  browserTextRasterCache.clear();
  browserTextAssetByLayerId.clear();
  browserTextAssetKeyByLayerId.clear();
  browserTextLayoutKeyByLayerId.clear();
}

/** Exported for testing only. */
export function _getBrowserTextRasterPromise(
  key: string,
): Promise<NativeTextRasterAsset> | undefined {
  return browserTextRasterCache.get(key);
}
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
  // templateAnimated is computed once by the evaluator from the embedded
  // templateSnapshot and stored on the layer. Reading it here is O(1) —
  // no artifact parsing, no document traversal, no per-frame allocation.
  //
  // For legacy layers that predate this field (templateAnimated === undefined),
  // we fall back to the old artifact-parse path so old clips are not broken.
  const templateAnimated: boolean =
    layer.templateAnimated !== undefined
      ? layer.templateAnimated
      : Boolean(
          layer.templateId &&
          resolveTextTemplateArtifact(
            layer.templateSnapshot,
          )?.document.nodes.some((node: any) => {
            const a = node.animation;
            return (
              a &&
              ((a.in && a.in !== "none") ||
                (a.out && a.out !== "none") ||
                Boolean(a.propertyKeyframes) ||
                Boolean(node.splitAnimator))
            );
          }),
        );

  const animation = layer.styleDefinition?.animation as
    | { type?: string }
    | undefined;
  const timeDependent = Boolean(
    templateAnimated ||
    (animation && animation.type && animation.type !== "none") ||
    Boolean((layer.styleDefinition as any)?.scene?.timeline?.duration),
  );

  return {
    layerId: layer.layerId,
    text: layer.text,
    textRole: layer.textRole,
    maxWidth: layer.maxWidth,
    time: timeDependent ? layer.time : undefined,
    width: layer.baseWidth ?? layer.width,
    height: layer.baseHeight ?? layer.height,
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

/**
 * Template crop geometry cache.
 *
 * The tight bounding box of a template's visible pixels is a property of the
 * template design, not of the frame time. Two facts make it safe to cache:
 *   1. The outer canvas dimensions are fixed (determined by bleed + layer size).
 *   2. Template animations move pixels inside the bounding box — they do not
 *      change the box itself across the clip duration.
 *
 * We scan pixels once on the first rendered frame and store only the geometry
 * (left, top, croppedWidth, croppedHeight). Subsequent frames apply the same
 * crop window to their fresh pixel data without re-scanning.
 *
 * Cache key: templateRevisionId ?? templateContentHash ?? templateId.
 * Invalidated implicitly when the clip is replaced (different key).
 * Bounded to MAX_TEMPLATE_CROP_CACHE_ENTRIES entries; LRU eviction.
 */
interface TemplateCropGeometry {
  left: number;
  top: number;
  croppedWidth: number;
  croppedHeight: number;
  offsetX: number;
  offsetY: number;
}

const MAX_TEMPLATE_CROP_CACHE_ENTRIES = 64;
const templateCropGeometryCache = new Map<
  string,
  TemplateCropGeometry | null
>();

/** Exported for testing only. */
export function _clearTemplateCropGeometryCache(): void {
  templateCropGeometryCache.clear();
}

export function getTemplateCropCacheKey(
  layer: EvaluatedTextLayer,
): string | null {
  const baseId =
    layer.templateRevisionId ?? layer.templateContentHash ?? layer.templateId;
  if (!baseId) return null;
  const custKey = JSON.stringify({
    t: layer.text,
    c: layer.customization,
    v: layer.templateControlValues,
    w: layer.width,
    h: layer.height,
  });
  return `${baseId}:${custKey}`;
}

/**
 * Scan the pixel data to find the tight bounding box of visible (alpha > 8)
 * pixels, then add a safety padding margin.
 *
 * This is O(W×H) and should only be called once per template revision.
 * All subsequent calls use `applyCropGeometry` with the cached result.
 */
function computeCropGeometry(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  padding = 8,
): TemplateCropGeometry | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  const left = Math.max(0, minX - padding);
  const top = Math.max(0, minY - padding);
  const right = Math.min(width - 1, maxX + padding);
  const bottom = Math.min(height - 1, maxY + padding);
  return {
    left,
    top,
    croppedWidth: right - left + 1,
    croppedHeight: bottom - top + 1,
    offsetX: left,
    offsetY: top,
  };
}

/**
 * Apply a cached crop geometry to a fresh pixel buffer.
 * No pixel scanning — just a typed-array slice using the pre-computed bounds.
 * O(croppedWidth × croppedHeight) copy — much smaller than O(W×H) scan.
 */
function applyCropGeometry(
  rgba: Uint8ClampedArray,
  srcWidth: number,
  geo: TemplateCropGeometry,
): Uint8ClampedArray {
  const { left, top, croppedWidth, croppedHeight } = geo;
  const cropped = new Uint8ClampedArray(croppedWidth * croppedHeight * 4);
  for (let y = 0; y < croppedHeight; y += 1) {
    const sourceStart = ((top + y) * srcWidth + left) * 4;
    const targetStart = y * croppedWidth * 4;
    cropped.set(
      rgba.subarray(sourceStart, sourceStart + croppedWidth * 4),
      targetStart,
    );
  }
  return cropped;
}

/**
 * Crop the transparent margins from a template raster asset.
 *
 * Uses the geometry cache to avoid the O(W×H) pixel scan on every frame.
 * Falls back to a fresh scan (and caches the result) on first render.
 */
export function cropTemplateAsset(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  cacheKey: string,
): {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
} | null {
  let geo = templateCropGeometryCache.get(cacheKey);
  if (geo === undefined) {
    // First render for this template revision — scan and cache.
    geo = computeCropGeometry(rgba, width, height);
    if (templateCropGeometryCache.size >= MAX_TEMPLATE_CROP_CACHE_ENTRIES) {
      const oldest = templateCropGeometryCache.keys().next().value as
        | string
        | undefined;
      if (oldest) templateCropGeometryCache.delete(oldest);
    }
    templateCropGeometryCache.set(cacheKey, geo);
  }
  if (!geo) return null;
  return {
    rgba: applyCropGeometry(rgba, width, geo),
    width: geo.croppedWidth,
    height: geo.croppedHeight,
    offsetX: geo.offsetX,
    offsetY: geo.offsetY,
  };
}

// Legacy function kept for non-template callers (currently unused — templates
// now use cropTemplateAsset). Retained so any future call sites compile.
function cropTransparentBounds(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  padding = 8,
): {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
} | null {
  const geo = computeCropGeometry(rgba, width, height, padding);
  if (!geo) return null;
  return {
    rgba: applyCropGeometry(rgba, width, geo),
    width: geo.croppedWidth,
    height: geo.croppedHeight,
    offsetX: geo.offsetX,
    offsetY: geo.offsetY,
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

export function getCachedLayoutMetrics(
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
  const baseWidth = layer.baseWidth ?? layer.width;
  const baseHeight = layer.baseHeight ?? layer.height;
  const rasterWidth = Math.max(1, Math.ceil(baseWidth + bleedX * 2));
  const rasterHeight = Math.max(1, Math.ceil(baseHeight + bleedY * 2));

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

  // ── Template fast-path: delegate to OffscreenCanvas Worker ────────────────
  // For text-template clips the render work (renderTextTemplateToCanvas +
  // getImageData) happens in the Worker, not on this thread. This is the
  // browser canvas path; the Tauri/native path already routes through
  // NativeRasterBridge.getTextRaster → TemplateRasterizerWorkerClient.
  if (layer.templateId || layer.clipKind === "text-template") {
    const rasterKey = buildNativeTextRasterKey(layer);
    const workerClient = getTemplateWorkerClient();
    if (workerClient) {
      try {
        console.log(`[nativeTextPreview] Delegating template ${layer.layerId} to worker client`);
        return await workerClient.rasterize(
          layer,
          rasterKey,
          options.phase ?? "visible-playback",
        );
      } catch (err) {
        console.warn(`[nativeTextPreview] Worker template rasterize failed for ${layer.layerId}, falling back to main-thread:`, err);
      }
    }
    // Worker not yet ready or failed — fall through to main thread.
  }

  // ── Canonical effect fast-path: delegate to OffscreenCanvas Worker ─────────
  // Only the canonical scene path (effectDef.scene.effectLayers) is routed
  // off-thread. Legacy _buildConfig effects are CPU-light and stay on main thread.
  if (layer.styleId && (layer.styleDefinition as any)?.scene?.effectLayers) {
    const rasterKey = buildNativeTextRasterKey(layer);
    const workerClient = getTemplateWorkerClient();
    if (workerClient) {
      try {
        const effectDef = layer.styleDefinition as any;
        const canonicalScene = JSON.parse(
          JSON.stringify(effectDef.scene),
        ) as Record<string, unknown>;
        const canvas = canonicalScene.canvas as any;
        const authoredWidth = Math.max(
          1,
          Math.ceil(Number(canvas?.width) || 800),
        );
        const authoredHeight = Math.max(
          1,
          Math.ceil(Number(canvas?.height) || 200),
        );
        const unscaledFontSize = normalizeFontSize(layer.fontSize);
        const baseWidth = layer.baseWidth ?? layer.width;
        const baseHeight = layer.baseHeight ?? layer.height;
        const evalWidth = Math.max(authoredWidth, Math.ceil(baseWidth + 400));
        const evalHeight = Math.max(
          authoredHeight,
          Math.ceil(baseHeight + 200),
        );
        const sceneText = canonicalScene.text as any;
        if (sceneText) {
          sceneText.content = layer.text;
          sceneText.fontSize = unscaledFontSize;
          sceneText.fontFamily = layer.fontFamily || sceneText.fontFamily;
          sceneText.fontWeight = layer.fontWeight ?? sceneText.fontWeight;
          sceneText.fontStyle = layer.fontStyle ?? sceneText.fontStyle;
          sceneText.letterSpacing =
            layer.letterSpacing ?? sceneText.letterSpacing;
          sceneText.lineHeight = layer.lineHeight ?? sceneText.lineHeight;
          sceneText.textPosX = layer.textAlign || sceneText.textPosX;
          sceneText.textPosY =
            layer.verticalAlign === "middle"
              ? "middle"
              : layer.verticalAlign || sceneText.textPosY;
        }
        (canonicalScene.canvas as any) = {
          ...canvas,
          width: evalWidth,
          height: evalHeight,
        };
        console.log(`[nativeTextPreview] Delegating effect ${layer.layerId} to worker client`);
        return await workerClient.rasterizeEffect(
          layer,
          canonicalScene,
          evalWidth,
          evalHeight,
          rasterKey,
          options.phase ?? "visible-playback",
        );
      } catch (err) {
        console.warn(`[nativeTextPreview] Worker effect rasterize failed for ${layer.layerId}, falling back to main-thread:`, err);
      }
    }
  }
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
  const baseWidth = layer.baseWidth ?? layer.width;
  const baseHeight = layer.baseHeight ?? layer.height;
  ctx.save();
  ctx.translate(baseWidth / 2 + bleedX, baseHeight / 2 + bleedY);
  const rasterStartedAt = performance.now();
  await rasterizeTextLayer(ctx, layer, baseWidth, baseHeight, 1, 1);
  const rasterMs = performance.now() - rasterStartedAt;
  ctx.restore();

  const readbackStartedAt = performance.now();
  // Keep the raw Uint8ClampedArray from getImageData — do NOT call Array.from().
  // The O(W×H) array copy was the dominant main-thread hotspot for animated
  // template frames. Uint8ClampedArray is accepted directly by createImageData
  // (browser canvas path) and converted to number[] only at the Tauri IPC
  // boundary where the JSON serializer actually requires it.
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const readbackMs = performance.now() - readbackStartedAt;
  const cropKey = getTemplateCropCacheKey(layer);
  const effectiveCropKey =
    cropKey && layer.templateAnimated
      ? `${cropKey}:t${Math.round((layer.time ?? 0) * 30)}`
      : cropKey;
  const croppedTemplate = effectiveCropKey
    ? cropTemplateAsset(rgba, width, height, effectiveCropKey)
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
    layoutWidth: baseWidth,
    layoutHeight: baseHeight,
  };
  if (!options.deferTelemetry) traceTextRenderTiming(timing);

  return {
    layerId: layer.layerId,
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
