import { Sprite } from "pixi.js";
import type { EvaluatedTextLayer } from "../evaluation/types.js";
import { useEffectsStore } from "../../features/text-effects/store/effectsStore.js";
import { effectBleed } from "../../lib/text/textClip.js";
import { rasterizeTextLayer } from "./textRasterizer.js";

import {
  beginTextFrame as engineBeginTextFrame,
  renderTextLayerBridged as engineRenderTextLayerBridged,
  unmountTextLayerBridge as engineUnmountTextLayerBridge,
  endTextFrame as engineEndTextFrame,
  clearAllTextBridges as engineClearAllTextBridges
} from "@clypra-studio/engine";

export function beginTextFrame(container: import("pixi.js").Container): void {
  engineBeginTextFrame(container);
}

export async function renderTextLayerBridged(
  layer: EvaluatedTextLayer,
  frameId: number,
  container: import("pixi.js").Container,
  viewport: { scale: number; offsetX: number; offsetY: number; pixelRatio: number },
  renderOrder: number,
): Promise<Sprite> {
  const { scale } = viewport;

  // Resolve the text effect definition
  const effectDef = layer.styleId
    ? (useEffectsStore.getState().definitions[layer.styleId] ?? layer.styleDefinition)
    : layer.styleDefinition;

  // Compute scaled dimensions of the layer
  const width = layer.width * scale;
  const height = layer.height * scale;

  // Compute padded dimensions (same bleed logic as textRasterizer.ts)
  const declaredBleed = effectBleed({
    styleId: layer.styleId,
    effectDefinition: effectDef,
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

  const unscaledFontSize = layer.fontSize;
  const unscaledPaddingX = Math.max(unscaledFontSize * 0.25, declaredBleed.x);
  const unscaledPaddingY = Math.max(unscaledFontSize * 0.25, declaredBleed.y);
  
  const isTemplate = !!layer.templateId;
  const isAnimated = !!(effectDef?.animation && effectDef.animation.type !== "none");
  const isDynamic = isTemplate || isAnimated;

  const baseKey = `${layer.layerId}_${Math.max(1, Math.ceil(width + unscaledPaddingX * scale * 2))}_${Math.max(1, Math.ceil(height + unscaledPaddingY * scale * 2))}_${layer.text}_${layer.fontSize}_${layer.styleId}_${layer.fontFamily}_${layer.color}_${layer.fontWeight}_${layer.fontStyle}_${layer.textAlign}_${layer.verticalAlign}_${layer.lineHeight}_${layer.letterSpacing}_${JSON.stringify(layer.stroke)}_${JSON.stringify(layer.shadow)}_${JSON.stringify(layer.background)}`;
  const cacheKey = isDynamic ? `${baseKey}_time_${layer.time}` : baseKey;

  const bleed = { x: unscaledPaddingX, y: unscaledPaddingY };

  const rasterizeTextCallback = async (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => {
    await rasterizeTextLayer(ctx, layer, width, height, scale, scale);
  };

  const sprite = await engineRenderTextLayerBridged(
    layer,
    frameId,
    container,
    viewport,
    renderOrder,
    bleed,
    rasterizeTextCallback,
    cacheKey
  );
  // Override engine position/scale to conform to project space layout contract
  const centerX = layer.x + layer.width / 2;
  const centerY = layer.y + layer.height / 2;
  const targetW = layer.width + bleed.x * 2;
  const targetH = layer.height + bleed.y * 2;
  const texW = sprite.texture?.orig?.width || sprite.texture?.source?.width || targetW;
  const texH = sprite.texture?.orig?.height || sprite.texture?.source?.height || targetH;

  sprite.position.set(centerX, centerY);
  if (texW > 0 && texH > 0) {
    sprite.scale.set(targetW / texW, targetH / texH);
  } else {
    sprite.width = targetW;
    sprite.height = targetH;
  }
  sprite.rotation = (((layer as any).rotation || 0) * Math.PI) / 180;

  sprite.zIndex = renderOrder;
  return sprite;
}

export function unmountTextLayerBridge(layerId: string, container: import("pixi.js").Container): void {
  engineUnmountTextLayerBridge(layerId, container);
}

export function endTextFrame(frameId: number, container: import("pixi.js").Container): void {
  engineEndTextFrame(frameId, container);
}

export function clearAllTextBridges(container?: import("pixi.js").Container): void {
  engineClearAllTextBridges(container);
}
