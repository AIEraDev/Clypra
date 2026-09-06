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

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

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
  preview: {
    textColor: string;
    bgColor?: string;
    bgBorderRadius?: number;
    strokeColor?: string;
    strokeWidth?: number;
    fontWeight?: number;
    fontFamily?: string;
    hasPill?: boolean;
  };
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
