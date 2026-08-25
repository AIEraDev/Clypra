/** Theme definitions, clip palettes, and runtime CSS composition. */
import {
  CLYPRA_LEGACY_COLOR_ALIASES,
  CLYPRA_SHADCN_COLOR_ALIASES,
  CLYPRA_THEME_SOURCE_ALIASES,
} from "@/constants/colors";
import type { ClipPalette, FontFamily, Theme, UiTheme } from "./settingsTypes";

export const UI_THEME_IDS: UiTheme[] = [
  "dark",
  "midnight",
  "ocean",
  "forest",
  "midnight-carbon",
  "ember-studio",
  "forest-console",
  "slate-noir",
  "rose-cut",
];

export const CLIP_PALETTE_IDS: ClipPalette[] = [...UI_THEME_IDS];

export function isUiTheme(value: unknown): value is UiTheme {
  return typeof value === "string" && UI_THEME_IDS.includes(value as UiTheme);
}

export function isClipPalette(value: unknown): value is ClipPalette {
  return (
    typeof value === "string" && CLIP_PALETTE_IDS.includes(value as ClipPalette)
  );
}

// ─── Theme definitions ──────────────────────────────────────────────────────
// Each theme provides a complete set of CSS custom properties so that the
// entire editor UI updates consistently when switching.
const themes: Record<Exclude<Theme, "custom">, Record<string, string>> = {
  dark: {
    "--color-bg": "#0b0e12",
    "--color-surface": "#12171d",
    "--color-surface-raised": "#1a2028",
    "--color-surface-panel": "#0f141a",
    "--color-surface-floating": "#1c2530",
    "--color-border": "#27313b",
    "--color-border-soft": "#35414e",
    "--color-accent": "#5ab8d4",
    "--color-accent-soft": "#86cde0",
    "--color-text-primary": "#edf2f4",
    "--color-text-muted": "#788991",
    "--color-danger": "#e26061",
    // Guides & Indicators
    "--color-guide-center": "#ff3b30",
    "--color-snap-guide-clip": "#10b981",
    "--color-handle": "#ffffff",
    "--color-handle-border": "rgba(0, 0, 0, 0.25)",
    // Timeline-specific colors
    "--color-timeline-bg": "#0e141a",
    "--color-timeline-track-bg": "#0c1117",
    "--color-timeline-track-border": "#27313b",
    "--color-timeline-track-hover": "#182029",
    "--color-timeline-track-selected": "#1b2b35",
    "--color-timeline-track-active": "#1a303b",
    "--color-timeline-ruler-bg": "#121a22",
    "--color-timeline-ruler-tick-major": "#53636d",
    "--color-timeline-ruler-tick-minor": "#2d3a43",
    "--color-timeline-ruler-text": "#84949d",
    "--color-timeline-toolbar-border": "#27313b",
    "--color-timeline-toolbar-divider": "#35414e",
    "--color-timeline-button-hover": "#202c35",
    "--color-timeline-button-icon": "#9aabb4",
    "--color-timeline-track-label": "#a5b5bd",
    "--color-timeline-track-name": "#e3eaed",
    "--color-timeline-ghost-track-bg": "#0e141a",
    "--color-timeline-drop-indicator": "#5ab8d4",
    "--color-timeline-drop-zone-text": "#84949d",

    // shadcn compat
    "--background": "#0f0f0f",
    "--foreground": "#f0f0f0",
    "--card": "#1a1a1a",
    "--card-foreground": "#f0f0f0",
    "--popover": "#1a1a1a",
    "--popover-foreground": "#f0f0f0",
    "--primary": "#6c63ff",
    "--primary-foreground": "#ffffff",
    "--secondary": "#242424",
    "--secondary-foreground": "#f0f0f0",
    "--muted": "#242424",
    "--muted-foreground": "#666666",
    "--accent": "#6c63ff",
    "--accent-foreground": "#ffffff",
    "--destructive": "#e05252",
    "--border": "#2e2e2e",
    "--input": "#2e2e2e",
    "--ring": "#6c63ff",
  },
  midnight: {
    "--color-bg": "#0a0e1a",
    "--color-surface": "#131829",
    "--color-surface-raised": "#1a2138",
    "--color-surface-panel": "#10152b",
    "--color-surface-floating": "#1c2340",
    "--color-border": "#252d47",
    "--color-border-soft": "#303a58",
    "--color-accent": "#5b8fff",
    "--color-accent-soft": "#7aa5ff",
    "--color-text-primary": "#e8eef7",
    "--color-text-muted": "#5a6b8c",
    "--color-danger": "#e05252",
    // Guides & Indicators
    "--color-guide-center": "#ff3b30",
    "--color-snap-guide-clip": "#10b981",
    "--color-handle": "#e8eef7",
    "--color-handle-border": "rgba(0, 0, 0, 0.25)",
    // Timeline-specific colors (midnight theme)
    "--color-timeline-bg": "#0d1220",
    "--color-timeline-track-bg": "#0f1525",
    "--color-timeline-track-border": "#252d47",
    "--color-timeline-track-hover": "#1a2138",
    "--color-timeline-track-selected": "#1e2640",
    "--color-timeline-track-active": "#1c2440",
    "--color-timeline-ruler-bg": "#12182a",
    "--color-timeline-ruler-tick-major": "#4a5a7c",
    "--color-timeline-ruler-tick-minor": "#2c3550",
    "--color-timeline-ruler-text": "#5a6b8c",
    "--color-timeline-toolbar-border": "#252d47",
    "--color-timeline-toolbar-divider": "#303a58",
    "--color-timeline-button-hover": "#2a3550",
    "--color-timeline-button-icon": "#7a8aac",
    "--color-timeline-track-label": "#7a8aac",
    "--color-timeline-track-name": "#d6dce7",
    "--color-timeline-ghost-track-bg": "#0d1220",
    "--color-timeline-drop-indicator": "#5b8fff",
    "--color-timeline-drop-zone-text": "#5a6b8c",

    "--background": "#0a0e1a",
    "--foreground": "#e8eef7",
    "--card": "#131829",
    "--card-foreground": "#e8eef7",
    "--popover": "#131829",
    "--popover-foreground": "#e8eef7",
    "--primary": "#5b8fff",
    "--primary-foreground": "#ffffff",
    "--secondary": "#1a2138",
    "--secondary-foreground": "#e8eef7",
    "--muted": "#1a2138",
    "--muted-foreground": "#5a6b8c",
    "--accent": "#5b8fff",
    "--accent-foreground": "#ffffff",
    "--destructive": "#e05252",
    "--border": "#252d47",
    "--input": "#252d47",
    "--ring": "#5b8fff",
  },
  ocean: {
    "--color-bg": "#0a1520",
    "--color-surface": "#0f1f2e",
    "--color-surface-raised": "#16293d",
    "--color-surface-panel": "#0c1a28",
    "--color-surface-floating": "#183044",
    "--color-border": "#1e3548",
    "--color-border-soft": "#284055",
    "--color-accent": "#3db8d9", // Fixed: reduced from 100% to 65% saturation
    "--color-accent-soft": "#5fc9e3",
    "--color-text-primary": "#e0f2ff",
    "--color-text-muted": "#5a7a94",
    "--color-danger": "#e05252",
    // Guides & Indicators
    "--color-guide-center": "#ff3b30",
    "--color-snap-guide-clip": "#10b981",
    "--color-handle": "#e0f2ff",
    "--color-handle-border": "rgba(0, 0, 0, 0.25)",
    // Timeline-specific colors (ocean theme)
    "--color-timeline-bg": "#0c1a28",
    "--color-timeline-track-bg": "#0a1520",
    "--color-timeline-track-border": "#1e3548",
    "--color-timeline-track-hover": "#16293d",
    "--color-timeline-track-selected": "#1a2f45",
    "--color-timeline-track-active": "#183044",
    "--color-timeline-ruler-bg": "#0f1f2e",
    "--color-timeline-ruler-tick-major": "#3a5a74",
    "--color-timeline-ruler-tick-minor": "#254055",
    "--color-timeline-ruler-text": "#5a7a94",
    "--color-timeline-toolbar-border": "#1e3548",
    "--color-timeline-toolbar-divider": "#284055",
    "--color-timeline-button-hover": "#254055",
    "--color-timeline-button-icon": "#7a9ab4",
    "--color-timeline-track-label": "#7a9ab4",
    "--color-timeline-track-name": "#d0e8ff",
    "--color-timeline-ghost-track-bg": "#0c1a28",
    "--color-timeline-drop-indicator": "#3db8d9",
    "--color-timeline-drop-zone-text": "#5a7a94",

    "--background": "#0a1520",
    "--foreground": "#e0f2ff",
    "--card": "#0f1f2e",
    "--card-foreground": "#e0f2ff",
    "--popover": "#0f1f2e",
    "--popover-foreground": "#e0f2ff",
    "--primary": "#3db8d9",
    "--primary-foreground": "#0a1520",
    "--secondary": "#16293d",
    "--secondary-foreground": "#e0f2ff",
    "--muted": "#16293d",
    "--muted-foreground": "#5a7a94",
    "--accent": "#3db8d9",
    "--accent-foreground": "#0a1520",
    "--destructive": "#e05252",
    "--border": "#1e3548",
    "--input": "#1e3548",
    "--ring": "#3db8d9",
  },
  forest: {
    "--color-bg": "#0d1410",
    "--color-surface": "#141d18",
    "--color-surface-raised": "#1c2820",
    "--color-surface-panel": "#111a14",
    "--color-surface-floating": "#1f2e25",
    "--color-border": "#263329",
    "--color-border-soft": "#2f3e32",
    "--color-accent": "#52c882", // Fixed: reduced from 69% to 45% saturation
    "--color-accent-soft": "#72d99c",
    "--color-text-primary": "#e8f5e9",
    "--color-text-muted": "#5a7a5f",
    "--color-danger": "#e05252",
    // Guides & Indicators
    "--color-guide-center": "#ff3b30",
    "--color-snap-guide-clip": "#10b981",
    "--color-handle": "#e8f5e9",
    "--color-handle-border": "rgba(0, 0, 0, 0.25)",
    // Timeline-specific colors (forest theme)
    "--color-timeline-bg": "#111a14",
    "--color-timeline-track-bg": "#0d1410",
    "--color-timeline-track-border": "#263329",
    "--color-timeline-track-hover": "#1c2820",
    "--color-timeline-track-selected": "#1f2e25",
    "--color-timeline-track-active": "#1f2e25",
    "--color-timeline-ruler-bg": "#141d18",
    "--color-timeline-ruler-tick-major": "#3a5a3f",
    "--color-timeline-ruler-tick-minor": "#2a3e2f",
    "--color-timeline-ruler-text": "#5a7a5f",
    "--color-timeline-toolbar-border": "#263329",
    "--color-timeline-toolbar-divider": "#2f3e32",
    "--color-timeline-button-hover": "#2a3e2f",
    "--color-timeline-button-icon": "#7a9a7f",
    "--color-timeline-track-label": "#7a9a7f",
    "--color-timeline-track-name": "#d8edd9",
    "--color-timeline-ghost-track-bg": "#111a14",
    "--color-timeline-drop-indicator": "#52c882",
    "--color-timeline-drop-zone-text": "#5a7a5f",

    "--background": "#0d1410",
    "--foreground": "#e8f5e9",
    "--card": "#141d18",
    "--card-foreground": "#e8f5e9",
    "--popover": "#141d18",
    "--popover-foreground": "#e8f5e9",
    "--primary": "#52c882",
    "--primary-foreground": "#0d1410",
    "--secondary": "#1c2820",
    "--secondary-foreground": "#e8f5e9",
    "--muted": "#1c2820",
    "--muted-foreground": "#5a7a5f",
    "--accent": "#52c882",
    "--accent-foreground": "#0d1410",
    "--destructive": "#e05252",
    "--border": "#263329",
    "--input": "#263329",
    "--ring": "#52c882",
  },
  "midnight-carbon": {
    "--color-bg": "#1d262e",
    "--color-surface": "#28323c",
    "--color-surface-raised": "#323d48",
    "--color-surface-panel": "#242d36",
    "--color-surface-floating": "#3a4551",
    "--color-border": "#404b57",
    "--color-border-soft": "#4a5663",
    "--color-accent": "#5db6d6",
    "--color-accent-soft": "#7dc6e1",
    "--color-text-primary": "#e9ebed",
    "--color-text-muted": "#7a8694",
    "--color-danger": "#e05252",
    // Guides & Indicators
    "--color-guide-center": "#ff3b30",
    "--color-snap-guide-clip": "#10b981",
    "--color-handle": "#e9ebed",
    "--color-handle-border": "rgba(0, 0, 0, 0.25)",
    // Timeline-specific colors (midnight-carbon theme)
    "--color-timeline-bg": "#202931",
    "--color-timeline-track-bg": "#1e2730",
    "--color-timeline-track-border": "#404b57",
    "--color-timeline-track-hover": "#2c3641",
    "--color-timeline-track-selected": "#303944",
    "--color-timeline-track-active": "#2e3842",
    "--color-timeline-ruler-bg": "#252f39",
    "--color-timeline-ruler-tick-major": "#5a6775",
    "--color-timeline-ruler-tick-minor": "#424d5a",
    "--color-timeline-ruler-text": "#7a8694",
    "--color-timeline-toolbar-border": "#404b57",
    "--color-timeline-toolbar-divider": "#4a5663",
    "--color-timeline-button-hover": "#424d5a",
    "--color-timeline-button-icon": "#98a3b0",
    "--color-timeline-track-label": "#98a3b0",
    "--color-timeline-track-name": "#e0e4e8",
    "--color-timeline-ghost-track-bg": "#202931",
    "--color-timeline-drop-indicator": "#5db6d6",
    "--color-timeline-drop-zone-text": "#7a8694",

    "--background": "#1d262e",
    "--foreground": "#e9ebed",
    "--card": "#28323c",
    "--card-foreground": "#e9ebed",
    "--popover": "#28323c",
    "--popover-foreground": "#e9ebed",
    "--primary": "#5db6d6",
    "--primary-foreground": "#ffffff",
    "--secondary": "#323d48",
    "--secondary-foreground": "#e9ebed",
    "--muted": "#323d48",
    "--muted-foreground": "#7a8694",
    "--accent": "#5db6d6",
    "--accent-foreground": "#ffffff",
    "--destructive": "#e05252",
    "--border": "#404b57",
    "--input": "#404b57",
    "--ring": "#5db6d6",
  },
  "ember-studio": {
    "--color-bg": "#1f1814",
    "--color-surface": "#2a211c",
    "--color-surface-raised": "#342b24",
    "--color-surface-panel": "#241d18",
    "--color-surface-floating": "#3c322a",
    "--color-border": "#453a30",
    "--color-border-soft": "#514539",
    "--color-accent": "#d98a50",
    "--color-accent-soft": "#e3a06e",
    "--color-text-primary": "#e6e0da",
    "--color-text-muted": "#8a7665",
    "--color-danger": "#e05252",
    // Guides & Indicators
    "--color-guide-center": "#ff3b30",
    "--color-snap-guide-clip": "#10b981",
    "--color-handle": "#e6e0da",
    "--color-handle-border": "rgba(0, 0, 0, 0.25)",
    // Timeline-specific colors (ember-studio theme)
    "--color-timeline-bg": "#231d18",
    "--color-timeline-track-bg": "#201a15",
    "--color-timeline-track-border": "#453a30",
    "--color-timeline-track-hover": "#2f2720",
    "--color-timeline-track-selected": "#342c24",
    "--color-timeline-track-active": "#322a22",
    "--color-timeline-ruler-bg": "#27211c",
    "--color-timeline-ruler-tick-major": "#5d5045",
    "--color-timeline-ruler-tick-minor": "#493e34",
    "--color-timeline-ruler-text": "#8a7665",
    "--color-timeline-toolbar-border": "#453a30",
    "--color-timeline-toolbar-divider": "#514539",
    "--color-timeline-button-hover": "#493e34",
    "--color-timeline-button-icon": "#a3927f",
    "--color-timeline-track-label": "#a3927f",
    "--color-timeline-track-name": "#ddd7d1",
    "--color-timeline-ghost-track-bg": "#231d18",
    "--color-timeline-drop-indicator": "#d98a50",
    "--color-timeline-drop-zone-text": "#8a7665",

    "--background": "#1f1814",
    "--foreground": "#e6e0da",
    "--card": "#2a211c",
    "--card-foreground": "#e6e0da",
    "--popover": "#2a211c",
    "--popover-foreground": "#e6e0da",
    "--primary": "#d98a50",
    "--primary-foreground": "#ffffff",
    "--secondary": "#342b24",
    "--secondary-foreground": "#e6e0da",
    "--muted": "#342b24",
    "--muted-foreground": "#8a7665",
    "--accent": "#d98a50",
    "--accent-foreground": "#ffffff",
    "--destructive": "#e05252",
    "--border": "#453a30",
    "--input": "#453a30",
    "--ring": "#d98a50",
  },
  "forest-console": {
    "--color-bg": "#181f19",
    "--color-surface": "#212a23",
    "--color-surface-raised": "#2a342c",
    "--color-surface-panel": "#1d241f",
    "--color-surface-floating": "#323c34",
    "--color-border": "#3a443b",
    "--color-border-soft": "#434f45",
    "--color-accent": "#6ebf8b",
    "--color-accent-soft": "#88d0a0",
    "--color-text-primary": "#e0e6e2",
    "--color-text-muted": "#6e826f",
    "--color-danger": "#e05252",
    // Guides & Indicators
    "--color-guide-center": "#ff3b30",
    "--color-snap-guide-clip": "#10b981",
    "--color-handle": "#e0e6e2",
    "--color-handle-border": "rgba(0, 0, 0, 0.25)",
    // Timeline-specific colors (forest-console theme)
    "--color-timeline-bg": "#1c241e",
    "--color-timeline-track-bg": "#192019",
    "--color-timeline-track-border": "#3a443b",
    "--color-timeline-track-hover": "#272f29",
    "--color-timeline-track-selected": "#2c352e",
    "--color-timeline-track-active": "#2a332c",
    "--color-timeline-ruler-bg": "#1f2821",
    "--color-timeline-ruler-tick-major": "#52605a",
    "--color-timeline-ruler-tick-minor": "#3f4a44",
    "--color-timeline-ruler-text": "#6e826f",
    "--color-timeline-toolbar-border": "#3a443b",
    "--color-timeline-toolbar-divider": "#434f45",
    "--color-timeline-button-hover": "#3f4a44",
    "--color-timeline-button-icon": "#8c9e8e",
    "--color-timeline-track-label": "#8c9e8e",
    "--color-timeline-track-name": "#d6dcd9",
    "--color-timeline-ghost-track-bg": "#1c241e",
    "--color-timeline-drop-indicator": "#6ebf8b",
    "--color-timeline-drop-zone-text": "#6e826f",

    "--background": "#181f19",
    "--foreground": "#e0e6e2",
    "--card": "#212a23",
    "--card-foreground": "#e0e6e2",
    "--popover": "#212a23",
    "--popover-foreground": "#e0e6e2",
    "--primary": "#6ebf8b",
    "--primary-foreground": "#ffffff",
    "--secondary": "#2a342c",
    "--secondary-foreground": "#e0e6e2",
    "--muted": "#2a342c",
    "--muted-foreground": "#6e826f",
    "--accent": "#6ebf8b",
    "--accent-foreground": "#ffffff",
    "--destructive": "#e05252",
    "--border": "#3a443b",
    "--input": "#3a443b",
    "--ring": "#6ebf8b",
  },
  "slate-noir": {
    "--color-bg": "#1f2226",
    "--color-surface": "#292d32",
    "--color-surface-raised": "#33383e",
    "--color-surface-panel": "#24282c",
    "--color-surface-floating": "#3b4148",
    "--color-border": "#424851",
    "--color-border-soft": "#4d545d",
    "--color-accent": "#6ba9c4",
    "--color-accent-soft": "#87bcd4",
    "--color-text-primary": "#e6e6e7",
    "--color-text-muted": "#767b82",
    "--color-danger": "#e05252",
    // Guides & Indicators
    "--color-guide-center": "#ff3b30",
    "--color-snap-guide-clip": "#10b981",
    "--color-handle": "#e6e6e7",
    "--color-handle-border": "rgba(0, 0, 0, 0.25)",
    // Timeline-specific colors (slate-noir theme)
    "--color-timeline-bg": "#22262a",
    "--color-timeline-track-bg": "#1f2226",
    "--color-timeline-track-border": "#424851",
    "--color-timeline-track-hover": "#2e3338",
    "--color-timeline-track-selected": "#33383e",
    "--color-timeline-track-active": "#31363c",
    "--color-timeline-ruler-bg": "#262b30",
    "--color-timeline-ruler-tick-major": "#5a6068",
    "--color-timeline-ruler-tick-minor": "#444a52",
    "--color-timeline-ruler-text": "#767b82",
    "--color-timeline-toolbar-border": "#424851",
    "--color-timeline-toolbar-divider": "#4d545d",
    "--color-timeline-button-hover": "#444a52",
    "--color-timeline-button-icon": "#95989e",
    "--color-timeline-track-label": "#95989e",
    "--color-timeline-track-name": "#dcdcdd",
    "--color-timeline-ghost-track-bg": "#22262a",
    "--color-timeline-drop-indicator": "#6ba9c4",
    "--color-timeline-drop-zone-text": "#767b82",

    "--background": "#1f2226",
    "--foreground": "#e6e6e7",
    "--card": "#292d32",
    "--card-foreground": "#e6e6e7",
    "--popover": "#292d32",
    "--popover-foreground": "#e6e6e7",
    "--primary": "#6ba9c4",
    "--primary-foreground": "#ffffff",
    "--secondary": "#33383e",
    "--secondary-foreground": "#e6e6e7",
    "--muted": "#33383e",
    "--muted-foreground": "#767b82",
    "--accent": "#6ba9c4",
    "--accent-foreground": "#ffffff",
    "--destructive": "#e05252",
    "--border": "#424851",
    "--input": "#424851",
    "--ring": "#6ba9c4",
  },
  "rose-cut": {
    "--color-bg": "#1f181c",
    "--color-surface": "#2a2125",
    "--color-surface-raised": "#342a2f",
    "--color-surface-panel": "#241d21",
    "--color-surface-floating": "#3c3237",
    "--color-border": "#44393e",
    "--color-border-soft": "#4f444a",
    "--color-accent": "#d97097",
    "--color-accent-soft": "#e58aac",
    "--color-text-primary": "#e3e0e1",
    "--color-text-muted": "#847478",
    "--color-danger": "#e05252",
    // Guides & Indicators
    "--color-guide-center": "#ff3b30",
    "--color-snap-guide-clip": "#10b981",
    "--color-handle": "#e3e0e1",
    "--color-handle-border": "rgba(0, 0, 0, 0.25)",
    // Timeline-specific colors (rose-cut theme)
    "--color-timeline-bg": "#231c20",
    "--color-timeline-track-bg": "#201921",
    "--color-timeline-track-border": "#44393e",
    "--color-timeline-track-hover": "#2f2629",
    "--color-timeline-track-selected": "#342b2f",
    "--color-timeline-track-active": "#32292d",
    "--color-timeline-ruler-bg": "#272024",
    "--color-timeline-ruler-tick-major": "#5d5156",
    "--color-timeline-ruler-tick-minor": "#483d42",
    "--color-timeline-ruler-text": "#847478",
    "--color-timeline-toolbar-border": "#44393e",
    "--color-timeline-toolbar-divider": "#4f444a",
    "--color-timeline-button-hover": "#483d42",
    "--color-timeline-button-icon": "#a08f94",
    "--color-timeline-track-label": "#a08f94",
    "--color-timeline-track-name": "#dbd7d8",
    "--color-timeline-ghost-track-bg": "#231c20",
    "--color-timeline-drop-indicator": "#d97097",
    "--color-timeline-drop-zone-text": "#847478",

    "--background": "#1f181c",
    "--foreground": "#e3e0e1",
    "--card": "#2a2125",
    "--card-foreground": "#e3e0e1",
    "--popover": "#2a2125",
    "--popover-foreground": "#e3e0e1",
    "--primary": "#d97097",
    "--primary-foreground": "#ffffff",
    "--secondary": "#342a2f",
    "--secondary-foreground": "#e3e0e1",
    "--muted": "#342a2f",
    "--muted-foreground": "#847478",
    "--accent": "#d97097",
    "--accent-foreground": "#ffffff",
    "--destructive": "#e05252",
    "--border": "#44393e",
    "--input": "#44393e",
    "--ring": "#d97097",
  },
};

