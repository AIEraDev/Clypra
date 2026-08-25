/** Persisted settings state and its public value types. */
export type Theme =
  | "dark"
  | "midnight"
  | "ocean"
  | "forest"
  | "midnight-carbon"
  | "ember-studio"
  | "forest-console"
  | "slate-noir"
  | "rose-cut"
  | "custom";
/** The independent UI chrome layer. */
export type UiTheme = Exclude<Theme, "custom">;
/** The independent clip-colour layer. */
export type ClipPalette = UiTheme;

export type FontFamily =
  | "inter"
  | "montserrat"
  | "geist"
  | "outfit"
  | "roboto"
  | "space-grotesk"
  | "system"
  | "mono";
export type FrameRate = 24 | 30 | 60;
export type PreviewQuality = "full" | "high" | "medium" | "low";
export type LayoutPreset =
  | "default"
  | "tall-player-right"
  | "tall-player-left"
  | "timeline-focus"
  | "dual-player"
  | "cinema-preview"
  | "vertical-shorts"
  | "inspector-focus";

export interface SettingsStore {
  // Appearance
  uiTheme: UiTheme;
  clipPalette: ClipPalette;
  theme: Theme;
  fontFamily: FontFamily;
  customTheme: Record<string, string> | null;
  setUiTheme: (theme: UiTheme) => void;
  setClipPalette: (palette: ClipPalette) => void;
  setTheme: (theme: Theme) => void;
  setFontFamily: (fontFamily: FontFamily) => void;
  setCustomTheme: (colors: Record<string, string>) => void;
  resetCustomTheme: () => void;
  // Editor
  snapToGrid: boolean;
  autoSave: boolean;
  defaultFrameRate: FrameRate;
  previewQuality: PreviewQuality;
  setSnapToGrid: (v: boolean) => void;
  setAutoSave: (v: boolean) => void;
  setDefaultFrameRate: (v: FrameRate) => void;
  setPreviewQuality: (v: PreviewQuality) => void;
  // Performance
  proxyEditingEnabled: boolean;
  autoClearCacheOnProjectClose: boolean;
  setProxyEditingEnabled: (v: boolean) => void;
  setAutoClearCacheOnProjectClose: (v: boolean) => void;
  // Layout persistence (replaces anonymous localStorage keys)
  layoutPreset: LayoutPreset;
  sidebarWidth: number;
  propertiesPanelWidth: number;
  tallPlayerWidth: number;
  sidebarCollapsed: boolean;
  propertiesPanelCollapsed: boolean;
  timelineHeight: number;
  setLayoutPreset: (v: LayoutPreset) => void;
  setSidebarWidth: (v: number) => void;
  setPropertiesPanelWidth: (v: number) => void;
  setTallPlayerWidth: (v: number) => void;
  setSidebarCollapsed: (v: boolean) => void;
  setPropertiesPanelCollapsed: (v: boolean) => void;
  setTimelineHeight: (v: number) => void;
}


