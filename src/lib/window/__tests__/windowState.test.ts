import { describe, it, expect, vi, beforeEach } from "vitest";
import { savePreRecordingWindowGeometry, restorePreRecordingWindowGeometry } from "../windowState";

const mockWin = {
  isMaximized: vi.fn().mockResolvedValue(true),
  isFullscreen: vi.fn().mockResolvedValue(false),
  outerPosition: vi.fn().mockResolvedValue({ x: 200, y: 150 }),
  outerSize: vi.fn().mockResolvedValue({ width: 1920, height: 1080 }),
  setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
  setMinSize: vi.fn().mockResolvedValue(undefined),
  setPosition: vi.fn().mockResolvedValue(undefined),
  setSize: vi.fn().mockResolvedValue(undefined),
  maximize: vi.fn().mockResolvedValue(undefined),
  setFullscreen: vi.fn().mockResolvedValue(undefined),
  unminimize: vi.fn().mockResolvedValue(undefined),
  setFocus: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => mockWin,
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalSize: class LogicalSize {
    constructor(public width: number, public height: number) {}
  },
  LogicalPosition: class LogicalPosition {
    constructor(public x: number, public y: number) {}
  },
}));

describe("WindowState Module", () => {
  beforeEach(() => {
    delete (window as any).__clypra_pre_recording_geometry__;
    delete (window as any).__TAURI_INTERNALS__;
    vi.clearAllMocks();
  });

  it("should handle non-Tauri browser environments gracefully", async () => {
    const saved = await savePreRecordingWindowGeometry();
    expect(saved).toBeNull();

    await expect(restorePreRecordingWindowGeometry()).resolves.toBeUndefined();
  });

  it("should save and restore window geometry in Tauri environment", async () => {
    (window as any).__TAURI_INTERNALS__ = {};

    const snapshot = await savePreRecordingWindowGeometry();
    expect(snapshot).toEqual({
      x: 200,
      y: 150,
      width: 1920,
      height: 1080,
      isMaximized: true,
      isFullscreen: false,
    });

    await restorePreRecordingWindowGeometry();

    expect(mockWin.setAlwaysOnTop).toHaveBeenCalledWith(false);
    expect(mockWin.maximize).toHaveBeenCalled();
    expect(mockWin.unminimize).toHaveBeenCalled();
    expect(mockWin.setFocus).toHaveBeenCalled();
  });
});