// ─── Independent theme registries ──────────────────────────────────────────
// UI themes own the application chrome and timeline structure. Clip palettes
// own only clip/fill/waveform colours. The runtime always composes one UI
// registry entry with one clip registry entry; no theme can overwrite the
// other layer's roles.
export const CLIP_PALETTE_TOKEN_KEYS = [
  "--color-timeline-clip-video",
  "--color-timeline-clip-video-border",
  "--color-timeline-clip-invalid",
  "--color-timeline-clip-audio",
  "--color-timeline-clip-audio-border",
  "--color-timeline-clip-image",
  "--color-timeline-clip-text",
  "--color-timeline-clip-caption",
  "--color-timeline-clip-title",
  "--color-timeline-clip-effect",
  "--color-timeline-clip-compound",
  "--color-timeline-clip-sticker",
  "--color-timeline-clip-fg",
  "--color-timeline-clip-muted-fg",
  "--color-timeline-clip-audio-wave",
  "--color-timeline-clip-envelope-fill",
  "--color-timeline-clip-envelope-line",
  "--color-timeline-clip-duration",
  "--color-timeline-filmstrip-bg",
  "--color-timeline-filmstrip-empty",
  "--color-timeline-filmstrip-border",
  "--color-timeline-filmstrip-overlay",
  "--color-timeline-filmstrip-overlay-soft",
  "--color-timeline-clip-badge-bg",
  "--color-timeline-clip-metadata-bg",
  "--color-timeline-clip-metadata-border",
  "--color-timeline-clip-waveform-bg",
  "--color-timeline-clip-waveform-border",
  "--color-timeline-clip-control-bg",
  "--color-timeline-clip-control-border",
  "--color-timeline-clip-control-shadow",
  "--color-timeline-clip-keyframe-bg",
  "--color-timeline-clip-keyframe-border",
  "--color-timeline-clip-keyframe-shadow",
  "--color-timeline-clip-volume-line",
  "--color-timeline-clip-volume-shadow",
  "--color-timeline-clip-tooltip-bg",
  "--color-timeline-clip-tooltip-border",
  "--color-timeline-clip-tooltip-text",
  "--color-timeline-clip-drag-shadow",
  "--color-timeline-clip-drag-border",
] as const;

