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
import { resolveFilterToIR, compileFilterIRToCSS } from "./filterIR";
import { getResourceCache } from "../resources/ResourceCache";
import { evaluateScene as engineEvaluateScene, textEffectConfigToScene, type TextEffectConfig, layerToTextEffectConfig, CanvasDevice, TextEffectBuilder } from "@clypra/engine";
import { useEffectsStore } from "../../features/text-effects/store/effectsStore";
import { invalidateEvaluationCache } from "../evaluation/evaluator";
import { useTimelineStore } from "../../store/timelineStore";
import { effectBleed } from "../../lib/text/textClip";
import lottie from "lottie-web";
import { useStickersStore } from "../../features/stickers/store/stickersStore";

interface LottieAnimationCacheEntry {
  anim: any;
  canvas: HTMLCanvasElement;
  container: HTMLDivElement;
  stickerId: string;
  cacheKey?: string;
}

const lottieRenderCache = new Map<string, LottieAnimationCacheEntry>();

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
      // Create offscreen canvases at full raster resolution
      const fromCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : document.createElement("canvas");
      const toCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : document.createElement("canvas");
      if (fromCanvas instanceof HTMLCanvasElement) {
        fromCanvas.width = width;
        fromCanvas.height = height;
      }
      if (toCanvas instanceof HTMLCanvasElement) {
        toCanvas.width = width;
        toCanvas.height = height;
      }
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

        // Import TransitionRenderer from features/video-effects
        const { TransitionRenderer } = await import("@/features/video-effects/renderers/TransitionRenderer");

        // Render transition
        TransitionRenderer.render(ctx as any, frames.fromCanvas as any, frames.toCanvas as any, tInfo.transition.type, {}, tInfo.transition.progress);
        ctx.restore();
      } else {
        // Fallback to normal rendering if frames failed to prepare
        await rasterizeLayer(ctx, layer, scale, scale, target);
      }
    } else {
      // Normal layer rendering
      await rasterizeLayer(ctx, layer, scale, scale, target);
    }
  }

  ctx.restore();

  // Apply track-level filter to the entire composition on CPU (unless skipped for GPU)
  if (scene.activeFilter && !target.skipFilters) {
    const { id, intensity } = scene.activeFilter;
    const ir = resolveFilterToIR(id, intensity);
    const cssFilter = compileFilterIRToCSS(ir);

    if (cssFilter) {
      // Apply the filter to the entire canvas by drawing it onto a temporary canvas,
      // then drawing it back with the filter applied.
      const tempCanvas = CanvasDevice.acquire(targetWidth, targetHeight);
      const tempCtx = tempCanvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (tempCtx) {
        // Copy current canvas contents to temp canvas
        tempCtx.clearRect(0, 0, targetWidth, targetHeight);
        tempCtx.drawImage(outputCanvas, 0, 0);

        // Clear output canvas
        ctx.save();
        if (typeof ctx.setTransform === "function") {
          ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset scale/offset
        }
        ctx.clearRect(0, 0, targetWidth, targetHeight);
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, targetWidth, targetHeight);

        // Draw back with filter
        ctx.filter = cssFilter;
        ctx.drawImage(tempCanvas, 0, 0);
        ctx.restore();
      }
      CanvasDevice.release(tempCanvas);
    }
  }

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
  try {
    if (layer.clipKind === "sticker") {
      const stickerId = layer.mediaId.replace("sticker-", "");
      let cachedSticker = useStickersStore.getState().getCachedSticker(stickerId);
      if (!cachedSticker) {
        await useStickersStore.getState().initializeCache();
        cachedSticker = useStickersStore.getState().getCachedSticker(stickerId);
      }

      if (cachedSticker && cachedSticker.format === "lottie") {
        let cacheEntry = lottieRenderCache.get(layer.clipId);

        if (!cacheEntry || cacheEntry.stickerId !== stickerId) {
          if (cacheEntry) {
            cacheEntry.anim.destroy();
            cacheEntry.container.remove();
          }

          try {
            const { stickerCacheManager } = await import("@/lib/cache/stickerCache");
            const { appCacheDir, join } = await import("@tauri-apps/api/path");
            const appCache = await appCacheDir();
            const absoluteLottiePath = await join(appCache, cachedSticker.localAnimationPath!);

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

          drawMediaWithSourceRotation(ctx, cacheEntry.canvas, width, height, layer.sourceRotation, layer.effects, layer.filter);
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
          // HAVE_CURRENT_DATA — element is loaded, draw it
          // Apply source rotation BEFORE drawing (critical for export)
          drawMediaWithSourceRotation(ctx, video, width, height, layer.sourceRotation, layer.effects, layer.filter);
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
    drawMediaWithSourceRotation(ctx, imageBitmap, width, height, layer.sourceRotation, layer.effects, layer.filter);

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
function drawMediaWithSourceRotation(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, source: HTMLVideoElement | ImageBitmap | HTMLCanvasElement, width: number, height: number, sourceRotation?: number, effects?: import("../evaluation/types").EvaluatedEffect[], filter?: { id: string; name: string; intensity: number }): void {
  ctx.save();

  // 1. Build and apply CSS filter string using Filter IR
  let filterString = "";
  if (filter) {
    const { id, intensity } = filter;
    const ir = resolveFilterToIR(id, intensity);
    filterString = compileFilterIRToCSS(ir);
  }

  // Check for CSS-based effects
  let blurIntensity = 0;
  if (effects && effects.length > 0) {
    const blurFx = effects.find((fx) => fx.effectId === "fx-blur");
    if (blurFx && blurFx.parameters) {
      blurIntensity = blurFx.parameters.intensity ?? 0.5;
      filterString += (filterString ? " " : "") + `blur(${blurIntensity * 20}px)`;
    }
  }

  if (filterString) {
    ctx.filter = filterString;
  }

  // 2. Resolve source dimensions & rotation transposition
  const isTransposed = sourceRotation === 90 || sourceRotation === 270;
  const drawWidth = isTransposed ? height : width;
  const drawHeight = isTransposed ? width : height;

  if (sourceRotation && sourceRotation !== 0) {
    ctx.rotate((sourceRotation * Math.PI) / 180);
  }

  // 3. Render pixelate or chromatic aberration or normal
  const pixelateFx = effects?.find((fx) => fx.effectId === "fx-pixelate");
  if (pixelateFx && pixelateFx.parameters && pixelateFx.parameters.intensity > 0.05) {
    const intensity = pixelateFx.parameters.intensity;
    // Calculate pixel scale factor
    const scale = Math.max(0.02, 1 - intensity * 0.95);
    const w = Math.max(4, Math.floor(drawWidth * scale));
    const h = Math.max(4, Math.floor(drawHeight * scale));

    // Create a temporary offscreen canvas
    const tempCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : document.createElement("canvas");

    if (tempCanvas instanceof HTMLCanvasElement) {
      tempCanvas.width = w;
      tempCanvas.height = h;
    }

    const tempCtx = tempCanvas.getContext("2d") as any;
    if (tempCtx) {
      tempCtx.drawImage(source, 0, 0, w, h);

      ctx.save();
      ctx.imageSmoothingEnabled = false;
      (ctx as any).mozImageSmoothingEnabled = false;
      (ctx as any).webkitImageSmoothingEnabled = false;
      (ctx as any).msImageSmoothingEnabled = false;

      ctx.drawImage(tempCanvas as any, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      ctx.restore();
    } else {
      ctx.drawImage(source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    }
  } else {
    // Check Chromatic Aberration
    const chromaticFx = effects?.find((fx) => fx.effectId === "fx-chromatic");
    if (chromaticFx && chromaticFx.parameters && chromaticFx.parameters.intensity > 0.05) {
      const shift = chromaticFx.parameters.intensity * 8; // Max 8px shift

      // Draw Red Channel shift
      ctx.save();
      ctx.globalAlpha = ctx.globalAlpha * 0.6;
      ctx.translate(-shift, 0);
      ctx.drawImage(source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      ctx.restore();

      // Draw Cyan (Green/Blue) Channel shift
      ctx.save();
      ctx.globalAlpha = ctx.globalAlpha * 0.6;
      ctx.translate(shift, 0);
      ctx.globalCompositeOperation = "screen";
      ctx.drawImage(source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      ctx.restore();
    } else {
      ctx.drawImage(source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    }
  }

  // 4. Draw overlays (Vignette, Film Grain)
  if (effects && effects.length > 0) {
    // Vignette Overlay
    const vignetteFx = effects.find((fx) => fx.effectId === "fx-vignette");
    if (vignetteFx && vignetteFx.parameters) {
      ctx.save();
      ctx.filter = "none"; // Clear filters for overlay drawing
      const intensity = vignetteFx.parameters.intensity ?? 0.5;
      const radius = Math.sqrt((drawWidth / 2) ** 2 + (drawHeight / 2) ** 2);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      grad.addColorStop(0, "transparent");
      grad.addColorStop(0.5, `rgba(0, 0, 0, ${intensity * 0.25})`);
      grad.addColorStop(1, `rgba(0, 0, 0, ${intensity * 0.95})`);
      ctx.fillStyle = grad;
      ctx.fillRect(-drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      ctx.restore();
    }

    // Film Grain Overlay
    const grainFx = effects.find((fx) => fx.effectId === "fx-film-grain");
    if (grainFx && grainFx.parameters) {
      ctx.save();
      ctx.filter = "none"; // Clear filters for overlay drawing
      const intensity = grainFx.parameters.intensity ?? 0.5;
      const dotsCount = Math.floor((drawWidth * drawHeight) / 100) * intensity;
      for (let d = 0; d < dotsCount; d++) {
        const rx = (Math.random() - 0.5) * drawWidth;
        const ry = (Math.random() - 0.5) * drawHeight;
        const rsize = 1 + Math.random() * 1.5;
        ctx.fillStyle = Math.random() > 0.5 ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)";
        ctx.fillRect(rx, ry, rsize, rsize);
      }
      ctx.restore();
    }
  }

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
async function rasterizeTextLayer(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, layer: EvaluatedTextLayer, width: number, height: number, scaleX: number, scaleY: number): Promise<void> {
  if (layer.templateId) {
    const { useTemplateStore } = await import("@/features/text-templates/templateStore");
    const templates = useTemplateStore.getState().templates;
    const template = templates.find((t) => t.id === layer.templateId);

    if (template && template.lottieData) {
      const customizationSig = JSON.stringify(layer.customization || {});
      const cacheKey = `${layer.clipId}-${layer.templateId}-${customizationSig}`;

      let cacheEntry = lottieRenderCache.get(layer.clipId);
      if (cacheEntry && cacheEntry.cacheKey !== cacheKey) {
        cacheEntry.anim.destroy();
        cacheEntry.container.remove();
        lottieRenderCache.delete(layer.clipId);
        cacheEntry = undefined;
      }

      if (!cacheEntry) {
        try {
          const { injectText, injectColor } = await import("@/features/text-templates/TemplateInjector");

          const customization = layer.customization || {
            primaryText: layer.text || "",
            secondaryText: "",
            accentText: "",
            primaryColor: "#ffffff",
            secondaryColor: "#ffffff",
          };

          let injectedLottie = injectText(template.lottieData, customization, template.textLayers);
          if (customization.primaryColor) {
            injectedLottie = injectColor(injectedLottie, "primary-fill-layer", customization.primaryColor);
          }
          if (customization.secondaryColor) {
            injectedLottie = injectColor(injectedLottie, "secondary-fill-layer", customization.secondaryColor);
          }

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
            animationData: JSON.parse(JSON.stringify(injectedLottie)),
          });

          anim.goToAndStop(0, true);
          await Promise.resolve();

          const canvas = container.querySelector("canvas") as HTMLCanvasElement;
          if (canvas) {
            cacheEntry = { anim, canvas, container, stickerId: layer.templateId, cacheKey };
            lottieRenderCache.set(layer.clipId, cacheEntry);
          }
        } catch (err) {
          console.error("[Rasterizer] Failed to load text template Lottie animation:", err);
        }
      }

      if (cacheEntry) {
        const totalFrames = cacheEntry.anim.totalFrames;
        const frameRate = cacheEntry.anim.frameRate || 30;

        const localTime = layer.time !== undefined && layer.clipStartTime !== undefined ? layer.time - layer.clipStartTime : 0;
        const frame = Math.floor(localTime * frameRate) % totalFrames;

        cacheEntry.anim.goToAndStop(frame, true);
        await Promise.resolve();

        ctx.drawImage(cacheEntry.canvas, 0, 0, width, height);
        return;
      }
    }
  }

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
