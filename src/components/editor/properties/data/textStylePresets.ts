/**
 * textStylePresets.ts
 *
 * Built-in visual text presets replicating CapCut's "PRESET STYLE" gallery.
 * Includes 23 authentic presets across outlines, drop shadows, badges, 3D extrusions,
 * and neon glows, plus a Reset (None) option.
 */

import React from "react";
import type { TextClip } from "@/types";

export interface TextStylePreset {
  id: string;
  name: string;
  color?: string;
  fontWeight?: number | string;
  fontStyle?: "normal" | "italic";
  textDecoration?: "underline" | "none";
  stroke?: {
    color: string;
    width: number;
  };
  shadow?: {
    color: string;
    blur: number;
    offsetX: number;
    offsetY: number;
  };
  background?: {
    color: string;
    padding: number;
    borderRadius: number;
  };
  containerStyle?: React.CSSProperties;
  textStyle?: React.CSSProperties;
  isReset?: boolean;
}

export const TEXT_STYLE_PRESETS: TextStylePreset[] = [
  // ── ROW 1: Outlines, Shadows & Solid Strokes ───────────────────────────
  {
    id: "none",
    name: "None",
    isReset: true,
    color: "#ffffff",
    fontWeight: 400,
    fontStyle: "normal",
    textDecoration: "none",
    stroke: undefined,
    shadow: undefined,
    background: undefined,
  },
  {
    id: "white-stroke-black",
    name: "White with Black Outline",
    color: "#ffffff",
    fontWeight: 700,
    stroke: { color: "#000000", width: 3 },
    textStyle: {
      color: "#ffffff",
      WebkitTextStroke: "1.5px #000000",
      paintOrder: "stroke fill",
    },
  },
  {
    id: "black-stroke-white",
    name: "Black with White Outline",
    color: "#000000",
    fontWeight: 700,
    stroke: { color: "#ffffff", width: 3 },
    textStyle: {
      color: "#000000",
      WebkitTextStroke: "1.5px #ffffff",
      paintOrder: "stroke fill",
    },
  },
  {
    id: "white-shadow-hard",
    name: "White with Drop Shadow",
    color: "#ffffff",
    fontWeight: 700,
    shadow: { color: "#000000", blur: 0, offsetX: 2, offsetY: 2 },
    textStyle: {
      color: "#ffffff",
      textShadow: "2px 2px 0px #000000",
    },
  },
  {
    id: "white-shadow-soft",
    name: "White with Soft Shadow",
    color: "#ffffff",
    fontWeight: 700,
    shadow: { color: "rgba(0,0,0,0.85)", blur: 8, offsetX: 0, offsetY: 2 },
    textStyle: {
      color: "#ffffff",
      textShadow: "0px 2px 6px rgba(0,0,0,0.9)",
    },
  },
  {
    id: "yellow-stroke-black",
    name: "Yellow with Black Outline",
    color: "#ffe600",
    fontWeight: 700,
    stroke: { color: "#000000", width: 3 },
    textStyle: {
      color: "#ffe600",
      WebkitTextStroke: "1.5px #000000",
      paintOrder: "stroke fill",
    },
  },
  {
    id: "red-stroke-white",
    name: "Red with White Outline",
    color: "#ff2a2a",
    fontWeight: 700,
    stroke: { color: "#ffffff", width: 3 },
    textStyle: {
      color: "#ff2a2a",
      WebkitTextStroke: "1.5px #ffffff",
      paintOrder: "stroke fill",
    },
  },
  {
    id: "orange-stroke-white",
    name: "Orange with White Outline",
    color: "#ff7a00",
    fontWeight: 700,
    stroke: { color: "#ffffff", width: 3 },
    textStyle: {
      color: "#ff7a00",
      WebkitTextStroke: "1.5px #ffffff",
      paintOrder: "stroke fill",
    },
  },
  {
    id: "blue-stroke-white",
    name: "Blue with White Outline",
    color: "#00b0ff",
    fontWeight: 700,
    stroke: { color: "#ffffff", width: 3 },
    textStyle: {
      color: "#00b0ff",
      WebkitTextStroke: "1.5px #ffffff",
      paintOrder: "stroke fill",
    },
  },
  {
    id: "green-stroke-black",
    name: "Green with Black Outline",
    color: "#00ff44",
    fontWeight: 700,
    stroke: { color: "#000000", width: 3 },
    textStyle: {
      color: "#00ff44",
      WebkitTextStroke: "1.5px #000000",
      paintOrder: "stroke fill",
    },
  },

  // ── ROW 2: Badges, Pills & 3D Extrusions ──────────────────────────────
  {
    id: "badge-grey",
    name: "Grey Badge",
    color: "#000000",
    fontWeight: 700,
    background: { color: "#808080", padding: 8, borderRadius: 6 },
    containerStyle: { backgroundColor: "#808080" },
    textStyle: { color: "#000000" },
  },
  {
    id: "badge-darkgrey",
    name: "Dark Grey Badge",
    color: "#ffffff",
    fontWeight: 700,
    background: { color: "#505054", padding: 8, borderRadius: 6 },
    containerStyle: { backgroundColor: "#505054" },
    textStyle: { color: "#ffffff" },
  },
  {
    id: "badge-yellow",
    name: "Yellow Badge",
    color: "#000000",
    fontWeight: 700,
    background: { color: "#ffd000", padding: 8, borderRadius: 6 },
    containerStyle: { backgroundColor: "#ffd000" },
    textStyle: { color: "#000000" },
  },
  {
    id: "badge-purple",
    name: "Purple Badge",
    color: "#ffffff",
    fontWeight: 700,
    background: { color: "#7928ca", padding: 8, borderRadius: 6 },
    containerStyle: { backgroundColor: "#7928ca" },
    textStyle: { color: "#ffffff" },
  },
  {
    id: "badge-white-purple",
    name: "White Badge with Purple Text",
    color: "#7928ca",
    fontWeight: 700,
    background: { color: "#ffffff", padding: 8, borderRadius: 6 },
    containerStyle: { backgroundColor: "#ffffff" },
    textStyle: { color: "#7928ca" },
  },
  {
    id: "badge-white-black",
    name: "White Badge with Black Text",
    color: "#000000",
    fontWeight: 700,
    background: { color: "#ffffff", padding: 8, borderRadius: 6 },
    containerStyle: { backgroundColor: "#ffffff" },
    textStyle: { color: "#000000" },
  },
  {
    id: "badge-black-cyan-border",
    name: "Black Badge with Cyan Border",
    color: "#ffffff",
    fontWeight: 700,
    background: { color: "#000000", padding: 8, borderRadius: 6 },
    stroke: { color: "#00e5ff", width: 1 },
    containerStyle: { backgroundColor: "#000000", border: "1.5px solid #00e5ff" },
    textStyle: { color: "#ffffff" },
  },
  {
    id: "badge-black-green",
    name: "Black Badge with Green Text",
    color: "#00ff55",
    fontWeight: 700,
    background: { color: "#000000", padding: 8, borderRadius: 6 },
    containerStyle: { backgroundColor: "#000000" },
    textStyle: { color: "#00ff55" },
  },
  {
    id: "3d-green",
    name: "Black with Green 3D Extrusion",
    color: "#000000",
    fontWeight: 700,
    shadow: { color: "#00ff55", blur: 0, offsetX: 2, offsetY: 2 },
    textStyle: {
      color: "#000000",
      textShadow: "2px 2px 0px #00ff55",
    },
  },
  {
    id: "3d-red",
    name: "Yellow with Red 3D Extrusion",
    color: "#ffd000",
    fontWeight: 700,
    shadow: { color: "#e02424", blur: 0, offsetX: 2, offsetY: 2 },
    textStyle: {
      color: "#ffd000",
      textShadow: "2px 2px 0px #e02424",
    },
  },

  // ── ROW 3: Neon Glows ─────────────────────────────────────────────────
  {
    id: "neon-pink",
    name: "Neon Pink Glow",
    color: "#ffffff",
    fontWeight: 700,
    shadow: { color: "#ff007f", blur: 12, offsetX: 0, offsetY: 0 },
    textStyle: {
      color: "#ffffff",
      textShadow: "0 0 4px #ff007f, 0 0 10px #ff007f",
    },
  },
  {
    id: "neon-yellow",
    name: "Neon Yellow Glow",
    color: "#ffffff",
    fontWeight: 700,
    shadow: { color: "#ffe600", blur: 12, offsetX: 0, offsetY: 0 },
    textStyle: {
      color: "#ffffff",
      textShadow: "0 0 4px #ffe600, 0 0 10px #ffe600",
    },
  },
  {
    id: "neon-green",
    name: "Neon Green Glow",
    color: "#ffffff",
    fontWeight: 700,
    shadow: { color: "#00ff66", blur: 12, offsetX: 0, offsetY: 0 },
    textStyle: {
      color: "#ffffff",
      textShadow: "0 0 4px #00ff66, 0 0 10px #00ff66",
    },
  },
];

