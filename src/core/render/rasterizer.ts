/**
 * Scene Rasterizer
 *
 * Deterministic pixel generation from EvaluatedScene.
 * This is the SINGLE SOURCE OF TRUTH for visual output.
 *
 * Architecture:
 *   EvaluatedScene → rasterizeScene() → RasterFrame
 *
 * Key principles:
 * - Evaluation: what exists? (evaluator.ts)
 * - Rasterization: how do pixels get produced? (this file)
 * - Preview and export MUST use the same rasterization
 * - Coordinates are source-resolution absolute (not viewport-relative)
 * - Rasterizer NEVER fetches/decodes (uses pre-resolved resources)
 */

import type { EvaluatedScene, EvaluatedMediaLayer, EvaluatedTextLayer } from "../evaluation/types";
import { getResourceCache } from "../resources/ResourceCache";
import { defaultConfig as engineDefaultConfig, evaluateScene as engineEvaluateScene, textEffectConfigToScene, type TextEffectConfig, _buildConfig, layerToTextEffectConfig, CanvasDevice, TextEffectBuilder } from "@clypra/engine";
import { useEffectsStore } from "../../features/text-effects/store/effectsStore";
import { invalidateEvaluationCache } from "../evaluation/evaluator";
import { useTimelineStore } from "../../store/timelineStore";
import { effectBleed } from "../../lib/textClip";

/**
 * Raster target configuration.
 * Defines the output framebuffer properties.
 */
export interface RasterTarget {
  /** Output width in pixels */
  width: number;

  /** Output height in pixels */
  height: number;

  /** Pixel ratio (for high-DPI displays) */
  pixelRatio?: number;

  /** Color space */
  colorSpace?: "srgb" | "display-p3";

  /** Background color */
  backgroundColor?: string;

  /** Active video elements (bypass decoding) */
  videoElements?: Map<string, HTMLVideoElement>;
}

/**
 * Rasterized frame result.
 * Contains the pixel data and metadata.
 */
export interface RasterFrame {
  /** Canvas element (for preview) or OffscreenCanvas (for export) */
  canvas: HTMLCanvasElement | OffscreenCanvas;

  /** 2D rendering context */
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  /** Output dimensions */
  width: number;
  height: number;

  /** Scale factors (target size / scene size) */
  scaleX: number;
  scaleY: number;

  /** Rasterization time in ms */
  rasterTimeMs: number;

  /** Release the canvas back to the pool (if applicable) */
  releaseCanvas?: () => void;
}

/**
 * Rasterize an evaluated scene to pixels.
 *
 * This is the canonical rasterization function.
 * Preview and export MUST use this.
 *
 * @param scene - Evaluated scene
 * @param target - Raster target configuration
 * @param canvas - Optional canvas to reuse (for preview)
 * @returns Rasterized frame
 */
