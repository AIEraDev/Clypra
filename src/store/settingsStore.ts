import { create } from "zustand";
import { persist } from "zustand/middleware";
import { setLanguage as setI18nLanguage, type MessageKey, type UiLanguage } from "@/i18n";

export type Theme = "dark" | "midnight" | "ocean" | "forest" | "midnight-carbon" | "ember-studio" | "forest-console" | "slate-noir" | "rose-cut" | "custom";
export type FontFamily = "inter" | "montserrat" | "geist" | "outfit" | "roboto" | "space-grotesk" | "system" | "mono";
export type FrameRate = 24 | 30 | 60;
export type PreviewQuality = "full" | "high" | "medium" | "low";

interface SettingsStore {
  // Appearance
  language: UiLanguage;
  theme: Theme;
  fontFamily: FontFamily;
  customTheme: Record<string, string> | null;
  setTheme: (theme: Theme) => void;
  setFontFamily: (fontFamily: FontFamily) => void;
  setCustomTheme: (colors: Record<string, string>) => void;
  resetCustomTheme: () => void;
  setLanguage: (language: UiLanguage) => void;
  // Editor
  snapToGrid: boolean;
  autoSave: boolean;
  defaultFrameRate: FrameRate;
  previewQuality: PreviewQuality;
  setSnapToGrid: (v: boolean) => void;
  setAutoSave: (v: boolean) => void;
  setDefaultFrameRate: (v: FrameRate) => void;
  setPreviewQuality: (v: PreviewQuality) => void;
}

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
    // Guides & Indicators
    "--color-guide-center": "#ff3b30",
    "--color-snap-guide-clip": "#10b981",
    "--color-handle": "#ffffff",
    "--color-handle-border": "rgba(0, 0, 0, 0.25)",
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
    "--color-timeline-text-clip-text": "#fceae6",

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
    "--color-timeline-text-clip-text": "#fceae6",

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
    "--color-video-clip": "#0f2a3d",
    "--color-audio-clip": "#0c2535",
    "--color-text-clip": "#1a3040",
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
    "--color-timeline-clip-video": "#0f2a3d",
    "--color-timeline-clip-video-border": "rgba(61, 184, 217, 0.4)",
    "--color-timeline-clip-audio": "#0c2535",
    "--color-timeline-clip-audio-border": "rgba(61, 184, 217, 0.4)",
    "--color-timeline-clip-text": "#d0e8ff",
    "--color-timeline-clip-duration": "#b0d8f0",
    "--color-timeline-filmstrip-bg": "rgba(12, 26, 40, 0.4)",
    "--color-timeline-filmstrip-empty": "rgba(12, 26, 40, 0.6)",
    "--color-timeline-filmstrip-border": "rgba(0, 0, 0, 0.2)",
    "--color-timeline-ghost-track-bg": "#0c1a28",
    "--color-timeline-drop-indicator": "#3db8d9",
    "--color-timeline-drop-zone-text": "#5a7a94",
    "--color-timeline-clip-invalid": "#ef4444",
    "--color-timeline-text-clip-bg": "#9c4937",
    "--color-timeline-text-clip-text": "#fceae6",

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
    "--color-video-clip": "#1a2e1e",
    "--color-audio-clip": "#142a1c",
    "--color-text-clip": "#2a3820",
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
    "--color-timeline-clip-video": "#1a2e1e",
    "--color-timeline-clip-video-border": "rgba(82, 200, 130, 0.4)",
    "--color-timeline-clip-audio": "#142a1c",
    "--color-timeline-clip-audio-border": "rgba(82, 200, 130, 0.4)",
    "--color-timeline-clip-text": "#d8edd9",
    "--color-timeline-clip-duration": "#b8ddb9",
    "--color-timeline-filmstrip-bg": "rgba(17, 26, 20, 0.4)",
    "--color-timeline-filmstrip-empty": "rgba(17, 26, 20, 0.6)",
    "--color-timeline-filmstrip-border": "rgba(0, 0, 0, 0.2)",
    "--color-timeline-ghost-track-bg": "#111a14",
    "--color-timeline-drop-indicator": "#52c882",
    "--color-timeline-drop-zone-text": "#5a7a5f",
    "--color-timeline-clip-invalid": "#ef4444",
    "--color-timeline-text-clip-bg": "#9c4937",
    "--color-timeline-text-clip-text": "#fceae6",

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
    "--color-video-clip": "#2d4851",
    "--color-audio-clip": "#253e48",
    "--color-text-clip": "#30383e",
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
    "--color-timeline-clip-video": "#2d4851",
    "--color-timeline-clip-video-border": "rgba(93, 182, 214, 0.4)",
    "--color-timeline-clip-audio": "#253e48",
    "--color-timeline-clip-audio-border": "rgba(93, 182, 214, 0.4)",
    "--color-timeline-clip-text": "#dce8ed",
    "--color-timeline-clip-duration": "#c0d5de",
    "--color-timeline-filmstrip-bg": "rgba(32, 41, 49, 0.4)",
    "--color-timeline-filmstrip-empty": "rgba(32, 41, 49, 0.6)",
    "--color-timeline-filmstrip-border": "rgba(0, 0, 0, 0.2)",
    "--color-timeline-ghost-track-bg": "#202931",
    "--color-timeline-drop-indicator": "#5db6d6",
    "--color-timeline-drop-zone-text": "#7a8694",
    "--color-timeline-clip-invalid": "#ef4444",
    "--color-timeline-text-clip-bg": "#9c4937",
    "--color-timeline-text-clip-text": "#fceae6",

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
    "--color-video-clip": "#3f3120",
    "--color-audio-clip": "#332818",
    "--color-text-clip": "#3d2915",
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
    "--color-timeline-clip-video": "#3f3120",
    "--color-timeline-clip-video-border": "rgba(217, 138, 80, 0.4)",
    "--color-timeline-clip-audio": "#332818",
    "--color-timeline-clip-audio-border": "rgba(217, 138, 80, 0.4)",
    "--color-timeline-clip-text": "#ebe4da",
    "--color-timeline-clip-duration": "#d9cbb9",
    "--color-timeline-filmstrip-bg": "rgba(35, 29, 24, 0.4)",
    "--color-timeline-filmstrip-empty": "rgba(35, 29, 24, 0.6)",
    "--color-timeline-filmstrip-border": "rgba(0, 0, 0, 0.2)",
    "--color-timeline-ghost-track-bg": "#231d18",
    "--color-timeline-drop-indicator": "#d98a50",
    "--color-timeline-drop-zone-text": "#8a7665",
    "--color-timeline-clip-invalid": "#ef4444",
    "--color-timeline-text-clip-bg": "#9c4937",
    "--color-timeline-text-clip-text": "#fceae6",

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
    "--color-video-clip": "#2d4236",
    "--color-audio-clip": "#24382d",
    "--color-text-clip": "#2a342c",
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
    "--color-timeline-clip-video": "#2d4236",
    "--color-timeline-clip-video-border": "rgba(110, 191, 139, 0.4)",
    "--color-timeline-clip-audio": "#24382d",
    "--color-timeline-clip-audio-border": "rgba(110, 191, 139, 0.4)",
    "--color-timeline-clip-text": "#dae8dd",
    "--color-timeline-clip-duration": "#bed5c5",
    "--color-timeline-filmstrip-bg": "rgba(28, 36, 30, 0.4)",
    "--color-timeline-filmstrip-empty": "rgba(28, 36, 30, 0.6)",
    "--color-timeline-filmstrip-border": "rgba(0, 0, 0, 0.2)",
    "--color-timeline-ghost-track-bg": "#1c241e",
    "--color-timeline-drop-indicator": "#6ebf8b",
    "--color-timeline-drop-zone-text": "#6e826f",
    "--color-timeline-clip-invalid": "#ef4444",
    "--color-timeline-text-clip-bg": "#9c4937",
    "--color-timeline-text-clip-text": "#fceae6",

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
    "--color-video-clip": "#314048",
    "--color-audio-clip": "#283840",
    "--color-text-clip": "#30363c",
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
    "--color-timeline-clip-video": "#314048",
    "--color-timeline-clip-video-border": "rgba(107, 169, 196, 0.4)",
    "--color-timeline-clip-audio": "#283840",
    "--color-timeline-clip-audio-border": "rgba(107, 169, 196, 0.4)",
    "--color-timeline-clip-text": "#dde7eb",
    "--color-timeline-clip-duration": "#c2d4db",
    "--color-timeline-filmstrip-bg": "rgba(34, 38, 42, 0.4)",
    "--color-timeline-filmstrip-empty": "rgba(34, 38, 42, 0.6)",
    "--color-timeline-filmstrip-border": "rgba(0, 0, 0, 0.2)",
    "--color-timeline-ghost-track-bg": "#22262a",
    "--color-timeline-drop-indicator": "#6ba9c4",
    "--color-timeline-drop-zone-text": "#767b82",
    "--color-timeline-clip-invalid": "#ef4444",
    "--color-timeline-text-clip-bg": "#9c4937",
    "--color-timeline-text-clip-text": "#fceae6",

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
    "--color-video-clip": "#40303a",
    "--color-audio-clip": "#342731",
    "--color-text-clip": "#3a2930",
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
    "--color-timeline-clip-video": "#40303a",
    "--color-timeline-clip-video-border": "rgba(217, 112, 151, 0.4)",
    "--color-timeline-clip-audio": "#342731",
    "--color-timeline-clip-audio-border": "rgba(217, 112, 151, 0.4)",
    "--color-timeline-clip-text": "#eedde3",
    "--color-timeline-clip-duration": "#dcc3cd",
    "--color-timeline-filmstrip-bg": "rgba(35, 28, 32, 0.4)",
    "--color-timeline-filmstrip-empty": "rgba(35, 28, 32, 0.6)",
    "--color-timeline-filmstrip-border": "rgba(0, 0, 0, 0.2)",
    "--color-timeline-ghost-track-bg": "#231c20",
    "--color-timeline-drop-indicator": "#d97097",
    "--color-timeline-drop-zone-text": "#847478",
    "--color-timeline-clip-invalid": "#ef4444",
    "--color-timeline-text-clip-bg": "#9c4937",
    "--color-timeline-text-clip-text": "#fceae6",

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