export type ClipPaletteToken = (typeof CLIP_PALETTE_TOKEN_KEYS)[number];
export type ClipPaletteTokens = Record<ClipPaletteToken, string>;

const CLIP_TOKEN_KEYS = new Set([
  ...CLIP_PALETTE_TOKEN_KEYS,
  // Strip the removed names from custom/v1 theme objects during migration.
  "--color-video-clip",
  "--color-audio-clip",
  "--color-text-clip",
]);

function withoutClipTokens(colors: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(colors).filter(
      ([property]) => !CLIP_TOKEN_KEYS.has(property),
    ),
  );
}

/** Canonical UI chrome registry. */
export const UI_THEMES: Record<
  UiTheme,
  Record<string, string>
> = Object.fromEntries(
  UI_THEME_IDS.map((theme) => [theme, withoutClipTokens(themes[theme])]),
) as Record<UiTheme, Record<string, string>>;

/**
 * Canonical clip palette registry — one entry per UI theme.
 *
 * To change a clip colour for a theme, edit the matching block below.
 * Every role consumed by a clip component is declared in
 * CLIP_PALETTE_TOKEN_KEYS and must be supplied by every palette below. The
 * old --color-video-clip / --color-audio-clip / --color-text-clip aliases are
 * intentionally not palette entries; they are runtime aliases only.
 */
