/**
 * Regression tests for the SettingsModal frame rate dropdowns.
 *
 * Task 3 (PAL & broadcast frame rate support, issue #547) replaced the
 * three-button toggle group with a <select> dropdown populated from
 * SUPPORTED_FRAME_RATES. These tests guard:
 *   - Both dropdowns render all 7 rate options.
 *   - The project frame rate onChange path calls updateProject correctly.
 *   - The default frame rate onChange path calls setDefaultFrameRate correctly.
 *   - The Number(e.target.value) as FrameRate conversion produces the exact
 *     numeric value and not a string or truncated integer.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsModal } from "../SettingsModal";
import { SUPPORTED_FRAME_RATES } from "@/store/settingsTypes";
import type { FrameRate } from "@/store/settingsTypes";

// ─── Mock heavy sub-components that are irrelevant to frame rate ─────────

vi.mock("@/components/settings/CacheSettings", () => ({
  CacheSettings: () => <div data-testid="cache-settings" />,
}));

vi.mock("@/components/settings/WhisperSettings", () => ({
  WhisperSettings: () => <div data-testid="whisper-settings" />,
}));

vi.mock("@/components/settings/KeyboardShortcutsSettings", () => ({
  KeyboardShortcutsSettings: () => (
    <div data-testid="keyboard-shortcuts-settings" />
  ),
}));

vi.mock("@/components/settings/PreviewDiagnosticsTab", () => ({
  PreviewDiagnosticsTab: () => <div data-testid="preview-diagnostics-tab" />,
}));

vi.mock("@clypra/ui-color-picker", () => ({
  ClypraColorPicker: () => <div data-testid="color-picker-mock" />,
}));

// ─── Mock Tauri APIs ──────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("1.6.0"),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

// ─── Mock platform service ────────────────────────────────────────────────

vi.mock("@/core/platform", () => ({
  platform: {
    isCapacitor: () => false,
  },
}));

vi.mock("@/services/updaterService", () => ({
  isTauriDesktop: () => false,
}));

vi.mock("@/hooks/useAutoUpdater", () => ({
  useAutoUpdater: () => ({
    status: "idle",
    updateInfo: null,
    downloadProgress: 0,
    error: null,
    downloadUpdate: vi.fn(),
    applyUpdate: vi.fn(),
    later: vi.fn(),
    recheckUpdate: vi.fn(),
  }),
}));

// ─── Mock toast ───────────────────────────────────────────────────────────

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ─── Mock i18n ────────────────────────────────────────────────────────────

vi.mock("@/i18n/I18nProvider", () => {
  const t = (key: string) => {
    const dict: Record<string, string> = {
      "settings.modal.title": "Settings",
      "settings.tabs.appearance": "Appearance",
      "settings.tabs.editor": "Editor",
      "settings.tabs.shortcuts": "Shortcuts",
      "settings.tabs.captions": "Auto-Captions",
      "settings.tabs.storage": "Storage & Cache",
      "settings.tabs.diagnostics": "Diagnostics",
      "settings.tabs.about": "About",
      "settings.language.label": "Language",
      "settings.language.description": "Interface language",
      "settings.theme.title": "Theme",
      "settings.theme.custom": "Custom",
      "settings.theme.hideEditor": "Hide Editor",
      "settings.theme.reset": "Reset",
      "settings.theme.searchColors": "Search colors…",
      "settings.font.title": "Font",
      "common.actions.reset": "Reset",
      "modal.close": "Close",
    };
    return dict[key] ?? key;
  };

  return {
    useI18n: () => ({
      t,
      language: "en",
      setLanguage: vi.fn(),
    }),
    SUPPORTED_LANGUAGES: [
      { code: "en", name: "English", nativeName: "English" },
    ],
  };
});

// ─── Mock settingsStore ───────────────────────────────────────────────────

const mockSetDefaultFrameRate = vi.fn();

vi.mock("@/store/settingsStore", () => ({
  useSettingsStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      // appearance
      theme: "dark",
      uiTheme: "dark",
      clipPalette: "dark",
      fontFamily: "inter",
      customTheme: null,
      setUiTheme: vi.fn(),
      setClipPalette: vi.fn(),
      setTheme: vi.fn(),
      setFontFamily: vi.fn(),
      setCustomTheme: vi.fn(),
      resetCustomTheme: vi.fn(),
      // editor
      snapToGrid: true,
      autoSave: true,
      defaultFrameRate: 30 as FrameRate,
      previewQuality: "full",
      proxyEditingEnabled: false,
      autoClearCacheOnProjectClose: false,
      setSnapToGrid: vi.fn(),
      setAutoSave: vi.fn(),
      setDefaultFrameRate: mockSetDefaultFrameRate,
      setPreviewQuality: vi.fn(),
      setProxyEditingEnabled: vi.fn(),
      setAutoClearCacheOnProjectClose: vi.fn(),
    };
    return typeof selector === "function" ? selector(state) : state;
  }),
  // Named re-exports used by SettingsModal component
  Theme: {},
  UiTheme: {},
  ClipPalette: {},
  CLIP_PALETTE_IDS: ["dark", "midnight", "ocean"],
  FontFamily: {},
  THEME_META: {
    dark: { name: "Dark", description: "Dark theme" },
    midnight: { name: "Midnight", description: "Midnight theme" },
    ocean: { name: "Ocean", description: "Ocean theme" },
    forest: { name: "Forest", description: "Forest theme" },
    "midnight-carbon": { name: "Midnight Carbon", description: "" },
    "ember-studio": { name: "Ember Studio", description: "" },
    "forest-console": { name: "Forest Console", description: "" },
    "slate-noir": { name: "Slate Noir", description: "" },
    "rose-cut": { name: "Rose Cut", description: "" },
  },
  CLIP_PALETTE_META: {
    dark: { name: "Dark", description: "Dark palette" },
    midnight: { name: "Midnight", description: "" },
    ocean: { name: "Ocean", description: "" },
  },
  FONT_META: {
    inter: { name: "Inter", stack: "Inter, sans-serif" },
    montserrat: { name: "Montserrat", stack: "Montserrat, sans-serif" },
    geist: { name: "Geist", stack: "Geist, sans-serif" },
    outfit: { name: "Outfit", stack: "Outfit, sans-serif" },
    roboto: { name: "Roboto", stack: "Roboto, sans-serif" },
    "space-grotesk": {
      name: "Space Grotesk",
      stack: "Space Grotesk, sans-serif",
    },
    system: { name: "System", stack: "system-ui, sans-serif" },
    mono: { name: "Mono", stack: "ui-monospace, monospace" },
  },
  getThemeColors: vi.fn(() => ({
    "--color-bg": "#1a1a1a",
    "--color-surface": "#222",
    "--color-surface-raised": "#2a2a2a",
    "--color-accent": "#6366f1",
    "--color-border": "#333",
    "--color-text-primary": "#fff",
    "--color-text-muted": "#888",
    "--color-timeline-bg": "#1a1a1a",
    "--color-timeline-track-bg": "#222",
    "--color-timeline-track-border": "#333",
    "--color-timeline-clip-video": "#6366f1",
    "--color-timeline-clip-audio": "#22c55e",
    "--color-timeline-ruler-bg": "#222",
  })),
  getClipPaletteColors: vi.fn(() => ({
    "--color-timeline-clip-video": "#6366f1",
    "--color-timeline-clip-audio": "#22c55e",
    "--color-timeline-clip-text": "#f59e0b",
  })),
  getBaseThemeForCustomization: vi.fn(() => ({})),
  getThemeColorKeys: vi.fn(() => []),
}));

// ─── Mock projectStore ────────────────────────────────────────────────────

const mockUpdateProject = vi.fn();

vi.mock("@/store/projectStore", () => ({
  useProjectStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      project: {
        id: "proj-1",
        name: "Test Project",
        frameRate: 30 as FrameRate,
        aspectRatio: "16:9",
        canvasWidth: 1920,
        canvasHeight: 1080,
        duration: 60,
        createdAt: 0,
        updatedAt: 0,
      },
      updateProject: mockUpdateProject,
    };
    return typeof selector === "function" ? selector(state) : state;
  }),
}));

// ─── Mock timelineStore ───────────────────────────────────────────────────

vi.mock("@/store/timelineStore", () => ({
  useTimelineStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      snapEnabled: true,
      toggleSnapEnabled: vi.fn(),
    };
    return typeof selector === "function" ? selector(state) : state;
  }),
}));

// ─── Mock refitClips ──────────────────────────────────────────────────────

vi.mock("@/lib/timeline/refitClips", () => ({
  refitClipsForCanvasChange: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────

function renderAndNavigateToEditorTab() {
  render(<SettingsModal isOpen={true} onClose={vi.fn()} />);
  // Click the "Editor" sidebar button to show EditorTab
  const editorTabBtn = screen.getByRole("button", { name: /editor/i });
  fireEvent.click(editorTabBtn);
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("SettingsModal — frame rate dropdowns (issue #547)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("project 'Frame rate' dropdown renders all 7 options from SUPPORTED_FRAME_RATES", () => {
    renderAndNavigateToEditorTab();

    // The project frame rate select has a label row saying "Frame rate"
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    // Find the one whose current value matches the mocked project.frameRate (30)
    const projectSelect = selects.find((s) => s.value === "30");
    expect(projectSelect).toBeDefined();

    const options = Array.from(projectSelect!.options).map((o) =>
      Number(o.value),
    );
    expect(options).toEqual([...SUPPORTED_FRAME_RATES]);
  });

  it("'Default frame rate' dropdown renders all 7 options from SUPPORTED_FRAME_RATES", () => {
    renderAndNavigateToEditorTab();

    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    // Both selects show "30" (mocked defaultFrameRate === 30, project.frameRate === 30),
    // so verify we have at least 2 selects and each contains all 7 options.
    expect(selects.length).toBeGreaterThanOrEqual(2);
    for (const sel of selects) {
      const options = Array.from(sel.options).map((o) => Number(o.value));
      expect(options).toEqual([...SUPPORTED_FRAME_RATES]);
    }
  });

  it("selecting '25' on the project frame rate dropdown calls updateProject({ frameRate: 25 })", () => {
    renderAndNavigateToEditorTab();

    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    const projectSelect = selects.find((s) => s.value === "30");
    expect(projectSelect).toBeDefined();

    fireEvent.change(projectSelect!, { target: { value: "25" } });

    expect(mockUpdateProject).toHaveBeenCalledTimes(1);
    expect(mockUpdateProject).toHaveBeenCalledWith({ frameRate: 25 });
    // Confirm it's the number 25, not the string "25"
    const arg = mockUpdateProject.mock.calls[0][0] as { frameRate: unknown };
    expect(typeof arg.frameRate).toBe("number");
    expect(arg.frameRate).toBe(25);
  });

  it("selecting '23.976' on the project frame rate dropdown calls updateProject({ frameRate: 23.976 })", () => {
    renderAndNavigateToEditorTab();

    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    const projectSelect = selects.find((s) => s.value === "30");
    expect(projectSelect).toBeDefined();

    fireEvent.change(projectSelect!, { target: { value: "23.976" } });

    expect(mockUpdateProject).toHaveBeenCalledTimes(1);
    expect(mockUpdateProject).toHaveBeenCalledWith({ frameRate: 23.976 });
    // Confirm exact fractional number, not a truncated integer
    const arg = mockUpdateProject.mock.calls[0][0] as { frameRate: unknown };
    expect(typeof arg.frameRate).toBe("number");
    expect(arg.frameRate).toBe(23.976);
  });

  it("selecting '50' on the default frame rate dropdown calls setDefaultFrameRate(50)", () => {
    renderAndNavigateToEditorTab();

    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    // The default frame rate select is a separate <select> in the Defaults section.
    // Both have value "30" so pick the second occurrence.
    expect(selects.length).toBeGreaterThanOrEqual(2);
    const defaultSelect = selects[selects.length - 1];

    fireEvent.change(defaultSelect, { target: { value: "50" } });

    expect(mockSetDefaultFrameRate).toHaveBeenCalledTimes(1);
    expect(mockSetDefaultFrameRate).toHaveBeenCalledWith(50);
    const val = mockSetDefaultFrameRate.mock.calls[0][0] as unknown;
    expect(typeof val).toBe("number");
    expect(val).toBe(50);
  });
});
