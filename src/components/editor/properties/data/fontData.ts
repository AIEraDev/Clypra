/**
 * fontData.ts
 *
 * Shared font catalogue and picker utilities for the Properties Panel.
 * Consumed by TextStyleSection, TemplateLayerEditor, and any future
 * font-selection control.
 */

import { normalizeFontFamily } from "@/core/evaluation/evaluator";

// ---------------------------------------------------------------------------
// Font catalogues
// ---------------------------------------------------------------------------

export const SYSTEM_FONTS = [
  { value: "Arial", label: "Arial" },
  { value: "Arial Black", label: "Arial Black" },
  { value: "Arial Rounded MT Bold", label: "Arial Rounded MT Bold" },
  { value: "Georgia", label: "Georgia" },
  { value: "Times New Roman", label: "Times New Roman" },
  { value: "Courier New", label: "Courier New" },
  { value: "Impact", label: "Impact" },
  { value: "Verdana", label: "Verdana" },
  { value: "Trebuchet MS", label: "Trebuchet MS" },
  { value: "Palatino", label: "Palatino" },
] as const;

export const GOOGLE_FONTS = [
  { value: "Inter Variable", label: "Inter" },
  { value: "Geist Variable", label: "Geist" },
  { value: "Outfit Variable", label: "Outfit" },
  { value: "Space Grotesk Variable", label: "Space Grotesk" },
  { value: "Roboto Variable", label: "Roboto" },
  { value: "Roboto Condensed", label: "Roboto Condensed" },
  { value: "Open Sans", label: "Open Sans" },
  { value: "Lato", label: "Lato" },
  { value: "Montserrat Variable", label: "Montserrat" },
  { value: "Raleway", label: "Raleway" },
  { value: "Oswald", label: "Oswald" },
  { value: "Playfair Display", label: "Playfair Display" },
  { value: "Anton", label: "Anton" },
  { value: "Bebas Neue", label: "Bebas Neue" },
  { value: "Nunito", label: "Nunito" },
  { value: "Poppins", label: "Poppins" },
  { value: "Permanent Marker", label: "Permanent Marker" },
  { value: "Bangers", label: "Bangers" },
  { value: "Press Start 2P", label: "Press Start 2P" },
  { value: "Dancing Script", label: "Dancing Script" },
  { value: "Pacifico", label: "Pacifico" },
] as const;

export const FONT_PICKER_OPTIONS = [
  ...SYSTEM_FONTS,
  ...GOOGLE_FONTS,
] as { value: string; label: string }[];

export const FONT_WEIGHTS = [
  { value: 100, label: "Thin" },
  { value: 200, label: "Extra Light" },
  { value: 300, label: "Light" },
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 600, label: "Semi Bold" },
  { value: 700, label: "Bold" },
  { value: 800, label: "Extra Bold" },
  { value: 900, label: "Black" },
] as const;

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------

export const COLOR_PALETTE = [
  { label: "White", value: "#ffffff" },
  { label: "Black", value: "#1a1a1a" },
  { label: "Yellow", value: "#ffcc00" },
  { label: "Red", value: "#ff3b30" },
  { label: "Pink", value: "#ff2d55" },
  { label: "Purple", value: "#af52de" },
  { label: "Blue", value: "#007aff" },
  { label: "Teal", value: "#00f0ff" },
  { label: "Green", value: "#34c759" },
  { label: "Gold", value: "#ffe066, #b38600" },
  { label: "Sunset", value: "#ff3e00, #ff0077, #aa00ff" },
  { label: "Ocean", value: "#00c8ff, #00ff66" },
  { label: "Rainbow", value: "#ff007f, #aa00ff, #00c8ff, #00ff66" },
] as const;

/** Solid-colour swatches (no gradients) — safe to pass to single-value colour pickers. */
export const SOLID_COLOR_SWATCHES = COLOR_PALETTE.filter(
  (p) => !p.value.includes(","),
).map((p) => p.value);

// ---------------------------------------------------------------------------
// resolveFontPickerValue
// ---------------------------------------------------------------------------

/**
 * Keep the native select controlled even when older clips store a family
 * alias (e.g. "Dancing Script") while evaluation resolves it to the
 * Fontsource family ("Dancing Script Variable").
 *
 * Tries progressively looser matches until one hits a known picker option.
 */
export function resolveFontPickerValue(family: string): string {
  const rawFamily = family.trim();
  const primaryFamily = rawFamily
    .split(",")[0]
    .trim()
    .replace(/^["']|["']$/g, "");
  const normalizedFamily = normalizeFontFamily(rawFamily);
  const normalizedPrimary = normalizeFontFamily(primaryFamily);
  const normalizedBase = normalizedPrimary.replace(/\s+variable$/i, "");

  const lc = (s: string) => s.toLowerCase();

  return (
    FONT_PICKER_OPTIONS.find((f) => lc(f.value) === lc(rawFamily))?.value ??
    FONT_PICKER_OPTIONS.find((f) => lc(f.value) === lc(normalizedFamily))?.value ??
    FONT_PICKER_OPTIONS.find((f) => lc(f.label) === lc(normalizedFamily))?.value ??
    FONT_PICKER_OPTIONS.find((f) => lc(f.value) === lc(primaryFamily))?.value ??
    FONT_PICKER_OPTIONS.find((f) => lc(f.label) === lc(primaryFamily))?.value ??
    FONT_PICKER_OPTIONS.find((f) => lc(f.value) === lc(normalizedPrimary))?.value ??
    FONT_PICKER_OPTIONS.find((f) => lc(f.label) === lc(normalizedPrimary))?.value ??
    FONT_PICKER_OPTIONS.find((f) => lc(f.value) === lc(normalizedBase))?.value ??
    FONT_PICKER_OPTIONS.find((f) => lc(f.label) === lc(normalizedBase))?.value ??
    normalizedFamily
  );
}