export const CLIP_PALETTES: Record<ClipPalette, ClipPaletteTokens> = {
  /** Dark — graphite navy video, deep green audio */
  dark: {
    "--color-timeline-clip-video": "#173745",
    "--color-timeline-clip-video-border": "rgba(90, 184, 212, 0.46)",
    "--color-timeline-clip-invalid": "#e26061",
    "--color-timeline-clip-audio": "#16382f",
    "--color-timeline-clip-audio-border": "rgba(79, 189, 138, 0.48)",
    "--color-timeline-clip-text": "#e1eef1",
    "--color-timeline-clip-duration": "#b8d2da",
    "--color-timeline-filmstrip-bg": "rgba(14, 39, 48, 0.42)",
    "--color-timeline-filmstrip-empty": "rgba(14, 39, 48, 0.62)",
    "--color-timeline-filmstrip-border": "rgba(0, 0, 0, 0.2)",
    "--color-timeline-clip-image": "#173745",
    "--color-timeline-clip-caption": "#5b3b2e",
    "--color-timeline-clip-title": "#173745",
    "--color-timeline-clip-effect": "#5b3b2e",
    "--color-timeline-clip-compound": "#173745",
    "--color-timeline-clip-sticker": "#5b3b2e",
    "--color-timeline-clip-fg": "#f7e7df",
    "--color-timeline-clip-muted-fg": "#b8d2da",
    "--color-timeline-clip-audio-wave": "#b8d2da",
    "--color-timeline-clip-envelope-fill": "rgba(14, 39, 48, 0.95)",
    "--color-timeline-clip-envelope-line": "rgba(184, 210, 218, 0.72)",
    "--color-timeline-filmstrip-overlay": "rgba(0, 0, 0, 0.10)",
    "--color-timeline-filmstrip-overlay-soft": "rgba(0, 0, 0, 0.08)",
    "--color-timeline-clip-badge-bg": "rgba(0, 0, 0, 0.30)",
    "--color-timeline-clip-metadata-bg": "rgba(14, 39, 48, 0.42)",
    "--color-timeline-clip-metadata-border": "rgba(90, 184, 212, 0.46)",
    "--color-timeline-clip-waveform-bg": "rgba(22, 56, 47, 0.35)",
    "--color-timeline-clip-waveform-border": "rgba(79, 189, 138, 0.48)",
    "--color-timeline-clip-control-bg": "#f7e7df",
    "--color-timeline-clip-control-border": "#173745",
    "--color-timeline-clip-control-shadow": "0 1px 3px rgba(0, 0, 0, 0.75)",
    "--color-timeline-clip-keyframe-bg": "#287a5c",
    "--color-timeline-clip-keyframe-border": "#f7e7df",
    "--color-timeline-clip-keyframe-shadow": "0 1px 3px rgba(0, 0, 0, 0.55)",
    "--color-timeline-clip-volume-line": "#f7e7df",
    "--color-timeline-clip-volume-shadow": "0 0 3px rgba(247, 231, 223, 0.35)",
    "--color-timeline-clip-tooltip-bg": "rgba(14, 39, 48, 0.62)",
    "--color-timeline-clip-tooltip-border": "rgba(79, 189, 138, 0.48)",
    "--color-timeline-clip-tooltip-text": "#b8d2da",
    "--color-timeline-clip-drag-shadow": "0 8px 32px rgba(0, 0, 0, 0.60)",
    "--color-timeline-clip-drag-border": "rgba(247, 231, 223, 0.20)",
  },

  /** Midnight — deep indigo video, teal audio */
  midnight: {
    "--color-timeline-clip-video": "#1e2a50",
    "--color-timeline-clip-video-border": "rgba(91, 143, 255, 0.4)",
    "--color-timeline-clip-invalid": "#ef4444",
    "--color-timeline-clip-audio": "#152e30",
    "--color-timeline-clip-audio-border": "rgba(80, 200, 160, 0.45)",
    "--color-timeline-clip-text": "#d8e0f1",
    "--color-timeline-clip-duration": "#b9c8e6",
    "--color-timeline-filmstrip-bg": "rgba(16, 21, 37, 0.4)",
    "--color-timeline-filmstrip-empty": "rgba(16, 21, 37, 0.6)",
    "--color-timeline-filmstrip-border": "rgba(0, 0, 0, 0.2)",
    "--color-timeline-clip-image": "#1e2a50",
    "--color-timeline-clip-caption": "#2e3550",
    "--color-timeline-clip-title": "#1e2a50",
    "--color-timeline-clip-effect": "#2e3550",
    "--color-timeline-clip-compound": "#1e2a50",
    "--color-timeline-clip-sticker": "#2e3550",
    "--color-timeline-clip-fg": "#dde6ff",
    "--color-timeline-clip-muted-fg": "#b9c8e6",
    "--color-timeline-clip-audio-wave": "#b9c8e6",
    "--color-timeline-clip-envelope-fill": "rgba(16, 21, 37, 0.95)",
    "--color-timeline-clip-envelope-line": "rgba(185, 200, 230, 0.72)",
    "--color-timeline-filmstrip-overlay": "rgba(0, 0, 0, 0.10)",
    "--color-timeline-filmstrip-overlay-soft": "rgba(0, 0, 0, 0.08)",
    "--color-timeline-clip-badge-bg": "rgba(0, 0, 0, 0.30)",
    "--color-timeline-clip-metadata-bg": "rgba(16, 21, 37, 0.40)",
    "--color-timeline-clip-metadata-border": "rgba(91, 143, 255, 0.40)",
    "--color-timeline-clip-waveform-bg": "rgba(21, 46, 48, 0.35)",
    "--color-timeline-clip-waveform-border": "rgba(80, 200, 160, 0.45)",
    "--color-timeline-clip-control-bg": "#dde6ff",
    "--color-timeline-clip-control-border": "#1e2a50",
    "--color-timeline-clip-control-shadow": "0 1px 3px rgba(0, 0, 0, 0.75)",
    "--color-timeline-clip-keyframe-bg": "#1a7a5a",
    "--color-timeline-clip-keyframe-border": "#dde6ff",
    "--color-timeline-clip-keyframe-shadow": "0 1px 3px rgba(0, 0, 0, 0.55)",
    "--color-timeline-clip-volume-line": "#dde6ff",
    "--color-timeline-clip-volume-shadow": "0 0 3px rgba(221, 230, 255, 0.35)",
    "--color-timeline-clip-tooltip-bg": "rgba(16, 21, 37, 0.60)",
    "--color-timeline-clip-tooltip-border": "rgba(80, 200, 160, 0.45)",
    "--color-timeline-clip-tooltip-text": "#b9c8e6",
    "--color-timeline-clip-drag-shadow": "0 8px 32px rgba(0, 0, 0, 0.60)",
    "--color-timeline-clip-drag-border": "rgba(221, 230, 255, 0.20)",
  },

  /** Ocean — deep teal video, cyan-green audio */
  ocean: {
    "--color-timeline-clip-video": "#0f2a3d",
    "--color-timeline-clip-video-border": "rgba(61, 184, 217, 0.42)",
    "--color-timeline-clip-invalid": "#ef4444",
    "--color-timeline-clip-audio": "#0f2a20",
    "--color-timeline-clip-audio-border": "rgba(61, 184, 140, 0.45)",
    "--color-timeline-clip-text": "#d0e8ff",
    "--color-timeline-clip-duration": "#b0d8f0",
    "--color-timeline-filmstrip-bg": "rgba(12, 26, 40, 0.42)",
    "--color-timeline-filmstrip-empty": "rgba(12, 26, 40, 0.62)",
    "--color-timeline-filmstrip-border": "rgba(0, 0, 0, 0.2)",
    "--color-timeline-clip-image": "#0f2a3d",
    "--color-timeline-clip-caption": "#0c2535",
    "--color-timeline-clip-title": "#0f2a3d",
    "--color-timeline-clip-effect": "#0c2535",
    "--color-timeline-clip-compound": "#0f2a3d",
    "--color-timeline-clip-sticker": "#0c2535",
    "--color-timeline-clip-fg": "#d0e8ff",
    "--color-timeline-clip-muted-fg": "#b0d8f0",
    "--color-timeline-clip-audio-wave": "#b0d8f0",
    "--color-timeline-clip-envelope-fill": "rgba(12, 26, 40, 0.95)",
    "--color-timeline-clip-envelope-line": "rgba(176, 216, 240, 0.72)",
    "--color-timeline-filmstrip-overlay": "rgba(0, 0, 0, 0.10)",
    "--color-timeline-filmstrip-overlay-soft": "rgba(0, 0, 0, 0.08)",
    "--color-timeline-clip-badge-bg": "rgba(0, 0, 0, 0.30)",
    "--color-timeline-clip-metadata-bg": "rgba(12, 26, 40, 0.42)",
    "--color-timeline-clip-metadata-border": "rgba(61, 184, 217, 0.42)",
    "--color-timeline-clip-waveform-bg": "rgba(15, 42, 32, 0.35)",
    "--color-timeline-clip-waveform-border": "rgba(61, 184, 140, 0.45)",
    "--color-timeline-clip-control-bg": "#d0e8ff",
    "--color-timeline-clip-control-border": "#0f2a3d",
    "--color-timeline-clip-control-shadow": "0 1px 3px rgba(0, 0, 0, 0.75)",
    "--color-timeline-clip-keyframe-bg": "#1a8060",
    "--color-timeline-clip-keyframe-border": "#d0e8ff",
    "--color-timeline-clip-keyframe-shadow": "0 1px 3px rgba(0, 0, 0, 0.55)",
    "--color-timeline-clip-volume-line": "#d0e8ff",
    "--color-timeline-clip-volume-shadow": "0 0 3px rgba(208, 232, 255, 0.35)",
    "--color-timeline-clip-tooltip-bg": "rgba(12, 26, 40, 0.62)",
    "--color-timeline-clip-tooltip-border": "rgba(61, 184, 140, 0.45)",
    "--color-timeline-clip-tooltip-text": "#b0d8f0",
    "--color-timeline-clip-drag-shadow": "0 8px 32px rgba(0, 0, 0, 0.60)",
    "--color-timeline-clip-drag-border": "rgba(208, 232, 255, 0.20)",
  },

  /** Forest — rich green video, olive-yellow audio */
  forest: {
    "--color-timeline-clip-video": "#1a2e1e",
    "--color-timeline-clip-video-border": "rgba(82, 200, 130, 0.42)",
    "--color-timeline-clip-invalid": "#ef4444",
    "--color-timeline-clip-audio": "#2a2a12",
    "--color-timeline-clip-audio-border": "rgba(180, 170, 60, 0.45)",
    "--color-timeline-clip-text": "#d8edd9",
    "--color-timeline-clip-duration": "#b8ddb9",
    "--color-timeline-filmstrip-bg": "rgba(17, 26, 20, 0.42)",
    "--color-timeline-filmstrip-empty": "rgba(17, 26, 20, 0.62)",
    "--color-timeline-filmstrip-border": "rgba(0, 0, 0, 0.2)",
    "--color-timeline-clip-image": "#1a2e1e",
    "--color-timeline-clip-caption": "#2a3820",
    "--color-timeline-clip-title": "#1a2e1e",
    "--color-timeline-clip-effect": "#2a3820",
    "--color-timeline-clip-compound": "#1a2e1e",
    "--color-timeline-clip-sticker": "#2a3820",
    "--color-timeline-clip-fg": "#d8edd9",
    "--color-timeline-clip-muted-fg": "#b8ddb9",
    "--color-timeline-clip-audio-wave": "#b8ddb9",
    "--color-timeline-clip-envelope-fill": "rgba(17, 26, 20, 0.95)",
    "--color-timeline-clip-envelope-line": "rgba(184, 221, 185, 0.72)",
    "--color-timeline-filmstrip-overlay": "rgba(0, 0, 0, 0.10)",
    "--color-timeline-filmstrip-overlay-soft": "rgba(0, 0, 0, 0.08)",
    "--color-timeline-clip-badge-bg": "rgba(0, 0, 0, 0.30)",
    "--color-timeline-clip-metadata-bg": "rgba(17, 26, 20, 0.42)",
    "--color-timeline-clip-metadata-border": "rgba(82, 200, 130, 0.42)",
    "--color-timeline-clip-waveform-bg": "rgba(42, 42, 18, 0.35)",
    "--color-timeline-clip-waveform-border": "rgba(180, 170, 60, 0.45)",
    "--color-timeline-clip-control-bg": "#d8edd9",
    "--color-timeline-clip-control-border": "#1a2e1e",
    "--color-timeline-clip-control-shadow": "0 1px 3px rgba(0, 0, 0, 0.75)",
    "--color-timeline-clip-keyframe-bg": "#6b7a18",
    "--color-timeline-clip-keyframe-border": "#d8edd9",
    "--color-timeline-clip-keyframe-shadow": "0 1px 3px rgba(0, 0, 0, 0.55)",
    "--color-timeline-clip-volume-line": "#d8edd9",
    "--color-timeline-clip-volume-shadow": "0 0 3px rgba(216, 237, 217, 0.35)",
    "--color-timeline-clip-tooltip-bg": "rgba(17, 26, 20, 0.62)",
    "--color-timeline-clip-tooltip-border": "rgba(180, 170, 60, 0.45)",
    "--color-timeline-clip-tooltip-text": "#b8ddb9",
    "--color-timeline-clip-drag-shadow": "0 8px 32px rgba(0, 0, 0, 0.60)",
    "--color-timeline-clip-drag-border": "rgba(216, 237, 217, 0.20)",
  },

  /** Midnight Carbon — steel teal video, sage green audio */
  "midnight-carbon": {
    "--color-timeline-clip-video": "#2d4851",
    "--color-timeline-clip-video-border": "rgba(93, 182, 214, 0.42)",
    "--color-timeline-clip-invalid": "#ef4444",
    "--color-timeline-clip-audio": "#2a3a28",
    "--color-timeline-clip-audio-border": "rgba(100, 190, 120, 0.45)",
    "--color-timeline-clip-text": "#dce8ed",
    "--color-timeline-clip-duration": "#c0d5de",
    "--color-timeline-filmstrip-bg": "rgba(32, 41, 49, 0.42)",
    "--color-timeline-filmstrip-empty": "rgba(32, 41, 49, 0.62)",
    "--color-timeline-filmstrip-border": "rgba(0, 0, 0, 0.2)",
    "--color-timeline-clip-image": "#2d4851",
    "--color-timeline-clip-caption": "#253e48",
    "--color-timeline-clip-title": "#2d4851",
    "--color-timeline-clip-effect": "#253e48",
    "--color-timeline-clip-compound": "#2d4851",
    "--color-timeline-clip-sticker": "#253e48",
    "--color-timeline-clip-fg": "#dce8ed",
    "--color-timeline-clip-muted-fg": "#c0d5de",
    "--color-timeline-clip-audio-wave": "#c0d5de",
    "--color-timeline-clip-envelope-fill": "rgba(32, 41, 49, 0.95)",
    "--color-timeline-clip-envelope-line": "rgba(192, 213, 222, 0.72)",
    "--color-timeline-filmstrip-overlay": "rgba(0, 0, 0, 0.10)",
    "--color-timeline-filmstrip-overlay-soft": "rgba(0, 0, 0, 0.08)",
    "--color-timeline-clip-badge-bg": "rgba(0, 0, 0, 0.30)",
    "--color-timeline-clip-metadata-bg": "rgba(32, 41, 49, 0.42)",
    "--color-timeline-clip-metadata-border": "rgba(93, 182, 214, 0.42)",
    "--color-timeline-clip-waveform-bg": "rgba(42, 58, 40, 0.35)",
    "--color-timeline-clip-waveform-border": "rgba(100, 190, 120, 0.45)",
    "--color-timeline-clip-control-bg": "#dce8ed",
    "--color-timeline-clip-control-border": "#2d4851",
    "--color-timeline-clip-control-shadow": "0 1px 3px rgba(0, 0, 0, 0.75)",
    "--color-timeline-clip-keyframe-bg": "#2a7a50",
    "--color-timeline-clip-keyframe-border": "#dce8ed",
    "--color-timeline-clip-keyframe-shadow": "0 1px 3px rgba(0, 0, 0, 0.55)",
    "--color-timeline-clip-volume-line": "#dce8ed",
    "--color-timeline-clip-volume-shadow": "0 0 3px rgba(220, 232, 237, 0.35)",
    "--color-timeline-clip-tooltip-bg": "rgba(32, 41, 49, 0.62)",
    "--color-timeline-clip-tooltip-border": "rgba(100, 190, 120, 0.45)",
    "--color-timeline-clip-tooltip-text": "#c0d5de",
    "--color-timeline-clip-drag-shadow": "0 8px 32px rgba(0, 0, 0, 0.60)",
    "--color-timeline-clip-drag-border": "rgba(220, 232, 237, 0.20)",
  },

  /** Ember Studio — amber video, warm teal audio */
  "ember-studio": {
    "--color-timeline-clip-video": "#3f3120",
    "--color-timeline-clip-video-border": "rgba(217, 138, 80, 0.42)",
    "--color-timeline-clip-invalid": "#ef4444",
    "--color-timeline-clip-audio": "#1e2e28",
    "--color-timeline-clip-audio-border": "rgba(80, 180, 140, 0.45)",
    "--color-timeline-clip-text": "#ebe4da",
    "--color-timeline-clip-duration": "#d9cbb9",
    "--color-timeline-filmstrip-bg": "rgba(35, 29, 24, 0.42)",
    "--color-timeline-filmstrip-empty": "rgba(35, 29, 24, 0.62)",
    "--color-timeline-filmstrip-border": "rgba(0, 0, 0, 0.2)",
    "--color-timeline-clip-image": "#3f3120",
    "--color-timeline-clip-caption": "#3d2915",
    "--color-timeline-clip-title": "#3f3120",
    "--color-timeline-clip-effect": "#3d2915",
    "--color-timeline-clip-compound": "#3f3120",
    "--color-timeline-clip-sticker": "#3d2915",
    "--color-timeline-clip-fg": "#ebe4da",
    "--color-timeline-clip-muted-fg": "#d9cbb9",
    "--color-timeline-clip-audio-wave": "#d9cbb9",
    "--color-timeline-clip-envelope-fill": "rgba(35, 29, 24, 0.95)",
    "--color-timeline-clip-envelope-line": "rgba(217, 203, 185, 0.72)",
    "--color-timeline-filmstrip-overlay": "rgba(0, 0, 0, 0.10)",
    "--color-timeline-filmstrip-overlay-soft": "rgba(0, 0, 0, 0.08)",
    "--color-timeline-clip-badge-bg": "rgba(0, 0, 0, 0.30)",
    "--color-timeline-clip-metadata-bg": "rgba(35, 29, 24, 0.42)",
    "--color-timeline-clip-metadata-border": "rgba(217, 138, 80, 0.42)",
    "--color-timeline-clip-waveform-bg": "rgba(30, 46, 40, 0.35)",
    "--color-timeline-clip-waveform-border": "rgba(80, 180, 140, 0.45)",
    "--color-timeline-clip-control-bg": "#ebe4da",
    "--color-timeline-clip-control-border": "#3f3120",
    "--color-timeline-clip-control-shadow": "0 1px 3px rgba(0, 0, 0, 0.75)",
    "--color-timeline-clip-keyframe-bg": "#1a6e50",
    "--color-timeline-clip-keyframe-border": "#ebe4da",
    "--color-timeline-clip-keyframe-shadow": "0 1px 3px rgba(0, 0, 0, 0.55)",
    "--color-timeline-clip-volume-line": "#ebe4da",
    "--color-timeline-clip-volume-shadow": "0 0 3px rgba(235, 228, 218, 0.35)",
    "--color-timeline-clip-tooltip-bg": "rgba(35, 29, 24, 0.62)",
    "--color-timeline-clip-tooltip-border": "rgba(80, 180, 140, 0.45)",
    "--color-timeline-clip-tooltip-text": "#d9cbb9",
    "--color-timeline-clip-drag-shadow": "0 8px 32px rgba(0, 0, 0, 0.60)",
    "--color-timeline-clip-drag-border": "rgba(235, 228, 218, 0.20)",
  },

  /** Forest Console — dark green video, yellow-olive audio */
  "forest-console": {
    "--color-timeline-clip-video": "#2d4236",
    "--color-timeline-clip-video-border": "rgba(110, 191, 139, 0.42)",
    "--color-timeline-clip-invalid": "#ef4444",
    "--color-timeline-clip-audio": "#2a3820",
    "--color-timeline-clip-audio-border": "rgba(160, 180, 80, 0.45)",
    "--color-timeline-clip-text": "#dae8dd",
    "--color-timeline-clip-duration": "#bed5c5",
    "--color-timeline-filmstrip-bg": "rgba(28, 36, 30, 0.42)",
    "--color-timeline-filmstrip-empty": "rgba(28, 36, 30, 0.62)",
    "--color-timeline-filmstrip-border": "rgba(0, 0, 0, 0.2)",
    "--color-timeline-clip-image": "#2d4236",
    "--color-timeline-clip-caption": "#24382d",
    "--color-timeline-clip-title": "#2d4236",
    "--color-timeline-clip-effect": "#24382d",
    "--color-timeline-clip-compound": "#2d4236",
    "--color-timeline-clip-sticker": "#24382d",
    "--color-timeline-clip-fg": "#dae8dd",
    "--color-timeline-clip-muted-fg": "#bed5c5",
    "--color-timeline-clip-audio-wave": "#bed5c5",
    "--color-timeline-clip-envelope-fill": "rgba(28, 36, 30, 0.95)",
    "--color-timeline-clip-envelope-line": "rgba(190, 213, 197, 0.72)",
    "--color-timeline-filmstrip-overlay": "rgba(0, 0, 0, 0.10)",
    "--color-timeline-filmstrip-overlay-soft": "rgba(0, 0, 0, 0.08)",
    "--color-timeline-clip-badge-bg": "rgba(0, 0, 0, 0.30)",
    "--color-timeline-clip-metadata-bg": "rgba(28, 36, 30, 0.42)",
    "--color-timeline-clip-metadata-border": "rgba(110, 191, 139, 0.42)",
    "--color-timeline-clip-waveform-bg": "rgba(42, 56, 32, 0.35)",
    "--color-timeline-clip-waveform-border": "rgba(160, 180, 80, 0.45)",
    "--color-timeline-clip-control-bg": "#dae8dd",
    "--color-timeline-clip-control-border": "#2d4236",
    "--color-timeline-clip-control-shadow": "0 1px 3px rgba(0, 0, 0, 0.75)",
    "--color-timeline-clip-keyframe-bg": "#5a7a20",
    "--color-timeline-clip-keyframe-border": "#dae8dd",
    "--color-timeline-clip-keyframe-shadow": "0 1px 3px rgba(0, 0, 0, 0.55)",
    "--color-timeline-clip-volume-line": "#dae8dd",
    "--color-timeline-clip-volume-shadow": "0 0 3px rgba(218, 232, 221, 0.35)",
    "--color-timeline-clip-tooltip-bg": "rgba(28, 36, 30, 0.62)",
    "--color-timeline-clip-tooltip-border": "rgba(160, 180, 80, 0.45)",
    "--color-timeline-clip-tooltip-text": "#bed5c5",
    "--color-timeline-clip-drag-shadow": "0 8px 32px rgba(0, 0, 0, 0.60)",
    "--color-timeline-clip-drag-border": "rgba(218, 232, 221, 0.20)",
  },

  /** Slate Noir — slate blue video, teal-green audio */
  "slate-noir": {
    "--color-timeline-clip-video": "#314048",
    "--color-timeline-clip-video-border": "rgba(107, 169, 196, 0.42)",
    "--color-timeline-clip-invalid": "#ef4444",
    "--color-timeline-clip-audio": "#2a3830",
    "--color-timeline-clip-audio-border": "rgba(100, 180, 130, 0.45)",
    "--color-timeline-clip-text": "#dde7eb",
    "--color-timeline-clip-duration": "#c2d4db",
    "--color-timeline-filmstrip-bg": "rgba(34, 38, 42, 0.42)",
    "--color-timeline-filmstrip-empty": "rgba(34, 38, 42, 0.62)",
    "--color-timeline-filmstrip-border": "rgba(0, 0, 0, 0.2)",
    "--color-timeline-clip-image": "#314048",
    "--color-timeline-clip-caption": "#283840",
    "--color-timeline-clip-title": "#314048",
    "--color-timeline-clip-effect": "#283840",
    "--color-timeline-clip-compound": "#314048",
    "--color-timeline-clip-sticker": "#283840",
    "--color-timeline-clip-fg": "#dde7eb",
    "--color-timeline-clip-muted-fg": "#c2d4db",
    "--color-timeline-clip-audio-wave": "#c2d4db",
    "--color-timeline-clip-envelope-fill": "rgba(34, 38, 42, 0.95)",
    "--color-timeline-clip-envelope-line": "rgba(194, 212, 219, 0.72)",
    "--color-timeline-filmstrip-overlay": "rgba(0, 0, 0, 0.10)",
    "--color-timeline-filmstrip-overlay-soft": "rgba(0, 0, 0, 0.08)",
    "--color-timeline-clip-badge-bg": "rgba(0, 0, 0, 0.30)",
    "--color-timeline-clip-metadata-bg": "rgba(34, 38, 42, 0.42)",
    "--color-timeline-clip-metadata-border": "rgba(107, 169, 196, 0.42)",
    "--color-timeline-clip-waveform-bg": "rgba(42, 56, 48, 0.35)",
    "--color-timeline-clip-waveform-border": "rgba(100, 180, 130, 0.45)",
    "--color-timeline-clip-control-bg": "#dde7eb",
    "--color-timeline-clip-control-border": "#314048",
    "--color-timeline-clip-control-shadow": "0 1px 3px rgba(0, 0, 0, 0.75)",
    "--color-timeline-clip-keyframe-bg": "#1a7058",
    "--color-timeline-clip-keyframe-border": "#dde7eb",
    "--color-timeline-clip-keyframe-shadow": "0 1px 3px rgba(0, 0, 0, 0.55)",
    "--color-timeline-clip-volume-line": "#dde7eb",
    "--color-timeline-clip-volume-shadow": "0 0 3px rgba(221, 231, 235, 0.35)",
    "--color-timeline-clip-tooltip-bg": "rgba(34, 38, 42, 0.62)",
    "--color-timeline-clip-tooltip-border": "rgba(100, 180, 130, 0.45)",
    "--color-timeline-clip-tooltip-text": "#c2d4db",
    "--color-timeline-clip-drag-shadow": "0 8px 32px rgba(0, 0, 0, 0.60)",
    "--color-timeline-clip-drag-border": "rgba(221, 231, 235, 0.20)",
  },

  /** Rose Cut — mauve-rose video, emerald audio */
  "rose-cut": {
    "--color-timeline-clip-video": "#40303a",
    "--color-timeline-clip-video-border": "rgba(217, 112, 151, 0.42)",
    "--color-timeline-clip-invalid": "#ef4444",
    "--color-timeline-clip-audio": "#243428",
    "--color-timeline-clip-audio-border": "rgba(90, 190, 130, 0.45)",
    "--color-timeline-clip-text": "#eedde3",
    "--color-timeline-clip-duration": "#dcc3cd",
    "--color-timeline-filmstrip-bg": "rgba(35, 28, 32, 0.42)",
    "--color-timeline-filmstrip-empty": "rgba(35, 28, 32, 0.62)",
    "--color-timeline-filmstrip-border": "rgba(0, 0, 0, 0.2)",
    "--color-timeline-clip-image": "#40303a",
    "--color-timeline-clip-caption": "#342731",
    "--color-timeline-clip-title": "#40303a",
    "--color-timeline-clip-effect": "#342731",
    "--color-timeline-clip-compound": "#40303a",
    "--color-timeline-clip-sticker": "#342731",
    "--color-timeline-clip-fg": "#eedde3",
    "--color-timeline-clip-muted-fg": "#dcc3cd",
    "--color-timeline-clip-audio-wave": "#dcc3cd",
    "--color-timeline-clip-envelope-fill": "rgba(35, 28, 32, 0.95)",
    "--color-timeline-clip-envelope-line": "rgba(220, 195, 205, 0.72)",
    "--color-timeline-filmstrip-overlay": "rgba(0, 0, 0, 0.10)",
    "--color-timeline-filmstrip-overlay-soft": "rgba(0, 0, 0, 0.08)",
    "--color-timeline-clip-badge-bg": "rgba(0, 0, 0, 0.30)",
    "--color-timeline-clip-metadata-bg": "rgba(35, 28, 32, 0.42)",
    "--color-timeline-clip-metadata-border": "rgba(217, 112, 151, 0.42)",
    "--color-timeline-clip-waveform-bg": "rgba(36, 52, 40, 0.35)",
    "--color-timeline-clip-waveform-border": "rgba(90, 190, 130, 0.45)",
    "--color-timeline-clip-control-bg": "#eedde3",
    "--color-timeline-clip-control-border": "#40303a",
    "--color-timeline-clip-control-shadow": "0 1px 3px rgba(0, 0, 0, 0.75)",
    "--color-timeline-clip-keyframe-bg": "#1a7848",
    "--color-timeline-clip-keyframe-border": "#eedde3",
    "--color-timeline-clip-keyframe-shadow": "0 1px 3px rgba(0, 0, 0, 0.55)",
    "--color-timeline-clip-volume-line": "#eedde3",
    "--color-timeline-clip-volume-shadow": "0 0 3px rgba(238, 221, 227, 0.35)",
    "--color-timeline-clip-tooltip-bg": "rgba(35, 28, 32, 0.62)",
    "--color-timeline-clip-tooltip-border": "rgba(90, 190, 130, 0.45)",
    "--color-timeline-clip-tooltip-text": "#dcc3cd",
    "--color-timeline-clip-drag-shadow": "0 8px 32px rgba(0, 0, 0, 0.60)",
    "--color-timeline-clip-drag-border": "rgba(238, 221, 227, 0.20)",
  },
};

