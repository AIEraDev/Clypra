import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  applyFontFamily,
  applyTheme,
  isClipPalette,
  isUiTheme,
} from "./themeRegistry";
import type { SettingsStore, Theme } from "./settingsTypes";
import { telemetryCollector } from "@/services/telemetryCollector";

export type {
  ClipPalette,
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
      performanceTelemetryEnabled: true,
      // Layout — read legacy localStorage on first load, fall back to defaults
      layoutPreset: "default",
      sidebarWidth: (() => {
        if (typeof window === "undefined") return 400;
        const v = parseInt(
          localStorage.getItem("clypra_sidebar_width") ?? "",
          10,
        );
        return !isNaN(v) && v >= 240 ? v : 400;
      })(),
      propertiesPanelWidth: (() => {
        if (typeof window === "undefined") return 400;
        const v = parseInt(
          localStorage.getItem("clypra_properties_width") ?? "",
          10,
        );
        return !isNaN(v) && v >= 240 ? v : 400;
      })(),
      tallPlayerWidth: 480,
      sidebarCollapsed: false,
      propertiesPanelCollapsed: false,
      timelineHeight: (() => {
        if (typeof window === "undefined") return 400;
        const v = parseInt(
          localStorage.getItem("clypra_timeline_height") ?? "",
          10,
        );
        return !isNaN(v) && v >= 160 ? v : 400;
      })(),

      setUiTheme: (uiTheme) => {
        const clipPalette = get().clipPalette;
        set({ uiTheme, theme: uiTheme });
        applyTheme(uiTheme, clipPalette, null);
      },

      setClipPalette: (clipPalette) => {
        set({ clipPalette });
        applyTheme(get().theme, clipPalette, get().customTheme);
      },

      setTheme: (theme) => {
        if (theme === "custom") {
          set({ theme });
          applyTheme(theme, get().clipPalette, get().customTheme);
          return;
        }
        set({ theme, uiTheme: theme, clipPalette: theme });
        applyTheme(theme, theme, null);
      },

      setFontFamily: (fontFamily) => {
        set({ fontFamily });
        applyFontFamily(fontFamily);
      },

      setCustomTheme: (colors) => {
        set({ customTheme: colors, theme: "custom" });
        applyTheme("custom", get().clipPalette, colors);
      },

      resetCustomTheme: () => {
        set({
          customTheme: null,
          theme: "dark",
          uiTheme: "dark",
          clipPalette: "dark",
        });
        applyTheme("dark", "dark", null);
      },

      setSnapToGrid: (snapToGrid) => set({ snapToGrid }),
      setAutoSave: (autoSave) => set({ autoSave }),
      setDefaultFrameRate: (defaultFrameRate) => set({ defaultFrameRate }),
      setPreviewQuality: (previewQuality) => set({ previewQuality }),
      setProxyEditingEnabled: (proxyEditingEnabled) =>
        set({ proxyEditingEnabled }),
      setAutoClearCacheOnProjectClose: (autoClearCacheOnProjectClose) =>
        set({ autoClearCacheOnProjectClose }),
      setPerformanceTelemetryEnabled: (performanceTelemetryEnabled) => {
        set({ performanceTelemetryEnabled });
        telemetryCollector.setEnabled(performanceTelemetryEnabled);
        if (!performanceTelemetryEnabled) {
          telemetryCollector.clearQueue();
        }
      },
      setLayoutPreset: (layoutPreset) => set({ layoutPreset }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setPropertiesPanelWidth: (propertiesPanelWidth) =>
        set({ propertiesPanelWidth }),
      setTallPlayerWidth: (tallPlayerWidth) => set({ tallPlayerWidth }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setPropertiesPanelCollapsed: (propertiesPanelCollapsed) =>
        set({ propertiesPanelCollapsed }),
      setTimelineHeight: (timelineHeight) => set({ timelineHeight }),
    }),
    {
      name: "clypra-settings",
      version: 2,
      migrate: (persistedState: unknown) => {
        const persisted = (persistedState || {}) as Partial<SettingsStore>;
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
          telemetryCollector.setEnabled(state.performanceTelemetryEnabled ?? true);
        }
      },
    },
  ),
);

export function initSettings() {
  const state = useSettingsStore.getState();
  applyTheme(state.theme, state.clipPalette, state.customTheme);
  applyFontFamily(state.fontFamily);
  telemetryCollector.setEnabled(state.performanceTelemetryEnabled ?? true);
}
