/**
 * Caption Style System
 *
 * A Caption Style is a named, reusable full-fidelity style package for caption clips.
 * It carries everything a TextClip needs for consistent, readable subtitle rendering
 * across different background content — distinct from generic Display text effects.
 *
 * Each style maps directly to a `Partial<TextClip>` patch that can be broadcast via
 * `ApplyCaptionTrackStyleCommand` to all caption clips on the active track.
 */

import type { TextClip } from "@/types";
import type { TemplateDefinition } from "@/features/text-templates/types";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface CaptionStylePreviewConfig {
  textColor: string;
  bgColor?: string;
  bgBorderRadius?: number;
  strokeColor?: string;
  strokeWidth?: number;
  fontWeight?: number;
  fontFamily?: string;
  hasPill?: boolean;
}

export interface CaptionStyleDefinition {
  /** Unique identifier */
  id: string;
  /** Display name shown in the gallery */
  name: string;
  /** Short description for tooltip / metadata */
  description: string;
  /**
   * Visual preview configuration for the gallery card thumbnail.
   * These are purely presentational CSS values for the preview card —
   * the actual clip values come from `patch`.
   */
  preview: CaptionStylePreviewConfig;
  /**
   * The full TextClip-compatible style patch applied to all caption clips
   * when this style is selected. Keys match the TextClip interface exactly.
   */
  patch: Partial<TextClip>;
  /** Whether this style is user-created (saved from the Style Designer) */
  isCustom?: boolean;
  /** ISO date string when this style was saved */
  createdAt?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Built-in Curated Caption Styles
// ──────────────────────────────────────────────────────────────────────────────

export const BUILTIN_CAPTION_STYLES: CaptionStyleDefinition[] = [
  // ── 1. Classic Yellow Bold ──────────────────────────────────────────────────
  // The gold standard of caption readability. Used by 80%+ of viral social clips.
  {
    id: "classic-yellow",
    name: "Classic Yellow",
    description:
      "High-contrast yellow text with bold black outline — the most readable caption style for mixed backgrounds.",
    preview: {
      textColor: "#FFE600",
      strokeColor: "#000000",
      strokeWidth: 4,
      fontWeight: 800,
      fontFamily: "Outfit Variable",
    },
    patch: {
      fontFamily: "Outfit Variable",
      fontSize: 38,
      fontWeight: 800,
      color: "#FFE600",
      textTransform: "uppercase",
      align: "center",
      valign: "bottom",
      stroke: { color: "#000000", width: 4 },
      shadow: { color: "rgba(0,0,0,0.6)", blur: 6, offsetX: 0, offsetY: 3 },
      background: undefined,
      styleId: undefined,
      templateId: undefined,
    },
  },

  // ── 2. Dark Pill ────────────────────────────────────────────────────────────
  // Rounded pill background — clean, broadcast-quality.
  {
    id: "dark-pill",
    name: "Dark Pill",
    description:
      "White text inside a semi-transparent dark rounded pill — works on any background.",
    preview: {
      textColor: "#FFFFFF",
      bgColor: "rgba(0,0,0,0.75)",
      bgBorderRadius: 10,
      fontWeight: 700,
      fontFamily: "Inter Variable",
      hasPill: true,
    },
    patch: {
      fontFamily: "Inter Variable",
      fontSize: 34,
      fontWeight: 700,
      color: "#FFFFFF",
      textTransform: "none",
      align: "center",
      valign: "bottom",
      stroke: undefined,
      shadow: { color: "rgba(0,0,0,0.5)", blur: 4, offsetX: 0, offsetY: 2 },
      background: { color: "rgba(0,0,0,0.75)", padding: 10, borderRadius: 10 },
      styleId: undefined,
      templateId: undefined,
    },
  },

  // ── 3. Outline White ───────────────────────────────────────────────────────
  // Classic broadcast standard — white text with clean dark outline.
  {
    id: "outline-white",
    name: "Outline White",
    description:
      "Broadcast-standard white text with dark outline — clean and professional on any content.",
    preview: {
      textColor: "#FFFFFF",
      strokeColor: "#1a1a1a",
      strokeWidth: 3,
      fontWeight: 600,
      fontFamily: "Inter Variable",
    },
    patch: {
      fontFamily: "Inter Variable",
      fontSize: 32,
      fontWeight: 600,
      color: "#FFFFFF",
      textTransform: "none",
      align: "center",
      valign: "bottom",
      stroke: { color: "#1a1a1a", width: 3 },
      shadow: { color: "rgba(0,0,0,0.8)", blur: 5, offsetX: 0, offsetY: 2 },
      background: undefined,
      styleId: undefined,
      templateId: undefined,
    },
  },

  // ── 4. Neon Pop ────────────────────────────────────────────────────────────
  // Social/short-form kinetic style — electric cyan with deep glow
  {
    id: "neon-pop",
    name: "Neon Pop",
    description:
      "Electric cyan with a vivid blue glow — perfect for tech, gaming, and high-energy content.",
    preview: {
      textColor: "#00FFFF",
      strokeColor: "#0044EE",
      strokeWidth: 3,
      fontWeight: 800,
      fontFamily: "Outfit Variable",
    },
    patch: {
      fontFamily: "Outfit Variable",
      fontSize: 38,
      fontWeight: 800,
      color: "#00FFFF",
      textTransform: "uppercase",
      align: "center",
      valign: "bottom",
      stroke: { color: "#0044EE", width: 3 },
      shadow: { color: "rgba(0,68,238,0.5)", blur: 10, offsetX: 0, offsetY: 0 },
      background: undefined,
      styleId: undefined,
      templateId: undefined,
    },
  },

  // ── 5. Minimal Clean ───────────────────────────────────────────────────────
  // Understated, editorial — YouTube/podcast standard
  {
    id: "minimal-clean",
    name: "Minimal Clean",
    description:
      "Understated white text with a soft shadow — editorial and podcast-friendly.",
    preview: {
      textColor: "#FFFFFF",
      strokeColor: "rgba(0,0,0,0.3)",
      strokeWidth: 1.5,
      fontWeight: 400,
      fontFamily: "Inter Variable",
    },
    patch: {
      fontFamily: "Inter Variable",
      fontSize: 30,
      fontWeight: 400,
      color: "#FFFFFF",
      textTransform: "none",
      align: "center",
      valign: "bottom",
      stroke: { color: "rgba(0,0,0,0.3)", width: 1.5 },
      shadow: { color: "rgba(0,0,0,0.7)", blur: 8, offsetX: 0, offsetY: 3 },
      background: undefined,
      styleId: undefined,
      templateId: undefined,
    },
  },

  // ── 6. Fire Orange ─────────────────────────────────────────────────────────
  // High energy — fitness, sports, motivation content
  {
    id: "fire-orange",
    name: "Fire Orange",
    description:
      "Bold warm orange with dark outline — energetic and attention-grabbing for action content.",
    preview: {
      textColor: "#FF6B1A",
      strokeColor: "#1A0800",
      strokeWidth: 4,
      fontWeight: 900,
      fontFamily: "Outfit Variable",
    },
    patch: {
      fontFamily: "Outfit Variable",
      fontSize: 40,
      fontWeight: 900,
      color: "#FF6B1A",
      textTransform: "uppercase",
      align: "center",
      valign: "bottom",
      stroke: { color: "#1A0800", width: 4 },
      shadow: { color: "rgba(255,80,0,0.4)", blur: 8, offsetX: 0, offsetY: 0 },
      background: undefined,
      styleId: undefined,
      templateId: undefined,
    },
  },

  // ── 7. Frosted Glass ───────────────────────────────────────────────────────
  // Modern translucent glass-effect box
  {
    id: "frosted-glass",
    name: "Frosted Glass",
    description:
      "Modern frosted glass pill with light text — clean, premium look for lifestyle and brand content.",
    preview: {
      textColor: "#FFFFFF",
      bgColor: "rgba(255,255,255,0.15)",
      bgBorderRadius: 12,
      strokeColor: "rgba(255,255,255,0.3)",
      strokeWidth: 1,
      fontWeight: 600,
      fontFamily: "Inter Variable",
      hasPill: true,
    },
    patch: {
      fontFamily: "Inter Variable",
      fontSize: 32,
      fontWeight: 600,
      color: "#FFFFFF",
      textTransform: "none",
      align: "center",
      valign: "bottom",
      stroke: { color: "rgba(255,255,255,0.3)", width: 1 },
      shadow: { color: "rgba(0,0,0,0.4)", blur: 6, offsetX: 0, offsetY: 2 },
      background: { color: "rgba(255,255,255,0.12)", padding: 12, borderRadius: 14 },
      styleId: undefined,
      templateId: undefined,
    },
  },

  // ── 8. Typewriter Mono ─────────────────────────────────────────────────────
  // Documentary / technical / code content
  {
    id: "typewriter-mono",
    name: "Typewriter Mono",
    description:
      "Monospace typewriter style — perfect for documentary narration, tech, or interview content.",
    preview: {
      textColor: "#E8E8D8",
      bgColor: "rgba(0,0,0,0.85)",
      bgBorderRadius: 4,
      fontWeight: 400,
      fontFamily: "monospace",
      hasPill: true,
    },
    patch: {
      fontFamily: "monospace",
      fontSize: 28,
      fontWeight: 400,
      color: "#E8E8D8",
      textTransform: "none",
      align: "left",
      valign: "bottom",
      stroke: undefined,
      shadow: undefined,
      background: { color: "rgba(0,0,0,0.85)", padding: 10, borderRadius: 4 },
      styleId: undefined,
      templateId: undefined,
    },
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Accessors
// ──────────────────────────────────────────────────────────────────────────────

export function getCaptionStyleById(id: string): CaptionStyleDefinition | undefined {
  return BUILTIN_CAPTION_STYLES.find((s) => s.id === id);
}

export function getAllCaptionStyles(
  userStyles: CaptionStyleDefinition[] = [],
): CaptionStyleDefinition[] {
  return [...BUILTIN_CAPTION_STYLES, ...userStyles];
}

/**
 * Converts a CaptionStyleDefinition into a first-class TemplateDefinition.
 * Retains the visual preview parameters and 1-to-1 patch for direct application.
 */
export function captionStyleToTemplate(style: CaptionStyleDefinition): TemplateDefinition {
  return {
    id: style.id,
    category: "caption",
    name: style.name,
    label: style.name,
    displayName: style.name,
    description: style.description,
    canvasWidth: 1920,
    canvasHeight: 1080,
    duration: 4,
    stylePreview: style.preview,
    patch: style.patch,
    layers: [
      {
        kind: "text",
        id: "caption-text",
        content: "Sample Subtitle Caption",
        fontFamily: style.patch.fontFamily || "Outfit Variable",
        fontSize: style.patch.fontSize || 36,
        fontWeight: (style.patch.fontWeight as number) || 700,
        color: style.patch.color || "#FFFFFF",
        align: style.patch.align || "center",
        x: 360,
        y: 890,
        width: 1200,
        height: 100,
        role: "primary",
        textRole: "caption",
        stroke: style.patch.stroke,
        shadow: style.patch.shadow,
        backgroundColor: style.patch.background?.color,
        backgroundRadius: style.patch.background?.borderRadius,
        padding: style.patch.background?.padding,
        animation: {
          in: "fade",
          out: "fade",
          inDuration: 0.2,
          outDuration: 0.2,
          hold: "full",
        },
        anchor: {
          anchorPoint: "bottom-center",
          maxWidthPercentage: 90,
        },
      },
    ],
  };
}

export const BUILTIN_CAPTION_TEMPLATES: TemplateDefinition[] =
  BUILTIN_CAPTION_STYLES.map(captionStyleToTemplate);

/**
 * Resolves available caption templates strictly from cloud-fetched templates.
 * Returns an empty array if no cloud templates are published or available,
 * ensuring no hardcoded presets are displayed.
 */
export function getUnifiedCaptionTemplates(
  cloudTemplates: TemplateDefinition[] = [],
): TemplateDefinition[] {
  return cloudTemplates;
}

/**
 * Resolves presentational preview CSS properties from any caption template.
 * Works seamlessly across baseline presets, engine templates, and Studio cloud templates.
 */
export function resolveCaptionPreview(template: TemplateDefinition): CaptionStylePreviewConfig {
  if (template.stylePreview) {
    return template.stylePreview;
  }

  const patch = (template as any).patch as Partial<TextClip> | undefined;
  if (patch) {
    return {
      textColor: patch.color || "#FFFFFF",
      bgColor: patch.background?.color,
      bgBorderRadius: patch.background?.borderRadius,
      strokeColor: patch.stroke?.color,
      strokeWidth: patch.stroke?.width,
      fontWeight: typeof patch.fontWeight === "number" ? patch.fontWeight : undefined,
      fontFamily: patch.fontFamily,
      hasPill: !!patch.background?.color,
    };
  }

  if (Array.isArray(template.layers)) {
    const textLayer = template.layers.find((l: any) => l.kind === "text") || template.layers[0];
    const shapeLayer = template.layers.find((l: any) => l.kind === "shape" || l.kind === "solid");

    return {
      textColor: textLayer?.color || "#FFFFFF",
      bgColor: shapeLayer?.fill || textLayer?.backgroundColor || undefined,
      bgBorderRadius: shapeLayer?.borderRadius || 8,
      strokeColor: textLayer?.stroke?.color,
      strokeWidth: textLayer?.stroke?.width,
      fontWeight: textLayer?.fontWeight || 700,
      fontFamily: textLayer?.fontFamily || "Outfit Variable",
      hasPill: !!(shapeLayer?.fill || textLayer?.backgroundColor),
    };
  }

  return {
    textColor: "#FFFFFF",
    fontWeight: 700,
  };
}

/**
 * Converts a cloud-published TextEffect (from /text-effects/caption) into a first-class TemplateDefinition.
 * Extracts visual properties (colors, strokes, shadows, background pills, and typography)
 * into both a high-fidelity stylePreview and a TextClip-compatible style patch.
 */
export function textEffectToCaptionTemplate(effect: any): TemplateDefinition {
  const isFull = !!(
    effect.scene ||
    effect.legacyConfig ||
    effect.fillColor !== undefined ||
    effect.panelEnabled !== undefined
  );

  const hasPill = isFull ? !!effect.panelEnabled : false;
  const bgColor =
    isFull && effect.panelEnabled
      ? effect.panelColor || "rgba(0,0,0,0.75)"
      : undefined;
  const bgRadius =
    isFull && effect.panelRadius !== undefined ? effect.panelRadius : 0;
  const bgPadding =
    isFull && effect.panelPaddingX !== undefined ? effect.panelPaddingX : 10;

  const textColor = effect.fillColor || "#FFFFFF";
  const stroke = effect.strokeEnabled
    ? { color: effect.strokeColor || "#000000", width: effect.strokeWidth || 3 }
    : undefined;
  const shadow = effect.shadowEnabled
    ? {
        color: effect.shadowColor || "rgba(0,0,0,0.85)",
        blur: effect.shadowBlur || 4,
        offsetX: effect.shadowOffsetX || 0,
        offsetY: effect.shadowOffsetY || 2,
      }
    : undefined;

  const revisionId = effect.revisionId ?? effect.revision?.revisionId;
  const contentHash = effect.contentHash ?? effect.revision?.contentHash;
  const rendererVersion = effect.rendererVersion ?? effect.revision?.rendererVersion;

  const patch: Partial<TextClip> = {
    fontFamily: effect.fontFamily || "Outfit Variable",
    fontSize: effect.fontSize || 34,
    fontWeight: typeof effect.fontWeight === "number" ? effect.fontWeight : 700,
    color: textColor,
    textTransform: "uppercase",
    align: "center",
    valign: "bottom",
    stroke,
    shadow,
    background: hasPill
      ? {
          color: bgColor!,
          padding: bgPadding,
          borderRadius: bgRadius,
        }
      : undefined,
    styleId: effect.id,
    styleRevisionId: revisionId,
    styleContentHash: contentHash,
    styleSnapshot: effect.scene,
    styleDefinition: isFull ? effect : undefined,
    templateId: undefined,
  };

  return {
    id: effect.id,
    category: "caption",
    name: effect.name || effect.id,
    label: effect.name || effect.id,
    displayName: effect.name || effect.id,
    description: effect.description || "",
    thumbnailUrl: effect.thumbnail,
    thumbnail: effect.thumbnail,
    previewUrl: effect.thumbnail,
    canvasWidth: effect.canvasWidth || 1920,
    canvasHeight: effect.canvasHeight || 1080,
    duration: 4,
    isCloud: true,
    isTextEffect: true,
    revisionId,
    contentHash,
    rendererVersion,
    stylePreview: {
      textColor,
      bgColor,
      bgBorderRadius: bgRadius,
      strokeColor: stroke?.color,
      strokeWidth: stroke?.width,
      fontWeight: typeof effect.fontWeight === "number" ? effect.fontWeight : 700,
      fontFamily: effect.fontFamily || "Outfit Variable",
      hasPill,
    },
    patch,
    templateData: effect,
    styleSnapshot: effect.scene,
    styleDefinition: isFull ? effect : undefined,
  };
}

