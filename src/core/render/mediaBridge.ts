import { Sprite, Texture, BlurFilter, Filter } from "pixi.js";
import { AdjustmentFilter } from "pixi-filters";
import { resolveFilterToIR } from "./filterIR.js";
import { createGPUPixelateFilter, createGPUScanlinesFilter, createGPURGBSplitFilter, createGPUFilmGrainFilter, createGPUVignetteFilter } from "./gpuFilters.js";

import { applyMediaTransform as engineApplyTransform, releaseMediaSprite as engineReleaseSprite, getOrCreateMediaSprite as engineGetOrCreateSprite, getActiveMediaSpriteKeys, getMediaSpriteRecord, createGPUBodyOutlineFilter, createGPUBodyGlowFilter, createGPUBodyParticlesFilter, resolveConform, type MediaSpriteRecord, type RenderViewport } from "@clypra-studio/engine";

export type { MediaSpriteRecord, RenderViewport };

const RELEASE_AFTER_INACTIVE_FRAMES = 180; // ~3 seconds at 60 FPS

export function applyMediaTransform(sprite: Sprite, layer: any, viewport: RenderViewport): void {
  if (!sprite || sprite.destroyed || !sprite.anchor) return;

  const { projectWidth, projectHeight } = viewport;
  const conform = layer.conform || {
    mode: "fit",
    sourceWidth: layer.width || 0,
    sourceHeight: layer.height || 0,
    userScale: 1,
    userOffsetX: 0,
    userOffsetY: 0,
  };
  const { x, y, width, height } = resolveConform(conform, projectWidth || 1920, projectHeight || 1080);

  // Use resolveConform output directly — no transposition needed.
  // The browser's <video> element already corrects for source rotation in
  // videoWidth/videoHeight, and resolveConform's sourceWidth/sourceHeight
  // are captured from those corrected values. Transposing here would
  // double-correct, causing the sprite to diverge from the TransformOverlay.
  const renderWidth = width;
  const renderHeight = height;

  const sw = sprite.texture?.source?.width;
  const sh = sprite.texture?.source?.height;
  if (sw && sh) {
    const currFrame = sprite.texture.frame;
    if (currFrame && (currFrame.x !== 0 || currFrame.y !== 0 || currFrame.width !== sw || currFrame.height !== sh)) {
      sprite.texture.frame.x = 0;
      sprite.texture.frame.y = 0;
      sprite.texture.frame.width = sw;
      sprite.texture.frame.height = sh;
      sprite.texture.orig.x = 0;
      sprite.texture.orig.y = 0;
      sprite.texture.orig.width = sw;
      sprite.texture.orig.height = sh;
      if (typeof sprite.texture.updateUvs === "function") {
        sprite.texture.updateUvs();
      }
      if (typeof (sprite as any).onViewUpdate === "function") {
        (sprite as any).onViewUpdate();
      }
    }
  }

  // Center anchor for accurate rotation around clip center (matching TransformOverlay)
  sprite.anchor.set(0.5, 0.5);
  sprite.position.set(x + renderWidth / 2, y + renderHeight / 2);

  // Set scale based on unrotated texture dimensions to prevent PixiJS AABB rotation distortion
  const texW = sprite.texture?.orig?.width || sprite.texture?.source?.width || renderWidth;
  const texH = sprite.texture?.orig?.height || sprite.texture?.source?.height || renderHeight;

  if (texW > 0 && texH > 0) {
    sprite.scale.set(renderWidth / texW, renderHeight / texH);
  } else {
    sprite.width = renderWidth;
    sprite.height = renderHeight;
  }

  // Only use the user's clip rotation — NOT sourceRotation.
  // The browser's <video> element already displays video content upright
  // (accounting for container metadata rotation), so adding sourceRotation
  // here would double-rotate the content.
  sprite.rotation = ((layer.rotation || 0) * Math.PI) / 180;
  sprite.alpha = layer.opacity;
}

