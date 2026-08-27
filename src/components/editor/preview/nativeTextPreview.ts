import type { EvaluatedTextLayer } from "@/core/evaluation/types";
import { effectBleed } from "@/lib/text/textClip";
import { getTextRenderMetrics, normalizeFontSize } from "@/lib/utils/fixedSizing";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";
import { rasterizeTextLayer } from "@/core/render/textRasterizer";

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
 * text engine. It is used for native upload caching and must change whenever
 * the visible text, style, geometry, or animated time changes.
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
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
    rotation: layer.rotation,
    opacity: layer.opacity,
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
  return layer.styleDefinition ?? (layer.styleId
    ? useEffectsStore.getState().definitions[layer.styleId]
    : undefined);
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
): Promise<NativeTextRasterAsset> {
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
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("Unable to create a 2D context for native text rasterization");

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(layer.width / 2 + bleedX, layer.height / 2 + bleedY);
  await rasterizeTextLayer(ctx, layer, layer.width, layer.height, 1, 1);
  ctx.restore();

  const rgba = Array.from(ctx.getImageData(0, 0, width, height).data);
  const cacheKey = buildNativeTextRasterKey(layer);

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
  };
}
