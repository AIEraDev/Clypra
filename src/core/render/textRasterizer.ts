import type { EvaluatedTextLayer } from "../evaluation/types";
import { evaluateScene as engineEvaluateScene, textEffectConfigToScene, type TextEffectConfig, layerToTextEffectConfig, CanvasDevice, defaultConfig as engineDefaultConfig, _buildConfig } from "@clypra-studio/engine";
import { useEffectsStore } from "../../features/text-effects/store/effectsStore";
import { invalidateEvaluationCache } from "../evaluation/evaluator";
import { useTimelineStore } from "../../store/timelineStore";
import { effectBleed } from "../../lib/text/textClip";
import { performanceMonitor } from "@/lib/monitoring/PerformanceMonitor";

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
export async function rasterizeTextLayer(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, layer: EvaluatedTextLayer, width: number, height: number, scaleX: number, scaleY: number): Promise<void> {
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
        console.error("[VireoStudio:Rasterizer] Failed to load templates index:", e);
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
        console.error(`[VireoStudio:Rasterizer] Failed to lazy-load template data for template ${rawTemplate.id}:`, err);
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

      const { TemplateRenderer } = await import("@clypra-studio/engine");
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

    const visibleAlpha = hasVisibleAlpha(offCtx, unscaledOffW, unscaledOffH);

    if (layer.styleId && visibleAlpha === false) {
      const fallbackConfig = buildPlainTextEffectConfig(layer, unscaledOffW, unscaledOffH, unscaledFontSize, 1.0, 1.0);
      const fallbackSceneDoc = textEffectConfigToScene(fallbackConfig);
      offCtx.clearRect(0, 0, unscaledOffW, unscaledOffH);
      engineEvaluateScene(fallbackSceneDoc, layer.time ?? 0, offCtx as unknown as CanvasRenderingContext2D);
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

/**
 * Measure text dimensions (for layout validation).
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
