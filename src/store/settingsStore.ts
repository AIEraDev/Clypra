import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  applyFontFamily,
  applyTheme,
  isClipPalette,
  isUiTheme,
  syncThemeToTransferService,
} from "./themeRegistry";
import type { SettingsStore, Theme, ColorMode } from "./settingsTypes";

export type {
  ClipPalette,
  ColorMode,
  FontFamily,
  FrameRate,
  LayoutPreset,
  PreviewQuality,
  SettingsStore,
  Theme,
  UiTheme,
} from "./settingsTypes";
export * from "./themeRegistry";

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      uiTheme: "dark",
      clipPalette: "dark",
      theme: "dark",
      fontFamily: "inter",
      customTheme: null,
      snapToGrid: true,
      autoSave: true,
      defaultFrameRate: 30,
      previewQuality: "high",
      // Performance
      proxyEditingEnabled: false,
      autoClearCacheOnProjectClose: false,
      // Layout — read legacy localStorage on first load, fall back to viewport-relative defaults
      layoutPreset: "default",
      sidebarWidth: (() => {
        if (typeof window === "undefined") return 300;
        const v = parseInt(
          localStorage.getItem("clypra_sidebar_width") ?? "",
          10,
        );
        // Fallback: ~22% of viewport width, clamped between 240–480px
        return !isNaN(v) && v >= 240 ? v : Math.round(Math.min(Math.max(window.innerWidth * 0.22, 240), 480));
      })(),
      propertiesPanelWidth: (() => {
        if (typeof window === "undefined") return 300;
        const v = parseInt(
          localStorage.getItem("clypra_properties_width") ?? "",
          10,
        );
        // Fallback: ~22% of viewport width, clamped between 240–480px
        return !isNaN(v) && v >= 240 ? v : Math.round(Math.min(Math.max(window.innerWidth * 0.22, 240), 480));
      })(),
      tallPlayerWidth: (() => {
        if (typeof window === "undefined") return 480;
        // ~32% of viewport width, clamped [320, 600]
        return Math.round(Math.min(Math.max(window.innerWidth * 0.32, 320), 600));
      })(),
      sidebarCollapsed: false,
      propertiesPanelCollapsed: false,
      timelineHeight: (() => {
        if (typeof window === "undefined") return 220;
        const v = parseInt(
          localStorage.getItem("clypra_timeline_height") ?? "",
          10,
        );
        // Fallback: ~30% of viewport height, clamped between 160–400px
        return !isNaN(v) && v >= 160 ? v : Math.round(Math.min(Math.max(window.innerHeight * 0.30, 160), 400));
      })(),

      setUiTheme: (uiTheme) => {
        const clipPalette = get().clipPalette;
        set({ uiTheme, theme: uiTheme });
        applyTheme(uiTheme, clipPalette, null);
        void syncThemeToTransferService();
      },

      setClipPalette: (clipPalette) => {
        set({ clipPalette });
        applyTheme(get().theme, clipPalette, get().customTheme);
      },

      setTheme: (theme) => {
        if (theme === "custom") {
          set({ theme });
          applyTheme(theme, get().clipPalette, get().customTheme);
          void syncThemeToTransferService();
          return;
        }
        set({ theme, uiTheme: theme, clipPalette: theme });
        applyTheme(theme, theme, null);
        void syncThemeToTransferService();
      },

      setFontFamily: (fontFamily) => {
        set({ fontFamily });
        applyFontFamily(fontFamily);
        void syncThemeToTransferService();
      },

      setCustomTheme: (colors) => {
        set({ customTheme: colors, theme: "custom" });
        applyTheme("custom", get().clipPalette, colors);
        void syncThemeToTransferService();
      },

      resetCustomTheme: () => {
        set({
          customTheme: null,
          theme: "dark",
          uiTheme: "dark",
          clipPalette: "dark",
        });
        applyTheme("dark", "dark", null);
        void syncThemeToTransferService();
      },

      setSnapToGrid: (snapToGrid) => set({ snapToGrid }),
      setAutoSave: (autoSave) => set({ autoSave }),
      setDefaultFrameRate: (defaultFrameRate) => set({ defaultFrameRate }),
      setPreviewQuality: (previewQuality) => set({ previewQuality }),
      setProxyEditingEnabled: (proxyEditingEnabled) =>
        set({ proxyEditingEnabled }),
      setAutoClearCacheOnProjectClose: (autoClearCacheOnProjectClose) =>
        set({ autoClearCacheOnProjectClose }),
      setLayoutPreset: (layoutPreset) => set({ layoutPreset }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setPropertiesPanelWidth: (propertiesPanelWidth) =>
        set({ propertiesPanelWidth }),
      setTallPlayerWidth: (tallPlayerWidth) => set({ tallPlayerWidth }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setPropertiesPanelCollapsed: (propertiesPanelCollapsed) =>
        set({ propertiesPanelCollapsed }),
      setTimelineHeight: (timelineHeight) => set({ timelineHeight }),
      transferSaveDirectory: null,
      setTransferSaveDirectory: (transferSaveDirectory) => set({ transferSaveDirectory }),
    }),
    {
      name: "clypra-settings",
      version: 4,
      migrate: (persistedState: unknown, version: number) => {
        const persisted = (persistedState || {}) as Partial<SettingsStore>;

        // v3 → v4: Map legacy 9-variant theme names to dark/light
        if (version < 4) {
          const LEGACY_DARK_THEMES = new Set([
            "midnight",
            "ocean",
            "forest",
            "midnight-carbon",
            "ember-studio",
            "forest-console",
            "slate-noir",
            "rose-cut",
          ]);
          if (persisted.theme && LEGACY_DARK_THEMES.has(persisted.theme as string)) {
            persisted.theme = "dark" as Theme;
          }
          if (persisted.uiTheme && LEGACY_DARK_THEMES.has(persisted.uiTheme as string)) {
            persisted.uiTheme = "dark" as ColorMode;
          }
          if (persisted.clipPalette && LEGACY_DARK_THEMES.has(persisted.clipPalette as string)) {
            persisted.clipPalette = "dark" as ColorMode;
          }
        }

        // v2 → v3: Reset panel sizes that were hardcoded at 400px to
        // viewport-relative defaults so the UI fits non-Retina screens.
        if (version < 3 && typeof window !== "undefined") {
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const relativePanel = Math.round(Math.min(Math.max(vw * 0.22, 240), 480));
          const relativeTimeline = Math.round(Math.min(Math.max(vh * 0.30, 160), 400));
          // Only reset if still at the old hardcoded default (400px)
          if (!persisted.sidebarWidth || persisted.sidebarWidth === 400)
            persisted.sidebarWidth = relativePanel;
          if (!persisted.propertiesPanelWidth || persisted.propertiesPanelWidth === 400)
            persisted.propertiesPanelWidth = relativePanel;
          if (!persisted.timelineHeight || persisted.timelineHeight === 400)
            persisted.timelineHeight = relativeTimeline;
          // Reset tallPlayerWidth if still at the old hardcoded default (480px)
          if (!persisted.tallPlayerWidth || persisted.tallPlayerWidth === 480)
            persisted.tallPlayerWidth = Math.round(Math.min(Math.max(vw * 0.32, 320), 600));
        }

        const legacyTheme = persisted.theme;
        const uiTheme = isUiTheme(persisted.uiTheme)
          ? persisted.uiTheme
          : legacyTheme && isUiTheme(legacyTheme)
            ? legacyTheme
            : "dark";
        const clipPalette = isClipPalette(persisted.clipPalette)
          ? persisted.clipPalette
          : uiTheme; // palette name === theme name, 1:1

        return {
          ...persisted,
          uiTheme,
          clipPalette,
          theme: legacyTheme === "custom" ? "custom" : uiTheme,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyTheme(state.theme, state.clipPalette, state.customTheme);
          applyFontFamily(state.fontFamily);
          void syncThemeToTransferService();
        }
      },
    },
  ),
);

export function initSettings() {
  const state = useSettingsStore.getState();
  applyTheme(state.theme, state.clipPalette, state.customTheme);
  applyFontFamily(state.fontFamily);
  void syncThemeToTransferService();
}