/** Human-readable metadata for each theme (used by SettingsModal) */
export const THEME_META: Record<Theme, { nameKey: MessageKey; descriptionKey: MessageKey }> = {
  dark: { nameKey: "settings.theme.dark.name", descriptionKey: "settings.theme.dark.description" },
  midnight: { nameKey: "settings.theme.midnight.name", descriptionKey: "settings.theme.midnight.description" },
  ocean: { nameKey: "settings.theme.ocean.name", descriptionKey: "settings.theme.ocean.description" },
  forest: { nameKey: "settings.theme.forest.name", descriptionKey: "settings.theme.forest.description" },
  "midnight-carbon": {
    nameKey: "settings.theme.midnightCarbon.name",
    descriptionKey: "settings.theme.midnightCarbon.description",
  },
  "ember-studio": {
    nameKey: "settings.theme.emberStudio.name",
    descriptionKey: "settings.theme.emberStudio.description",
  },
  "forest-console": {
    nameKey: "settings.theme.forestConsole.name",
    descriptionKey: "settings.theme.forestConsole.description",
  },
  "slate-noir": {
    nameKey: "settings.theme.slateNoir.name",
    descriptionKey: "settings.theme.slateNoir.description",
  },
  "rose-cut": {
    nameKey: "settings.theme.roseCut.name",
    descriptionKey: "settings.theme.roseCut.description",
  },
  custom: { nameKey: "settings.theme.custom.name", descriptionKey: "settings.theme.custom.description" },
};

