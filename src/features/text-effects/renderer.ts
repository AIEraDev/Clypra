import { renderTextEffectToCanvas, defaultConfig as engineDefaultConfig, type TextEffectConfig, _buildConfig } from "@clypra-studio/engine";
import { TextEffectDefinition } from "./types/types";
import { hasRegisteredEngine, renderRegisteredEffect } from "./registry";
import { getFontLoader } from "@/core/fonts/FontLoader";

/**
 * Draw a SceneDocument to the target canvas context.
 * Delegates to the package-owned text-effect capability renderer.
 */
function drawScene(targetCtx: CanvasRenderingContext2D, cfg: TextEffectConfig, time: number): void {
  renderTextEffectToCanvas(targetCtx, {
    source: cfg,
    context: { environment: "studio", time, width: cfg.canvasWidth, height: cfg.canvasHeight },
  });
}

function drawCanonicalScene(
  targetCtx: CanvasRenderingContext2D,
  effect: TextEffectDefinition,
  text: string,
  fontSize: number,
  canvasWidth: number,
  canvasHeight: number,
  time: number,
): boolean {
  if (!effect.scene?.effectLayers) return false;

  // Published effects may contain both a canonical scene and legacy flat
  // fields. The scene is authoritative; only runtime text/layout inputs are
  // overridden for this timeline instance.
  const scene = JSON.parse(JSON.stringify(effect.scene));
  scene.text.content = text;
  scene.text.fontSize = fontSize;
  scene.text.fontFamily = effect.font?.family || scene.text.fontFamily;
  scene.text.fontWeight = effect.font?.weight || scene.text.fontWeight;
  scene.text.fontStyle = effect.font?.style || scene.text.fontStyle;
  scene.canvas.width = canvasWidth;
  scene.canvas.height = canvasHeight;
  renderTextEffectToCanvas(targetCtx, {
    source: scene,
    context: { environment: "studio", time, width: canvasWidth, height: canvasHeight },
  });
  return true;
}

/**
 * Build a TextEffectConfig from a TextEffectDefinition + runtime params.
 * Maps width/height (local engine keys) → canvasWidth/canvasHeight (engine keys).
 */
function buildEngineConfig(effect: TextEffectDefinition, text: string, fontSize: number, canvasWidth: number, canvasHeight: number, time?: number, clipStartTime?: number, clipDuration?: number): TextEffectConfig {
  const builtCfg = _buildConfig(effect, text, fontSize, canvasWidth, canvasHeight, time, clipStartTime, clipDuration);
  return {
    ...engineDefaultConfig,
    ...builtCfg,
    canvasWidth,
    canvasHeight,
  } as TextEffectConfig;
}

/**
 * Render a text effect onto any 2D canvas context.
 *
 * Uses the full @clypra-studio/engine capability pipeline for API-fetched effects
 * so stroke blur (ctx.filter), glow compositing, bevel, and all post-fx are
 * applied correctly. Locally registered engines (studio-generated classes) are
 * called via their drawFrame() method.
 */
export const renderTextEffectToContext = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, text: string, effect: TextEffectDefinition, fontSize: number, _x: number, _y: number, canvasWidth: number, canvasHeight: number, time?: number, clipStartTime?: number, clipDuration?: number) => {
  if (hasRegisteredEngine(effect?.id)) {
    const originalFillText = ctx.fillText.bind(ctx);
    const originalStrokeText = ctx.strokeText.bind(ctx);
    renderRegisteredEffect(ctx, effect, text, fontSize, canvasWidth, canvasHeight, time, clipStartTime, clipDuration);
    ctx.fillText = originalFillText;
    ctx.strokeText = originalStrokeText;
    return;
  }

  if (
    drawCanonicalScene(
      ctx as CanvasRenderingContext2D,
      effect,
      text,
      fontSize,
      canvasWidth,
      canvasHeight,
      time ?? 0,
    )
  ) {
    return;
  }

  const cfg = buildEngineConfig(effect, text, fontSize, canvasWidth, canvasHeight, time, clipStartTime, clipDuration);
  drawScene(ctx as CanvasRenderingContext2D, cfg, time ?? 0);
};

/**
 * Render a text effect to an HTMLCanvasElement synchronously.
 * For preview, prefer renderTextEffectAsync which waits for fonts first.
 */
export const renderTextEffect = (canvas: HTMLCanvasElement, text: string, effect: TextEffectDefinition, fontSize: number, time?: number) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (canvas.width === 0 || canvas.height === 0) {
    canvas.width = 640;
    canvas.height = 360;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderTextEffectToContext(ctx, text, effect, fontSize, canvas.width / 2, canvas.height / 2, canvas.width, canvas.height, time);
};

/**
 * Render a text effect to an HTMLCanvasElement after ensuring fonts are loaded.
 *
 * This is the correct entry point for preview rendering:
 * 1. Sets canvas dimensions
 * 2. Pre-loads the required font via FontLoader (deduped, cached)
 * 3. Waits for document.fonts.ready
 * 4. Draws via the package capability renderer (full pipeline incl. ctx.filter)
 */
export const renderTextEffectAsync = async (canvas: HTMLCanvasElement, text: string, effect: TextEffectDefinition, fontSize: number, time?: number): Promise<void> => {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = 640;
  canvas.height = 360;

  const cfg = buildEngineConfig(effect, text, fontSize, canvas.width, canvas.height, time);

  if (effect?.font?.family) {
    try {
      await getFontLoader().ensureFont({
        family: effect.font.family,
        weight: effect.font.weight,
        style: effect.font.style,
      });
    } catch (error) {
      console.warn(`[TextEffects] Failed to pre-load font "${effect.font.family}":`, error);
    }
  }

  if (typeof document !== "undefined" && document.fonts) {
    await document.fonts.ready;
  }

  drawScene(ctx, cfg, time ?? 0);
};

/**
 * Render a text effect to a PNG data URL (export / thumbnail use).
 */
export const renderTextEffectToDataURL = (text: string, effect: TextEffectDefinition, fontSize: number, width = 800, height = 400): string => {
  const offscreen = document.createElement("canvas");
  offscreen.width = width;
  offscreen.height = height;
  renderTextEffect(offscreen, text, effect, fontSize);
  return offscreen.toDataURL("image/png");
};
