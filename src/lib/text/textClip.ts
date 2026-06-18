/**
 * Text Clip Creation Utilities
 *
 * Helpers for creating text clips with sensible defaults.
 */

import type { TextClip } from "../../types";
import type { TextEffectDefinition } from "@clypra/engine";
import { generateId } from "../utils/id";
import { useEffectsStore } from "../../features/text-effects/store/effectsStore";
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

  if (options.stroke) {
    x += options.stroke.width;
    y += options.stroke.width;
  }
  if (options.shadow) {
    x += Math.abs(options.shadow.offsetX) + options.shadow.blur;
    y += Math.abs(options.shadow.offsetY) + options.shadow.blur;
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

export function measureTextEffectContentBounds(options: { text: string; fontFamily: string; fontSize: number; bold?: boolean; fontWeight?: string | number; letterSpacing?: number; lineHeight?: number; styleId?: string; effectDefinition?: TextEffectDefinition; stroke?: { width: number }; shadow?: { blur: number; offsetX: number; offsetY: number }; background?: { padding: number; color?: string; borderRadius?: number }; canvasWidth: number }): TextEffectBounds {
  const isBold = options.bold || options.fontWeight === "bold" || (typeof options.fontWeight === "number" && options.fontWeight >= 700);
  const letterSpacing = options.letterSpacing ?? options.effectDefinition?.font?.letterSpacing ?? 0;
  const measured = measureTextInk(options.text, options.fontFamily, options.fontSize, !!isBold, letterSpacing);
  const renderBleed = effectBleed(options);
  const hasDeclaredBounds = !!options.effectDefinition?.boundingBox;
  const isPanelEffect = options.effectDefinition?.boundingBox?.mode === "panel";
  const isStyled = !!options.styleId;
  const maxWidth = options.canvasWidth * 0.95;

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

export function calculateTextClipSize(options: { text: string; fontFamily: string; fontSize: number; bold?: boolean; fontWeight?: string | number; letterSpacing?: number; lineHeight?: number; styleId?: string; effectDefinition?: TextEffectDefinition; stroke?: { width: number }; shadow?: { blur: number; offsetX: number; offsetY: number }; background?: { padding: number; color?: string; borderRadius?: number }; canvasWidth: number }): { width: number; height: number; bleed: { x: number; y: number }; measuredWidth: number; bounds: TextEffectBounds } {
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

/**
 * Create a text clip with sensible defaults.
 */
export function createTextClip(options: CreateTextClipOptions): TextClip {
  const { trackId, startTime, duration = 5.0, text = "Text", canvasWidth, canvasHeight, color = "#ffffff", bold = false, italic = false, position = "center", textRole, words, styleId, templateId, customization, stroke, shadow, background, effectDefinition } = options;
  const resolvedEffectDefinition = resolveTextEffectDefinition(styleId, effectDefinition);
  const definitionFontSize = (resolvedEffectDefinition as (TextEffectDefinition & { fontSize?: number }) | undefined)?.fontSize;
  const defaultFontSize = definitionFontSize ?? (options.styleId ? 96 : 100);
  const fontSize = options.fontSize ?? defaultFontSize;
  const fontFamily = options.fontFamily ?? resolvedEffectDefinition?.font?.family ?? "Inter, system-ui, sans-serif";
  const fontWeight = options.fontWeight ?? resolvedEffectDefinition?.font?.weight;
  const fontStyle = options.fontStyle ?? resolvedEffectDefinition?.font?.style;
  const lineHeight = options.lineHeight ?? resolvedEffectDefinition?.font?.lineHeight ?? 1.2;
  const letterSpacing = options.letterSpacing ?? resolvedEffectDefinition?.font?.letterSpacing ?? 0;

  const sizing = calculateTextClipSize({
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
  });

  // Calculate position based on preset using the dynamic box sizes
  const { x, y, width, height } = calculateTextPosition(position, canvasWidth, canvasHeight, sizing.width, sizing.height);

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
    aspectRatioLocked: false,
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

function calculateTextClipContentTransform(clip: TextClip, updates: Partial<TextClip>, canvasWidth: number): { merged: TextClip; sizing: ReturnType<typeof calculateTextClipSize>; transform: Pick<TextClip, "x" | "y" | "width" | "height"> } {
  const merged = { ...clip, ...updates };
  const { text = "Text", fontSize = 48, styleId, stroke, shadow, background } = merged;

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
  });

  const oldCenterX = clip.x + clip.width / 2;
  const oldCenterY = clip.y + clip.height / 2;

  return {
    merged,
    sizing,
    transform: {
      x: oldCenterX - sizing.width / 2,
      y: oldCenterY - sizing.height / 2,
      width: sizing.width,
      height: sizing.height,
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
  const { merged, sizing, transform } = calculateTextClipContentTransform(clip, cleanUpdates, canvasWidth);

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

const TEXT_STYLE_KEYS: (keyof TextClip)[] = ["text", "fontSize", "fontFamily", "fontWeight", "fontStyle", "styleId", "stroke", "shadow", "background", "letterSpacing", "lineHeight"];
const MANUAL_BOUNDS_KEYS: (keyof TextClip)[] = ["x", "y", "width", "height"];

export function shouldRecalculateTextClipBounds(updates: Partial<TextClip>): boolean {
  const hasManualBounds = MANUAL_BOUNDS_KEYS.some((key) => key in updates);
  const hasStyleChange = TEXT_STYLE_KEYS.some((key) => key in updates);
  return hasStyleChange && !hasManualBounds;
}

export function resolveTextClipStyleUpdate(clip: TextClip, updates: Partial<TextClip>, canvasWidth: number, canvasHeight: number): Partial<TextClip> {
  if (!shouldRecalculateTextClipBounds(updates)) return updates;
  const recalculated = recalculateTextClipBounds(clip, updates, canvasWidth, canvasHeight);
  return {
    ...updates,
    x: recalculated.x,
    y: recalculated.y,
    width: recalculated.width,
    height: recalculated.height,
  };
}

export function resolveTextClipContentTransform(clip: TextClip, canvasWidth: number, canvasHeight: number, reason = "content-transform"): Pick<TextClip, "x" | "y" | "width" | "height"> {
  const recalculated = recalculateTextClipBounds(clip, { _boundsReason: reason } as Partial<TextClip>, canvasWidth, canvasHeight);
  return {
    x: recalculated.x,
    y: recalculated.y,
    width: recalculated.width,
    height: recalculated.height,
  };
}

export function hasTextClipContentTransformDrift(clip: TextClip, canvasWidth: number, _canvasHeight: number, epsilon = 1): boolean {
  const resolved = calculateTextClipContentTransform(clip, {}, canvasWidth).transform;
  return Math.abs(resolved.x - clip.x) > epsilon || Math.abs(resolved.y - clip.y) > epsilon || Math.abs(resolved.width - clip.width) > epsilon || Math.abs(resolved.height - clip.height) > epsilon;
}