export const CLIP_PALETTE_META: Record<
  ClipPalette,
  { name: string; description: string }
> = {
  dark: { name: "Dark", description: "Teal video and green audio" },
  midnight: { name: "Midnight", description: "Deep blue video and cyan audio" },
  ocean: { name: "Ocean", description: "Cool cyan clip colours" },
  forest: { name: "Forest", description: "Natural green and olive clips" },
  "midnight-carbon": {
    name: "Midnight Carbon",
    description: "Steel and sage clips",
  },
  "ember-studio": {
    name: "Ember Studio",
    description: "Amber video and teal audio",
  },
  "forest-console": {
    name: "Forest Console",
    description: "Low-contrast green clips",
  },
  "slate-noir": { name: "Slate Noir", description: "Neutral slate clips" },
  "rose-cut": {
    name: "Rose Cut",
    description: "Mauve video and emerald audio",
  },
};

/** Human-readable metadata for each theme (used by SettingsModal) */
export const THEME_META: Record<Theme, { name: string; description: string }> =
  {
    dark: { name: "Dark", description: "Classic dark" },
    midnight: { name: "Midnight", description: "Deep blue tones" },
    ocean: { name: "Ocean", description: "Cool cyan accents" },
    forest: { name: "Forest", description: "Natural green hues" },
    "midnight-carbon": {
      name: "Midnight Carbon",
      description: "Professional broadcast-grade cold precision",
    },
    "ember-studio": {
      name: "Ember Studio",
      description: "Warm creative workspace",
    },
    "forest-console": {
      name: "Forest Console",
      description: "Low eye strain terminal aesthetic",
    },
    "slate-noir": {
      name: "Slate Noir",
      description: "Maximum neutrality broadcast interface",
    },
    "rose-cut": {
      name: "Rose Cut",
      description: "Modern approachable aesthetic",
    },
    custom: { name: "Custom", description: "Your custom theme" },
  };

