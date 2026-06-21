/**
 * Text Clip Creation Utilities
 *
 * Helpers for creating text clips with sensible defaults.
 */

import type { TextClip } from "../../types";
import { TemplateRenderer, type TextEffectDefinition, type TextTemplate } from "@clypra/engine";
import { generateId } from "../utils/id";
import { useEffectsStore } from "../../features/text-effects/store/effectsStore";
import { useTemplateStore } from "../../features/text-templates/templateStore";
import { textRenderTrace } from "@/lib/debug/textRenderTrace";

export interface CreateTextClipOptions {
  /** Track ID to place the clip on */
  trackId: string;

  /** Start time on timeline */
  startTime: number;

  /** Duration in seconds */
  duration?: number;

  /** Text content */
  text?: string;

  /** Canvas dimensions for positioning */
  canvasWidth: number;
  canvasHeight: number;

  /** Font size */
  fontSize?: number;

  /** Font family */
  fontFamily?: string;

  /** Font line height multiplier */
  lineHeight?: number;

  /** Letter spacing in pixels */
  letterSpacing?: number;

  /** Text color */
  color?: string;

  /** Bold */
  bold?: boolean;

  /** Italic */
  italic?: boolean;

  /** Position preset */
  position?: "center" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

  /** Text role: caption for subtitles, title for decorative text */
  textRole?: "caption" | "title";

  /** Word-level timestamps for karaoke-style caption highlighting */
  words?: Array<{
    word: string;
    start: number;
    end: number;
    probability?: number;
  }>;

  // Additional style parameters for custom presets/effects/templates
  styleId?: string;
  templateId?: string;
  customization?: any;
  fontWeight?: string | number;
  fontStyle?: "normal" | "italic";
  stroke?: { color: string; width: number };
  shadow?: { color: string; blur: number; offsetX: number; offsetY: number };
  background?: { color: string; padding: number; borderRadius: number };

  /** Effect definition for accurate bounding box calculation */
  effectDefinition?: TextEffectDefinition;

  /** Template definition/data for accurate content-bounds calculation */
  templateDefinition?: TextTemplate;
}

export interface TextEffectBounds {
  contentWidth: number;
  contentHeight: number;
  bleedLeft: number;
  bleedRight: number;
  bleedTop: number;
  bleedBottom: number;
  measuredTextWidth: number;
  measuredTextHeight: number;
  source: "panel" | "ink" | "plain" | "fallback";
  selectionInset: number;
}

function measureTextInk(text: string, fontFamily: string, fontSize: number, bold: boolean, letterSpacing = 0): { width: number; height: number } {
  try {
    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
    const ctx = canvas.getContext("2d") as any;
    if (!ctx) return { width: text.length * fontSize * 0.6 + Math.max(0, text.length - 1) * letterSpacing, height: fontSize * 0.82 };
    ctx.font = `${bold ? "bold" : "normal"} ${fontSize}px ${fontFamily}`;
    const metrics = ctx.measureText(text);
    const metricsHeight = Number(metrics.actualBoundingBoxAscent ?? 0) + Number(metrics.actualBoundingBoxDescent ?? 0);
    return {
      width: metrics.width + Math.max(0, text.length - 1) * letterSpacing,
      height: metricsHeight > 0 ? metricsHeight : fontSize * 0.82,
    };
  } catch (e) {
    return { width: text.length * fontSize * 0.6 + Math.max(0, text.length - 1) * letterSpacing, height: fontSize * 0.82 };
  }
}

/**
 * Calculate effect bleed/padding beyond text ink bounds.
 *
 * The effect definition can declare exactly what it needs via boundingBox.
 * Otherwise, we compute based on explicit style properties (stroke, shadow, background).
 *
 * **Backward Compatibility:**
 * - Effects WITH boundingBox: Uses declared padding (accurate)
 * - Effects WITHOUT boundingBox: Falls back to conservative estimates (40px x, 30px y)
 * - Plain text (no styleId): Uses minimal padding based on explicit styles only
 *
 * @returns Padding to add on each side (x = horizontal per side, y = vertical per side)
 */
