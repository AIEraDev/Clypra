/**
 * usePreviewMode Hook Tests
 *
 * Tests coordinated preview mode switching with auto-pause behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePreviewMode } from "../usePreviewMode";
import { useUIStore } from "@/store/uiStore";
import * as ProjectSession from "@/core/runtime/ProjectSession";

// Mock ProjectSession
vi.mock("@/core/runtime/ProjectSession", () => ({
  getActiveSessionOrNull: vi.fn(),
}));

describe("usePreviewMode", () => {
  let mockTransportAuthority: any;
  let mockSession: any;

  beforeEach(() => {
    // Reset UI store
    useUIStore.setState({
      previewMode: "program",
      sourceAsset: null,
      sourceTextPreset: null,
      previewMediaId: null,
    });

    // Setup mock transport authority
    mockTransportAuthority = {
      setActiveContext: vi.fn(),
      pause: vi.fn(),
    };

    mockSession = {
      transportAuthority: mockTransportAuthority,
    };

    vi.mocked(ProjectSession.getActiveSessionOrNull).mockReturnValue(mockSession);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("previewAsset", () => {
    it("updates UI state and switches transport context", () => {
      const { result } = renderHook(() => usePreviewMode());

      const mockAsset = {
        id: "asset-1",
        name: "test.mp4",
        type: "video" as const,
        path: "/test.mp4",
        duration: 10,
        size: 0,
      };

      act(() => {
        result.current.previewAsset(mockAsset);
      });

      // Check UI state updated
      expect(useUIStore.getState().previewMode).toBe("source");
      expect(useUIStore.getState().sourceAsset).toEqual(mockAsset);

      // Check transport context switched
      expect(mockTransportAuthority.setActiveContext).toHaveBeenCalledWith("source");
    });

    it("auto-pauses program context via TransportAuthority", () => {
      const { result } = renderHook(() => usePreviewMode());

      const mockAsset = {
        id: "asset-1",
        name: "test.mp4",
        type: "video" as const,
        path: "/test.mp4",
        duration: 10,
        size: 0,
      };

      act(() => {
        result.current.previewAsset(mockAsset);
      });

      // TransportAuthority.setActiveContext internally pauses previous context
      expect(mockTransportAuthority.setActiveContext).toHaveBeenCalled();
    });
  });

  describe("previewTextPreset", () => {
    it("updates UI state for text presets", () => {
      const { result } = renderHook(() => usePreviewMode());

      const mockPreset = {
        id: "preset-1",
        name: "Title",
        fontSize: 72,
      };

      act(() => {
        result.current.previewTextPreset(mockPreset, "template");
      });

      expect(useUIStore.getState().previewMode).toBe("source");
      expect(useUIStore.getState().sourceTextPreset).toBeDefined();
      expect(mockTransportAuthority.setActiveContext).toHaveBeenCalledWith("source");
    });
  });

  describe("exitSourceMode", () => {
    it("returns to program mode and switches transport context", () => {
      const { result } = renderHook(() => usePreviewMode());

      // First enter source mode
      const mockAsset = {
        id: "asset-1",
        name: "test.mp4",
        type: "video" as const,
        path: "/test.mp4",
        duration: 10,
        size: 0,
      };

      act(() => {
        result.current.previewAsset(mockAsset);
      });

      expect(useUIStore.getState().previewMode).toBe("source");

      // Then exit
      act(() => {
        result.current.exitSourceMode();
      });

      expect(useUIStore.getState().previewMode).toBe("program");
      expect(useUIStore.getState().sourceAsset).toBeNull();
      expect(mockTransportAuthority.setActiveContext).toHaveBeenCalledWith("program");
    });

    it("auto-pauses source context when returning to program", () => {
      const { result } = renderHook(() => usePreviewMode());

      act(() => {
        result.current.exitSourceMode();
      });

      // TransportAuthority.setActiveContext internally pauses previous context
      expect(mockTransportAuthority.setActiveContext).toHaveBeenCalledWith("program");
    });
  });

  describe("handles missing session gracefully", () => {
    it("does not crash when no session exists", () => {
      vi.mocked(ProjectSession.getActiveSessionOrNull).mockReturnValue(null);

      const { result } = renderHook(() => usePreviewMode());

      const mockAsset = {
        id: "asset-1",
        name: "test.mp4",
        type: "video" as const,
        path: "/test.mp4",
        duration: 10,
        size: 0,
      };

      // Should not throw
      expect(() => {
        act(() => {
          result.current.previewAsset(mockAsset);
        });
      }).not.toThrow();

      // UI state should still update
      expect(useUIStore.getState().previewMode).toBe("source");
    });
  });
});
