import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "midnight" | "ocean" | "forest";
export type FontFamily = "inter" | "system" | "mono" | "serif";

interface SettingsStore {
  theme: Theme;
  fontFamily: FontFamily;
  setTheme: (theme: Theme) => void;
  setFontFamily: (fontFamily: FontFamily) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: "dark",
      fontFamily: "inter",

      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },

      setFontFamily: (fontFamily) => {
        set({ fontFamily });
        applyFontFamily(fontFamily);
      },
    }),
    {
      name: "clypra-settings",
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyTheme(state.theme);
          applyFontFamily(state.fontFamily);
        }
      },
    },
  ),
);

// Theme definitions
const themes: Record<Theme, Record<string, string>> = {
  dark: {
    "--color-bg": "#0f0f0f",
    "--color-surface": "#1a1a1a",
    "--color-surface-raised": "#242424",
    "--color-border": "#2e2e2e",
    "--color-accent": "#6c63ff",
    "--color-text-primary": "#f0f0f0",
    "--color-text-muted": "#666666",
  },
  midnight: {
    "--color-bg": "#0a0e1a",
    "--color-surface": "#131829",
    "--color-surface-raised": "#1a2138",
    "--color-border": "#252d47",
    "--color-accent": "#5b8fff",
    "--color-text-primary": "#e8eef7",
    "--color-text-muted": "#5a6b8c",
  },
  ocean: {
    "--color-bg": "#0a1520",
    "--color-surface": "#0f1f2e",
    "--color-surface-raised": "#16293d",
    "--color-border": "#1e3548",
    "--color-accent": "#00d4ff",
    "--color-text-primary": "#e0f2ff",
    "--color-text-muted": "#5a7a94",
  },
  forest: {
    "--color-bg": "#0d1410",
    "--color-surface": "#141d18",
    "--color-surface-raised": "#1c2820",
    "--color-border": "#263329",
    "--color-accent": "#4ade80",
    "--color-text-primary": "#e8f5e9",
    "--color-text-muted": "#5a7a5f",
  },
};

// Font family definitions
const fontFamilies: Record<FontFamily, string> = {
  inter: '"Inter Variable", sans-serif',
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  mono: '"JetBrains Mono", "Fira Code", Consolas, monospace',
  serif: 'Georgia, "Times New Roman", serif',
};

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const themeColors = themes[theme];

  Object.entries(themeColors).forEach(([property, value]) => {
    root.style.setProperty(property, value);
  });
}

function applyFontFamily(fontFamily: FontFamily) {
  const root = document.documentElement;
  root.style.setProperty("--font-sans", fontFamilies[fontFamily]);
  document.body.style.fontFamily = fontFamilies[fontFamily];
}