export function releaseMediaSprite(clipId: string, container: import("pixi.js").Container): void {
  engineReleaseSprite(clipId, container);
}

export function getOrCreateMediaSprite(clipId: string, kind: "video" | "image", sourceElement: HTMLVideoElement | HTMLCanvasElement | ImageBitmap | HTMLImageElement, container: import("pixi.js").Container): MediaSpriteRecord | null {
  const effectiveKind = (typeof HTMLCanvasElement !== "undefined" && sourceElement instanceof HTMLCanvasElement) ? "image" : kind;
  return engineGetOrCreateSprite(clipId, effectiveKind, sourceElement as any, container);
}

/**
 * Prepares the container's visual children for reconciliation.
 */
export function beginMediaFrame(container: import("pixi.js").Container): void {
  for (const child of container.children) {
    child.visible = false;
  }
}

/**
 * Compiles and applies GPU-accelerated video/body filters directly to the PixiJS Sprite.
 */
function applyMediaEffectsAndFilters(sprite: Sprite, layer: any, bodyMasks: Map<string, any>, viewport: RenderViewport): void {
  const filters: Filter[] = [];
  const width = sprite.texture.source.width || layer.width;
  const height = sprite.texture.source.height || layer.height;

  // 1. Process track/layer filter
  if (layer.filter && layer.filter.intensity > 0.001) {
    const ir = resolveFilterToIR(layer.filter.id, layer.filter.intensity);
    const adj = new AdjustmentFilter();

    if (ir.sepia !== undefined) {
      adj.contrast = 1.0 - ir.sepia * 0.15;
    }
    if (ir.saturate !== undefined) {
      adj.saturation = ir.saturate;
    }
    if (ir.contrast !== undefined) {
      adj.contrast = ir.contrast;
    }
    filters.push(adj);
  }

  // 2. Process active effects
  for (const effect of layer.effects || []) {
    if (effect.intensity <= 0.001) continue;
    const renderer = effect.renderer || effect.effectId;
    const norm = renderer.replace(/^fx-/, "").replace(/-/g, "_").toLowerCase();

    if (norm === "brightness") {
      const b = Number(effect.parameters.brightness ?? 1.0) * effect.intensity;
      filters.push(new AdjustmentFilter({ brightness: b }));
    } else if (norm === "contrast") {
      const c = Number(effect.parameters.contrast ?? 1.0) * effect.intensity;
      filters.push(new AdjustmentFilter({ contrast: c }));
    } else if (norm === "saturation") {
      const s = Number(effect.parameters.saturation ?? 1.0) * effect.intensity;
      filters.push(new AdjustmentFilter({ saturation: s }));
    } else if (norm === "blur") {
      const amount = Number(effect.parameters.blur ?? effect.parameters.blurAmount ?? 10) * effect.intensity;
      filters.push(new BlurFilter({ strength: amount }));
    } else if (norm === "pixelate") {
      const size = Math.max(2, Math.floor(Number(effect.parameters.pixelSize ?? 18) * effect.intensity));
      filters.push(createGPUPixelateFilter(size));
    } else if (norm === "scanlines") {
      const count = Math.max(20, Number(effect.parameters.scanlineCount ?? 120));
      const intensity = effect.intensity;
      filters.push(createGPUScanlinesFilter(count, intensity));
    } else if (norm === "rgb_split" || norm === "chromatic_aberration" || norm === "chromatic") {
      const shift = Number(effect.parameters.rgbSplit ?? effect.parameters.splitDistance ?? 8) * effect.intensity;
      filters.push(createGPURGBSplitFilter(shift, shift, width, height));
    } else if (norm === "film_grain" || norm === "grain") {
      const intensity = Number(effect.parameters.grainIntensity ?? 1.0) * effect.intensity;
      const time = effect.localTime || 0;
      filters.push(createGPUFilmGrainFilter(intensity, time));
    } else if (norm === "vignette") {
      const radius = Number(effect.parameters.radius ?? 0.7);
      const intensity = effect.intensity;
      filters.push(createGPUVignetteFilter(radius, intensity));
    } else if (norm === "body_outline") {
      const maskData = bodyMasks.get(`${layer.layerId}_${effect.effectId}`);
      if (maskData) {
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = maskData.width;
        maskCanvas.height = maskData.height;
        maskCanvas.getContext("2d")!.putImageData(maskData, 0, 0);
        const maskTexture = Texture.from(maskCanvas);

        const color = String(effect.parameters.outlineColor ?? effect.parameters.glowColor ?? "#ffffff");
        const thickness = Math.max(1, Number(effect.parameters.thickness ?? 5) * effect.intensity);

        filters.push(createGPUBodyOutlineFilter(maskTexture, color, thickness));
      }
    } else if (norm === "body_glow" || norm === "body_segmentation_glow") {
      const maskData = bodyMasks.get(`${layer.layerId}_${effect.effectId}`);
      if (maskData) {
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = maskData.width;
        maskCanvas.height = maskData.height;
        maskCanvas.getContext("2d")!.putImageData(maskData, 0, 0);
        const maskTexture = Texture.from(maskCanvas);

        const color = String(effect.parameters.glowColor ?? "#00ffff");
        const radius = Math.max(2, Number(effect.parameters.glowRadius ?? 22) * effect.intensity);
        const alpha = Math.min(1, Number(effect.parameters.glowIntensity ?? 0.8) * effect.intensity);

        filters.push(createGPUBodyGlowFilter(maskTexture, color, radius, alpha));
      }
    } else if (norm === "body_particles") {
      const maskData = bodyMasks.get(`${layer.layerId}_${effect.effectId}`);
      if (maskData) {
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = maskData.width;
        maskCanvas.height = maskData.height;
        maskCanvas.getContext("2d")!.putImageData(maskData, 0, 0);
        const maskTexture = Texture.from(maskCanvas);

        const color = String(effect.parameters.particleColor ?? effect.parameters.glowColor ?? "#00ffff");
        const count = Math.floor(Number(effect.parameters.particleCount ?? 120) * effect.intensity);
        const time = effect.localTime || 0;

        filters.push(createGPUBodyParticlesFilter(maskTexture, color, count, effect.intensity, time));
      }
    }
  }

  sprite.filters = filters.length > 0 ? filters : null;
}

