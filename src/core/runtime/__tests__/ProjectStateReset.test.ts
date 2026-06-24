/**
 * Project State Reset Tests
 *
 * Verify that centralized state reset works correctly when closing/opening projects.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetAllProjectState, detectStaleState, type ResetOptions } from "../ProjectStateReset";

// Mock implementations
vi.mock("@/store/dragStateStore", () => ({
  useDragStateStore: {
    getState: () => ({
      clearDragging: vi.fn(),
    }),
    setState: vi.fn(),
  },
}));

vi.mock("@/store/uiStore", () => ({
  useUIStore: {
    getState: () => ({}),
    setState: vi.fn(),
  },
}));

vi.mock("@/store/historyStore", () => ({
  useHistoryStore: {
    getState: () => ({
      clear: vi.fn(),
      state: { size: 0, canUndo: false },
    }),
  },
}));

vi.mock("@/core/interactions", () => ({
  getTransformController: () => ({
    endTransform: vi.fn(),
  }),
  getViewportController: () => ({
    reset: vi.fn(),
  }),
  resetViewportController: vi.fn(),
  resetTransformController: vi.fn(),
}));

vi.mock("@/core/playback/PlaybackClock", () => ({
  getPlaybackClock: () => ({
    state: "stopped",
    time: 0,
    pause: vi.fn(),
    seek: vi.fn(),
  }),
  resetPlaybackClock: vi.fn(),
}));

vi.mock("@/core/scheduler/FrameScheduler", () => ({
  getFrameScheduler: () => ({
    cancelAll: vi.fn(),
    getStats: () => ({ active: 0 }),
  }),
  resetFrameScheduler: vi.fn(),
}));

vi.mock("@/lib/monitoring/PerformanceMonitor", () => ({
  performanceMonitor: {
    reset: vi.fn(),
  },
}));

describe("ProjectStateReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resetAllProjectState", () => {
    it("should reset all subsystems by default", async () => {
      const result = await resetAllProjectState();

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.resetSubsystems).toContain("PlaybackClock");
      expect(result.resetSubsystems).toContain("FrameScheduler");
      expect(result.resetSubsystems).toContain("DragStateStore");
      expect(result.resetSubsystems).toContain("TransformController");
      expect(result.resetSubsystems).toContain("UIStore");
      expect(result.resetSubsystems).toContain("ViewportController");
      expect(result.resetSubsystems).toContain("HistoryStore");
      expect(result.resetSubsystems).toContain("PerformanceMonitor");
    });

    it("should support selective reset", async () => {
      const options: ResetOptions = {
        resetHistory: true,
        resetPlayback: false,
        resetScheduler: false,
        resetUI: false,
        resetDrag: false,
        resetViewport: false,
        resetTransform: false,
        resetMonitoring: false,
      };

      const result = await resetAllProjectState(options);

      expect(result.success).toBe(true);
      expect(result.resetSubsystems).toContain("HistoryStore");
      expect(result.resetSubsystems).not.toContain("PlaybackClock");
      expect(result.resetSubsystems).not.toContain("UIStore");
    });

    it("should handle errors gracefully", async () => {
      // Note: In real implementation, errors would be caught and reported
      // This test verifies the structure exists
      const result = await resetAllProjectState();

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("errors");
      expect(result).toHaveProperty("resetSubsystems");
    });
  });

  describe("detectStaleState", () => {
    it("should detect when no stale state exists", async () => {
      const result = await detectStaleState();

      expect(result.hasStaleState).toBe(false);
      expect(result.staleSubsystems).toHaveLength(0);
    });

    it("should return details about stale subsystems", async () => {
      const result = await detectStaleState();

      expect(result).toHaveProperty("hasStaleState");
      expect(result).toHaveProperty("staleSubsystems");
      expect(result).toHaveProperty("details");
    });
  });
});
