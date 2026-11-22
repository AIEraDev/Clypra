import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsModal } from "../SettingsModal";
import { useSettingsStore } from "@/store/settingsStore";
import { useUIStore } from "@/store/uiStore";
import { APP_VERSION } from "@/config/version";

// Mock child tabs that have complex dependencies
vi.mock("@/components/settings/CacheSettings", () => ({
  CacheSettings: () => <div data-testid="cache-settings-mock">Cache Settings Content</div>,
}));

vi.mock("@/components/settings/WhisperSettings", () => ({
  WhisperSettings: () => <div data-testid="whisper-settings-mock">Whisper Content</div>,
}));

vi.mock("@/components/settings/KeyboardShortcutsSettings", () => ({
  KeyboardShortcutsSettings: () => (
    <div data-testid="keyboard-shortcuts-mock">Shortcuts Content</div>
  ),
}));

// Mock updater service
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

describe("SettingsModal — Redesigned Experience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({ settingsInitialTab: null });
  });

  it("renders all 6 canonical tabs and excludes the removed Performance tab", () => {
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    // Verify presence of all 6 supported tabs
    expect(screen.getByRole("button", { name: /appearance/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /editor/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /shortcuts/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /auto-captions/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /storage & cache/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /about/i })).toBeDefined();

    // PERFORMANCE TAB REMOVAL VERIFICATION:
    // Neither "Preview Performance" nor "Diagnostics" tab should exist in the sidebar
    expect(screen.queryByRole("button", { name: /preview performance/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /diagnostics/i })).toBeNull();
  });

  it("switches tabs when clicking on sidebar buttons", () => {
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    // Initially in Appearance tab
    expect(screen.getByText("Font")).toBeDefined();

    // Click "Editor" tab
    fireEvent.click(screen.getByRole("button", { name: /editor/i }));
    expect(screen.getByText("Snap to grid")).toBeDefined();
    expect(screen.getByText("Playback & Quality")).toBeDefined();

    // Click "Storage & Cache" tab
    fireEvent.click(screen.getByRole("button", { name: /storage & cache/i }));
    expect(screen.getByTestId("cache-settings-mock")).toBeDefined();

    // Click "Shortcuts" tab
    fireEvent.click(screen.getByRole("button", { name: /shortcuts/i }));
    expect(screen.getByTestId("keyboard-shortcuts-mock")).toBeDefined();

    // Click "About" tab
    fireEvent.click(screen.getByRole("button", { name: /about/i }));
    expect(screen.getByText("Support the Project")).toBeDefined();
  });

  it("opens directly to settingsInitialTab if specified by uiStore", () => {
    useUIStore.setState({ settingsInitialTab: "about" });

    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    // Should render the About tab directly
    expect(screen.getByText("Support the Project")).toBeDefined();
    expect(screen.getByText(`v${APP_VERSION}`)).toBeDefined();
  });

  it("toggles Dark and Light mode from the Appearance tab", () => {
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    const lightButton = screen.getByRole("button", { name: /light/i });
    fireEvent.click(lightButton);
    expect(useSettingsStore.getState().uiTheme).toBe("light");

    const darkButton = screen.getByRole("button", { name: /dark/i });
    fireEvent.click(darkButton);
    expect(useSettingsStore.getState().uiTheme).toBe("dark");
  });

  it("renders dynamic version badge in About tab", () => {
    useUIStore.setState({ settingsInitialTab: "about" });

    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText(`v${APP_VERSION}`)).toBeDefined();
  });
});