function isTheme(value: unknown): value is Theme {
  return (
    value === "custom" ||
    (typeof value === "string" && Object.prototype.hasOwnProperty.call(themes, value))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SAFE_COLOR_KEYWORDS = new Set([
  "aqua",
  "black",
  "blue",
  "currentcolor",
  "fuchsia",
  "gray",
  "green",
  "lime",
  "maroon",
  "navy",
  "olive",
  "orange",
  "purple",
  "rebeccapurple",
  "red",
  "silver",
  "teal",
  "transparent",
  "white",
  "yellow",
]);

function isValidCssColor(value: string): boolean {
  if (
    /[;{}]/.test(value) ||
    /^(?:inherit|initial|revert|revert-layer|unset)$/i.test(value) ||
    /(?:url|var|env)\s*\(/i.test(value)
  ) {
    return false;
  }

  if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
    return CSS.supports("color", value);
  }

  if (typeof document !== "undefined") {
    const style = document.createElement("span").style;
    style.color = "";
    style.color = value;
    return style.color !== "";
  }

  if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) {
    return true;
  }

  if (
    /^(?:rgba?|hsla?)\(\s*[-+\d.%]+\s*(?:,\s*[-+\d.%]+\s*){2}(?:,\s*[-+\d.%]+\s*)?\)$/i.test(
      value,
    )
  ) {
    return true;
  }

  return SAFE_COLOR_KEYWORDS.has(value.toLowerCase());
}

export function sanitizeThemeColors(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;

  const entries = Object.entries(value);
  if (entries.length === 0) return null;

  const allowedKeys = new Set(Object.keys(themes.dark));
  const sanitized: Record<string, string> = {};

  for (const [key, color] of entries) {
    if (!allowedKeys.has(key) || typeof color !== "string") return null;

    const normalizedColor = color.trim();
    if (!normalizedColor || !isValidCssColor(normalizedColor)) return null;
    sanitized[key] = normalizedColor;
  }

  return sanitized;
}

function normalizeCustomTheme(value: unknown): Record<string, string> | null {
  const sanitizedColors = sanitizeThemeColors(value);
  return sanitizedColors ? { ...themes.dark, ...sanitizedColors } : null;
}

/** Returns the raw theme color tokens for a given theme (for live previews) */
export function getThemeColors(t: Theme, customColors?: Record<string, string> | null): Record<string, string> {
  const safeTheme = isTheme(t) ? t : "dark";
  const safeCustomColors = normalizeCustomTheme(customColors);

  if (safeTheme === "custom" && safeCustomColors) {
    return safeCustomColors;
  }
  if (safeTheme === "custom") {
    return themes.dark;
  }
  return themes[safeTheme];
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

function isFontFamily(value: unknown): value is FontFamily {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(fontFamilies, value);
}

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
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const safeTheme = isTheme(theme) ? theme : "dark";
  const safeCustomColors = normalizeCustomTheme(customColors);
  let themeColors: Record<string, string>;

  if (safeTheme === "custom" && safeCustomColors) {
    themeColors = safeCustomColors;
  } else if (safeTheme === "custom") {
    themeColors = themes.dark;
  } else {
    themeColors = themes[safeTheme];
  }

  Object.entries(themeColors).forEach(([property, value]) => {
    root.style.setProperty(property, value);
  });
}

export function applyFontFamily(fontFamily: FontFamily) {
  if (typeof document === "undefined") return;

  const safeFontFamily = isFontFamily(fontFamily) ? fontFamily : "inter";
  const root = document.documentElement;
  root.style.setProperty("--font-sans", fontFamilies[safeFontFamily]);
  if (document.body) {
    document.body.style.fontFamily = fontFamilies[safeFontFamily];
  }
}

export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === "zhCN" || value === "en";
}