/**
 * Registers and updates a base media layer's sprite in the current frame.
 */
export function renderBaseMediaLayer(layer: any, frameId: number, sourceEl: HTMLVideoElement | HTMLCanvasElement | ImageBitmap | HTMLImageElement, container: import("pixi.js").Container, viewport: RenderViewport, renderOrder: number, bodyMasks: Map<string, any> = new Map()): void {
  const record = getOrCreateMediaSprite(layer.clipId, layer.mediaType, sourceEl, container);
  if (!record) return;

  record.lastSeenFrame = frameId;
  record.sprite.visible = true;

  // Apply transforms
  applyMediaTransform(record.sprite, layer, viewport);

  // Apply filters and effects on the GPU
  applyMediaEffectsAndFilters(record.sprite, layer, bodyMasks, viewport);

  // Apply visual z-ordering
  record.sprite.zIndex = renderOrder;
}

/**
 * Reconciles the frame: hides inactive sprites and garbage collects
 * records that haven't been seen for RELEASE_AFTER_INACTIVE_FRAMES frames.
 */
export function endMediaFrame(frameId: number, container: import("pixi.js").Container): void {
  const keys = getActiveMediaSpriteKeys();
  for (const clipId of keys) {
    const record = getMediaSpriteRecord(clipId);
    if (!record) continue;

    // Hide immediately if not seen in the current frame
    if (record.lastSeenFrame !== frameId) {
      record.sprite.visible = false;
    }

    // Garbage collect if inactive beyond the retention window
    if (frameId - record.lastSeenFrame > RELEASE_AFTER_INACTIVE_FRAMES) {
      releaseMediaSprite(clipId, container);
    }
  }
}
