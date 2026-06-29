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

import type { EvaluatedEffect, EvaluatedScene, EvaluatedMediaLayer, EvaluatedTextLayer } from "../evaluation/types";
import { resolveFilterToIR, compileFilterIRToCSS } from "./filterIR";
import { getResourceCache } from "../resources/ResourceCache";
import { evaluateScene as engineEvaluateScene, textEffectConfigToScene, type TextEffectConfig, layerToTextEffectConfig, CanvasDevice, defaultConfig as engineDefaultConfig, _buildConfig, EffectGraph, EffectEngine } from "@clypra/engine";
import { useEffectsStore } from "../../features/text-effects/store/effectsStore";
import { invalidateEvaluationCache } from "../evaluation/evaluator";
import { useTimelineStore } from "../../store/timelineStore";
import { effectBleed } from "../../lib/text/textClip";
import lottie from "lottie-web";
import { useStickersStore } from "../../features/stickers/store/stickersStore";
import { segmentBodyMask } from "../../features/body-effects/segmentation/bodySegmentationWorkerClient";
import { sampleCanvasAlpha, textRenderTrace, textRenderWarn } from "@/lib/debug/textRenderTrace";
import { performanceMonitor } from "@/lib/monitoring/PerformanceMonitor";
import { TransitionRenderer } from "@clypra/engine/transitions";

const effectEngine = new EffectEngine();

interface LottieAnimationCacheEntry {
  anim: any;
  canvas: HTMLCanvasElement;
  container: HTMLDivElement;
  stickerId: string;
  cacheKey?: string;
}

const lottieRenderCache = new Map<string, LottieAnimationCacheEntry>();

/**
 * PREV-BUG-003 fix: Clear all cached Lottie animations and remove their DOM containers.
 * Must be called on project switch to prevent DOM node leaks and stale animation data.
 */
export function clearLottieRenderCache(): void {
  for (const [, entry] of lottieRenderCache) {
    try {
      entry.anim.destroy();
    } catch {
      // Lottie destroy can throw if already cleaned up
    }
    entry.container.remove();
  }
  lottieRenderCache.clear();
}

function hasVisibleAlpha(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number): boolean | null {
  try {
    const sampleWidth = Math.max(1, Math.floor(width));
    const sampleHeight = Math.max(1, Math.floor(height));
    const image = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
    const step = Math.max(4, Math.floor(image.data.length / 4096 / 4) * 4);

    for (let i = 3; i < image.data.length; i += step) {
      if (image.data[i] > 8) return true;
    }

    return false;
  } catch {
    return null;
  }
}