export function effectBleed(options: { styleId?: string; effectDefinition?: TextEffectDefinition; stroke?: { width: number }; shadow?: { blur: number; offsetX: number; offsetY: number }; background?: { padding: number; color?: string; borderRadius?: number } }): { x: number; y: number } {
  let x = 0;
  let y = 0;
  const definition = options.effectDefinition as any;

  if (options.stroke) {
    x += options.stroke.width;
    y += options.stroke.width;
  }
  const definitionStrokes = Array.isArray(definition?.strokes) ? definition.strokes : [];
  for (const stroke of definitionStrokes) {
    const strokeWidth = Number(stroke?.width ?? 0);
    const strokeBlur = Number(stroke?.blur ?? 0);
    if (strokeWidth > 0 || strokeBlur > 0) {
      x = Math.max(x, strokeWidth + strokeBlur);
      y = Math.max(y, strokeWidth + strokeBlur);
    }
  }
  if (options.shadow) {
    x += Math.abs(options.shadow.offsetX) + options.shadow.blur;
    y += Math.abs(options.shadow.offsetY) + options.shadow.blur;
  }
  const definitionShadows = Array.isArray(definition?.shadows) ? definition.shadows : [];
  for (const shadow of definitionShadows) {
    const shadowBlur = Number(shadow?.blur ?? 0);
    const offsetX = Number(shadow?.offset?.x ?? shadow?.offsetX ?? 0);
    const offsetY = Number(shadow?.offset?.y ?? shadow?.offsetY ?? 0);
    x = Math.max(x, Math.abs(offsetX) + shadowBlur);
    y = Math.max(y, Math.abs(offsetY) + shadowBlur);
  }
  const glows = Array.isArray(definition?.glows) ? definition.glows : Array.isArray(definition?.glowLayers) ? definition.glowLayers : definition?.glow ? [definition.glow] : [];
  for (const glow of glows) {
    if (glow?.enabled === false) continue;
    const glowPadding = Number(glow?.blur ?? 0) + Number(glow?.spread ?? 0);
    x = Math.max(x, glowPadding);
    y = Math.max(y, glowPadding);
  }
  const bevelDepth = Number(definition?.bevel?.depth ?? definition?.bevelDepth ?? 0);
  const bevelBlur = Number(definition?.bevel?.blur ?? definition?.bevelBlur ?? 0);
  if (bevelDepth > 0 || bevelBlur > 0) {
    x = Math.max(x, bevelDepth + bevelBlur);
    y = Math.max(y, bevelDepth + bevelBlur);
  }
  const stack = definition?.stack;
  const stackEnabled = stack ? stack.enabled !== false : !!definition?.stackEnabled;
  const stackCount = Number(stack?.count ?? definition?.stackCount ?? 0);
  if (stackEnabled && stackCount > 0) {
    const offsetX = Number(stack?.offsetX ?? definition?.stackOffsetX ?? 0);
    const offsetY = Number(stack?.offsetY ?? definition?.stackOffsetY ?? 0);
    x = Math.max(x, Math.abs(offsetX * stackCount));
    y = Math.max(y, Math.abs(offsetY * stackCount));
  }

  const mode = options.effectDefinition?.boundingBox?.mode;
  if (options.effectDefinition?.boundingBox && mode !== "panel") {
    const bbox = options.effectDefinition.boundingBox;
    x = Math.max(x, bbox.paddingX);
    y = Math.max(y, bbox.paddingY);
  } else if (options.styleId) {
    // Fallback for legacy effects without boundingBox declared yet
    // Reduced padding for tighter bounding boxes - most text effects (glow, shadow)
    // need 15-20px padding, not 40px. Users can manually resize if needed.
    x = Math.max(x, 20);
    y = Math.max(y, 15);
  }

  const hasDeclaredInkBounds = !!options.effectDefinition?.boundingBox && mode !== "panel";
  if (!hasDeclaredInkBounds && (x > 0 || y > 0)) {
    x = Math.ceil(x * 1.15);
    y = Math.ceil(y * 1.15);
  }

  return { x, y };
}

function getPanelContentPadding(effectDefinition?: TextEffectDefinition, background?: { padding: number; color?: string; borderRadius?: number }, fontSize = 100): { x: number; y: number } {
  const panel = effectDefinition?.panel as { paddingX?: number; paddingY?: number; stroke?: { width?: number } } | undefined;
  const ratio = fontSize / 100;
  const backgroundPadding = background ? Math.max(0, background.padding) : 0;
  if (panel) {
    const strokeWidth = (panel.stroke?.width ?? 0) * ratio;
    return {
      x: Math.max(Math.max(0, panel.paddingX ?? 0) * ratio, backgroundPadding) + strokeWidth,
      y: Math.max(Math.max(0, panel.paddingY ?? 0) * ratio, backgroundPadding) + strokeWidth,
    };
  }
  if (background) return { x: backgroundPadding, y: backgroundPadding };
  return { x: 0, y: 0 };
}

function getPanelTrace(effectDefinition?: TextEffectDefinition, background?: { padding: number; color?: string; borderRadius?: number }, fontSize = 100): Record<string, unknown> {
  const panel = effectDefinition?.panel as { paddingX?: number; paddingY?: number; stroke?: { width?: number } } | undefined;
  const ratio = fontSize / 100;
  return {
    effectId: effectDefinition?.id,
    hasPanel: !!panel,
    ratio,
    definitionPanel: panel
      ? {
          paddingX: panel.paddingX,
          paddingY: panel.paddingY,
          strokeWidth: panel.stroke?.width,
          scaledPaddingX: Math.max(0, panel.paddingX ?? 0) * ratio,
          scaledPaddingY: Math.max(0, panel.paddingY ?? 0) * ratio,
          scaledStrokeWidth: (panel.stroke?.width ?? 0) * ratio,
        }
      : null,
    background,
  };
}