export async function rasterizeScene(scene: EvaluatedScene, target: RasterTarget, canvas?: HTMLCanvasElement | OffscreenCanvas): Promise<RasterFrame> {
  const startTime = performance.now();

  const { width, height, pixelRatio = 1, colorSpace = "srgb", backgroundColor = "#000000" } = target;

  const targetWidth = width * pixelRatio;
  const targetHeight = height * pixelRatio;

  // Create or reuse canvas
  // callerSupplied: canvas was provided by the caller (not drawn from pool)
  const callerSupplied = canvas != null;
  const outputCanvas = canvas ?? CanvasDevice.acquire(targetWidth, targetHeight);

  // Resize caller-supplied canvases when dimensions changed.
  // Pool canvases are always sized correctly by acquire().
  if (callerSupplied && (outputCanvas.width !== targetWidth || outputCanvas.height !== targetHeight)) {
    outputCanvas.width = targetWidth;
    outputCanvas.height = targetHeight;
  }

  const ctx = outputCanvas.getContext("2d", {
    alpha: true,
    colorSpace,
  }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

  if (!ctx) {
    throw new Error("Failed to get 2D context");
  }

  // Reset transform on every frame (critical when reusing pooled canvases —
  // without this, ctx.scale() accumulates and pushes drawing off-screen).
  // Guard for test environments where mock canvas contexts may not implement setTransform.
  if (typeof ctx.setTransform === "function") {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // Scale for pixel ratio
  if (pixelRatio !== 1) {
    ctx.scale(pixelRatio, pixelRatio);
  }

  // Clear with background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  // Calculate scale factors (target size / scene size)
  // Use uniform scaling to preserve aspect ratio
  const scaleX = width / scene.metadata.canvasWidth;
  const scaleY = height / scene.metadata.canvasHeight;
  const scale = Math.min(scaleX, scaleY); // Uniform scale (letterbox if needed)

  // Calculate letterbox/pillarbox offsets to center content
  const scaledCanvasWidth = scene.metadata.canvasWidth * scale;
  const scaledCanvasHeight = scene.metadata.canvasHeight * scale;
  const offsetX = (width - scaledCanvasWidth) / 2;
  const offsetY = (height - scaledCanvasHeight) / 2;

  // Apply centering offset
  ctx.save();
  ctx.translate(offsetX, offsetY);

  // Rasterize all visual layers with uniform scaling
  for (const layer of scene.visualLayers) {
    // TRACE: Z-order verification (can be removed after validation)
    console.log("[TRACE][RASTERIZER] Drawing:", layer.clipId.substring(0, 8), "role:", layer.role, "zIndex:", layer.zIndex);
    await rasterizeLayer(ctx, layer, scale, scale, target);
  }

  ctx.restore();

  const rasterTimeMs = performance.now() - startTime;

  // Caller must invoke releaseCanvas() after extracting ImageBitmap/ImageData
  // to return the pooled OffscreenCanvas for reuse.
  return {
    canvas: outputCanvas,
    ctx,
    width,
    height,
    scaleX: scale,
    scaleY: scale,
    rasterTimeMs,
    releaseCanvas: () => {
      if (!callerSupplied) {
        CanvasDevice.release(outputCanvas);
      }
    },
  };
}

/**
 * Rasterize a single visual layer.
 */
async function rasterizeLayer(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, layer: EvaluatedMediaLayer | EvaluatedTextLayer, scaleX: number, scaleY: number, target: RasterTarget): Promise<void> {
  ctx.save();

  // Apply transform
  const x = layer.x * scaleX;
  const y = layer.y * scaleY;
  const width = layer.width * scaleX;
  const height = layer.height * scaleY;

  // Translate to layer center
  ctx.translate(x + width / 2, y + height / 2);

  // Apply rotation
  if (layer.rotation !== 0) {
    ctx.rotate((layer.rotation * Math.PI) / 180);
  }

  // Apply opacity
  ctx.globalAlpha = layer.opacity;

  // Apply blend mode
  ctx.globalCompositeOperation = mapBlendMode(layer.blendMode);

  // Rasterize based on layer type
  if (layer.layerType === "media") {
    await rasterizeMediaLayer(ctx, layer, width, height, target);
  } else if (layer.layerType === "text") {
    rasterizeTextLayer(ctx, layer, width, height, scaleX, scaleY);
  }

  ctx.restore();
}

/**
 * Rasterize a media layer.
 * Uses pre-resolved resources when available.
 */

/** Throttle state for video element warnings (prevent log flood at 60fps). */
let _lastVideoWarnTime = 0;
const VIDEO_WARN_INTERVAL_MS = 5000;

async function rasterizeMediaLayer(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, layer: EvaluatedMediaLayer, width: number, height: number, target: RasterTarget): Promise<void> {
  try {
    // 1. Try to use active video element (bypasses decoding)
    if (layer.mediaType === "video" && target.videoElements) {
      const key = `${layer.clipId}-${layer.mediaId}`;
      const video = target.videoElements.get(key);

      if (video) {
        if (video.readyState >= 2) {
          // HAVE_CURRENT_DATA — element is loaded, draw it
          // Apply source rotation BEFORE drawing (critical for export)
          drawMediaWithSourceRotation(ctx, video, width, height, layer.sourceRotation);
          return;
        }
        // Element exists but still loading — draw silent placeholder (no error)
        drawLoadingPlaceholder(ctx, width, height);
        return;
      } else {
        // Only log warning occasionally to avoid spam
        const now = performance.now();
        if (now - _lastVideoWarnTime > VIDEO_WARN_INTERVAL_MS) {
          _lastVideoWarnTime = now;
          console.warn(`[Rasterizer] No video element for clip ${layer.clipId}`);
        }
      }
    }

    let imageBitmap: ImageBitmap | null = null;

    // 2. Try to use pre-resolved resource
    if (layer.resourceHandle) {
      const resourceCache = getResourceCache();
      const resource = resourceCache.get(layer.resourceHandle);

      if (resource && resource.data instanceof ImageBitmap) {
        imageBitmap = resource.data;
      } else {
        console.warn(`[Rasterizer] Resource handle ${layer.resourceHandle} not found or not ImageBitmap`);
      }
    } else if (layer.mediaType === "image") {
      console.warn(`[Rasterizer] No resourceHandle for image clip ${layer.clipId}, falling back to fetch`);
    }

    // Fallback: load on-demand (legacy path, should be avoided)
    if (!imageBitmap) {
      if (layer.mediaType === "video") {
        // Cannot decode video without video element — draw placeholder silently
        // Throttle the warning to prevent log flood at 60fps
        const now = performance.now();
        if (now - _lastVideoWarnTime > VIDEO_WARN_INTERVAL_MS) {
          _lastVideoWarnTime = now;
          console.warn(`[Rasterizer] No video element for clip ${layer.clipId} — video pool may not have synced yet`);
        }
        drawLoadingPlaceholder(ctx, width, height);
        return;
      }

      // Only attempt fetch for images
      const response = await fetch(layer.sourcePath);
      const blob = await response.blob();
      imageBitmap = await createImageBitmap(blob);
    }

    // Draw centered (after rotation transform) with source rotation applied
    drawMediaWithSourceRotation(ctx, imageBitmap, width, height, layer.sourceRotation);

    // Only close if we created it (not from resource manager)
    if (!layer.resourceHandle && imageBitmap) {
      imageBitmap.close();
    }
  } catch (error) {
    // Fallback: draw error placeholder
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(-width / 2, -height / 2, width, height);

    // Draw error border
    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 2;
    ctx.strokeRect(-width / 2, -height / 2, width, height);

    // Draw error text
    ctx.save();
    ctx.fillStyle = "#ff4444";
    ctx.font = "14px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Media decode error", 0, -10);
    ctx.font = "10px monospace";
    ctx.fillStyle = "#ff8888";
    ctx.fillText(layer.mediaType === "video" ? "Missing video element" : "Load failed", 0, 10);
    ctx.restore();

    console.error(`[Rasterizer] Failed to render media layer:`, error);
  }
}

/**
 * Draw a non-alarming loading placeholder (dark frame with spinner indicator).
 * Used when a video element exists but hasn't loaded yet, or during pool sync.
 */
function drawLoadingPlaceholder(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(-width / 2, -height / 2, width, height);
}

/**
 * Draw media (video element or ImageBitmap) with source rotation applied.
 *
 * CRITICAL: This handles container metadata rotation (e.g., iPhone portrait videos
 * encoded as 1280×720 with rotation=270° → display as 720×1280 portrait).
 *
 * The HTML5 video element and ImageBitmap APIs return pixels in the ENCODED
 * orientation, NOT display orientation. We must apply the rotation transform
 * to draw pixels correctly before they are piped to FFmpeg as raw RGBA.
 *
 * @param ctx - Canvas context (already translated to layer center)
 * @param source - Video element or ImageBitmap to draw
 * @param width - Target width (layer width in canvas)
 * @param height - Target height (layer height in canvas)
 * @param sourceRotation - Rotation from container metadata (0, 90, 180, 270)
 */
function drawMediaWithSourceRotation(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, source: HTMLVideoElement | ImageBitmap, width: number, height: number, sourceRotation?: number): void {
  if (!sourceRotation || sourceRotation === 0) {
    // No rotation - draw normally
    ctx.drawImage(source, -width / 2, -height / 2, width, height);
    return;
  }

  // Apply source rotation correction
  // The context is already at the layer center (from rasterizeLayer)
  // and has the user's clip rotation applied. Now we add source rotation.
  ctx.save();

  // Rotate around the drawing origin (layer center)
  ctx.rotate((sourceRotation * Math.PI) / 180);

  // For 90° and 270° rotations, the source aspect ratio is transposed
  // Example: source is 1280×720 encoded, but displays as 720×1280 portrait
  // We need to draw at transposed dimensions so the rotated result fits correctly
  const isTransposed = sourceRotation === 90 || sourceRotation === 270;
  const drawWidth = isTransposed ? height : width;
  const drawHeight = isTransposed ? width : height;

  ctx.drawImage(source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);

  ctx.restore();
}

/**
 * Rasterize a text layer.
 *
 * CRITICAL: This is the canonical text rendering path.
 * Preview and export MUST use the same code path.
 *
 * Styled layers (styleId present) always go through engineEvaluateScene,
 * which is the authoritative pipeline for stroke-blur, glow, bevel, and
 * all post-fx. When ctx.filter is unsupported (WKWebView on macOS),
 * rendering is routed through the WebGLCompositor fallback so visual
 * output is consistent across platforms.
 *
 * Plain text layers (no styleId) use a minimal Canvas 2D path that
 * respects the same baseline alignment as the engine (fontSize * 0.82).
 */
function rasterizeTextLayer(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, layer: EvaluatedTextLayer, width: number, height: number, scaleX: number, scaleY: number): void {
  // fontSize for rendering: scaled to match the layer's on-canvas pixel size.
  const fontSize = layer.fontSize * scaleY;
  const effectDef = layer.styleId ? useEffectsStore.getState().definitions[layer.styleId] : undefined;
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
  const effectPaddingX = Math.max(fontSize * 0.25, declaredBleed.x * scaleX);
  const effectPaddingY = Math.max(fontSize * 0.25, declaredBleed.y * scaleY);
  const offW = Math.max(1, Math.ceil(width + effectPaddingX * 2));
  const offH = Math.max(1, Math.ceil(height + effectPaddingY * 2));

  let engineConfig: TextEffectConfig;

  if (layer.styleId) {
    if (effectDef) {
      // Pass render-resolution fontSize so all derived effect parameters
      // (stroke width, glow blur, bevel depth, etc.) are computed at the
      // correct scale for the target framebuffer.
      const builder = TextEffectBuilder.fromDefinition(effectDef, layer.text, fontSize, offW, offH);

      builder.setCanvas({
        posX: layer.textAlign || "center",
        posY: layer.verticalAlign === "middle" ? "middle" : layer.verticalAlign || "middle",
      });

      engineConfig = builder.buildConfig();
      if (layer.time !== undefined) (engineConfig as any).time = layer.time;
      if (layer.clipStartTime !== undefined) (engineConfig as any).clipStartTime = layer.clipStartTime;
      if (layer.clipDuration !== undefined) (engineConfig as any).clipDuration = layer.clipDuration;
    } else {
      // styleId present but definition not yet in cache — trigger fetch in background
      // and fall back to plain text until it resolves and redraws.
      const store = useEffectsStore.getState();
      if (!store.prefetchingIds.has(layer.styleId)) {
        // Mark as prefetching to prevent duplicate network requests
        useEffectsStore.setState((s) => {
          const next = new Set(s.prefetchingIds);
          next.add(layer.styleId!);
          return { prefetchingIds: next };
        });

        store
          .fetchDefinitionOnlyById(layer.styleId)
          .then(() => {
            // Once resolved, remove from prefetchingIds (definitions cache is now populated)
            useEffectsStore.setState((s) => {
              const next = new Set(s.prefetchingIds);
              next.delete(layer.styleId!);
              return { prefetchingIds: next };
            });

            // Invalidate evaluated scene cache for current epoch and trigger redraw
            const currentEpoch = useTimelineStore.getState().epoch;
            invalidateEvaluationCache(currentEpoch);
            useTimelineStore.getState().incrementEpoch();
          })
          .catch((err) => {
            useEffectsStore.setState((s) => {
              const next = new Set(s.prefetchingIds);
              next.delete(layer.styleId!);
              return { prefetchingIds: next };
            });
            console.error(`[Rasterizer] Failed to load text effect ${layer.styleId}:`, err);
          });
      }

      const plainConfig = layerToTextEffectConfig(layer);
      engineConfig = {
        ...plainConfig,
        canvasWidth: offW,
        canvasHeight: offH,
        fontSize,
        fontFamily: layer.fontFamily,
        letterSpacing: (layer.letterSpacing ?? plainConfig.letterSpacing ?? 0) * scaleX,
        strokeWidth: layer.stroke ? layer.stroke.width * scaleY : plainConfig.strokeWidth * scaleY,
        shadowBlur: layer.shadow ? layer.shadow.blur * scaleY : plainConfig.shadowBlur * scaleY,
        shadowOffsetX: layer.shadow ? layer.shadow.offsetX * scaleX : plainConfig.shadowOffsetX * scaleX,
        shadowOffsetY: layer.shadow ? layer.shadow.offsetY * scaleY : plainConfig.shadowOffsetY * scaleY,
        panelRadius: layer.background ? layer.background.borderRadius * scaleY : plainConfig.panelRadius * scaleY,
        panelPaddingX: layer.background ? layer.background.padding * scaleX : plainConfig.panelPaddingX * scaleX,
        panelPaddingY: layer.background ? layer.background.padding * scaleY : plainConfig.panelPaddingY * scaleY,
      } as any;
    }
  } else {
    // Plain text: build configuration from evaluated layer properties
    const plainConfig = layerToTextEffectConfig(layer);
    engineConfig = {
      ...plainConfig,
      canvasWidth: offW,
      canvasHeight: offH,
      fontSize,
      fontFamily: layer.fontFamily,
      letterSpacing: (layer.letterSpacing ?? plainConfig.letterSpacing ?? 0) * scaleX,
      strokeWidth: layer.stroke ? layer.stroke.width * scaleY : plainConfig.strokeWidth * scaleY,
      shadowBlur: layer.shadow ? layer.shadow.blur * scaleY : plainConfig.shadowBlur * scaleY,
      shadowOffsetX: layer.shadow ? layer.shadow.offsetX * scaleX : plainConfig.shadowOffsetX * scaleX,
      shadowOffsetY: layer.shadow ? layer.shadow.offsetY * scaleY : plainConfig.shadowOffsetY * scaleY,
      panelRadius: layer.background ? layer.background.borderRadius * scaleY : plainConfig.panelRadius * scaleY,
      panelPaddingX: layer.background ? layer.background.padding * scaleX : plainConfig.panelPaddingX * scaleX,
      panelPaddingY: layer.background ? layer.background.padding * scaleY : plainConfig.panelPaddingY * scaleY,
    } as any;
  }

  const sceneDoc = textEffectConfigToScene(engineConfig);

  // Acquire canvas context from the unified CanvasDevice pool
  const offscreen = CanvasDevice.acquire(offW, offH);
  const offCtx = offscreen.getContext("2d", { alpha: true }) as OffscreenCanvasRenderingContext2D | null;
  if (offCtx) {
    if (typeof offCtx.setTransform === "function") {
      offCtx.setTransform(1, 0, 0, 1, 0, 0);
    }
    offCtx.clearRect(0, 0, offW, offH);
    engineEvaluateScene(sceneDoc, layer.time ?? 0, offCtx as unknown as CanvasRenderingContext2D);
    ctx.drawImage(offscreen, 0, 0, offW, offH, -width / 2 - effectPaddingX, -height / 2 - effectPaddingY, offW, offH);
  }
  CanvasDevice.release(offscreen);
}

// wrapText helper was removed since wrapping is handled natively inside the engine.

/**
 * Map blend mode to canvas composite operation.
 */
function mapBlendMode(blendMode: string): GlobalCompositeOperation {
  const map: Record<string, GlobalCompositeOperation> = {
    normal: "source-over",
    multiply: "multiply",
    screen: "screen",
    overlay: "overlay",
    darken: "darken",
    lighten: "lighten",
    add: "lighter",
    mask: "source-in",
    "mask-inverted": "source-out",
    "source-in": "source-in",
    "source-out": "source-out",
    "destination-in": "destination-in",
    "destination-out": "destination-out",
  };

  return map[blendMode] || "source-over";
}

/**
 * Measure text dimensions (for layout validation).
 *
 * This allows evaluator to include measured bounds in EvaluatedTextLayer.
 * Future enhancement.
 */
export function measureText(text: string, fontFamily: string, fontSize: number, fontWeight: string | number, fontStyle: string): { width: number; height: number } {
  // Create temporary canvas for measurement
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");

  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) {
    return { width: 0, height: 0 };
  }

  const weight = typeof fontWeight === "number" ? fontWeight : fontWeight === "bold" ? "700" : "400";
  ctx.font = `${fontStyle} ${weight} ${fontSize}px ${fontFamily}`;

  const metrics = ctx.measureText(text);

  return {
    width: metrics.width,
    height: fontSize * 1.2, // Approximate height
  };
}
