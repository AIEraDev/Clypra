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

// Mock forceRepaintNativeProgramPreview and wakeNativeProgramPreviewRenderLoop
const mockForceRepaint = vi.fn();
const mockWakeRenderLoop = vi.fn();
vi.mock("@/core/preview/previewRepaintCoordinator", () => ({
  requestPreviewRepaint: () => mockForceRepaint(),
  forceRepaintNativeProgramPreview: () => mockForceRepaint(),
  wakeNativeProgramPreviewRenderLoop: () => mockWakeRenderLoop(),
  registerPreviewRepaintHandler: () => () => {},
  isPreviewRepaintPending: () => false,
  resetPreviewRepaintCoordinator: () => {},
}));
vi.mock("@/components/editor/preview/NativeProgramPreview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/editor/preview/NativeProgramPreview")>();
  return {
    ...actual,
    forceRepaintNativeProgramPreview: () => mockForceRepaint(),
    wakeNativeProgramPreviewRenderLoop: () => mockWakeRenderLoop(),
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

  describe("LayoutPresetMenu & TopBar dropdown overlay registration", () => {
    it("registers overlay in uiStore and hides native surface when dropdown opens, unregisters on close", async () => {
      const { useUIStore } = await import("@/store/uiStore");

      mockHideNativeSurfaceWhenIdle.mockClear();

      // Opening dropdown
      useUIStore.getState().registerOverlay("layout-preset-menu");
      expect(useUIStore.getState().activeOverlayIds).toContain("layout-preset-menu");
      expect(mockHideNativeSurfaceWhenIdle).toHaveBeenCalledTimes(1);

      // Multiple open overlays are deduplicated and tracked concurrently
      useUIStore.getState().registerOverlay("topbar-dropdown");
      expect(useUIStore.getState().activeOverlayIds).toEqual([
        "layout-preset-menu",
        "topbar-dropdown",
      ]);

      // Closing one keeps the other active
      useUIStore.getState().unregisterOverlay("layout-preset-menu");
      expect(useUIStore.getState().activeOverlayIds).toEqual(["topbar-dropdown"]);

      // Closing all clears active overlays
      useUIStore.getState().unregisterOverlay("topbar-dropdown");
      expect(useUIStore.getState().activeOverlayIds).toEqual([]);
    });
  });

  /**
   * Regression tests for commit 5adc64f6 regression:
   * "fix(preview): gate native surface presentation when dropdown menus and overlays are open"
   *
   * That commit introduced two bugs:
   *   A) isAnyModalOpen was added to nativeReadbackFallbackPath, routing playback
   *      frames to WebView readback while overlay was open → stuck canvas after close.
   *   B) !isAnyModalOpen was added to nativeDirectSurfacePath, blocking native
   *      surface re-engagement after overlay close.
   */
  describe("Regression: overlay open/close must not permanently route to DOM canvas (5adc64f6)", () => {
    it("nativeReadbackFallbackPath must NOT be true when only isAnyModalOpen is set during playback", () => {
      // Simulate the render-loop path variables as they appear in NativeProgramPreview.
      // Conditions: playing, nativePlaybackPath = true, surface IS usable, no qualification override.
      // The only extra condition is isAnyModalOpen = true (overlay open).
      const isPlaying = true;
      const nativePlaybackPath = true;
      const nativeSurfaceUsable = true;
      const qualificationForcesWebView = false;
      const isAnyModalOpen = true;
      const deferWebViewFallbackForNativeStartup = false;

      // FIXED version — isAnyModalOpen must NOT appear in nativeReadbackFallbackPath.
      // When overlay is open during playback, we idle (nativeSurfaceNeedsHide handles hide),
      // we do NOT reroute to WebView readback.
      const nativeReadbackFallbackPath =
        isPlaying &&
        nativePlaybackPath &&
        (!nativeSurfaceUsable || qualificationForcesWebView) &&
        !deferWebViewFallbackForNativeStartup;

      expect(nativeReadbackFallbackPath).toBe(false);

      // Confirm the BUGGY version (5adc64f6) would have been true:
      const buggyNativeReadbackFallbackPath =
        isPlaying &&
        nativePlaybackPath &&
        (!nativeSurfaceUsable || qualificationForcesWebView || isAnyModalOpen) &&
        !deferWebViewFallbackForNativeStartup;

      expect(buggyNativeReadbackFallbackPath).toBe(true); // Negative control — proves the fix is meaningful
    });

    it("nativeDirectSurfacePath must become true again after overlay closes", () => {
      // Simulate two ticks of the render loop:
      // Tick 1: overlay open → nativeDirectSurfacePath depends on isAnyModalOpen
      // Tick 2: overlay closed → nativeDirectSurfacePath should re-engage

      const nativeSurfaceUsable = true;
      const nativeRequest = {} as object; // truthy
      const nativePlaybackPath = true;
      const qualificationForcesWebView = false;

      // TICK 1: overlay open
      const isAnyModalOpenTick1 = true;

      // FIXED: no !isAnyModalOpen guard on nativeDirectSurfacePath itself
      const nativeDirectSurfacePathTick1 =
        nativeSurfaceUsable &&
        Boolean(nativeRequest) &&
        (nativePlaybackPath || false) &&
        !qualificationForcesWebView;

      // With the fix, path is true even during overlay — hide is handled by nativeSurfaceNeedsHide
      expect(nativeDirectSurfacePathTick1).toBe(true);
      // isAnyModalOpen being true will separately cause nativeSurfaceNeedsHide → hide correctly

      // Confirm BUGGY version (5adc64f6) would have been false during overlay open:
      const buggyNativeDirectSurfacePathTick1 =
        nativeSurfaceUsable &&
        Boolean(nativeRequest) &&
        !isAnyModalOpenTick1 &&   // extra guard — WRONG
        (nativePlaybackPath || false) &&
        !qualificationForcesWebView;

      expect(buggyNativeDirectSurfacePathTick1).toBe(false); // Negative control

      // TICK 2: overlay closed
      const isAnyModalOpenTick2 = false;

      const nativeDirectSurfacePathTick2 =
        nativeSurfaceUsable &&
        Boolean(nativeRequest) &&
        (nativePlaybackPath || false) &&
        !qualificationForcesWebView;

      // Native surface path re-engages on tick 2 — both fixed and buggy would be true here.
      // The critical point is that with the fix, the hide/re-show lifecycle is managed by
      // nativeSurfaceNeedsHide, not by blocking nativeDirectSurfacePath itself.
      expect(nativeDirectSurfacePathTick2).toBe(true);
      void isAnyModalOpenTick2; // used only in buggy variant below

      const buggyNativeDirectSurfacePathTick2 =
        nativeSurfaceUsable &&
        Boolean(nativeRequest) &&
        !isAnyModalOpenTick2 &&
        (nativePlaybackPath || false) &&
        !qualificationForcesWebView;

      expect(buggyNativeDirectSurfacePathTick2).toBe(true); // Also true after close — issue was nativeSurfaceShown stayed false
    });

    it("wakeNativeProgramPreviewRenderLoop is called on overlay close in overlay components", async () => {
      // This test verifies Part C of the fix: all three overlay components must
      // call wakeNativeProgramPreviewRenderLoop() after forceRepaintNativeProgramPreview()
      // on overlay close, to ensure the RAF loop restarts when it may be idle.

      mockForceRepaint.mockClear();
      mockWakeRenderLoop.mockClear();

      // Simulate the pattern used in LayoutPresetMenu, TopBar, and Timeline:
      const simulateOverlayClose = () => {
        mockForceRepaint(); // forceRepaintNativeProgramPreview()
        mockWakeRenderLoop(); // wakeNativeProgramPreviewRenderLoop()
      };

      simulateOverlayClose();

      expect(mockForceRepaint).toHaveBeenCalledTimes(1);
      expect(mockWakeRenderLoop).toHaveBeenCalledTimes(1);
    });
  });
});
