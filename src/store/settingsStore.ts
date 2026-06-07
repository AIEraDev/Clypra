import { create } from "zustand";
import { persist } from "zustand/middleware";
import { changeLanguage } from "@/i18n";

export type Theme = "dark" | "midnight" | "ocean" | "forest" | "custom";
export type FontFamily = "inter" | "montserrat" | "geist" | "outfit" | "roboto" | "space-grotesk" | "system" | "mono";
export type Language = "en" | "ja" | "zh-CN";
export type FrameRate = 24 | 30 | 60;
export type PreviewQuality = "full" | "high" | "medium" | "low";

interface SettingsStore {
  // Appearance
  theme: Theme;
  fontFamily: FontFamily;
  language: Language;
  customTheme: Record<string, string> | null;
  setTheme: (theme: Theme) => void;
  setFontFamily: (fontFamily: FontFamily) => void;
  setLanguage: (language: Language) => Promise<void>;
  setCustomTheme: (colors: Record<string, string>) => void;
  resetCustomTheme: () => void;
  // Editor
  snapToGrid: boolean;
  autoRipple: boolean;
  autoSave: boolean;
  defaultFrameRate: FrameRate;
  previewQuality: PreviewQuality;
  setSnapToGrid: (v: boolean) => void;
  setAutoRipple: (v: boolean) => void;
  setAutoSave: (v: boolean) => void;
  setDefaultFrameRate: (v: FrameRate) => void;
  setPreviewQuality: (v: PreviewQuality) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      theme: "dark",
      fontFamily: "inter",
      language: "en",
      customTheme: null,
      snapToGrid: true,
      autoRipple: false,
      autoSave: true,
      defaultFrameRate: 30,
      previewQuality: "high",

      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme, get().customTheme);
      },

      setFontFamily: (fontFamily) => {
        set({ fontFamily });
        applyFontFamily(fontFamily, get().language);
      },

      setLanguage: async (language) => {
        // Update selected state immediately so the UI reflects the choice
        // while the (async) language chunk loads.
        set({ language });
        await changeLanguage(language);
        // Re-apply the font so CJK fallbacks are added/removed as needed.
        applyFontFamily(get().fontFamily, language);
      },

      setCustomTheme: (colors) => {
        set({ customTheme: colors, theme: "custom" });
        applyTheme("custom", colors);
      },

      resetCustomTheme: () => {
        set({ customTheme: null, theme: "dark" });
        applyTheme("dark", null);
      },

      setSnapToGrid: (snapToGrid) => set({ snapToGrid }),
      setAutoRipple: (autoRipple) => set({ autoRipple }),
      setAutoSave: (autoSave) => set({ autoSave }),
      setDefaultFrameRate: (defaultFrameRate) => set({ defaultFrameRate }),
      setPreviewQuality: (previewQuality) => set({ previewQuality }),
    }),
    {
      name: "clypra-settings",
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyTheme(state.theme, state.customTheme);
          applyFontFamily(state.fontFamily, state.language);
        }
      },
    },
  ),
);