export function measureTextEffectContentBounds(options: { text: string; fontFamily: string; fontSize: number; bold?: boolean; fontWeight?: string | number; letterSpacing?: number; lineHeight?: number; styleId?: string; effectDefinition?: TextEffectDefinition; stroke?: { width: number }; shadow?: { blur: number; offsetX: number; offsetY: number }; background?: { padding: number; color?: string; borderRadius?: number }; canvasWidth: number; textRole?: "caption" | "title"; maxWidth?: number }): TextEffectBounds {
  const isBold = options.bold || options.fontWeight === "bold" || (typeof options.fontWeight === "number" && options.fontWeight >= 700);
  const letterSpacing = options.letterSpacing ?? options.effectDefinition?.font?.letterSpacing ?? 0;
  const measured = measureTextInk(options.text, options.fontFamily, options.fontSize, !!isBold, letterSpacing);
  const renderBleed = effectBleed(options);
  const hasDeclaredBounds = !!options.effectDefinition?.boundingBox;
  const isPanelEffect = options.effectDefinition?.boundingBox?.mode === "panel";
  const isStyled = !!options.styleId;

  // Dynamic maxWidth based on text role:
  // - Captions (subtitles) should wrap within screen safe area (95% of canvas width)
  // - Titles and text effects can overflow beyond screen (10x canvas width for point text behavior)
  const defaultMaxWidth = options.textRole === "caption" ? options.canvasWidth * 0.95 : options.canvasWidth * 10.0;
  const maxWidth = options.maxWidth ?? defaultMaxWidth;

  let source: TextEffectBounds["source"] = options.background ? "panel" : "plain";
  let contentPaddingX = options.fontSize * 0.4;
  let contentPaddingY = options.fontSize * 0.25;

  if (isPanelEffect) {
    source = "panel";
    const panelPadding = getPanelContentPadding(options.effectDefinition, options.background, options.fontSize);
    contentPaddingX = panelPadding.x;
    contentPaddingY = panelPadding.y;
  } else if (options.background) {
    const backgroundPadding = getPanelContentPadding(undefined, options.background, options.fontSize);
    contentPaddingX = backgroundPadding.x;
    contentPaddingY = backgroundPadding.y;
  } else if (hasDeclaredBounds || isStyled) {
    source = hasDeclaredBounds ? "ink" : "fallback";
    contentPaddingX = Math.max(8, options.fontSize * 0.12);
    contentPaddingY = Math.max(6, options.fontSize * 0.08);
  }

  const selectionInset = source === "panel" ? Math.max(4, Math.min(12, options.fontSize * 0.04)) : 0;
  const singleLineWidth = measured.width + contentPaddingX * 2 + selectionInset * 2;
  const width = Math.min(maxWidth, Math.max(48, singleLineWidth));
  const contentInnerWidth = Math.max(1, width - contentPaddingX * 2 - selectionInset * 2);
  const wrappedLineCount = Math.max(1, Math.ceil(measured.width / contentInnerWidth));
  const textHeight = source === "panel" ? options.fontSize * wrappedLineCount : measured.height * wrappedLineCount;
  const height = Math.max(24, textHeight + contentPaddingY * 2 + selectionInset * 2);

  textRenderTrace("text-bounds-measure", {
    text: options.text,
    styleId: options.styleId,
    fontFamily: options.fontFamily,
    fontSize: options.fontSize,
    fontWeight: options.fontWeight,
    letterSpacing,
    source,
    isPanelEffect,
    hasDeclaredBounds,
    measured,
    contentPadding: { x: contentPaddingX, y: contentPaddingY },
    selectionInset,
    textHeight,
    contentBounds: { width, height },
    renderBleed,
    panelTrace: getPanelTrace(options.effectDefinition, options.background, options.fontSize),
  });

  return {
    contentWidth: width,
    contentHeight: height,
    bleedLeft: renderBleed.x,
    bleedRight: renderBleed.x,
    bleedTop: renderBleed.y,
    bleedBottom: renderBleed.y,
    measuredTextWidth: measured.width,
    measuredTextHeight: measured.height,
    source,
    selectionInset,
  };
}

export function calculateTextClipSize(options: { text: string; fontFamily: string; fontSize: number; bold?: boolean; fontWeight?: string | number; letterSpacing?: number; lineHeight?: number; styleId?: string; effectDefinition?: TextEffectDefinition; stroke?: { width: number }; shadow?: { blur: number; offsetX: number; offsetY: number }; background?: { padding: number; color?: string; borderRadius?: number }; canvasWidth: number; textRole?: "caption" | "title"; maxWidth?: number }): { width: number; height: number; bleed: { x: number; y: number }; measuredWidth: number; bounds: TextEffectBounds } {
  const bounds = measureTextEffectContentBounds(options);

  return {
    width: bounds.contentWidth,
    height: bounds.contentHeight,
    bleed: { x: Math.max(bounds.bleedLeft, bounds.bleedRight), y: Math.max(bounds.bleedTop, bounds.bleedBottom) },
    measuredWidth: bounds.measuredTextWidth,
    bounds,
  };
}

