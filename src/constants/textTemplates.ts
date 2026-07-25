/**
 * Premium Text Templates Catalog
 *
 * 20 dynamic overlay composition text templates.
 * Each template includes default style properties and layout configurations
 * that can be applied to clips to compose rich title cards.
 * 
 * Note: All templates are fully free.
 */

export interface TextTemplatePreset {
  id: string;
  name: string;
  category: "Trending" | "Classic" | "NEW" | "Hits" | "Free Fire" | "Icons" | "Title" | "Retro";
  defaultText: string;
  overlayType:
    | "smoke"
    | "neon"
    | "pin"
    | "waveform"
    | "cursive"
    | "shield"
    | "divider"
    | "grid"
    | "badge"
    | "viewfinder"
    | "social"
    | "news"
    | "quote"
    | "terminal"
    | "credits"
    | "food"
    | "flight"
    | "hud"
    | "waves"
    | "health";
  fontFamily: string;
  color: string;
  fontSize: number;
  fontWeight: "normal" | "bold" | number;
  fontStyle: "normal" | "italic";
  stroke?: { color: string; width: number };
  shadow?: { color: string; blur: number; offsetX: number; offsetY: number };
  background?: { color: string; padding: number; borderRadius: number };
  premium?: boolean;
}

export const TEXT_TEMPLATES: TextTemplatePreset[] = [
  {
    id: "template-discount",
    name: "Discount Smoke",
    category: "Trending",
    defaultText: "50% DISCOUNT",
    overlayType: "smoke",
    fontFamily: "Outfit",
    color: "#ffd700",
    fontSize: 54,
    fontWeight: "bold",
    fontStyle: "normal",
    stroke: { color: "#000000", width: 5 },
    shadow: { color: "#ff6600", blur: 12, offsetX: 0, offsetY: 0 },
  },
  {
    id: "template-smart",
    name: "Smart Neon Box",
    category: "Trending",
    defaultText: "SMART TECH",
    overlayType: "neon",
    fontFamily: "Inter",
    color: "#ffffff",
    fontSize: 48,
    fontWeight: "bold",
    fontStyle: "normal",
    stroke: { color: "#ff0077", width: 4 },
    shadow: { color: "#ff0077", blur: 15, offsetX: 0, offsetY: 0 },
  },
  {
    id: "template-location",
    name: "Location Pin",
    category: "Icons",
    defaultText: "Los Angeles, CA",
    overlayType: "pin",
    fontFamily: "Montserrat",
    color: "#ffffff",
    fontSize: 32,
    fontWeight: 500,
    fontStyle: "normal",
    background: { color: "rgba(0, 0, 0, 0.6)", padding: 10, borderRadius: 20 },
  },
  {
    id: "template-waveform",
    name: "Title Waveform",
    category: "Title",
    defaultText: "SOUNDTRACK TITLE",
    overlayType: "waveform",
    fontFamily: "Outfit",
    color: "#00ffcc",
    fontSize: 42,
    fontWeight: "bold",
    fontStyle: "normal",
    stroke: { color: "#051122", width: 4 },
  },
  {
    id: "template-cursive",
    name: "Luminous Script",
    category: "Classic",
    defaultText: "Golden Memories",
    overlayType: "cursive",
    fontFamily: "Outfit",
    color: "#ffdd66, #ccaa44",
    fontSize: 60,
    fontWeight: "normal",
    fontStyle: "italic",
    shadow: { color: "rgba(0,0,0,0.5)", blur: 8, offsetX: 2, offsetY: 3 },
  },
  {
    id: "template-freefire",
    name: "Free Fire Shield",
    category: "Free Fire",
    defaultText: "SQUAD CHAMPION",
    overlayType: "shield",
    fontFamily: "Outfit",
    color: "#ffffff",
    fontSize: 36,
    fontWeight: "bold",
    fontStyle: "italic",
    stroke: { color: "#e63946", width: 6 },
  },
  {
    id: "template-divider",
    name: "Minimal Divider",
    category: "Classic",
    defaultText: "CHAPTER ONE",
    overlayType: "divider",
    fontFamily: "Inter",
    color: "#f4f4f5",
    fontSize: 28,
    fontWeight: "normal",
    fontStyle: "normal",
  },
  {
    id: "template-grid",
    name: "Retro Synth Grid",
    category: "Retro",
    defaultText: "80S VIBES",
    overlayType: "grid",
    fontFamily: "Outfit",
    color: "#ff00ff, #00ffff",
    fontSize: 56,
    fontWeight: 900,
    fontStyle: "italic",
    stroke: { color: "#000000", width: 6 },
  },
  {
    id: "template-badge",
    name: "Mega Sale Badge",
    category: "Hits",
    defaultText: "BIG SALE",
    overlayType: "badge",
    fontFamily: "Outfit",
    color: "#ffffff",
    fontSize: 38,
    fontWeight: "bold",
    fontStyle: "normal",
    stroke: { color: "#d90429", width: 4 },
  },
  {
    id: "template-viewfinder",
    name: "Vlog Viewfinder",
    category: "Trending",
    defaultText: "VLOG DAY #45",
    overlayType: "viewfinder",
    fontFamily: "Inter",
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "normal",
    fontStyle: "normal",
  },
  {
    id: "template-social",
    name: "Social Follow",
    category: "Icons",
    defaultText: "@username",
    overlayType: "social",
    fontFamily: "Inter",
    color: "#ffffff",
    fontSize: 28,
    fontWeight: 500,
    fontStyle: "normal",
    background: { color: "#1877f2", padding: 8, borderRadius: 6 },
  },
  {
    id: "template-news",
    name: "Breaking News Ticker",
    category: "NEW",
    defaultText: "BREAKING NEWS: MAJOR EVENT OCCURRING NOW",
    overlayType: "news",
    fontFamily: "Roboto",
    color: "#ffffff",
    fontSize: 30,
    fontWeight: "bold",
    fontStyle: "normal",
    background: { color: "#d90429", padding: 12, borderRadius: 0 },
  },
  {
    id: "template-quote",
    name: "Modern Quote Card",
    category: "Classic",
    defaultText: "Life is short, edit it fast.",
    overlayType: "quote",
    fontFamily: "Roboto",
    color: "#a1a1aa",
    fontSize: 34,
    fontWeight: "normal",
    fontStyle: "italic",
  },
  {
    id: "template-terminal",
    name: "CRT Terminal Prompt",
    category: "Retro",
    defaultText: "vireostudio --render-scene",
    overlayType: "terminal",
    fontFamily: "Inter",
    color: "#39ff14",
    fontSize: 24,
    fontWeight: "normal",
    fontStyle: "normal",
    background: { color: "#000000", padding: 14, borderRadius: 4 },
  },
  {
    id: "template-credits",
    name: "Cinematic Roll",
    category: "Title",
    defaultText: "Director of Photography",
    overlayType: "credits",
    fontFamily: "Roboto",
    color: "#eeeeee",
    fontSize: 30,
    fontWeight: "normal",
    fontStyle: "normal",
  },
  {
    id: "template-food",
    name: "Chef Kitchen",
    category: "NEW",
    defaultText: "SWEET PANCAKE RECIPE",
    overlayType: "food",
    fontFamily: "Montserrat",
    color: "#5c3d2e",
    fontSize: 34,
    fontWeight: "bold",
    fontStyle: "normal",
    background: { color: "#fef6e4", padding: 12, borderRadius: 10 },
  },
  {
    id: "template-flight",
    name: "Travel Route",
    category: "Icons",
    defaultText: "LONDON to NEW YORK",
    overlayType: "flight",
    fontFamily: "Outfit",
    color: "#ffffff",
    fontSize: 30,
    fontWeight: "bold",
    fontStyle: "normal",
  },
  {
    id: "template-hud",
    name: "Sci-Fi HUD Frame",
    category: "Retro",
    defaultText: "SECTOR A ACTIVE",
    overlayType: "hud",
    fontFamily: "Inter",
    color: "#00c8ff",
    fontSize: 26,
    fontWeight: "normal",
    fontStyle: "normal",
  },
  {
    id: "template-waves",
    name: "Lyric Sync Waves",
    category: "Hits",
    defaultText: "Singing like the wind...",
    overlayType: "waves",
    fontFamily: "Montserrat",
    color: "#ffffff",
    fontSize: 36,
    fontWeight: "bold",
    fontStyle: "normal",
    shadow: { color: "#8b84ff", blur: 10, offsetX: 0, offsetY: 0 },
  },
  {
    id: "template-health",
    name: "Gamer Health HUD",
    category: "Free Fire",
    defaultText: "VIREOSTUDIO_EDIT",
    overlayType: "health",
    fontFamily: "Outfit",
    color: "#ffffff",
    fontSize: 28,
    fontWeight: "bold",
    fontStyle: "normal",
  },
];
