import type { EvaluatedTextLayer } from "@/core/evaluation/types";
import { effectBleed, resolveTextEffectDefinition } from "@/lib/text/textClip";
import { getTextRenderMetrics, normalizeFontSize } from "@/lib/utils/fixedSizing";
import { rasterizeTextLayer } from "@/core/render/textRasterizer";
import { getFontLoader } from "@/core/fonts/FontLoader";
import {
  traceTextRenderGeometry,
  traceTextRenderTiming,
  type TextRenderTracePhase,
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
  /** Internal geometry metadata; not part of the native wire snapshot. */
  bleedX?: number;
  bleedY?: number;
}

function hashTextRasterKey(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * This key deliberately follows the inputs consumed by the Clypra Studio
 * text engine. It is used for native upload caching. Layout dimensions affect
 * wrapping and therefore remain in the key; placement and presentation
 * controls are compositor uniforms and deliberately do not.
 */
export function buildNativeTextRasterKey(layer: EvaluatedTextLayer): string {
  const animation = layer.styleDefinition?.animation as { type?: string } | undefined;
  const timeDependent = Boolean(
    layer.templateId || (animation && animation.type && animation.type !== "none"),
  );

  return JSON.stringify({
    layerId: layer.layerId,
    text: layer.text,
    time: timeDependent ? layer.time : undefined,
    width: layer.width,
    height: layer.height,
    fontFamily: layer.fontFamily,
    fontSize: layer.fontSize,
    fontWeight: layer.fontWeight,
    fontStyle: layer.fontStyle,
    textAlign: layer.textAlign,
    verticalAlign: layer.verticalAlign,
    lineHeight: layer.lineHeight,
    letterSpacing: layer.letterSpacing,
    styleId: layer.styleId,
    styleVersion: layer.styleVersion,
    parameterOverrides: layer.parameterOverrides,
    templateId: layer.templateId,
    customization: layer.customization,
    stroke: layer.stroke,
    shadow: layer.shadow,
    background: layer.background,
    styleDefinition: layer.styleDefinition,
  });
}

/** Resolve the immutable clip snapshot before consulting the live catalog. */
export function resolveNativeTextEffectDefinition(layer: EvaluatedTextLayer) {
  return resolveTextEffectDefinition(layer.styleId, layer.styleDefinition);
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error("Native text rasterization requires a canvas-capable runtime");
}

/**
 * Rasterize one evaluated text layer through the exact Clypra Studio engine
 * path used by the native text bridge. The returned bitmap is positioned in
 * project space including the same effect bleed as the browser renderer.
 */
export async function rasterizeTextLayerForNative(
  layer: EvaluatedTextLayer,
  options: { phase?: TextRenderTracePhase } = {},
): Promise<NativeTextRasterAsset> {
  const totalStartedAt = performance.now();
  let fontWaitMs = 0;
  // The raster must use the same font variant as Studio/source preview before
  // any glyph metrics or effect bounds are computed.
  if (layer.fontFamily) {
    const fontStartedAt = performance.now();
    try {
      await getFontLoader().ensureFont({
        family: layer.fontFamily,
        weight: layer.fontWeight,
        style: layer.fontStyle,
      });
      if (typeof document !== "undefined" && document.fonts) {
        await document.fonts.ready;
      }
    } catch (error) {
      console.warn(`[NativeTextPreview] Failed to pre-load font "${layer.fontFamily}":`, error);
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
    assetId: layer.styleId,
    revisionId: layer.styleRevisionId,
    contentHash: layer.styleContentHash,
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
  if (!ctx) throw new Error("Unable to create a 2D context for native text rasterization");

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(layer.width / 2 + bleedX, layer.height / 2 + bleedY);
  const rasterStartedAt = performance.now();
  await rasterizeTextLayer(ctx, layer, layer.width, layer.height, 1, 1);
  const rasterMs = performance.now() - rasterStartedAt;
  ctx.restore();

  const rgba = Array.from(ctx.getImageData(0, 0, width, height).data);
  const cacheKey = buildNativeTextRasterKey(layer);
  traceTextRenderTiming({
    phase: options.phase ?? "visible-playback",
    assetId: layer.styleId,
    layerId: layer.layerId,
    fontFamily: layer.fontFamily,
    fontWaitMs,
    rasterMs,
    totalMs: performance.now() - totalStartedAt,
  });

  return {
    assetId: `native-text:${layer.layerId}:${hashTextRasterKey(cacheKey)}`,
    rgba,
    width,
    height,
    x: layer.x - bleedX,
    y: layer.y - bleedY,
    rotation: layer.rotation,
    opacity: layer.opacity,
    zIndex: layer.zIndex,
    blendMode: layer.blendMode,
    isText: true,
    bleedX,
    bleedY,
  };
}