/** Returns the raw theme color tokens for a given theme (for live previews) */
export function getThemeColors(
  t: Theme,
  customColors?: Record<string, string> | null,
  clipPalette: ClipPalette = t === "custom" ? "dark" : (t as ClipPalette),
): Record<string, string> {
  const uiColors =
    t === "custom" && customColors
      ? withoutClipTokens(customColors)
      : UI_THEMES[t === "custom" ? "dark" : t] || UI_THEMES.dark;
  return { ...uiColors, ...(CLIP_PALETTES[clipPalette] || CLIP_PALETTES.dark) };
}

export function getClipPaletteColors(
  palette: ClipPalette,
): Record<string, string> {
  return CLIP_PALETTES[palette] || CLIP_PALETTES.dark;
}

/** Get all color variable names exposed by the theme editor. */
export function getThemeColorKeys(): string[] {
  return Object.keys(UI_THEMES.dark);
}

/** Get a base theme to start customization from. */
export function getBaseThemeForCustomization(
  baseTheme: Exclude<Theme, "custom">,
): Record<string, string> {
  return { ...UI_THEMES[baseTheme] };
}

// Font family definitions
const fontFamilies: Record<FontFamily, string> = {
  inter: '"Inter Variable", sans-serif',
  montserrat: '"Montserrat Variable", sans-serif',
  geist: '"Geist Variable", sans-serif',
  outfit: '"Outfit Variable", sans-serif',
  roboto: '"Roboto Variable", sans-serif',
  "space-grotesk": '"Space Grotesk Variable", sans-serif',
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  mono: '"JetBrains Mono", "Fira Code", Consolas, monospace',
};