function resolveTextEffectDefinition(styleId?: string, effectDefinition?: TextEffectDefinition): TextEffectDefinition | undefined {
  if (effectDefinition) return effectDefinition;
  if (!styleId) return undefined;
  return useEffectsStore.getState().definitions[styleId] as TextEffectDefinition | undefined;
}

export interface TextTemplateContentSize {
  width: number;
  height: number;
  aspectRatio: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
  source: "template" | "fallback";
}

function resolveTextTemplateDefinition(templateId?: string, templateDefinition?: TextTemplate): TextTemplate | undefined {
  if (templateDefinition?.layers?.length) return templateDefinition;
  if (!templateId) return undefined;
  const rawTemplate = useTemplateStore.getState().templates.find((template) => template.id === templateId);
  const templateData = rawTemplate?.templateData || rawTemplate?.lottieData;
  if (templateData?.layers?.length) return templateData as TextTemplate;
  if (rawTemplate?.layers?.length) return rawTemplate as TextTemplate;
  return undefined;
}

function createMeasurementCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas | null {
  try {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
  } catch {
    return null;
  }
  return null;
}

function applyTemplateCustomization(renderer: TemplateRenderer, template: TextTemplate, text: string, customization?: any): void {
  for (const layer of template.layers ?? []) {
    if (layer.kind !== "text" && layer.kind !== "shape") continue;
    const changes: Record<string, unknown> = {};

    if (layer.kind === "text") {
      if (customization?.layerTexts?.[layer.id] !== undefined) changes.content = customization.layerTexts[layer.id];
      else if (layer.role === "primary") changes.content = customization?.primaryText ?? text;
      else if (layer.role === "secondary") changes.content = customization?.secondaryText ?? "";
      else if (layer.role === "accent") changes.content = customization?.accentText ?? "";

      if (customization?.layerColors?.[layer.id] !== undefined) changes.color = customization.layerColors[layer.id];
      else if (layer.role === "primary" && customization?.primaryColor) changes.color = customization.primaryColor;
      else if (layer.role === "secondary" && customization?.secondaryColor) changes.color = customization.secondaryColor;

      if (customization?.layerFontSizes?.[layer.id] !== undefined) changes.fontSize = customization.layerFontSizes[layer.id];
      if (customization?.layerFontWeights?.[layer.id] !== undefined) changes.fontWeight = customization.layerFontWeights[layer.id];
    } else if (customization?.layerColors?.[layer.id] !== undefined) {
      changes.fill = customization.layerColors[layer.id];
    }

    if (Object.keys(changes).length > 0) {
      renderer.updateLayer(layer.id, changes as any);
    }
  }
}