// ─── Theme definitions ──────────────────────────────────────────────────────
// Each theme provides a complete set of CSS custom properties so that the
// entire editor UI updates consistently when switching.
const themes: Record<Exclude<Theme, "custom">, Record<string, string>> = {
  dark: {
    "--color-bg": "#0f0f0f",
    "--color-surface": "#1a1a1a",
    "--color-surface-raised": "#242424",
    "--color-surface-panel": "#161616",
    "--color-surface-floating": "#20242a",
    "--color-border": "#2e2e2e",
    "--color-border-soft": "#343b45",
    "--color-accent": "#6c63ff",
    "--color-accent-soft": "#8b84ff",
    "--color-text-primary": "#f0f0f0",
    "--color-text-muted": "#666666",
    "--color-danger": "#e05252",
    "--color-video-clip": "#2d2340",
    "--color-audio-clip": "#1a3040",
    "--color-text-clip": "#3d3010",
    // Timeline-specific colors
    "--color-timeline-bg": "#141920",
    "--color-timeline-track-bg": "#12171d",
    "--color-timeline-track-border": "#2c2f34",
    "--color-timeline-track-hover": "#1e2228",
    "--color-timeline-track-selected": "#20252b",
    "--color-timeline-track-active": "#1f242b",
    "--color-timeline-ruler-bg": "#1a1d23",
    "--color-timeline-ruler-tick-major": "#4a505c",
    "--color-timeline-ruler-tick-minor": "#2c3039",
    "--color-timeline-ruler-text": "#5c6370",
    "--color-timeline-toolbar-border": "#2c2f34",
    "--color-timeline-toolbar-divider": "#30343a",
    "--color-timeline-button-hover": "#2a3038",
    "--color-timeline-button-icon": "#848c96",
    "--color-timeline-track-label": "#88909a",
    "--color-timeline-track-name": "#d6d9de",
    "--color-timeline-clip-video": "#153840",
    "--color-timeline-clip-video-border": "rgba(48, 167, 200, 0.4)",
    "--color-timeline-clip-audio": "#153840",
    "--color-timeline-clip-audio-border": "rgba(48, 167, 200, 0.4)",
    "--color-timeline-clip-text": "#d8edf1",
    "--color-timeline-clip-duration": "#b9e0e6",
    "--color-timeline-filmstrip-bg": "rgba(12, 39, 48, 0.4)",
    "--color-timeline-filmstrip-empty": "rgba(12, 39, 48, 0.6)",
    "--color-timeline-filmstrip-border": "rgba(0, 0, 0, 0.2)",
    "--color-timeline-ghost-track-bg": "#141920",
    "--color-timeline-drop-indicator": "#3b82f6",
    "--color-timeline-drop-zone-text": "#6b7280",
    "--color-timeline-clip-invalid": "#ef4444",
    "--color-timeline-text-clip-bg": "#9c4937",
    "--color-timeline-text-clip-text": "#9C4A3723",

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
    "--color-video-clip": "#1e2a50",
    "--color-audio-clip": "#152845",
    "--color-text-clip": "#2e3550",
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
    "--color-timeline-clip-video": "#1e2a50",
    "--color-timeline-clip-video-border": "rgba(91, 143, 255, 0.4)",
    "--color-timeline-clip-audio": "#152845",
    "--color-timeline-clip-audio-border": "rgba(91, 143, 255, 0.4)",
    "--color-timeline-clip-text": "#d8e0f1",
    "--color-timeline-clip-duration": "#b9c8e6",
    "--color-timeline-filmstrip-bg": "rgba(16, 21, 37, 0.4)",
    "--color-timeline-filmstrip-empty": "rgba(16, 21, 37, 0.6)",
    "--color-timeline-filmstrip-border": "rgba(0, 0, 0, 0.2)",
    "--color-timeline-ghost-track-bg": "#0d1220",
    "--color-timeline-drop-indicator": "#5b8fff",
    "--color-timeline-drop-zone-text": "#5a6b8c",
    "--color-timeline-clip-invalid": "#ef4444",
    "--color-timeline-text-clip-bg": "#9c4937",
    "--color-timeline-text-clip-text": "#9C4A3723",

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
    "--color-accent": "#00d4ff",
    "--color-accent-soft": "#33ddff",
    "--color-text-primary": "#e0f2ff",
    "--color-text-muted": "#5a7a94",
    "--color-danger": "#e05252",
    "--color-video-clip": "#0f2a3d",
    "--color-audio-clip": "#0c2535",
    "--color-text-clip": "#1a3040",
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
    "--color-timeline-clip-video": "#0f2a3d",
    "--color-timeline-clip-video-border": "rgba(0, 212, 255, 0.4)",
    "--color-timeline-clip-audio": "#0c2535",
    "--color-timeline-clip-audio-border": "rgba(0, 212, 255, 0.4)",
    "--color-timeline-clip-text": "#d0e8ff",
    "--color-timeline-clip-duration": "#b0d8f0",
    "--color-timeline-filmstrip-bg": "rgba(12, 26, 40, 0.4)",
    "--color-timeline-filmstrip-empty": "rgba(12, 26, 40, 0.6)",
    "--color-timeline-filmstrip-border": "rgba(0, 0, 0, 0.2)",
    "--color-timeline-ghost-track-bg": "#0c1a28",
    "--color-timeline-drop-indicator": "#00d4ff",
    "--color-timeline-drop-zone-text": "#5a7a94",
    "--color-timeline-clip-invalid": "#ef4444",
    "--color-timeline-text-clip-bg": "#9c4937",
    "--color-timeline-text-clip-text": "#9C4A3723",

    "--background": "#0a1520",
    "--foreground": "#e0f2ff",
    "--card": "#0f1f2e",
    "--card-foreground": "#e0f2ff",
    "--popover": "#0f1f2e",
    "--popover-foreground": "#e0f2ff",
    "--primary": "#00d4ff",
    "--primary-foreground": "#0a1520",
    "--secondary": "#16293d",
    "--secondary-foreground": "#e0f2ff",
    "--muted": "#16293d",
    "--muted-foreground": "#5a7a94",
    "--accent": "#00d4ff",
    "--accent-foreground": "#0a1520",
    "--destructive": "#e05252",
    "--border": "#1e3548",
    "--input": "#1e3548",
    "--ring": "#00d4ff",
  },
  forest: {
    "--color-bg": "#0d1410",
    "--color-surface": "#141d18",
    "--color-surface-raised": "#1c2820",
    "--color-surface-panel": "#111a14",
    "--color-surface-floating": "#1f2e25",
    "--color-border": "#263329",
    "--color-border-soft": "#2f3e32",
    "--color-accent": "#4ade80",
    "--color-accent-soft": "#6ee7a0",
    "--color-text-primary": "#e8f5e9",
    "--color-text-muted": "#5a7a5f",
    "--color-danger": "#e05252",
    "--color-video-clip": "#1a2e1e",
    "--color-audio-clip": "#142a1c",
    "--color-text-clip": "#2a3820",
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
    "--color-timeline-clip-video": "#1a2e1e",
    "--color-timeline-clip-video-border": "rgba(74, 222, 128, 0.4)",
    "--color-timeline-clip-audio": "#142a1c",
    "--color-timeline-clip-audio-border": "rgba(74, 222, 128, 0.4)",
    "--color-timeline-clip-text": "#d8edd9",
    "--color-timeline-clip-duration": "#b8ddb9",
    "--color-timeline-filmstrip-bg": "rgba(17, 26, 20, 0.4)",
    "--color-timeline-filmstrip-empty": "rgba(17, 26, 20, 0.6)",
    "--color-timeline-filmstrip-border": "rgba(0, 0, 0, 0.2)",
    "--color-timeline-ghost-track-bg": "#111a14",
    "--color-timeline-drop-indicator": "#4ade80",
    "--color-timeline-drop-zone-text": "#5a7a5f",
    "--color-timeline-clip-invalid": "#ef4444",
    "--color-timeline-text-clip-bg": "#9c4937",
    "--color-timeline-text-clip-text": "#9C4A3723",

    "--background": "#0d1410",
    "--foreground": "#e8f5e9",
    "--card": "#141d18",
    "--card-foreground": "#e8f5e9",
    "--popover": "#141d18",
    "--popover-foreground": "#e8f5e9",
    "--primary": "#4ade80",
    "--primary-foreground": "#0d1410",
    "--secondary": "#1c2820",
    "--secondary-foreground": "#e8f5e9",
    "--muted": "#1c2820",
    "--muted-foreground": "#5a7a5f",
    "--accent": "#4ade80",
    "--accent-foreground": "#0d1410",
    "--destructive": "#e05252",
    "--border": "#263329",
    "--input": "#263329",
    "--ring": "#4ade80",
  },
};

