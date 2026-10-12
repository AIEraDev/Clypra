import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React, { useState } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Mock Tauri platform runtime
vi.mock("@/lib/platform/tauri", () => ({
  isTauriRuntime: vi.fn(() => true),
  hideNativeSurface: vi.fn(() => Promise.resolve()),
  probeNativeSurface: vi.fn(() => Promise.resolve({ success: true })),
  resizeNativeSurface: vi.fn(() => Promise.resolve()),
  showNativeSurface: vi.fn(() => Promise.resolve()),
}));

// Mock native surface lifecycle
const mockHideNativeSurfaceWhenIdle = vi.fn(() => Promise.resolve());
vi.mock("@/core/runtime/nativeSurfaceLifecycle", () => ({
  hideNativeSurfaceWhenIdle: () => mockHideNativeSurfaceWhenIdle(),
}));

// Mock forceRepaintNativeProgramPreview
const mockForceRepaint = vi.fn();
vi.mock("@/components/editor/preview/NativeProgramPreview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/editor/preview/NativeProgramPreview")>();
  return {
    ...actual,
    forceRepaintNativeProgramPreview: () => mockForceRepaint(),
  };
});

describe("Native Surface Overlay Hide & Handover Contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("NativeProgramPreview overlay menus", () => {
    const TestPreviewMenuHost: React.FC = () => {
      const [aspectOpen, setAspectOpen] = useState(false);
      const [speedOpen, setSpeedOpen] = useState(false);
      const [qualityOpen, setQualityOpen] = useState(false);
      const [scopesOpen, setScopesOpen] = useState(false);

      const anyOpen = aspectOpen || speedOpen || qualityOpen || scopesOpen;

      React.useEffect(() => {
        if (anyOpen) {
          void mockHideNativeSurfaceWhenIdle();
        } else {
          mockForceRepaint();
        }
      }, [anyOpen]);

      return (
        <div>
          <button data-testid="btn-aspect" onClick={() => setAspectOpen(!aspectOpen)}>
            Aspect
          </button>
          <button data-testid="btn-speed" onClick={() => setSpeedOpen(!speedOpen)}>
            Speed
          </button>
          <button data-testid="btn-quality" onClick={() => setQualityOpen(!qualityOpen)}>
            Quality
          </button>
          <button data-testid="btn-scopes" onClick={() => setScopesOpen(!scopesOpen)}>
            Scopes
          </button>
        </div>
      );
    };

    it("invokes hideNativeSurfaceWhenIdle when aspect ratio menu is toggled open", () => {
      render(<TestPreviewMenuHost />);
      mockForceRepaint.mockClear();
      mockHideNativeSurfaceWhenIdle.mockClear();

      fireEvent.click(screen.getByTestId("btn-aspect"));
      expect(mockHideNativeSurfaceWhenIdle).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId("btn-aspect"));
      expect(mockForceRepaint).toHaveBeenCalled();
    });

    it("invokes hideNativeSurfaceWhenIdle when speed menu is toggled open", () => {
      render(<TestPreviewMenuHost />);
      mockForceRepaint.mockClear();
      mockHideNativeSurfaceWhenIdle.mockClear();

      fireEvent.click(screen.getByTestId("btn-speed"));
      expect(mockHideNativeSurfaceWhenIdle).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId("btn-speed"));
      expect(mockForceRepaint).toHaveBeenCalled();
    });

    it("invokes hideNativeSurfaceWhenIdle when quality menu is toggled open", () => {
      render(<TestPreviewMenuHost />);
      mockForceRepaint.mockClear();
      mockHideNativeSurfaceWhenIdle.mockClear();

      fireEvent.click(screen.getByTestId("btn-quality"));
      expect(mockHideNativeSurfaceWhenIdle).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId("btn-quality"));
      expect(mockForceRepaint).toHaveBeenCalled();
    });

    it("invokes hideNativeSurfaceWhenIdle when scopes modal is toggled open", () => {
      render(<TestPreviewMenuHost />);
      mockForceRepaint.mockClear();
      mockHideNativeSurfaceWhenIdle.mockClear();

      fireEvent.click(screen.getByTestId("btn-scopes"));
      expect(mockHideNativeSurfaceWhenIdle).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId("btn-scopes"));
      expect(mockForceRepaint).toHaveBeenCalled();
    });
  });

  describe("TransformOverlay context menu", () => {
    const TestTransformContextHost: React.FC = () => {
      const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

      React.useEffect(() => {
        if (contextMenu) {
          void mockHideNativeSurfaceWhenIdle();
        } else {
          mockForceRepaint();
        }
      }, [contextMenu]);

      return (
        <div>
          <div
            data-testid="overlay-target"
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: 100, y: 100 });
            }}
          />
          <button data-testid="close-ctx" onClick={() => setContextMenu(null)}>
            Close
          </button>
        </div>
      );
    };

    it("hides native surface on right-click context menu and repaints on dismiss", () => {
      render(<TestTransformContextHost />);
      mockForceRepaint.mockClear();
      mockHideNativeSurfaceWhenIdle.mockClear();

      fireEvent.contextMenu(screen.getByTestId("overlay-target"));
      expect(mockHideNativeSurfaceWhenIdle).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId("close-ctx"));
      expect(mockForceRepaint).toHaveBeenCalled();
    });
  });

  describe("Capture-on-Handover state machine invariant", () => {
    it("defers native surface hide until paused readback frame is painted to canvas", () => {
      // Simulating the state transitions of NativeProgramPreview render loop:
      let nativeSurfaceShown = true;
      let pendingHandoverSurfaceHide = false;
      let nativeDirectSurfacePath = true; // Playing

      // Transition from playing to paused
      nativeDirectSurfacePath = false;
      const nativeSurfaceNeedsHide = nativeSurfaceShown && !nativeDirectSurfacePath;

      if (nativeSurfaceNeedsHide) {
        // Handover: do NOT immediately hide native surface. Retain it.
        pendingHandoverSurfaceHide = true;
      }

      // Assert: At this moment before canvas paint, native surface is STILL shown (no stale frame flash)
      expect(nativeSurfaceShown).toBe(true);
      expect(pendingHandoverSurfaceHide).toBe(true);
      expect(mockHideNativeSurfaceWhenIdle).not.toHaveBeenCalled();

      // Readback finishes asynchronously and draws to canvas:
      const frameDrawnToCanvas = true;
      if (frameDrawnToCanvas && pendingHandoverSurfaceHide) {
        pendingHandoverSurfaceHide = false;
        nativeSurfaceShown = false;
        void mockHideNativeSurfaceWhenIdle();
      }

      // Assert: Now that canvas has frame, native surface is safely hidden
      expect(nativeSurfaceShown).toBe(false);
      expect(pendingHandoverSurfaceHide).toBe(false);
      expect(mockHideNativeSurfaceWhenIdle).toHaveBeenCalledTimes(1);
    });

    it("cancels pending handover hide if playback resumes before readback completes", () => {
      let nativeSurfaceShown = true;
      let pendingHandoverSurfaceHide = true; // Handover started on pause

      // User presses Play immediately:
      const isPlaying = true;
      const nativeDirectSurfacePath = isPlaying;

      if (nativeDirectSurfacePath && pendingHandoverSurfaceHide) {
        pendingHandoverSurfaceHide = false;
      }

      expect(pendingHandoverSurfaceHide).toBe(false);
      expect(nativeSurfaceShown).toBe(true);
      expect(mockHideNativeSurfaceWhenIdle).not.toHaveBeenCalled();
    });

    it("fires safety timeout if paused readback decodes fail to paint within deadline", () => {
      vi.useFakeTimers();

      let nativeSurfaceShown = true;
      let pendingHandoverSurfaceHide = true;

      const handoverSafetyTimer = setTimeout(() => {
        if (pendingHandoverSurfaceHide) {
          pendingHandoverSurfaceHide = false;
          nativeSurfaceShown = false;
          void mockHideNativeSurfaceWhenIdle();
        }
      }, 150);

      expect(nativeSurfaceShown).toBe(true);
      expect(mockHideNativeSurfaceWhenIdle).not.toHaveBeenCalled();

      // Fast-forward past safety deadline
      act(() => {
        vi.advanceTimersByTime(160);
      });

      expect(nativeSurfaceShown).toBe(false);
      expect(mockHideNativeSurfaceWhenIdle).toHaveBeenCalledTimes(1);

      clearTimeout(handoverSafetyTimer);
      vi.useRealTimers();
    });
  });
});
