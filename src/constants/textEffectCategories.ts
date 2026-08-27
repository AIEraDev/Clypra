/**
 * Single source of truth for text effect categories.
 * Used in the effect catalog panel, API queries, and any
 * other place that needs to enumerate or validate a text effect category.
 *
 * Must stay in sync with clypra-studio and clypra-api TEXT_EFFECT_CATEGORIES.
 */

export const TEXT_EFFECT_CATEGORY_IDS = [
  "essentials",
  "neon",
  "3d",
  "glitch",
  "gradient",
  "outline",
  "cinematic",
  "retro",
  "minimal",
  "grunge",
  "metallic",
  "handwritten",
] as const;

export type TextEffectCategoryId = (typeof TEXT_EFFECT_CATEGORY_IDS)[number];

export const TEXT_EFFECT_CATEGORY_OPTIONS: ReadonlyArray<{
  id: TextEffectCategoryId;
  name: string;
  description: string;
}> = [
  {
    id: "essentials",
    name: "Essentials",
    description: "Clean, versatile styles — every editor's starting point",
  },
  {
    id: "neon",
    name: "Neon",
    description: "Glowing electric text, the creator aesthetic staple",
  },
  {
    id: "3d",
    name: "3D",
    description: "Depth, extrusion and perspective — great for thumbnails",
  },
  {
    id: "glitch",
    name: "Glitch",
    description: "VHS / digital distortion with a retro-futuristic edge",
  },
  {
    id: "gradient",
    name: "Gradient",
    description: "Smooth multi-color fills that work across all content types",
  },
  {
    id: "outline",
    name: "Outline",
    description: "Crisp strokes for captions, lower thirds, and titles",
  },
  {
    id: "cinematic",
    name: "Cinematic",
    description: "Film-grade title treatments with dramatic lighting",
  },
  {
    id: "retro",
    name: "Retro",
    description: "Nostalgic vintage and old-school typographic styles",
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Understated, whitespace-forward typographic compositions",
  },
  {
    id: "grunge",
    name: "Grunge",
    description: "Textured, weathered effects with raw organic character",
  },
  {
    id: "metallic",
    name: "Metallic",
    description: "Gold, chrome, and brushed-metal surface finishes",
  },
  {
    id: "handwritten",
    name: "Handwritten",
    description: "Brush lettering and handcrafted script treatments",
  },
];

/** Flat array of just the string IDs — useful for API calls and dropdowns */
export const TEXT_EFFECT_CATEGORIES = TEXT_EFFECT_CATEGORY_IDS;