function buildPlainTextEffectConfig(layer: EvaluatedTextLayer, offW: number, offH: number, fontSize: number, scaleX: number, scaleY: number): TextEffectConfig {
  const plainConfig = layerToTextEffectConfig(layer);
  return {
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
  } as TextEffectConfig;
}

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

  /** Whether to skip applying track-level filters on the CPU (for GPU preview path) */
  skipFilters?: boolean;

  /** PREV-BUG-005 fix: Resource handle side-channel map (layerId → handle).
   *  Used instead of mutating cached EvaluatedScene layer objects. */
  resourceHandleMap?: Map<string, import("../resources/types").RenderResourceHandle>;
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
  performanceMonitor.increment("rasterizer.scene_rasterize");

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

  // Detect if scene contains text template layers which require transparent background
  const hasTextTemplate = scene.visualLayers.some((layer) => layer.layerType === "text" && (layer as any).templateId);

  // Clear with background
  // Text templates always render with transparent background
  if (hasTextTemplate) {
    ctx.clearRect(0, 0, width, height);
  } else {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
  }

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

  // Clip all layer rendering to the canvas bounds.
  // Without this, "cover" and "original" mode clips bleed past the canvas
  // into the letterbox/pillarbox area. Professional NLEs always clip to canvas.
  // Guard for test environments where mock canvas contexts may not implement these.
  if (typeof ctx.beginPath === "function") {
    ctx.beginPath();
    ctx.rect(0, 0, scaledCanvasWidth, scaledCanvasHeight);
    ctx.clip();
  }

  // Identify layers that are part of transitions
  const transitionsMap = new Map<string, { transition: any; isIncoming: boolean; otherLayerId: string }>();
  for (const t of scene.transitions) {
    transitionsMap.set(t.outgoingLayer, { transition: t, isIncoming: false, otherLayerId: t.incomingLayer });
    transitionsMap.set(t.incomingLayer, { transition: t, isIncoming: true, otherLayerId: t.outgoingLayer });
  }

  // Pre-render transition frames if needed
  const transitionFrames = new Map<string, { fromCanvas: OffscreenCanvas | HTMLCanvasElement; toCanvas: OffscreenCanvas | HTMLCanvasElement }>();
  for (const t of scene.transitions) {
    const outgoing = scene.visualLayers.find((l) => l.layerId === t.outgoingLayer);
    const incoming = scene.visualLayers.find((l) => l.layerId === t.incomingLayer);
    if (outgoing && incoming) {
      // PREV-BUG-004 fix: Use CanvasDevice pool instead of raw OffscreenCanvas to avoid GC pressure.
      const fromCanvas = CanvasDevice.acquire(width, height);
      const toCanvas = CanvasDevice.acquire(width, height);
      const fromCtx = fromCanvas.getContext("2d") as any;
      const toCtx = toCanvas.getContext("2d") as any;

      if (fromCtx && toCtx) {
        // Draw layers onto temporary canvases (with scaling and centering translation applied)
        fromCtx.save();
        fromCtx.translate(offsetX, offsetY);
        if (typeof fromCtx.beginPath === "function") {
          fromCtx.beginPath();
          fromCtx.rect(0, 0, scaledCanvasWidth, scaledCanvasHeight);
          fromCtx.clip();
        }
        // Force opacity to 1.0 during transition capture so the TransitionRenderer controls blending
        await rasterizeLayer(fromCtx, { ...outgoing, opacity: 1.0 }, scale, scale, target);
        fromCtx.restore();

        toCtx.save();
        toCtx.translate(offsetX, offsetY);
        if (typeof toCtx.beginPath === "function") {
          toCtx.beginPath();
          toCtx.rect(0, 0, scaledCanvasWidth, scaledCanvasHeight);
          toCtx.clip();
        }
        await rasterizeLayer(toCtx, { ...incoming, opacity: 1.0 }, scale, scale, target);
        toCtx.restore();

        transitionFrames.set(t.transitionId, { fromCanvas, toCanvas });
      }
    }
  }

  // Rasterize all visual layers with uniform scaling
  for (const layer of scene.visualLayers) {
    performanceMonitor.startTimer(`rasterizer.layer_${layer.layerType}`);

    const tInfo = transitionsMap.get(layer.layerId);
    if (tInfo) {
      // If outgoing layer, we skip drawing it (it will be blended when we hit the incoming layer)
      if (!tInfo.isIncoming) {
        continue;
      }

      // If incoming layer, render the transition blend!
      const frames = transitionFrames.get(tInfo.transition.transitionId);
      if (frames) {
        ctx.save();
        // Since the frames are already rendered with offsetX/offsetY, reset transform to draw them full-screen
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        // PREV-BUG-007 fix: TransitionRenderer is now a static import (no async import() in hot path)
        TransitionRenderer.render(ctx as any, frames.fromCanvas as any, frames.toCanvas as any, tInfo.transition.type, tInfo.transition.params || {}, tInfo.transition.progress);
        ctx.restore();
        // PREV-BUG-004 fix: Release transition canvases back to pool
        CanvasDevice.release(frames.fromCanvas);
        CanvasDevice.release(frames.toCanvas);
        performanceMonitor.endTimer(`rasterizer.layer_${layer.layerType}`);
      } else {
        // Fallback to normal rendering if frames failed to prepare
        await rasterizeLayer(ctx, layer, scale, scale, target);
        performanceMonitor.endTimer(`rasterizer.layer_${layer.layerType}`);
      }
    } else {
      // Normal layer rendering
      await rasterizeLayer(ctx, layer, scale, scale, target);
      performanceMonitor.endTimer(`rasterizer.layer_${layer.layerType}`);
    }
  }

  ctx.restore();

  // ─────────────────────────────────────────────────────────────────────────────
  // Apply track-level filter to the entire composition on CPU (unless skipped for GPU)
  //
  // ARCHITECTURE NOTE: This implements a LINEAR MERGED PIPELINE where filters
  // are applied as a post-process to the effect-composited canvas. While this
  // appears to merge pipelines, it's actually the CORRECT implementation of the
  // isolated pipeline architecture:
  //
  //   Effect Pipeline → outputCanvas
  //   Filter Pipeline → reads outputCanvas, writes filtered result back
  //
  // The pipelines remain isolated because:
  // 1. Filter rendering is independent (doesn't modify effect state)
  // 2. Effect rendering is independent (doesn't know about filters)
  // 3. Composite pass happens here (final blend of both pipelines)
  //
  // TODO: Migrate to WebGL-based filter rendering to support advanced params
  // (exposure, temperature, tint, vignette) that Canvas2D ctx.filter can't handle.
  // See FILTER_ARCHITECTURE.md for details.
  // ─────────────────────────────────────────────────────────────────────────────
  if (scene.activeFilter && !target.skipFilters) {
    const { id, intensity, effectStack, pipeline } = scene.activeFilter;

    if (pipeline === "v2" && effectStack && effectStack.length > 0) {
      try {
        const { buildManifestFromClip, isV2SupportedEffectStack, renderMPGFrame } = await import("../mpg");
        const { scaleEffectStackByIntensity } = await import("../mpg/filterStack");
        const scaled = scaleEffectStackByIntensity(
          effectStack.map((n) => ({ type: n.type, params: n.params ?? {} })),
          intensity,
        );
        if (isV2SupportedEffectStack(scaled)) {
          const manifest = buildManifestFromClip(
            "filter-post",
            "Filter Post Process",
            { id: "filter-clip", assetId: "filter-source", timelineStartMs: 0, timelineEndMs: 60_000, enabled: true },
            scaled,
            { width: targetWidth, height: targetHeight, assetUri: "inline://filter", assetKind: "image" },
          );

          const sourceCanvas = document.createElement("canvas");
          sourceCanvas.width = targetWidth;
          sourceCanvas.height = targetHeight;
          const sourceCtx = sourceCanvas.getContext("2d")!;
          sourceCtx.drawImage(outputCanvas, 0, 0, targetWidth, targetHeight);

          const filtered = await renderMPGFrame(manifest, sourceCanvas, {
            timelineTimeMs: 500,
            width: targetWidth,
            height: targetHeight,
          });

          ctx.save();
          if (typeof ctx.setTransform === "function") {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
          }
          ctx.clearRect(0, 0, targetWidth, targetHeight);
          ctx.fillStyle = backgroundColor;
          ctx.fillRect(0, 0, targetWidth, targetHeight);
          ctx.drawImage(filtered, 0, 0, targetWidth, targetHeight);
          ctx.restore();
        }
      } catch (err) {
        console.warn("[Rasterizer:MPG Filter] V2 filter path failed, falling back to CSS", err);
      }
    } else {
      const ir = resolveFilterToIR(id, intensity, scene.activeFilter.swatch);
      const cssFilter = compileFilterIRToCSS(ir);

      if (cssFilter) {
        const tempCanvas = CanvasDevice.acquire(targetWidth, targetHeight);
        const tempCtx = tempCanvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        if (tempCtx) {
          tempCtx.clearRect(0, 0, targetWidth, targetHeight);
          tempCtx.drawImage(outputCanvas, 0, 0);

          ctx.save();
          if (typeof ctx.setTransform === "function") {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
          }
          ctx.clearRect(0, 0, targetWidth, targetHeight);
          ctx.fillStyle = backgroundColor;
          ctx.fillRect(0, 0, targetWidth, targetHeight);
          ctx.filter = cssFilter;
          ctx.drawImage(tempCanvas, 0, 0);
          ctx.restore();
        }
        CanvasDevice.release(tempCanvas);
      }
    }
  }

  const rasterTimeMs = performance.now() - startTime;

  // Track rasterization performance
  performanceMonitor.timing("rasterizer.scene_duration", rasterTimeMs);
  performanceMonitor.gauge("rasterizer.layer_count", scene.visualLayers.length);
  performanceMonitor.gauge("rasterizer.canvas_pool_size", (canvas as any)?.poolSize ?? 0);

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
    await rasterizeTextLayer(ctx, layer, width, height, scaleX, scaleY);
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
  performanceMonitor.startTimer(`rasterizer.media_${layer.mediaType}`);

  try {
    if (layer.clipKind === "sticker") {
      const stickerId = layer.stickerSourceId || layer.mediaId.replace("sticker-", "");
      let cachedSticker = useStickersStore.getState().getCachedSticker(stickerId);
      if (!cachedSticker) {
        await useStickersStore.getState().initializeCache();
        cachedSticker = useStickersStore.getState().getCachedSticker(stickerId);
      }

      // Stickers are Lottie-only
      const stickerFormat = "lottie";
      const lottieSourcePath = cachedSticker?.localAnimationPath ?? layer.stickerAnimationPath;

      if (stickerFormat === "lottie" && lottieSourcePath) {
        let cacheEntry = lottieRenderCache.get(layer.clipId);

        if (!cacheEntry || cacheEntry.stickerId !== stickerId) {
          if (cacheEntry) {
            cacheEntry.anim.destroy();
            cacheEntry.container.remove();
          }

          try {
            const { stickerCacheManager } = await import("@/features/stickers/cache/stickerCache");
            let absoluteLottiePath = lottieSourcePath;
            if (!absoluteLottiePath.startsWith("/") && !absoluteLottiePath.startsWith("file:") && !absoluteLottiePath.startsWith("asset://")) {
              const { appCacheDir, join } = await import("@tauri-apps/api/path");
              const appCache = await appCacheDir();
              absoluteLottiePath = await join(appCache, absoluteLottiePath);
            }

            const lottieData = await stickerCacheManager.readLottieJson(absoluteLottiePath);

            const container = document.createElement("div");
            container.style.width = `${width}px`;
            container.style.height = `${height}px`;
            container.style.position = "absolute";
            container.style.left = "-9999px";
            container.style.top = "-9999px";
            document.body.appendChild(container);

            const anim = lottie.loadAnimation({
              container,
              renderer: "canvas",
              autoplay: false,
              loop: true,
              animationData: JSON.parse(JSON.stringify(lottieData)),
            });

            anim.goToAndStop(0, true);
            await Promise.resolve();

            const canvas = container.querySelector("canvas") as HTMLCanvasElement;
            if (canvas) {
              cacheEntry = { anim, canvas, container, stickerId };
              lottieRenderCache.set(layer.clipId, cacheEntry);
            }
          } catch (err) {
            console.error("[Rasterizer] Failed to load Lottie animation:", err);
          }
        }

        if (cacheEntry) {
          const totalFrames = cacheEntry.anim.totalFrames;
          const frameRate = cacheEntry.anim.frameRate || 30;
          const speed = layer.stickerSettings?.speed ?? 1.0;
          const loop = layer.stickerSettings?.loop ?? true;

          let frame = Math.floor(layer.sourceTime * speed * frameRate);
          if (loop) {
            frame = frame % totalFrames;
          } else {
            frame = Math.min(frame, totalFrames - 1);
          }

          cacheEntry.anim.goToAndStop(frame, true);
          await Promise.resolve();

          await drawMediaWithSourceRotation(ctx, cacheEntry.canvas, width, height, layer.sourceRotation, layer.effects, layer.filter);
          return;
        }
      }
    }

    // 1. Try to use active video element (bypasses decoding)
    if (layer.mediaType === "video" && target.videoElements) {
      const key = `${layer.clipId}-${layer.mediaId}`;
      const video = target.videoElements.get(key);

      if (video) {
        if (video.readyState >= 2) {
          performanceMonitor.increment("rasterizer.video_element_hit");

          await drawMediaWithSourceRotation(ctx, video, width, height, layer.sourceRotation, layer.effects, layer.filter);
          performanceMonitor.endTimer(`rasterizer.media_${layer.mediaType}`);
          return;
        }
        performanceMonitor.increment("rasterizer.video_element_loading");
        drawLoadingPlaceholder(ctx, width, height);
        performanceMonitor.endTimer(`rasterizer.media_${layer.mediaType}`);
        return;
      } else {
        // Only log warning occasionally to avoid spam
        const now = performance.now();
        if (now - _lastVideoWarnTime > VIDEO_WARN_INTERVAL_MS) {
          _lastVideoWarnTime = now;
          console.warn(`[Rasterizer] No video element for clip ${layer.clipId} (key: ${key})`);

          // LOG: Show available keys to help debug mismatch
          if (target.videoElements.size > 0) {
            const availableKeys = Array.from(target.videoElements.keys()).filter((k) => k.includes(layer.mediaId));
            console.warn(`[Rasterizer] Available keys for mediaId ${layer.mediaId}:`, availableKeys);
          }
        }
      }
    }

    let imageBitmap: ImageBitmap | null = null;

    // 2. Try to use pre-resolved resource
    // PREV-BUG-005 fix: Check the side-channel map first (avoids reliance on mutated scene cache),
    // then fall back to layer.resourceHandle for backward compatibility (export path).
    const resolvedHandle = target.resourceHandleMap?.get(layer.layerId) ?? layer.resourceHandle;
    if (resolvedHandle) {
      const resourceCache = getResourceCache();
      const resource = resourceCache.get(resolvedHandle);

      if (resource && resource.data instanceof ImageBitmap) {
        performanceMonitor.increment("rasterizer.resource_cache_hit");
        imageBitmap = resource.data;
      } else {
        performanceMonitor.increment("rasterizer.resource_cache_miss");
        console.warn(`[Rasterizer] Resource handle ${resolvedHandle} not found or not ImageBitmap`);
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
    await drawMediaWithSourceRotation(ctx, imageBitmap, width, height, layer.sourceRotation, layer.effects, layer.filter);

    // Only close if we created it (not from resource manager)
    if (!resolvedHandle && imageBitmap) {
      imageBitmap.close();
    }

    performanceMonitor.endTimer(`rasterizer.media_${layer.mediaType}`);
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

    performanceMonitor.increment("rasterizer.media_decode_error");
    performanceMonitor.endTimer(`rasterizer.media_${layer.mediaType}`);
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
async function drawMediaWithSourceRotation(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, source: HTMLVideoElement | ImageBitmap | HTMLCanvasElement, width: number, height: number, sourceRotation?: number, effects?: EvaluatedEffect[], filter?: { id: string; name: string; intensity: number }): Promise<void> {
  ctx.save();
  const isTransposed = sourceRotation === 90 || sourceRotation === 270;
  const drawWidth = isTransposed ? height : width;
  const drawHeight = isTransposed ? width : height;
  const frameCanvas = await renderMediaFrame(source, drawWidth, drawHeight, effects, filter);

  if (sourceRotation && sourceRotation !== 0) {
    ctx.rotate((sourceRotation * Math.PI) / 180);
  }

  ctx.drawImage(frameCanvas, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  CanvasDevice.release(frameCanvas);
  ctx.restore();
}

async function imageBitmapToCanvas(bitmap: ImageBitmap, width: number, height: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

async function renderMediaFrame(source: HTMLVideoElement | ImageBitmap | HTMLCanvasElement, width: number, height: number, effects: EvaluatedEffect[] | undefined, filter?: { id: string; name: string; intensity: number }): Promise<HTMLCanvasElement | OffscreenCanvas> {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));

  const bodyEffects = (effects || []).filter((effect) => isBodyRenderer(effect.renderer || effect.effectId));
  const videoEffects = (effects || []).filter((effect) => !isBodyRenderer(effect.renderer || effect.effectId));

  if (videoEffects.length > 0 && bodyEffects.length === 0) {
    try {
      const { buildManifestFromClip, isV2SupportedEffectStack, expandMpgStackEffects, renderMPGFrame } = await import("../mpg");
      const rawStack = videoEffects.map((fx) => ({
        id: fx.effectId,
        type: fx.renderer || fx.effectId,
        params: { ...fx.parameters, intensity: fx.intensity } as Record<string, unknown>,
      }));
      const stack = expandMpgStackEffects(rawStack);

      if (isV2SupportedEffectStack(stack)) {
        const manifest = buildManifestFromClip(
          "rasterizer-frame",
          "Rasterizer Frame",
          { id: "clip-inline", assetId: "source-inline", timelineStartMs: 0, timelineEndMs: 60_000, enabled: true },
          stack.map((fx) => {
            const params = fx.params as Record<string, unknown>;
            const typeLower = fx.type.toLowerCase();
            const intensity = Number(params.intensity ?? 0);
            return {
              ...fx,
              params: {
                ...params,
                brightness: params.brightness ?? (typeLower.includes("brightness") ? intensity : undefined),
                contrast: params.contrast ?? (typeLower.includes("contrast") ? intensity : undefined),
                blur: params.blur ?? params.blurAmount ?? (typeLower.includes("blur") ? intensity * 20 : undefined),
              },
            };
          }),
          { width: w, height: h, assetUri: "inline://source", assetKind: "image" },
        );

        const sourceEl =
          source instanceof HTMLVideoElement || source instanceof HTMLCanvasElement
            ? source
            : await imageBitmapToCanvas(source, w, h);

        const mpgCanvas = await renderMPGFrame(manifest, sourceEl, {
          timelineTimeMs: videoEffects[0]?.localTime ? videoEffects[0].localTime * 1000 : 500,
          width: w,
          height: h,
        });

        if (filter) {
          const filtered = CanvasDevice.acquire(w, h);
          const fctx = filtered.getContext("2d")!;
          const ir = resolveFilterToIR(filter.id, filter.intensity);
          const cssFilter = compileFilterIRToCSS(ir);
          if (cssFilter) fctx.filter = cssFilter;
          fctx.drawImage(mpgCanvas, 0, 0, w, h);
          return filtered;
        }

        return mpgCanvas;
      }
    } catch (err) {
      console.warn("[Rasterizer:MPG] V2 path failed, falling back to legacy", err);
    }
  }

  const canvas = CanvasDevice.acquire(w, h);
  const frameCtx = canvas.getContext("2d", { alpha: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!frameCtx) return canvas;

  if (typeof frameCtx.setTransform === "function") {
    frameCtx.setTransform(1, 0, 0, 1, 0, 0);
  }
  frameCtx.clearRect(0, 0, canvas.width, canvas.height);

  const cssFilter = buildMediaFilter(filter, effects);
  if (cssFilter) frameCtx.filter = cssFilter;

  try {
    frameCtx.drawImage(source, 0, 0, canvas.width, canvas.height);
  } catch (error) {
    console.error(`[Rasterizer] Error drawing video to canvas:`, error);
  }

  frameCtx.filter = "none";

  const bodyMasks = await prepareBodyMasks(canvas, effects, canvas.width, canvas.height);

  for (const effect of effects || []) {
    applyRasterEffect(frameCtx, effect, canvas.width, canvas.height, bodyMasks);
  }

  return canvas;
}

async function prepareBodyMasks(source: HTMLCanvasElement | OffscreenCanvas, effects: EvaluatedEffect[] | undefined, width: number, height: number): Promise<Map<string, ImageData>> {
  const bodyEffects = (effects || []).filter((effect) => isBodyRenderer(effect.renderer || effect.effectId));
  const masks = new Map<string, ImageData>();
  if (bodyEffects.length === 0) return masks;

  await Promise.all(
    bodyEffects.map(async (effect) => {
      const mask = await segmentBodyMask(source as unknown as CanvasImageSource, {
        effectId: effect.effectId,
        renderer: effect.renderer,
        time: effect.localTime,
        width,
        height,
        minConfidence: Number(effect.parameters.minConfidence ?? 0.7),
      });
      if (mask) masks.set(effect.effectId, mask);
    }),
  );

  return masks;
}

function buildMediaFilter(filter: { id: string; name: string; intensity: number } | undefined, effects: EvaluatedEffect[] | undefined): string {
  const filters: string[] = [];
  if (filter) {
    const ir = resolveFilterToIR(filter.id, filter.intensity);
    const cssFilter = compileFilterIRToCSS(ir);
    if (cssFilter) filters.push(cssFilter);
  }

  for (const effect of effects || []) {
    const renderer = normalizeRendererName(effect.renderer || effect.effectId);
    if (renderer === "blur" || effect.effectId === "fx-blur") {
      const blurAmount = Number(effect.parameters.blurAmount ?? 20) * effect.intensity;
      if (blurAmount > 0.1) filters.push(`blur(${blurAmount}px)`);
    }
  }

  return filters.join(" ");
}

function applyRasterEffect(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, effect: EvaluatedEffect, width: number, height: number, bodyMasks: Map<string, ImageData>): void {
  if (effect.intensity <= 0.001) return;

  performanceMonitor.startTimer(`rasterizer.effect_${effect.renderer || effect.effectId}`);
  performanceMonitor.increment("rasterizer.effects_applied");

  const renderer = normalizeRendererName(effect.renderer || effect.effectId);

  if (isBodyRenderer(renderer)) {
    // Body effects require source mask overlays and are handled locally in the rasterizer
    switch (renderer) {
      case "body_segmentation_glow":
      case "body_glow":
        renderBodySegmentationGlow(ctx, effect, width, height, bodyMasks.get(effect.effectId));
        break;
      case "body_outline":
        renderBodyOutline(ctx, effect, width, height, bodyMasks.get(effect.effectId));
        break;
      case "body_particles":
        renderBodyParticles(ctx, effect, width, height, bodyMasks.get(effect.effectId));
        break;
    }
  } else {
    // Traditional effects are executed through the unified Effect Engine and Graph
    try {
      const graphDef = {
        schemaVersion: "2.0.0",
        graphId: effect.effectId,
        name: effect.renderer || effect.effectId,
        nodes: [
          { id: "input-node", type: "source", params: {} },
          { id: "effect-node", type: renderer === "grain" ? "film_grain" : renderer, params: effect.parameters },
        ],
        connections: [{ fromNode: "input-node", fromOutput: "output", toNode: "effect-node", toInput: "input" }],
      };

      const graph = new EffectGraph(graphDef);
      effectEngine.loadGraph(graph);

      // Copy the source frame to input
      const sourceCopy = CanvasDevice.acquire(width, height);
      const sourceCopyCtx = sourceCopy.getContext("2d")!;
      sourceCopyCtx.clearRect(0, 0, width, height);
      sourceCopyCtx.drawImage(ctx.canvas as any, 0, 0, width, height);

      // Render through unified engine
      effectEngine.render(ctx as any, effect.localTime || 0, sourceCopy);

      CanvasDevice.release(sourceCopy);
    } catch (err) {
      console.warn("[Rasterizer:EffectGraph] Failed to execute through EffectEngine, falling back to legacy", err);
      // Fallback
      switch (renderer) {
        case "glitch":
          renderGlitch(ctx, effect, width, height);
          break;
        case "rgb_split":
        case "chromatic_aberration":
        case "chromatic":
          renderRGBSplit(ctx, effect, width, height);
          break;
        case "pixelate":
          renderPixelate(ctx, effect, width, height);
          break;
        case "scanlines":
          renderScanlines(ctx, effect, width, height);
          break;
        case "film_grain":
        case "grain":
          renderFilmGrain(ctx, effect, width, height);
          break;
        case "vignette":
          renderVignette(ctx, effect, width, height);
          break;
        case "glow":
          renderFrameGlow(ctx, effect, width, height);
          break;
      }
    }
  }

  performanceMonitor.endTimer(`rasterizer.effect_${effect.renderer || effect.effectId}`);
}

function normalizeRendererName(value: string): string {
  return value.replace(/^fx-/, "").replace(/-/g, "_").toLowerCase();
}

function isBodyRenderer(value: string): boolean {
  const renderer = normalizeRendererName(value);
  return renderer === "body_segmentation_glow" || renderer === "body_glow" || renderer === "body_outline" || renderer === "body_particles";
}

function renderPixelate(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, effect: EvaluatedEffect, width: number, height: number): void {
  const pixelSize = Math.max(2, Math.floor(Number(effect.parameters.pixelSize ?? 18) * effect.intensity));
  const w = Math.max(4, Math.floor(width / pixelSize));
  const h = Math.max(4, Math.floor(height / pixelSize));
  const temp = CanvasDevice.acquire(w, h);
  const tempCtx = temp.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!tempCtx) {
    CanvasDevice.release(temp);
    return;
  }

  tempCtx.drawImage(ctx.canvas as any, 0, 0, w, h);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(temp, 0, 0, width, height);
  ctx.restore();
  CanvasDevice.release(temp);
}

function renderRGBSplit(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, effect: EvaluatedEffect, width: number, height: number): void {
  const shift = Number(effect.parameters.rgbSplit ?? effect.parameters.splitDistance ?? 8) * effect.intensity;
  if (shift < 0.25) return;
  const temp = CanvasDevice.acquire(width, height);
  const tempCtx = temp.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!tempCtx) {
    CanvasDevice.release(temp);
    return;
  }

  tempCtx.drawImage(ctx.canvas as any, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = Math.min(0.65, 0.25 + effect.intensity * 0.35);
  ctx.drawImage(temp, -shift, 0);
  ctx.drawImage(temp, shift, 0);
  ctx.restore();
  CanvasDevice.release(temp);
}

function renderGlitch(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, effect: EvaluatedEffect, width: number, height: number): void {
  const amount = Math.max(1, Number(effect.parameters.glitchIntensity ?? 24) * effect.intensity);
  const slices = Math.max(1, Math.floor(Number(effect.parameters.sliceCount ?? 8) * effect.intensity));
  const seed = Math.floor((effect.localTime || 0) * 24);

  for (let i = 0; i < slices; i++) {
    const y = Math.floor(pseudoRandom(seed + i * 13) * height);
    const sliceHeight = Math.max(1, Math.floor(4 + pseudoRandom(seed + i * 19) * 24));
    const offset = Math.floor((pseudoRandom(seed + i * 29) - 0.5) * amount * 2);
    try {
      const imageData = ctx.getImageData(0, y, width, Math.min(sliceHeight, height - y));
      ctx.putImageData(imageData, offset, y);
    } catch {
      break;
    }
  }

  renderRGBSplit(ctx, { ...effect, parameters: { ...effect.parameters, splitDistance: amount * 0.4 } }, width, height);
}

function renderScanlines(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, effect: EvaluatedEffect, width: number, height: number): void {
  const count = Math.max(20, Number(effect.parameters.scanlineCount ?? 120));
  const spacing = height / count;
  ctx.save();
  ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.45, effect.intensity * 0.28)})`;
  for (let y = 0; y < height; y += spacing) {
    ctx.fillRect(0, y, width, Math.max(1, spacing * 0.45));
  }
  ctx.restore();
}

function renderFilmGrain(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, effect: EvaluatedEffect, width: number, height: number): void {
  const density = Math.floor((width * height) / 180);
  const count = Math.floor(density * effect.intensity * Number(effect.parameters.grainIntensity ?? 1));
  const seed = Math.floor((effect.localTime || 0) * 30);
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = pseudoRandom(seed + i * 3) * width;
    const y = pseudoRandom(seed + i * 7) * height;
    const alpha = 0.04 + pseudoRandom(seed + i * 11) * 0.08;
    ctx.fillStyle = pseudoRandom(seed + i * 17) > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  ctx.restore();
}

function renderVignette(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, effect: EvaluatedEffect, width: number, height: number): void {
  const radius = Math.sqrt(width * width + height * height) / 2;
  const gradient = ctx.createRadialGradient(width / 2, height / 2, radius * 0.2, width / 2, height / 2, radius);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.58, `rgba(0,0,0,${effect.intensity * 0.14})`);
  gradient.addColorStop(1, `rgba(0,0,0,${effect.intensity * 0.86})`);
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function renderFrameGlow(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, effect: EvaluatedEffect, width: number, height: number): void {
  const color = String(effect.parameters.glowColor ?? "#00ffff");
  const blur = Number(effect.parameters.glowRadius ?? 20) * effect.intensity;
  const temp = CanvasDevice.acquire(width, height);
  const tempCtx = temp.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!tempCtx) {
    CanvasDevice.release(temp);
    return;
  }

  tempCtx.drawImage(ctx.canvas as any, 0, 0);
  tempCtx.globalCompositeOperation = "source-in";
  tempCtx.fillStyle = color;
  tempCtx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = Math.min(0.9, effect.intensity);
  ctx.filter = `blur(${blur}px)`;
  ctx.drawImage(temp, 0, 0);
  ctx.filter = "none";
  ctx.restore();
  CanvasDevice.release(temp);
}

function renderBodySegmentationGlow(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, effect: EvaluatedEffect, width: number, height: number, providedMask?: ImageData): void {
  const original = CanvasDevice.acquire(width, height);
  const originalCtx = original.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!originalCtx) {
    CanvasDevice.release(original);
    return;
  }
  originalCtx.drawImage(ctx.canvas as any, 0, 0);

  const mask = providedMask ? imageDataToCanvas(providedMask) : buildLocalBodyMask(originalCtx, width, height);
  const maskCtx = mask.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!maskCtx) {
    CanvasDevice.release(mask);
    CanvasDevice.release(original);
    return;
  }

  const color = String(effect.parameters.glowColor ?? "#00ffff");
  const radius = Math.max(2, Number(effect.parameters.glowRadius ?? 22) * effect.intensity);
  const alpha = Math.min(1, Number(effect.parameters.glowIntensity ?? 0.8) * effect.intensity);
  maskCtx.save();
  maskCtx.globalCompositeOperation = "source-in";
  maskCtx.fillStyle = color;
  maskCtx.fillRect(0, 0, width, height);
  maskCtx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "destination-over";
  ctx.globalAlpha = alpha;
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(mask, 0, 0);
  ctx.filter = `blur(${Math.max(1, radius * 0.45)}px)`;
  ctx.drawImage(mask, 0, 0);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = color;
  ctx.globalAlpha = Math.min(0.35, alpha * 0.35);
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  CanvasDevice.release(mask);
  CanvasDevice.release(original);
}

function renderBodyOutline(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, effect: EvaluatedEffect, width: number, height: number, providedMask?: ImageData): void {
  const source = CanvasDevice.acquire(width, height);
  const sourceCtx = source.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!sourceCtx) {
    CanvasDevice.release(source);
    return;
  }
  sourceCtx.drawImage(ctx.canvas as any, 0, 0);

  const mask = providedMask ? imageDataToCanvas(providedMask) : buildLocalBodyMask(sourceCtx, width, height);
  const color = String(effect.parameters.outlineColor ?? effect.parameters.glowColor ?? "#ffffff");
  const thickness = Math.max(1, Number(effect.parameters.thickness ?? 5) * effect.intensity);

  const maskCtx = mask.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (maskCtx) {
    maskCtx.save();
    maskCtx.globalCompositeOperation = "source-in";
    maskCtx.fillStyle = color;
    maskCtx.fillRect(0, 0, width, height);
    maskCtx.restore();
  }

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = Math.min(1, effect.intensity);
  ctx.filter = `blur(${thickness}px)`;
  ctx.drawImage(mask, 0, 0);
  ctx.filter = "none";
  ctx.drawImage(mask, -thickness * 0.5, 0);
  ctx.drawImage(mask, thickness * 0.5, 0);
  ctx.drawImage(mask, 0, -thickness * 0.5);
  ctx.drawImage(mask, 0, thickness * 0.5);
  ctx.restore();

  CanvasDevice.release(mask);
  CanvasDevice.release(source);
}

function renderBodyParticles(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, effect: EvaluatedEffect, width: number, height: number, providedMask?: ImageData): void {
  const source = CanvasDevice.acquire(width, height);
  const sourceCtx = source.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!sourceCtx) {
    CanvasDevice.release(source);
    return;
  }
  sourceCtx.drawImage(ctx.canvas as any, 0, 0);

  const mask = providedMask ? imageDataToCanvas(providedMask) : buildLocalBodyMask(sourceCtx, width, height);
  const maskCtx = mask.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!maskCtx) {
    CanvasDevice.release(mask);
    CanvasDevice.release(source);
    return;
  }

  let maskData: ImageData | null = null;
  try {
    maskData = maskCtx.getImageData(0, 0, width, height);
  } catch {
    maskData = null;
  }

  const color = String(effect.parameters.particleColor ?? effect.parameters.glowColor ?? "#00ffff");
  const count = Math.floor(Number(effect.parameters.particleCount ?? 120) * effect.intensity);
  const seed = Math.floor((effect.localTime || 0) * 24);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = color;
  ctx.globalAlpha = Math.min(0.85, 0.25 + effect.intensity * 0.6);

  for (let i = 0; i < count; i++) {
    const x = Math.floor(pseudoRandom(seed + i * 37) * width);
    const y = Math.floor(pseudoRandom(seed + i * 43) * height);
    const idx = (y * width + x) * 4 + 3;
    if (maskData && maskData.data[idx] < 64) continue;
    const drift = Math.sin((effect.localTime + i) * 2.1) * 8 * effect.intensity;
    const size = 1 + pseudoRandom(seed + i * 53) * 3;
    ctx.beginPath();
    ctx.arc(x + drift, y - pseudoRandom(seed + i * 59) * 20 * effect.intensity, size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  CanvasDevice.release(mask);
  CanvasDevice.release(source);
}

function imageDataToCanvas(imageData: ImageData): HTMLCanvasElement | OffscreenCanvas {
  const canvas = CanvasDevice.acquire(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (ctx) {
    ctx.putImageData(imageData, 0, 0);
  }
  return canvas;
}

function buildLocalBodyMask(sourceCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  const mask = CanvasDevice.acquire(width, height);
  const maskCtx = mask.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!maskCtx) return mask;

  try {
    const imageData = sourceCtx.getImageData(0, 0, width, height);
    const data = imageData.data;
    let totalLuma = 0;
    let samples = 0;
    for (let i = 0; i < data.length; i += 16) {
      totalLuma += data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      samples++;
    }
    const avgLuma = samples > 0 ? totalLuma / samples : 96;
    const threshold = Math.max(18, Math.min(180, avgLuma * 0.78));

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      const luma = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      const chroma = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
      const confidence = alpha > 8 && (luma > threshold || chroma > 28) ? 255 : 0;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = confidence;
    }

    maskCtx.putImageData(imageData, 0, 0);
  } catch {
    maskCtx.drawImage(sourceCtx.canvas as any, 0, 0);
    maskCtx.globalCompositeOperation = "source-in";
    maskCtx.fillStyle = "#ffffff";
    maskCtx.fillRect(0, 0, width, height);
  }

  return mask;
}

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
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
async function rasterizeTextLayer(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, layer: EvaluatedTextLayer, width: number, height: number, scaleX: number, scaleY: number): Promise<void> {
  performanceMonitor.startTimer("rasterizer.text_layer");
  performanceMonitor.increment("rasterizer.text_renders");

  if (layer.templateId) {
    const { useTemplateStore } = await import("@/features/text-templates/templateStore");
    let templates = useTemplateStore.getState().templates;
    if (templates.length === 0) {
      try {
        await useTemplateStore.getState().loadTemplates();
        templates = useTemplateStore.getState().templates;
      } catch (e) {
        console.error("[Clypra:Rasterizer] Failed to load templates index:", e);
      }
    }
    const rawTemplate = templates.find((t) => t.id === layer.templateId);
    let template = rawTemplate?.templateData || rawTemplate?.lottieData;

    if (rawTemplate && !template) {
      try {
        const { TextEffectsApi } = await import("@/features/text-effects/api/textEffectsApi");
        const templateData = await TextEffectsApi.getTemplateData(rawTemplate.category, rawTemplate.id);
        useTemplateStore.setState((state) => ({
          templates: state.templates.map((t) => (t.id === rawTemplate.id ? { ...t, templateData, lottieData: templateData } : t)),
        }));
        template = templateData;
        const { useTimelineStore } = await import("@/store/timelineStore");
        useTimelineStore.getState().incrementEpoch();
      } catch (err) {
        console.error(`[Clypra:Rasterizer] Failed to lazy-load template data for template ${rawTemplate.id}:`, err);
      }
    }

    if (template && template.layers) {
      const customization = layer.customization || {
        primaryText: layer.text || "",
        secondaryText: "",
        accentText: "",
        primaryColor: "#ffffff",
        secondaryColor: "#ffffff",
      };

      const { TemplateRenderer } = await import("@clypra/engine");
      const renderer = new TemplateRenderer(template);

      // Apply customization overrides to the renderer
      for (const tLayer of template.layers) {
        if (tLayer.kind === "text") {
          const changes: any = {};

          // 1. Text content override or role-based default
          if (customization.layerTexts && customization.layerTexts[tLayer.id] !== undefined) {
            changes.content = customization.layerTexts[tLayer.id];
          } else if (tLayer.role === "primary") {
            changes.content = customization.primaryText;
          } else if (tLayer.role === "secondary") {
            changes.content = customization.secondaryText ?? "";
          } else if (tLayer.role === "accent") {
            changes.content = customization.accentText ?? "";
          }

          // 2. Color override or role-based default
          if (customization.layerColors && customization.layerColors[tLayer.id] !== undefined) {
            changes.color = customization.layerColors[tLayer.id];
          } else if (tLayer.role === "primary" && customization.primaryColor) {
            changes.color = customization.primaryColor;
          } else if (tLayer.role === "secondary" && customization.secondaryColor) {
            changes.color = customization.secondaryColor;
          }

          // 3. Font Size override
          if (customization.layerFontSizes && customization.layerFontSizes[tLayer.id] !== undefined) {
            changes.fontSize = customization.layerFontSizes[tLayer.id];
          }

          // 4. Font Weight override
          if (customization.layerFontWeights && customization.layerFontWeights[tLayer.id] !== undefined) {
            changes.fontWeight = customization.layerFontWeights[tLayer.id];
          }

          renderer.updateLayer(tLayer.id, changes);
        } else if (tLayer.kind === "shape") {
          const changes: any = {};

          // Color override or role-based default
          if (customization.layerColors && customization.layerColors[tLayer.id] !== undefined) {
            changes.fill = customization.layerColors[tLayer.id];
          } else {
            const colorOverride = tLayer.id === "primary-fill-layer" ? customization.primaryColor : tLayer.id === "secondary-fill-layer" ? customization.secondaryColor : undefined;
            if (colorOverride) {
              changes.fill = colorOverride;
            }
          }

          if (Object.keys(changes).length > 0) {
            renderer.updateLayer(tLayer.id, changes);
          }
        }
      }

      const localTime = layer.time !== undefined && layer.clipStartTime !== undefined ? layer.time - layer.clipStartTime : 0;

      // Get the bounds of the actual template content to scale it relative to the content rather than the empty canvas
      const tempCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(template.canvasWidth, template.canvasHeight) : document.createElement("canvas");
      tempCanvas.width = template.canvasWidth;
      tempCanvas.height = template.canvasHeight;
      const tempCtx = tempCanvas.getContext("2d");
      if (tempCtx) {
        renderer.drawFrame(tempCtx, localTime, { skipClear: true });
      }
      const bounds = renderer.getContentBounds();

      ctx.save();
      // Translate from the center back to the top-left corner of the layer bounding box
      ctx.translate(-width / 2, -height / 2);

      if (bounds && bounds.width > 0 && bounds.height > 0) {
        // Map content bounds to layer box with uniform scaling to avoid distortion
        const sX = width / bounds.width;
        const sY = height / bounds.height;
        const scale = Math.min(sX, sY);

        // Center the content bounds within the layer bounding box
        const offsetX = (width - bounds.width * scale) / 2;
        const offsetY = (height - bounds.height * scale) / 2;

        ctx.scale(scale, scale);
        ctx.translate(-bounds.x + offsetX / scale, -bounds.y + offsetY / scale);
      } else {
        const sX = width / template.canvasWidth;
        const sY = height / template.canvasHeight;
        ctx.scale(sX, sY);
      }

      renderer.drawFrame(ctx as CanvasRenderingContext2D, localTime, { skipClear: true });
      ctx.restore();
      return;
    }
  }

  // CRITICAL: For text clips, fontSize is explicitly managed by the transform system
  // and already reflects the user's resize operations. scaleX/scaleY are preview quality
  // scales (e.g., 50% vs 100% preview), NOT text resize scales.
  // DO NOT apply preview scale to fontSize - it causes double-scaling bugs where
  // text renders at wrong size after resize operations.
  // We DO apply scale to geometric properties (bleed, stroke, shadow) for quality independence.
  const fontSize = layer.fontSize; // Use fontSize directly from layer state
  const effectDef = layer.styleId ? (useEffectsStore.getState().definitions[layer.styleId] ?? layer.styleDefinition) : layer.styleDefinition;
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

  // CRITICAL: Calculate UNSCALED dimensions for _buildConfig()
  // The effect must be rendered at original canvas resolution, then scaled for preview quality.
  // Otherwise text appears at wrong size during playback (e.g., 50% quality makes text 2x larger).
  const unscaledFontSize = layer.fontSize;
  const unscaledBleed = effectBleed({
    styleId: layer.styleId,
    effectDefinition: effectDef,
    stroke: layer.stroke,
    shadow: layer.shadow,
    background: layer.background,
  });
  const unscaledPaddingX = Math.max(unscaledFontSize * 0.25, unscaledBleed.x);
  const unscaledPaddingY = Math.max(unscaledFontSize * 0.25, unscaledBleed.y);
  const effectPaddingX = unscaledPaddingX * scaleX;
  const effectPaddingY = unscaledPaddingY * scaleY;
  const offW = Math.max(1, Math.ceil(width + effectPaddingX * 2));
  const offH = Math.max(1, Math.ceil(height + effectPaddingY * 2));
  // Defensive checks: Ensure dimensions are valid positive numbers to prevent rendering crashes
  const safeWidth = Number.isFinite(layer.width) && layer.width > 0 ? layer.width : 100;
  const safeHeight = Number.isFinite(layer.height) && layer.height > 0 ? layer.height : 100;
  const unscaledOffW = Math.max(1, Math.ceil(safeWidth + unscaledPaddingX * 2));
  const unscaledOffH = Math.max(1, Math.ceil(safeHeight + unscaledPaddingY * 2));

  textRenderTrace("text-raster-bounds", {
    clipId: layer.clipId,
    layerId: layer.layerId,
    text: layer.text,
    styleId: layer.styleId,
    hasLayerStyleDefinition: !!layer.styleDefinition,
    hasStoreDefinition: !!(layer.styleId && useEffectsStore.getState().definitions[layer.styleId]),
    resolvedDefinitionId: effectDef?.id,
    contentBounds: { x: layer.x, y: layer.y, width: layer.width, height: layer.height, opacity: layer.opacity },
    fontSize,
    unscaledFontSize,
    renderBleed: declaredBleed,
    scaledRenderPadding: { x: effectPaddingX, y: effectPaddingY },
    renderBounds: { width: offW, height: offH, scaleX, scaleY },
    unscaledRenderBounds: { width: unscaledOffW, height: unscaledOffH },
    drawDestination: {
      x: -width / 2 - effectPaddingX,
      y: -height / 2 - effectPaddingY,
      width: offW,
      height: offH,
    },
  });

  let engineConfig: TextEffectConfig;

  if (layer.styleId) {
    if (effectDef) {
      // Use _buildConfig (single source of truth) instead of TextEffectBuilder
      // This properly handles effect native dimensions and scales all effect
      // parameters (stroke width, glow blur, bevel depth) correctly.
      // CRITICAL: Pass unscaled dimensions to _buildConfig() so text renders at
      // correct size regardless of preview quality. _buildConfig calculates layout
      // based on these dimensions, then we override canvasWidth/canvasHeight for
      // the actual render resolution.
      const builtCfg = _buildConfig(effectDef, layer.text, unscaledFontSize, unscaledOffW, unscaledOffH, layer.time, layer.clipStartTime, layer.clipDuration);

      // Override canvas dimensions to match scaled render resolution while preserving
      // the layout calculated at unscaled dimensions
      // CRITICAL: Also override fontSize to ensure user's resize operations are respected
      // _buildConfig may recalculate fontSize based on native effect bounds - we must
      // override it with the user's explicit fontSize from the transform system
      engineConfig = {
        ...engineDefaultConfig,
        ...builtCfg,
        fontSize: unscaledFontSize, // Force user's fontSize, don't let _buildConfig override it
        canvasWidth: unscaledOffW,
        canvasHeight: unscaledOffH,
        textPosX: layer.textAlign || "center",
        textPosY: layer.verticalAlign === "middle" ? "middle" : layer.verticalAlign || "middle",
      } as TextEffectConfig;
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

      engineConfig = buildPlainTextEffectConfig(layer, unscaledOffW, unscaledOffH, unscaledFontSize, 1.0, 1.0);
    }
  } else {
    // Plain text: build configuration from evaluated layer properties
    // CRITICAL: Use unscaled dimensions and fontSize (same as styled effect path)
    // to ensure text renders at correct size regardless of preview quality
    engineConfig = buildPlainTextEffectConfig(layer, unscaledOffW, unscaledOffH, unscaledFontSize, 1.0, 1.0);
  }

  textRenderTrace("rasterize-text-config", {
    clipId: layer.clipId,
    styleId: layer.styleId,
    text: engineConfig.text,
    fontFamily: engineConfig.fontFamily,
    fontSize: engineConfig.fontSize,
    fontWeight: engineConfig.fontWeight,
    fontStyle: engineConfig.fontStyle,
    canvasWidth: engineConfig.canvasWidth,
    canvasHeight: engineConfig.canvasHeight,
    textPosX: (engineConfig as any).textPosX,
    textPosY: (engineConfig as any).textPosY,
    fillType: (engineConfig as any).fillType,
    strokeEnabled: (engineConfig as any).strokeEnabled,
    glowLayers: (engineConfig as any).glowLayers,
    panelEnabled: (engineConfig as any).panelEnabled,
    panelColor: (engineConfig as any).panelColor,
    panelOpacity: (engineConfig as any).panelOpacity,
    panelRadius: (engineConfig as any).panelRadius,
    panelPaddingX: (engineConfig as any).panelPaddingX,
    panelPaddingY: (engineConfig as any).panelPaddingY,
    panelStrokeEnabled: (engineConfig as any).panelStrokeEnabled,
    panelStrokeWidth: (engineConfig as any).panelStrokeWidth,
    layerBackground: layer.background,
  });
  const sceneDoc = textEffectConfigToScene(engineConfig);

  // Acquire canvas context from the unified CanvasDevice pool
  // CRITICAL: Use UNSCALED dimensions for text rendering to ensure consistent layout
  // regardless of preview quality. The result is then scaled during drawImage.
  const offscreen = CanvasDevice.acquire(unscaledOffW, unscaledOffH);
  const offCtx = offscreen.getContext("2d", { alpha: true }) as OffscreenCanvasRenderingContext2D | null;
  if (offCtx) {
    // Always reset transform state (remove conditional guard to prevent accumulated transforms)
    offCtx.setTransform(1, 0, 0, 1, 0, 0);

    // Force synchronous canvas clear before drawing
    offCtx.clearRect(0, 0, unscaledOffW, unscaledOffH);

    engineEvaluateScene(sceneDoc, layer.time ?? 0, offCtx as unknown as CanvasRenderingContext2D);
    const alpha = sampleCanvasAlpha(offCtx, unscaledOffW, unscaledOffH);
    const alphaLayerBounds = alpha?.bounds
      ? {
          x: alpha.bounds.x - unscaledPaddingX,
          y: alpha.bounds.y - unscaledPaddingY,
          width: alpha.bounds.width,
          height: alpha.bounds.height,
          overflowsContent: alpha.bounds.x < unscaledPaddingX || alpha.bounds.y < unscaledPaddingY || alpha.bounds.x + alpha.bounds.width > unscaledPaddingX + safeWidth || alpha.bounds.y + alpha.bounds.height > unscaledPaddingY + safeHeight,
        }
      : null;
    textRenderTrace("text-raster-bounds", {
      clipId: layer.clipId,
      styleId: layer.styleId,
      contentBounds: { x: layer.x, y: layer.y, width: layer.width, height: layer.height },
      unscaledRenderBounds: { width: unscaledOffW, height: unscaledOffH },
      unscaledRenderPadding: { x: unscaledPaddingX, y: unscaledPaddingY },
      alpha,
      alphaLayerBounds,
    });
    const visibleAlpha = hasVisibleAlpha(offCtx, unscaledOffW, unscaledOffH);
    if (alpha && alpha.visiblePixels === 0) {
      textRenderWarn("rasterize-text-blank-offscreen", {
        clipId: layer.clipId,
        styleId: layer.styleId,
        text: layer.text,
        fontFamily: engineConfig.fontFamily,
        fontSize: engineConfig.fontSize,
        offscreen: { width: unscaledOffW, height: unscaledOffH },
        hasEffectDef: !!effectDef,
      });
    }
    if (layer.styleId && visibleAlpha === false) {
      const fallbackConfig = buildPlainTextEffectConfig(layer, unscaledOffW, unscaledOffH, unscaledFontSize, 1.0, 1.0);
      const fallbackSceneDoc = textEffectConfigToScene(fallbackConfig);
      offCtx.clearRect(0, 0, unscaledOffW, unscaledOffH);
      engineEvaluateScene(fallbackSceneDoc, layer.time ?? 0, offCtx as unknown as CanvasRenderingContext2D);
      textRenderWarn("rasterize-text-effect-fallback", {
        clipId: layer.clipId,
        styleId: layer.styleId,
        text: layer.text,
        reason: "styled effect rendered no visible pixels",
      });
    }
    // Draw the unscaled offscreen canvas scaled down to the preview resolution.
    // Source rect: full unscaled canvas
    // Dest rect: scaled position and size for preview quality
    ctx.drawImage(
      offscreen,
      0,
      0,
      unscaledOffW,
      unscaledOffH, // source
      -width / 2 - effectPaddingX,
      -height / 2 - effectPaddingY,
      offW,
      offH, // destination
    );
  }

  // Defer canvas release to prevent premature reuse during rapid state transitions
  // Use microtask to ensure GPU has finished compositing
  Promise.resolve().then(() => {
    CanvasDevice.release(offscreen);
  });

  performanceMonitor.endTimer("rasterizer.text_layer");
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
