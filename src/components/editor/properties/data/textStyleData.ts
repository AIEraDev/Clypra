/**
 * textStyleData.ts
 *
 * Static data specific to the TextStyleSection:
 * - BUBBLE_PRESETS  — named background-box presets shown in the Bubble tab.
 * - CAPTION_STYLE_KEYS — the clip fields that participate in
 *   "apply to all captions" batch styling.
 */

// ---------------------------------------------------------------------------
// Bubble presets
// ---------------------------------------------------------------------------

export interface BubblePreset {
  id: string;
  name: string;
  background?: {
    color: string;
    padding: number;
    borderRadius: number;
  };
}

export const BUBBLE_PRESETS: BubblePreset[] = [
  { id: "none", name: "None", background: undefined },
  {
    id: "dark_pill",
    name: "Dark Pill",
    background: { color: "rgba(24, 24, 27, 0.85)", padding: 8, borderRadius: 999 },
  },
  {
    id: "speech_white",
    name: "Speech Bubble",
    background: { color: "rgba(255, 255, 255, 0.95)", padding: 12, borderRadius: 12 },
  },
  {
    id: "dark_box",
    name: "Dark Box",
    background: { color: "rgba(0, 0, 0, 0.75)", padding: 10, borderRadius: 6 },
  },
  {
    id: "cyan_glow",
    name: "Cyan Glow",
    background: { color: "rgba(6, 182, 212, 0.25)", padding: 10, borderRadius: 8 },
  },
  {
    id: "yellow_tag",
    name: "Yellow Tag",
    background: { color: "#fef08a", padding: 10, borderRadius: 4 },
  },
  {
    id: "rose_pill",
    name: "Rose Pill",
    background: { color: "rgba(244, 63, 94, 0.85)", padding: 8, borderRadius: 999 },
  },
];

// ---------------------------------------------------------------------------
// Caption style keys
// ---------------------------------------------------------------------------

/**
 * Clip fields that are considered "style" properties for batch caption
 * broadcasting. When "apply to all captions" is active any update to one
 * of these keys is mirrored to every other caption on the same track.
 */
export const CAPTION_STYLE_KEYS: ReadonlyArray<string> = [
  "fontFamily",
  "fontSize",
  "color",
  "fontWeight",
  "fontStyle",
  "textDecoration",
  "textTransform",
  "stroke",
  "shadow",
  "background",
  "lineHeight",
  "letterSpacing",
  "align",
  "valign",
  "styleId",
  "styleVersion",
  "styleRevisionId",
  "styleContentHash",
  "styleSnapshot",
  "styleDefinition",
  "templateId",
  "templateSnapshot",
];