export const FONT_META: Record<FontFamily, { name: string; stack: string }> = {
  inter: { name: "Inter", stack: fontFamilies.inter },
  montserrat: { name: "Montserrat", stack: fontFamilies.montserrat },
  geist: { name: "Geist", stack: fontFamilies.geist },
  outfit: { name: "Outfit", stack: fontFamilies.outfit },
  roboto: { name: "Roboto", stack: fontFamilies.roboto },
  "space-grotesk": {
    name: "Space Grotesk",
    stack: fontFamilies["space-grotesk"],
  },
  system: { name: "System", stack: fontFamilies.system },
  mono: { name: "Mono", stack: fontFamilies.mono },
};

export function applyTheme(
  theme: UiTheme | Theme,
  clipPalette: ClipPalette | Record<string, string> | null = "dark",
  customColors?: Record<string, string> | null,
) {
  const root = document.documentElement;
  // Accept the old applyTheme(theme, customColors) shape for external callers
  // while all internal callers use the explicit three-layer arguments.
  if (typeof clipPalette === "object") {
    customColors = clipPalette;
    clipPalette = "dark";
  }

  const uiTheme = theme === "custom" ? "dark" : theme;
  const uiColors =
    theme === "custom" && customColors
      ? withoutClipTokens(customColors)
      : UI_THEMES[uiTheme] || UI_THEMES.dark;
  const clipColors =
    CLIP_PALETTES[clipPalette as ClipPalette] || CLIP_PALETTES.dark;
  const themeColors = { ...uiColors, ...clipColors };

  Object.entries(themeColors).forEach(([property, value]) => {
    // Palette source names live in CLIP_PALETTES only. Runtime consumers use
    // the canonical --clypra-clip-* variables written by clipColorMap below.
    if (
      CLIP_PALETTE_TOKEN_KEYS.includes(
        property as (typeof CLIP_PALETTE_TOKEN_KEYS)[number],
      )
    ) {
      return;
    }

    const sourceProperty =
      CLYPRA_THEME_SOURCE_ALIASES[
        property as keyof typeof CLYPRA_THEME_SOURCE_ALIASES
      ];

    if (sourceProperty) {
      root.style.setProperty(sourceProperty, value);
      // Preserve the old public variable name as an alias. It is never a
      // second palette value and keeps older call sites compatible.
      root.style.setProperty(property, `var(${sourceProperty})`);
      return;
    }

    root.style.setProperty(property, value);
  });

  // Promote the active palette's explicit clip roles into the canonical
  // runtime variables consumed by CSS and timeline components. This is the
  // only conversion from palette config names to runtime names.
  const clipColorMap: Array<[string, string]> = [
    ["--color-timeline-clip-video", "--clypra-clip-video-bg"],
    ["--color-timeline-clip-video-border", "--clypra-clip-video-border"],
    ["--color-timeline-clip-invalid", "--clypra-clip-invalid"],
    ["--color-timeline-clip-audio", "--clypra-clip-audio-bg"],
    ["--color-timeline-clip-audio-border", "--clypra-clip-audio-border"],
    ["--color-timeline-clip-image", "--clypra-clip-image-bg"],
    ["--color-timeline-clip-text", "--clypra-clip-text-bg"],
    ["--color-timeline-clip-caption", "--clypra-clip-caption-bg"],
    ["--color-timeline-clip-title", "--clypra-clip-title-bg"],
    ["--color-timeline-clip-effect", "--clypra-clip-effect-bg"],
    ["--color-timeline-clip-compound", "--clypra-clip-compound-bg"],
    ["--color-timeline-clip-sticker", "--clypra-clip-sticker-bg"],
    ["--color-timeline-clip-fg", "--clypra-clip-fg"],
    ["--color-timeline-clip-muted-fg", "--clypra-clip-muted-fg"],
    ["--color-timeline-clip-audio-wave", "--clypra-clip-audio-wave"],
    ["--color-timeline-clip-envelope-fill", "--clypra-clip-envelope-fill"],
    ["--color-timeline-clip-envelope-line", "--clypra-clip-envelope-line"],
    ["--color-timeline-clip-duration", "--clypra-clip-duration"],
    ["--color-timeline-filmstrip-bg", "--clypra-clip-filmstrip-bg"],
    ["--color-timeline-filmstrip-empty", "--clypra-clip-filmstrip-empty"],
    ["--color-timeline-filmstrip-border", "--clypra-clip-filmstrip-border"],
    ["--color-timeline-filmstrip-overlay", "--clypra-clip-filmstrip-overlay"],
    [
      "--color-timeline-filmstrip-overlay-soft",
      "--clypra-clip-filmstrip-overlay-soft",
    ],
    ["--color-timeline-clip-badge-bg", "--clypra-clip-badge-bg"],
    ["--color-timeline-clip-metadata-bg", "--clypra-clip-metadata-bg"],
    ["--color-timeline-clip-metadata-border", "--clypra-clip-metadata-border"],
    ["--color-timeline-clip-waveform-bg", "--clypra-clip-waveform-bg"],
    ["--color-timeline-clip-waveform-border", "--clypra-clip-waveform-border"],
    ["--color-timeline-clip-control-bg", "--clypra-clip-control-bg"],
    ["--color-timeline-clip-control-border", "--clypra-clip-control-border"],
    ["--color-timeline-clip-control-shadow", "--clypra-clip-control-shadow"],
    ["--color-timeline-clip-keyframe-bg", "--clypra-clip-keyframe-bg"],
    ["--color-timeline-clip-keyframe-border", "--clypra-clip-keyframe-border"],
    ["--color-timeline-clip-keyframe-shadow", "--clypra-clip-keyframe-shadow"],
    ["--color-timeline-clip-volume-line", "--clypra-clip-volume-line"],
    ["--color-timeline-clip-volume-shadow", "--clypra-clip-volume-shadow"],
    ["--color-timeline-clip-tooltip-bg", "--clypra-clip-tooltip-bg"],
    ["--color-timeline-clip-tooltip-border", "--clypra-clip-tooltip-border"],
    ["--color-timeline-clip-tooltip-text", "--clypra-clip-tooltip-text"],
    ["--color-timeline-clip-drag-shadow", "--clypra-clip-drag-shadow"],
    ["--color-timeline-clip-drag-border", "--clypra-clip-drag-border"],
  ];
  clipColorMap.forEach(([sourceVar, canonicalVar]) => {
    const value = clipColors[sourceVar as keyof typeof clipColors]?.trim();
    if (value) root.style.setProperty(canonicalVar, value);
  });

  // Remove any source-token styles left by an older runtime so there can
  // never be two live values for the same clip role.
  CLIP_PALETTE_TOKEN_KEYS.forEach((property) =>
    root.style.removeProperty(property),
  );

  // Keep legacy names available to older consumers (read-only aliases that
  // point back to the canonical vars so they stay in sync with the theme).
  Object.entries(CLYPRA_LEGACY_COLOR_ALIASES).forEach(([property, value]) => {
    root.style.setProperty(property, value);
  });
  Object.entries(CLYPRA_SHADCN_COLOR_ALIASES).forEach(([property, value]) => {
    root.style.setProperty(property, value);
  });
}

export function applyFontFamily(fontFamily: FontFamily) {
  const root = document.documentElement;
  const fontStack = fontFamilies[fontFamily] || fontFamilies.inter;
  root.style.setProperty("--font-sans", fontStack);
  root.style.fontFamily = fontStack;
  if (document.body) {
    document.body.style.fontFamily = fontStack;
  }
  const rootEl = document.getElementById("root");
  if (rootEl) {
    rootEl.style.fontFamily = fontStack;
  }
}