/** Human-readable metadata for each theme (used by SettingsModal) */
export const THEME_META: Record<Theme, { name: string; description: string }> = {
  dark: { name: "Dark", description: "Classic dark" },
  midnight: { name: "Midnight", description: "Deep blue tones" },
  ocean: { name: "Ocean", description: "Cool cyan accents" },
  forest: { name: "Forest", description: "Natural green hues" },
  custom: { name: "Custom", description: "Your custom theme" },
};

/** Returns the raw theme color tokens for a given theme (for live previews) */
export function getThemeColors(t: Theme, customColors?: Record<string, string> | null): Record<string, string> {
  if (t === "custom" && customColors) {
    return customColors;
  }
  if (t === "custom") {
    return themes.dark;
  }
  return themes[t] || themes.dark;
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
  "space-grotesk": { name: "Space Grotesk", stack: fontFamilies["space-grotesk"] },
  system: { name: "System", stack: fontFamilies.system },
  mono: { name: "Mono", stack: fontFamilies.mono },
};

export function applyTheme(theme: Theme, customColors?: Record<string, string> | null) {
  const root = document.documentElement;
  let themeColors: Record<string, string>;

  if (theme === "custom" && customColors) {
    themeColors = customColors;
  } else if (theme === "custom") {
    themeColors = themes.dark;
  } else {
    themeColors = themes[theme] || themes.dark;
  }

  Object.entries(themeColors).forEach(([property, value]) => {
    root.style.setProperty(property, value);
  });
}

// CJK fallback fonts appended to the active font stack when a CJK language is
// selected, so Latin-only fonts (e.g. Inter) don't render missing glyphs.
const CJK_FALLBACK = '"PingFang SC", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

function fontStackForLanguage(fontFamily: FontFamily, language: Language): string {
  const base = fontFamilies[fontFamily];
  if (language === "ja" || language === "zh-CN") {
    return `${base}, ${CJK_FALLBACK}`;
  }
  return base;
}

export function applyFontFamily(fontFamily: FontFamily, language: Language = "en") {
  const root = document.documentElement;
  const stack = fontStackForLanguage(fontFamily, language);
  root.style.setProperty("--font-sans", stack);
  if (document.body) {
    document.body.style.fontFamily = stack;
  }
}

export function initSettings() {
  const state = useSettingsStore.getState();
  applyTheme(state.theme, state.customTheme);
  applyFontFamily(state.fontFamily, state.language);
}

/** Get all color variable names for theme editor */
export function getThemeColorKeys(): string[] {
  return Object.keys(themes.dark);
}

/** Get a base theme to start customization from */
export function getBaseThemeForCustomization(baseTheme: Exclude<Theme, "custom">): Record<string, string> {
  return { ...themes[baseTheme] };
}