/**
 * Determines whether a given preset matches the current styling of a TextClip.
 */
export function isPresetActive(
  preset: TextStylePreset,
  textClip: TextClip,
): boolean {
  if (preset.isReset) {
    const hasNoStroke = !textClip.stroke || textClip.stroke.width === 0;
    const hasNoShadow = !textClip.shadow;
    const hasNoBg = !textClip.background;
    const isDefaultColor =
      !textClip.color || textClip.color.toLowerCase() === "#ffffff";
    const isNormalWeight =
      !textClip.fontWeight ||
      textClip.fontWeight === 400 ||
      textClip.fontWeight === "normal";
    return hasNoStroke && hasNoShadow && hasNoBg && isDefaultColor && isNormalWeight;
  }

  // If preset has background:
  if (preset.background) {
    if (!textClip.background) return false;
    const bgMatch =
      textClip.background.color.toLowerCase() ===
      preset.background.color.toLowerCase();
    const colMatch =
      !preset.color ||
      (textClip.color &&
        textClip.color.toLowerCase() === preset.color.toLowerCase());
    return bgMatch && Boolean(colMatch);
  }

  // If textClip has background but preset does not:
  if (textClip.background) return false;

  // If preset has stroke:
  if (preset.stroke) {
    if (!textClip.stroke || textClip.stroke.width === 0) return false;
    const strokeMatch =
      textClip.stroke.color.toLowerCase() === preset.stroke.color.toLowerCase();
    const colMatch =
      !preset.color ||
      (textClip.color &&
        textClip.color.toLowerCase() === preset.color.toLowerCase());
    return strokeMatch && Boolean(colMatch);
  }

  // If textClip has stroke but preset does not:
  if (textClip.stroke && textClip.stroke.width > 0) return false;

  // If preset has shadow:
  if (preset.shadow) {
    if (!textClip.shadow) return false;
    const shadowColorMatch =
      textClip.shadow.color.toLowerCase() === preset.shadow.color.toLowerCase();
    const colMatch =
      !preset.color ||
      (textClip.color &&
        textClip.color.toLowerCase() === preset.color.toLowerCase());
    return shadowColorMatch && Boolean(colMatch);
  }

  return false;
}
