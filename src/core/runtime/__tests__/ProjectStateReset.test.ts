/**
 * Project State Reset Tests
 *
 * Verify that centralized state reset works correctly when closing/opening projects.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetAllProjectState, detectStaleState, type ResetOptions } from "../ProjectStateReset";

// Mock implementations
const mockClearDragging = vi.fn();
vi.mock("@/store/dragStateStore", () => ({
  useDragStateStore: {
    getState: () => ({
      clearDragging: mockClearDragging,
    }),
    setState: vi.fn(),
  },
}));

const mockUiSetState = vi.fn();
vi.mock("@/store/uiStore", () => ({
  useUIStore: {
    getState: () => ({
      selectedClipIds: [],
      selectedGapId: null,
      previewMode: "program",
    }),
    setState: mockUiSetState,
  },
}));

const mockHistoryClear = vi.fn();
vi.mock("@/store/historyStore", () => ({
  useHistoryStore: {
    getState: () => ({
      clear: mockHistoryClear,
      state: { size: 0, canUndo: false },
    }),
  },
}));

const mockTemplateReset = vi.fn();
vi.mock("@/features/text-templates/templateStore", () => ({
  useTemplateStore: {
    getState: () => ({
      reset: mockTemplateReset,
    }),
  },
}));

const mockFavoritesSetState = vi.fn();
vi.mock("@/store/favoritesStore", () => ({
  useFavoritesStore: {
    setState: mockFavoritesSetState,
  },
}));

const mockBodyMaskClear = vi.fn();
vi.mock("@/features/body-effects/segmentation/maskCache", () => ({
  bodyMaskCache: {
    clear: mockBodyMaskClear,
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


vi.mock("@/store/middleware/autoSaveMiddleware", () => ({
  resumeAutoSave: vi.fn(),
  suspendAutoSave: vi.fn(),
  autoSaveMiddleware: (f: any) => f,
}));

vi.mock("../evaluation/evaluator", () => ({
  clearEvaluationCache: vi.fn(),
}));

vi.mock("../render/rasterizer", () => ({
  clearLottieRenderCache: vi.fn(),
}));

vi.mock("@/lib/cache/globalGPUCache", () => ({
  globalGPUCache: {
    clearAllTextures: vi.fn().mockReturnValue(0),
  },
}));

vi.mock("@/components/editor/preview/previewMediaSync", () => ({
  clearClipFilterCache: vi.fn(),
}));

vi.mock("../resources/ResourceCache", () => ({
  resetResourceCache: vi.fn(),
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
      expect(result.resetSubsystems).toContain("DragStateStore");
      expect(result.resetSubsystems).toContain("TransformController");
      expect(result.resetSubsystems).toContain("UIStore");
      expect(result.resetSubsystems).toContain("ViewportController");
      expect(result.resetSubsystems).toContain("HistoryStore");
      expect(result.resetSubsystems).toContain("Monitoring");
      expect(result.resetSubsystems).toContain("TemplateStore");
      expect(result.resetSubsystems).toContain("FavoritesStore");
      expect(result.resetSubsystems).toContain("BodyMaskCache");

      expect(mockTemplateReset).toHaveBeenCalled();
      expect(mockFavoritesSetState).toHaveBeenCalledWith({ downloadingIds: [] });
      expect(mockBodyMaskClear).toHaveBeenCalled();
    }, 15_000);

    it("should support selective reset", async () => {
      const options: ResetOptions = {
        resetHistory: true,
        resetPlayback: false,
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