export function measureTextTemplateContentSize(options: { templateId?: string; templateDefinition?: TextTemplate; text?: string; customization?: any }): TextTemplateContentSize | null {
  const template = resolveTextTemplateDefinition(options.templateId, options.templateDefinition);
  if (!template?.layers?.length) {
    textRenderTrace("text-template-measure-no-template", {
      templateId: options.templateId,
      hasTemplateDefinition: !!options.templateDefinition,
    });
    return null;
  }

  const legacyTemplate = template as TextTemplate & { width?: number; height?: number };
  const templateWidth = Math.max(1, Number(legacyTemplate.canvasWidth ?? legacyTemplate.width ?? 800));
  const templateHeight = Math.max(1, Number(legacyTemplate.canvasHeight ?? legacyTemplate.height ?? 450));
  const fallbackAspect = templateWidth / templateHeight;

  textRenderTrace("text-template-measure-start", {
    templateId: options.templateId ?? template.id,
    text: options.text,
    templateWidth,
    templateHeight,
    fallbackAspect,
    layerCount: template.layers?.length,
  });

  try {
    const canvas = createMeasurementCanvas(templateWidth, templateHeight);
    const ctx = canvas?.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) {
      textRenderTrace("text-template-measure-no-canvas", {
        templateId: options.templateId ?? template.id,
      });
      return { width: templateWidth, height: templateHeight, aspectRatio: fallbackAspect, bounds: null, source: "fallback" };
    }

    const renderer = new TemplateRenderer(template);
    applyTemplateCustomization(renderer, template, options.text ?? "Text", options.customization);
    renderer.drawFrame(ctx, 0, { skipClear: true });
    const bounds = renderer.getContentBounds();

    textRenderTrace("text-template-measure-bounds", {
      templateId: options.templateId ?? template.id,
      text: options.text,
      bounds,
      hasBounds: !!bounds,
      boundsValid: bounds && bounds.width > 0 && bounds.height > 0,
    });

    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      textRenderTrace("text-template-measure-invalid-bounds", {
        templateId: options.templateId ?? template.id,
        bounds,
      });
      return { width: templateWidth, height: templateHeight, aspectRatio: fallbackAspect, bounds: null, source: "fallback" };
    }

    textRenderTrace("text-template-measure-success", {
      templateId: options.templateId ?? template.id,
      contentBounds: bounds,
      aspectRatio: bounds.width / bounds.height,
      source: "template",
    });

    return {
      width: bounds.width,
      height: bounds.height,
      aspectRatio: bounds.width / bounds.height,
      bounds,
      source: "template",
    };
  } catch (error) {
    textRenderTrace("text-template-bounds-measure-fallback", {
      templateId: options.templateId ?? template.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { width: templateWidth, height: templateHeight, aspectRatio: fallbackAspect, bounds: null, source: "fallback" };
  }
}

export function calculateTextTemplateClipSize(options: { canvasWidth: number; canvasHeight: number; templateId?: string; templateDefinition?: TextTemplate; text?: string; customization?: any }): { width: number; height: number; content: TextTemplateContentSize | null } {
  const content = measureTextTemplateContentSize(options);

  textRenderTrace("text-template-calculate-size-start", {
    templateId: options.templateId,
    canvasWidth: options.canvasWidth,
    canvasHeight: options.canvasHeight,
    text: options.text,
    contentMeasured: content,
    contentSource: content?.source,
  });

  // If we successfully measured content bounds, use them
  if (content?.source === "template" && content.bounds && content.bounds.width > 0 && content.bounds.height > 0) {
    const contentWidth = content.bounds.width;
    const contentHeight = content.bounds.height;
    const contentAspect = contentWidth / contentHeight;

    // Scale content bounds to fit within a reasonable portion of the canvas
    // Use a max of 80% canvas width and 50% canvas height for flexibility
    const maxWidth = options.canvasWidth * 0.8;
    const maxHeight = options.canvasHeight * 0.5;

    let width: number;
    let height: number;

    textRenderTrace("text-template-calculate-size-using-bounds", {
      templateId: options.templateId,
      contentWidth,
      contentHeight,
      contentAspect,
      maxWidth,
      maxHeight,
    });

    // Determine if we're width-constrained or height-constrained
    if (contentWidth > maxWidth || contentHeight > maxHeight) {
      // Content is larger than max, scale it down proportionally
      if (maxWidth / maxHeight > contentAspect) {
        // Height-constrained
        height = maxHeight;
        width = height * contentAspect;
        textRenderTrace("text-template-calculate-size-height-constrained", {
          templateId: options.templateId,
          width,
          height,
          scaleFactor: height / contentHeight,
        });
      } else {
        // Width-constrained
        width = maxWidth;
        height = width / contentAspect;
        textRenderTrace("text-template-calculate-size-width-constrained", {
          templateId: options.templateId,
          width,
          height,
          scaleFactor: width / contentWidth,
        });
      }
    } else {
      // Content fits within max bounds, use actual size
      width = contentWidth;
      height = contentHeight;
      textRenderTrace("text-template-calculate-size-actual-size", {
        templateId: options.templateId,
        width,
        height,
        contentFits: true,
      });
    }

    textRenderTrace("text-template-calculate-size-result", {
      templateId: options.templateId,
      finalWidth: width,
      finalHeight: height,
      contentBounds: content.bounds,
      source: "template-bounds",
    });

    return { width, height, content };
  }

  // Fallback to aspect-based sizing if measurement failed or returned fallback
  textRenderTrace("text-template-calculate-size-fallback", {
    templateId: options.templateId,
    contentSource: content?.source,
    usingAspectFallback: true,
  });

  const templateAspect = content?.aspectRatio && Number.isFinite(content.aspectRatio) && content.aspectRatio > 0 ? content.aspectRatio : 16 / 9;
  const maxWidth = options.canvasWidth * 0.5;
  const maxHeight = options.canvasHeight * 0.25;

  let width: number;
  let height: number;
  if (maxWidth / maxHeight > templateAspect) {
    height = maxHeight;
    width = height * templateAspect;
  } else {
    width = maxWidth;
    height = width / templateAspect;
  }

  textRenderTrace("text-template-calculate-size-fallback-result", {
    templateId: options.templateId,
    width,
    height,
    templateAspect,
    maxWidth,
    maxHeight,
  });

  return { width, height, content };
}

/**
 * Create a text clip with sensible defaults.
 */
export function createTextClip(options: CreateTextClipOptions): TextClip {
  const { trackId, startTime, duration = 5.0, text = "Text", canvasWidth, canvasHeight, color = "#ffffff", bold = false, italic = false, position = "center", textRole, words, styleId, templateId, customization, stroke, shadow, background, effectDefinition, templateDefinition } = options;

  textRenderTrace("text-clip-create-start", {
    trackId,
    text,
    templateId,
    hasTemplateDefinition: !!templateDefinition,
    styleId,
    canvasWidth,
    canvasHeight,
    textRole,
  });

  // For templates, calculate dimensions based on template's native aspect ratio
  // instead of text measurements to ensure professional full-canvas rendering
  let x: number, y: number, width: number, height: number, sizing: any;
  let sourceAspectRatio: number | undefined;

  if (templateId) {
    const templateSizing = calculateTextTemplateClipSize({
      canvasWidth,
      canvasHeight,
      templateId,
      templateDefinition,
      text,
      customization,
    });
    width = templateSizing.width;
    height = templateSizing.height;
    sourceAspectRatio = width / Math.max(1, height);

    // Position based on preset
    const templatePosition = calculateTextPosition(position, canvasWidth, canvasHeight, width, height);
    x = templatePosition.x;
    y = templatePosition.y;

    // Create synthetic sizing for consistency
    sizing = {
      width,
      height,
      bleed: { x: 0, y: 0 },
      measuredWidth: width,
      bounds: {
        contentWidth: width,
        contentHeight: height,
        bleedLeft: 0,
        bleedRight: 0,
        bleedTop: 0,
        bleedBottom: 0,
        measuredTextWidth: width,
        measuredTextHeight: height,
        source: "plain",
        selectionInset: 0,
      },
      templateContent: templateSizing.content,
    };
  } else {
    // Regular text clips use text measurement
    const resolvedEffectDefinition = resolveTextEffectDefinition(styleId, effectDefinition);
    const definitionFontSize = (resolvedEffectDefinition as (TextEffectDefinition & { fontSize?: number }) | undefined)?.fontSize;
    const defaultFontSize = definitionFontSize ?? (options.styleId ? 96 : 100);
    const fontSize = options.fontSize ?? defaultFontSize;
    const fontFamily = options.fontFamily ?? resolvedEffectDefinition?.font?.family ?? "Inter, system-ui, sans-serif";
    const fontWeight = options.fontWeight ?? resolvedEffectDefinition?.font?.weight;
    const fontStyle = options.fontStyle ?? resolvedEffectDefinition?.font?.style;
    const lineHeight = options.lineHeight ?? resolvedEffectDefinition?.font?.lineHeight ?? 1.2;
    const letterSpacing = options.letterSpacing ?? resolvedEffectDefinition?.font?.letterSpacing ?? 0;

    sizing = calculateTextClipSize({
      text,
      fontFamily,
      fontSize,
      bold,
      fontWeight,
      letterSpacing,
      lineHeight,
      styleId,
      effectDefinition: resolvedEffectDefinition,
      stroke,
      shadow,
      background,
      canvasWidth,
      textRole,
    });

    // Calculate position based on preset using the dynamic box sizes
    const textPosition = calculateTextPosition(position, canvasWidth, canvasHeight, sizing.width, sizing.height);
    x = textPosition.x;
    y = textPosition.y;
    width = textPosition.width;
    height = textPosition.height;
  }

  const resolvedEffectDefinition = resolveTextEffectDefinition(styleId, effectDefinition);
  const definitionFontSize = (resolvedEffectDefinition as (TextEffectDefinition & { fontSize?: number }) | undefined)?.fontSize;
  const defaultFontSize = definitionFontSize ?? (options.styleId ? 96 : 100);
  const fontSize = options.fontSize ?? defaultFontSize;
  const fontFamily = options.fontFamily ?? resolvedEffectDefinition?.font?.family ?? "Inter, system-ui, sans-serif";
  const fontWeight = options.fontWeight ?? resolvedEffectDefinition?.font?.weight;
  const fontStyle = options.fontStyle ?? resolvedEffectDefinition?.font?.style;
  const lineHeight = options.lineHeight ?? resolvedEffectDefinition?.font?.lineHeight ?? 1.2;
  const letterSpacing = options.letterSpacing ?? resolvedEffectDefinition?.font?.letterSpacing ?? 0;

  const clip: TextClip = {
    id: generateId("text-clip"),
    kind: "text",
    trackId,
    mediaId: "", // Text clips don't have media assets
    startTime,
    duration,
    trimIn: 0,
    trimOut: duration,
    x,
    y,
    width,
    height,
    opacity: 1.0,
    rotation: 0,
    aspectRatioLocked: templateId ? true : false,
    text,
    fontSize,
    fontFamily,
    color,
    fontWeight: fontWeight || (bold ? "bold" : "normal"),
    fontStyle: fontStyle || (italic ? "italic" : "normal"),
    align: "center",
    valign: "middle",
    lineHeight,
    letterSpacing,
    paddingX: 16,
    paddingY: 16,
    textRole,
    words, // Include word-level timestamps for karaoke-style highlighting
    styleId,
    styleDefinition: resolvedEffectDefinition,
    templateId,
    customization,
    stroke,
    shadow,
    background,
    sourceAspectRatio,
  };

  textRenderTrace("text-bounds-create", {
    clipId: clip.id,
    text: clip.text,
    startTime: clip.startTime,
    duration: clip.duration,
    x: clip.x,
    y: clip.y,
    width: clip.width,
    height: clip.height,
    fontFamily: clip.fontFamily,
    fontSize: clip.fontSize,
    fontWeight: clip.fontWeight,
    styleId: clip.styleId,
    hasStyleDefinition: !!clip.styleDefinition,
    styleDefinitionFont: clip.styleDefinition?.font,
    background: clip.background,
    stroke: clip.stroke,
    shadow: clip.shadow,
    contentBounds: { x: clip.x, y: clip.y, width: clip.width, height: clip.height },
    renderBleed: sizing.bounds,
  });

  return clip;
}

/**
 * Calculate text position based on preset.
 */
function calculateTextPosition(position: "center" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right", canvasWidth: number, canvasHeight: number, boxWidth: number, boxHeight: number): { x: number; y: number; width: number; height: number } {
  const margin = 40; // Margin from edges

  switch (position) {
    case "center":
      return {
        x: (canvasWidth - boxWidth) / 2,
        y: (canvasHeight - boxHeight) / 2,
        width: boxWidth,
        height: boxHeight,
      };

    case "top":
      return {
        x: (canvasWidth - boxWidth) / 2,
        y: margin,
        width: boxWidth,
        height: boxHeight,
      };

    case "bottom":
      return {
        x: (canvasWidth - boxWidth) / 2,
        y: canvasHeight - boxHeight - margin,
        width: boxWidth,
        height: boxHeight,
      };

    case "top-left":
      return {
        x: margin,
        y: margin,
        width: boxWidth,
        height: boxHeight,
      };

    case "top-right":
      return {
        x: canvasWidth - boxWidth - margin,
        y: margin,
        width: boxWidth,
        height: boxHeight,
      };

    case "bottom-left":
      return {
        x: margin,
        y: canvasHeight - boxHeight - margin,
        width: boxWidth,
        height: boxHeight,
      };

    case "bottom-right":
      return {
        x: canvasWidth - boxWidth - margin,
        y: canvasHeight - boxHeight - margin,
        width: boxWidth,
        height: boxHeight,
      };

    default:
      return {
        x: (canvasWidth - boxWidth) / 2,
        y: (canvasHeight - boxHeight) / 2,
        width: boxWidth,
        height: boxHeight,
      };
  }
}

/**
 * Text preset configurations.
 */
export const TEXT_PRESETS = {
  title: {
    fontSize: 72,
    bold: true,
    position: "center" as const,
  },
  subtitle: {
    fontSize: 48,
    bold: false,
    position: "center" as const,
  },
  lowerThird: {
    fontSize: 32,
    bold: false,
    position: "bottom-left" as const,
  },
  caption: {
    fontSize: 24,
    bold: false,
    position: "bottom" as const,
  },
  headline: {
    fontSize: 64,
    bold: true,
    position: "top" as const,
  },
  quote: {
    fontSize: 36,
    italic: true,
    position: "center" as const,
  },
} as const;

function calculateTextClipContentTransform(clip: TextClip, updates: Partial<TextClip>, canvasWidth: number, canvasHeight: number): { merged: TextClip; sizing: any; transform: Pick<TextClip, "x" | "y" | "width" | "height" | "sourceAspectRatio"> } {
  const merged = { ...clip, ...updates };
  const { text = "Text", fontSize = 48, styleId, stroke, shadow, background } = merged;
  const oldCenterX = clip.x + clip.width / 2;
  const oldCenterY = clip.y + clip.height / 2;

  // Templates maintain their current dimensions - don't recalculate automatically
  // However, allow manual transforms (drag/resize) to update position/size
  if (merged.templateId) {
    const hasManualTransform = updates.x !== undefined || updates.y !== undefined || updates.width !== undefined || updates.height !== undefined;

    console.log("[TEMPLATE TRANSFORM]", {
      clipId: clip.id,
      templateId: merged.templateId,
      hasManualTransform,
      updatesKeys: Object.keys(updates),
      updates: { x: updates.x, y: updates.y, width: updates.width, height: updates.height },
      clipValues: { x: clip.x, y: clip.y, width: clip.width, height: clip.height },
      mergedValues: { x: merged.x, y: merged.y, width: merged.width, height: merged.height },
    });

    return {
      merged,
      sizing: {
        width: merged.width,
        height: merged.height,
        bounds: null,
      },
      transform: {
        // If manual transform is happening, use merged values (which include updates)
        // Otherwise, return original clip values to prevent automatic recalculation
        x: hasManualTransform ? merged.x : clip.x,
        y: hasManualTransform ? merged.y : clip.y,
        width: hasManualTransform ? merged.width : clip.width,
        height: hasManualTransform ? merged.height : clip.height,
        sourceAspectRatio: clip.sourceAspectRatio ?? clip.width / Math.max(1, clip.height),
      },
    };
  }

  const effectDefinition = resolveTextEffectDefinition(styleId);
  const fontFamily = merged.fontFamily ?? effectDefinition?.font?.family ?? "Inter, system-ui, sans-serif";
  const fontWeight = merged.fontWeight ?? effectDefinition?.font?.weight;

  const sizing = calculateTextClipSize({
    text,
    fontFamily,
    fontSize,
    fontWeight,
    letterSpacing: merged.letterSpacing,
    lineHeight: merged.lineHeight,
    styleId,
    effectDefinition,
    stroke,
    shadow,
    background,
    canvasWidth,
    textRole: merged.textRole,
  });

  return {
    merged,
    sizing,
    transform: {
      x: oldCenterX - sizing.width / 2,
      y: oldCenterY - sizing.height / 2,
      width: sizing.width,
      height: sizing.height,
      sourceAspectRatio: sizing.width / Math.max(1, sizing.height),
    },
  };
}

/**
 * Recalculate the bounding box of a text clip when text content or styling changes.
 * Keeps the center of the clip fixed on the canvas.
 */
export function recalculateTextClipBounds(clip: TextClip, updates: Partial<TextClip>, canvasWidth: number, _canvasHeight: number): TextClip {
  const traceReason = (updates as Partial<TextClip> & { _boundsReason?: string })._boundsReason;
  const cleanUpdates = { ...updates } as Partial<TextClip> & { _boundsReason?: string };
  delete cleanUpdates._boundsReason;
  const { merged, sizing, transform } = calculateTextClipContentTransform(clip, cleanUpdates, canvasWidth, _canvasHeight);

  textRenderTrace("text-bounds-recalculate", {
    clipId: clip.id,
    reason: traceReason ? [traceReason] : Object.keys(cleanUpdates),
    oldContentBounds: { x: clip.x, y: clip.y, width: clip.width, height: clip.height },
    newContentBounds: transform,
    renderBleed: sizing.bounds,
  });

  return {
    ...merged,
    ...transform,
  };
}

const TEXT_STYLE_KEYS: (keyof TextClip)[] = ["text", "fontSize", "fontFamily", "fontWeight", "fontStyle", "styleId", "templateId", "customization", "stroke", "shadow", "background", "letterSpacing", "lineHeight"];
const MANUAL_BOUNDS_KEYS: (keyof TextClip)[] = ["x", "y", "width", "height"];

export function shouldRecalculateTextClipBounds(clip: TextClip, updates: Partial<TextClip>): boolean {
  // Templates never recalculate bounds
  if (clip.templateId) return false;

  const hasManualBounds = MANUAL_BOUNDS_KEYS.some((key) => key in updates);
  const hasStyleChange = TEXT_STYLE_KEYS.some((key) => key in updates);
  return hasStyleChange && !hasManualBounds;
}

export function resolveTextClipStyleUpdate(clip: TextClip, updates: Partial<TextClip>, canvasWidth: number, canvasHeight: number): Partial<TextClip> {
  if (!shouldRecalculateTextClipBounds(clip, updates)) return updates;
  const recalculated = recalculateTextClipBounds(clip, updates, canvasWidth, canvasHeight);
  return {
    ...updates,
    x: recalculated.x,
    y: recalculated.y,
    width: recalculated.width,
    height: recalculated.height,
    sourceAspectRatio: recalculated.sourceAspectRatio,
  };
}

export function resolveTextClipContentTransform(clip: TextClip, canvasWidth: number, canvasHeight: number, reason = "content-transform"): Pick<TextClip, "x" | "y" | "width" | "height" | "sourceAspectRatio"> {
  const recalculated = recalculateTextClipBounds(clip, { _boundsReason: reason } as Partial<TextClip>, canvasWidth, canvasHeight);
  return {
    x: recalculated.x,
    y: recalculated.y,
    width: recalculated.width,
    height: recalculated.height,
    sourceAspectRatio: recalculated.sourceAspectRatio,
  };
}

export function hasTextClipContentTransformDrift(clip: TextClip, canvasWidth: number, _canvasHeight: number, epsilon = 1): boolean {
  const resolved = calculateTextClipContentTransform(clip, {}, canvasWidth, _canvasHeight).transform;
  return Math.abs(resolved.x - clip.x) > epsilon || Math.abs(resolved.y - clip.y) > epsilon || Math.abs(resolved.width - clip.width) > epsilon || Math.abs(resolved.height - clip.height) > epsilon;
}