export function applyLanguage(language: UiLanguage): void {
  setI18nLanguage(language);
  if (typeof document !== "undefined") {
    document.documentElement.lang = language === "zhCN" ? "zh-CN" : "en";
  }
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function mergePersistedSettings(
  persistedState: unknown,
  currentState: SettingsStore,
): SettingsStore {
  if (!isRecord(persistedState)) {
    return { ...currentState, language: "zhCN" };
  }

  const customTheme = hasOwn(persistedState, "customTheme")
    ? normalizeCustomTheme(persistedState.customTheme)
    : normalizeCustomTheme(currentState.customTheme);
  const persistedTheme = hasOwn(persistedState, "theme")
    ? isTheme(persistedState.theme)
      ? persistedState.theme
      : "dark"
    : currentState.theme;
  const theme = persistedTheme === "custom" && !customTheme ? "dark" : persistedTheme;
  const fontFamily = hasOwn(persistedState, "fontFamily")
    ? isFontFamily(persistedState.fontFamily)
      ? persistedState.fontFamily
      : "inter"
    : currentState.fontFamily;
  const defaultFrameRate = [24, 30, 60].includes(persistedState.defaultFrameRate as number)
    ? (persistedState.defaultFrameRate as FrameRate)
    : currentState.defaultFrameRate;
  const previewQuality = ["full", "high", "medium", "low"].includes(
    persistedState.previewQuality as string,
  )
    ? (persistedState.previewQuality as PreviewQuality)
    : currentState.previewQuality;
  const language = isUiLanguage(persistedState.language)
    ? persistedState.language
    : "zhCN";

  return {
    ...currentState,
    language,
    theme,
    fontFamily,
    customTheme,
    snapToGrid:
      typeof persistedState.snapToGrid === "boolean"
        ? persistedState.snapToGrid
        : currentState.snapToGrid,
    autoSave:
      typeof persistedState.autoSave === "boolean"
        ? persistedState.autoSave
        : currentState.autoSave,
    defaultFrameRate,
    previewQuality,
  };
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      language: "zhCN",
      theme: "dark",
      fontFamily: "inter",
      customTheme: null,
      snapToGrid: true,
      autoSave: true,
      defaultFrameRate: 30,
      previewQuality: "high",

      setLanguage: (language) => {
        const safeLanguage = isUiLanguage(language) ? language : "zhCN";
        set({ language: safeLanguage });
        applyLanguage(safeLanguage);
      },

      setTheme: (theme) => {
        const safeTheme = isTheme(theme) ? theme : "dark";
        const customTheme = normalizeCustomTheme(get().customTheme);
        const nextTheme = safeTheme === "custom" && !customTheme ? "dark" : safeTheme;
        set({ theme: nextTheme, customTheme });
        applyTheme(nextTheme, customTheme);
      },

      setFontFamily: (fontFamily) => {
        const safeFontFamily = isFontFamily(fontFamily) ? fontFamily : "inter";
        set({ fontFamily: safeFontFamily });
        applyFontFamily(safeFontFamily);
      },

      setCustomTheme: (colors) => {
        const sanitizedColors = normalizeCustomTheme(colors);
        if (!sanitizedColors) return;

        set({ customTheme: sanitizedColors, theme: "custom" });
        applyTheme("custom", sanitizedColors);
      },

      resetCustomTheme: () => {
        set({ customTheme: null, theme: "dark" });
        applyTheme("dark", null);
      },

      setSnapToGrid: (snapToGrid) => set({ snapToGrid }),
      setAutoSave: (autoSave) => set({ autoSave }),
      setDefaultFrameRate: (defaultFrameRate) => set({ defaultFrameRate }),
      setPreviewQuality: (previewQuality) => set({ previewQuality }),
    }),
    {
      name: "clypra-settings",
      merge: mergePersistedSettings,
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyLanguage(state.language);
          applyTheme(state.theme, state.customTheme);
          applyFontFamily(state.fontFamily);
        }
      },
    },
  ),
);

export function initSettings() {
  const state = useSettingsStore.getState();
  applyLanguage(state.language);
  applyTheme(state.theme, state.customTheme);
  applyFontFamily(state.fontFamily);
}

/** Get all color variable names for theme editor */
export function getThemeColorKeys(): string[] {
  return Object.keys(themes.dark);
}

/** Get a base theme to start customization from */
export function getBaseThemeForCustomization(baseTheme: Exclude<Theme, "custom">): Record<string, string> {
  return { ...themes[baseTheme] };
}
