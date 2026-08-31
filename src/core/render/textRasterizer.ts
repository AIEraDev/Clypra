import type { EvaluatedTextLayer } from "../evaluation/types";
import { textEffectConfigToScene, type TextEffectConfig, layerToTextEffectConfig, CanvasDevice, defaultConfig as engineDefaultConfig, _buildConfig, renderTextTemplateToCanvas, renderTextEffectToCanvas, resolveTextTemplateArtifact } from "@clypra-studio/engine";
import { useEffectsStore } from "../../features/text-effects/store/effectsStore";
import { invalidateEvaluationCache } from "../evaluation/evaluator";
import { useTimelineStore } from "../../store/timelineStore";
import { effectBleed, resolveTextEffectDefinition } from "../../lib/text/textClip";
import { getTextRenderMetrics, normalizeFontSize } from "../../lib/utils/fixedSizing";
import { traceTextRenderScene } from "./textRenderTrace";



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
  const hasExplicitWidthConstraint =
    typeof layer.maxWidth === "number" &&
    Number.isFinite(layer.maxWidth) &&
    layer.maxWidth > 0;
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
    // Normal title text is point text: only authored newlines create lines.
    // Captions and explicitly constrained text retain automatic wrapping.
    wrapText: layer.textRole === "caption" || hasExplicitWidthConstraint,
  } as TextEffectConfig;
}

function templateControlValues(layer: EvaluatedTextLayer, artifact: ReturnType<typeof resolveTextTemplateArtifact>): Record<string, unknown> {
  if (!artifact) return {};
  const customization = layer.customization;
  const values: Record<string, unknown> = { ...(layer.templateControlValues || {}) };
  for (const control of artifact.controls) {
    if (control.type !== "text" && control.type !== "color") continue;
    const node = artifact.document.nodes.find((candidate: any) => candidate.id === control.target.nodeId) as any;
    const role = node?.role || "";
    if (control.type === "text") {
      values[control.id] = customization?.layerTexts?.[control.target.nodeId]
        ?? (role === "primary" ? customization?.primaryText : role === "secondary" ? customization?.secondaryText : role === "accent" ? customization?.accentText : undefined)
        ?? values[control.id]
        ?? control.defaultValue;
    } else {
      values[control.id] = customization?.layerColors?.[control.target.nodeId]
        ?? (role === "secondary" ? customization?.secondaryColor : customization?.primaryColor)
        ?? values[control.id]
        ?? control.defaultValue;
    }
  }
  return values;
}

function renderTemplateArtifact(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  layer: EvaluatedTextLayer,
  artifact: ReturnType<typeof resolveTextTemplateArtifact>,
  width: number,
  height: number,
): boolean {
  if (!artifact) return false;
  const localTime = layer.time !== undefined && layer.clipStartTime !== undefined ? layer.time - layer.clipStartTime : 0;
  ctx.save();
  // Native text raster assets are centered around the evaluated layer origin.
  // The package renderer uses composition-space coordinates from (0, 0).
  ctx.translate(-width / 2, -height / 2);
  renderTextTemplateToCanvas(ctx, {
    artifact,
    context: {
      environment: "editor",
      time: localTime,
      clipDuration: layer.clipDuration,
      width,
      height,
      controlValues: templateControlValues(layer, artifact),
    },
  });
  ctx.restore();
  return true;
}

/**
 * Rasterize a text layer.
 *
 * CRITICAL: This is the canonical text rendering path.
 * Preview and export MUST use the same code path.
 *
 * Styled layers (styleId present) always go through the package effect facade,
 * which is the authoritative pipeline for stroke-blur, glow, bevel, and
 * all post-fx. When ctx.filter is unsupported (WKWebView on macOS),
 * rendering is routed through the native compositor so visual
 * output is consistent across platforms.
 *
 * Plain text layers (no styleId) use a minimal Canvas 2D path that
 * respects the same baseline alignment as the engine (fontSize * 0.82).
 */
