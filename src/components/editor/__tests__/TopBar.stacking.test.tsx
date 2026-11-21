/**
 * Regression tests for the TopBar stacking-context elevation.
 *
 * The TopBar root div has `backdrop-blur-md` which creates a stacking context
 * and a containing block for `position: fixed` descendants. Without an
 * explicit z-index, the editor body (a later sibling at z-index auto) paints
 * on top, hiding dropdowns trapped inside the TopBar — the workspace layout
 * dropdown and the export menu both rendered behind editor panels.
 *
 * The fix adds the `z-topbar` design token (mapped to `--ds-z-dropdown: 50`)
 * to the TopBar root div, raising its stacking context above the editor body.
 * These tests verify the token is applied and both dropdown triggers remain
 * children of the elevated container.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ─── Mock stores ─────────────────────────────────────────────────────────

vi.mock("@/store/projectStore", () => ({
  useProjectStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      project: { name: "Test Project" },
      closeProject: vi.fn(),
    };
    return typeof selector === "function" ? selector(state) : state;
  }),
}));

vi.mock("@/store/uiStore", () => ({
  useUIStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      toggleSettingsModal: vi.fn(),
      toggleTransferModal: vi.fn(),
      showSettingsModal: false,
      showTransferModal: false,
      activeOverlayIds: [],
      registerOverlay: vi.fn(),
      unregisterOverlay: vi.fn(),
    };
    return typeof selector === "function" ? selector(state) : state;
  }),
}));

vi.mock("@/store/settingsStore", () => ({
  useSettingsStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      sidebarCollapsed: false,
      setSidebarCollapsed: vi.fn(),
      propertiesPanelCollapsed: false,
      setPropertiesPanelCollapsed: vi.fn(),
      layoutPreset: "default",
      setLayoutPreset: vi.fn(),
    };
    return typeof selector === "function" ? selector(state) : state;
  }),
}));

// ─── Mock i18n ────────────────────────────────────────────────────────────

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

// ─── Mock native surface & preview lifecycle ──────────────────────────────

vi.mock("@/core/runtime/nativeSurfaceLifecycle", () => ({
  hideNativeSurfaceWhenIdle: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/core/preview/previewRepaintCoordinator", () => ({
  forceRepaintNativeProgramPreview: vi.fn(),
  wakeNativeProgramPreviewRenderLoop: vi.fn(),
}));

// ─── Mock platform ────────────────────────────────────────────────────────

vi.mock("@/core/platform", () => ({
  platform: { type: "web" },
}));

vi.mock("@/lib/platform/windowPlatform", () => ({
  isMacOSPlatform: () => false,
}));

// ─── Mock hooks ───────────────────────────────────────────────────────────

vi.mock("@/hooks", () => ({
  useClickOutside: vi.fn(),
}));

// ─── Tests ────────────────────────────────────────────────────────────────

import { TopBar } from "../TopBar";

describe("TopBar stacking context elevation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies the z-topbar design token to the root container", () => {
    render(<TopBar />);

    const topbar = screen.getByTestId("editor-topbar");
    expect(topbar).toBeInTheDocument();
    // z-topbar maps to --ds-z-dropdown (50), raising the backdrop-blur
    // stacking context above the z-auto editor body so dropdowns render
    // on top of editor panels instead of behind them.
    expect(topbar).toHaveClass("z-topbar");
  });

  it("renders the workspace layout dropdown trigger inside the elevated TopBar", () => {
    render(<TopBar />);

    const topbar = screen.getByTestId("editor-topbar");
    const layoutButton = screen.getByLabelText(
      "layout.presets.switchWorkspace",
    );
    expect(layoutButton).toBeInTheDocument();
    expect(topbar.contains(layoutButton)).toBe(true);
  });

  it("renders the export dropdown trigger inside the elevated TopBar", () => {
    render(<TopBar />);

    const topbar = screen.getByTestId("editor-topbar");
    const exportButton = screen.getByLabelText("export.video");
    expect(exportButton).toBeInTheDocument();
    expect(topbar.contains(exportButton)).toBe(true);
  });
});