export async function rasterizeTextLayer(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, layer: EvaluatedTextLayer, width: number, height: number, scaleX: number, scaleY: number): Promise<void> {
  if (layer.templateId) {
    const pinnedArtifact = resolveTextTemplateArtifact(layer.templateSnapshot);
    if (renderTemplateArtifact(ctx, layer, pinnedArtifact, width, height)) return;
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
    // Existing timeline instances are immutable snapshots. Resolve them
    // before consulting the live catalog so a Studio republish cannot change
    // the appearance of an already-created clip.
    let template = ((layer.templateSnapshot as any)?.layers?.length || (layer.templateSnapshot as any)?.elements?.length)
      ? layer.templateSnapshot
      : undefined;

    const requestedRevisionId = layer.templateRevisionId;
    const catalogRevisionId = (rawTemplate as any)?.revisionId ?? (rawTemplate as any)?.revision?.revisionId;
    if (!template && rawTemplate && (!requestedRevisionId || requestedRevisionId === catalogRevisionId)) {
      template = rawTemplate.templateData || rawTemplate.lottieData;
    }

    if (rawTemplate && !template) {
      try {
        const { TextEffectsApi } = await import("@/features/text-effects/api/textEffectsApi");
        const templateData = await TextEffectsApi.getTemplateData(
          rawTemplate.category,
          rawTemplate.id,
          requestedRevisionId ? { revisionId: requestedRevisionId } : {},
        );
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

    const resolvedArtifact = resolveTextTemplateArtifact(template);
    if (renderTemplateArtifact(ctx, layer, resolvedArtifact, width, height)) return;

    if (layer.clipKind === "text-template") {
      // A pinned revision is part of the clip contract. Never substitute a
      // newer catalog revision or silently turn a missing template into plain
      // text; show a deterministic, actionable placeholder instead.
      ctx.save();
      ctx.translate(-width / 2, -height / 2);
      ctx.strokeStyle = "rgba(255, 92, 92, 0.95)";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, Math.max(1, width - 2), Math.max(1, height - 2));
      ctx.fillStyle = "rgba(255, 92, 92, 0.95)";
      ctx.font = "600 16px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Template unavailable", width / 2, height / 2 - 10);
      ctx.font = "12px sans-serif";
      ctx.fillText(layer.templateRevisionId ? `Revision ${layer.templateRevisionId.slice(0, 12)}…` : "Pinned revision missing", width / 2, height / 2 + 14);
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
  const resolvedEffectDef = resolveTextEffectDefinition(
    layer.styleId,
    layer.styleDefinition,
    layer.styleRevisionId,
    layer.styleContentHash,
  );
  const effectDef = resolvedEffectDef && layer.styleSnapshot
    ? ({ ...resolvedEffectDef, scene: layer.styleSnapshot } as any)
    : resolvedEffectDef;
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
  const unscaledFontSize = normalizeFontSize(layer.fontSize);
  const textMetrics = getTextRenderMetrics(unscaledFontSize);
  const unscaledBleed = effectBleed({
    styleId: layer.styleId,
    effectDefinition: effectDef,
    stroke: layer.stroke,
    shadow: layer.shadow,
    background: layer.background,
  });
  const unscaledPaddingX = Math.max(textMetrics.paddingX, unscaledBleed.x);
  const unscaledPaddingY = Math.max(textMetrics.paddingY, unscaledBleed.y);

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
      // New published effects carry the canonical scene snapshot. Render it
      // directly so the editor never reconstructs visual state from a second
      // flat/nested representation.
      if ((effectDef as any).scene?.effectLayers) {
        const canonicalScene = JSON.parse(JSON.stringify((effectDef as any).scene));
        const authoredWidth = Math.max(1, Math.ceil(Number(canonicalScene.canvas?.width) || 800));
        const authoredHeight = Math.max(1, Math.ceil(Number(canonicalScene.canvas?.height) || 200));
        canonicalScene.text.content = layer.text;
        canonicalScene.text.fontSize = unscaledFontSize;
        canonicalScene.text.fontFamily = layer.fontFamily || canonicalScene.text.fontFamily;
        canonicalScene.text.fontWeight = layer.fontWeight ?? canonicalScene.text.fontWeight;
        canonicalScene.text.fontStyle = layer.fontStyle ?? canonicalScene.text.fontStyle;
        canonicalScene.text.letterSpacing = layer.letterSpacing ?? canonicalScene.text.letterSpacing;
        canonicalScene.text.lineHeight = layer.lineHeight ?? canonicalScene.text.lineHeight;
        canonicalScene.text.textPosX = layer.textAlign || canonicalScene.text.textPosX;
        canonicalScene.text.textPosY = layer.verticalAlign === "middle" ? "middle" : layer.verticalAlign || canonicalScene.text.textPosY;

        const evalWidth = Math.max(authoredWidth, Math.ceil(width + 200));
        const evalHeight = Math.max(authoredHeight, Math.ceil(height + 100));
        canonicalScene.canvas.width = evalWidth;
        canonicalScene.canvas.height = evalHeight;
        traceTextRenderScene(canonicalScene, {
          path: "program-preview",
          assetId: layer.styleId,
          revisionId: (effectDef as any).revisionId,
          contentHash: (effectDef as any).contentHash,
          time: layer.time ?? 0,
        });

        const offscreen = CanvasDevice.acquire(evalWidth, evalHeight);
        const offCtx = offscreen.getContext("2d", { alpha: true }) as OffscreenCanvasRenderingContext2D | null;
        if (offCtx) {
          offCtx.setTransform(1, 0, 0, 1, 0, 0);
          offCtx.clearRect(0, 0, evalWidth, evalHeight);
          renderTextEffectToCanvas(offCtx, {
            source: canonicalScene,
            context: { environment: "editor", time: layer.time ?? 0, width: evalWidth, height: evalHeight },
          });
          ctx.drawImage(
            offscreen,
            -evalWidth / 2,
            -evalHeight / 2,
          );
        }
        Promise.resolve().then(() => CanvasDevice.release(offscreen));
        return;
      }

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
  traceTextRenderScene(sceneDoc, {
    path: "program-preview",
    assetId: layer.styleId,
    revisionId: (effectDef as any)?.revisionId,
    contentHash: (effectDef as any)?.contentHash,
    time: layer.time ?? 0,
  });

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

    renderTextEffectToCanvas(offCtx, {
      source: sceneDoc,
      context: { environment: "editor", time: layer.time ?? 0, width: unscaledOffW, height: unscaledOffH },
    });

    const visibleAlpha = hasVisibleAlpha(offCtx, unscaledOffW, unscaledOffH);

    if (layer.styleId && visibleAlpha === false) {
      const fallbackConfig = buildPlainTextEffectConfig(layer, unscaledOffW, unscaledOffH, unscaledFontSize, 1.0, 1.0);
      const fallbackSceneDoc = textEffectConfigToScene(fallbackConfig);
      offCtx.clearRect(0, 0, unscaledOffW, unscaledOffH);
      renderTextEffectToCanvas(offCtx, {
        source: fallbackSceneDoc,
        context: { environment: "editor", time: layer.time ?? 0, width: unscaledOffW, height: unscaledOffH },
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
