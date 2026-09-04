/**
 * Viewport Controller Hooks
 *
 * Provides UI snapshots of viewport state (throttled to 10fps).
 * For render loops, read controller.getViewport() imperatively instead.
 *
 * Architecture: Single global ViewportController singleton shared by all consumers.
 *
 * Usage:
 *   // For UI (zoom indicator, controls)
 *   const viewport = useViewportState();
 *
 *   // For render loops (canvas, overlay)
 *   const controller = getViewportController();
 *   requestAnimationFrame(() => {
 *     const viewport = controller.getViewport(); // Imperative read
 *     renderCanvas(viewport);
 *   });
 */

import { useEffect, useState, useMemo } from "react";
import {
  getViewportController,
  type Viewport,
  type ViewportListener,
} from "@/core/interactions";

/**
 * Hook for UI snapshots of viewport state.
 * Updates are throttled to 10fps to avoid React render storms.
 *
 * For high-frequency reads (render loops), use getViewportController() directly.
 */
export function useViewportState(): Viewport {
  const controller = getViewportController();
  const [state, setState] = useState<Viewport>(controller.getViewport());

  useEffect(() => {
    // Subscribe to throttled updates (10fps max)
    const unsubscribe = controller.subscribe((newState) => {
      setState(newState);
    });

    return unsubscribe;
  }, [controller]);

  return state;
}

/**
 * Hook for viewport controls.
 * Returns imperative control functions (no state).
 * Functions are memoized to prevent unnecessary re-renders.
 */
export function useViewportControls() {
  const controller = getViewportController();

  return useMemo(
    () => ({
      setZoom: (zoom: number) => controller.setZoom(zoom),
      setPan: (panX: number, panY: number) => controller.setPan(panX, panY),
      reset: () => controller.reset(),
      zoomToFit: (
        canvasWidth: number,
        canvasHeight: number,
        viewportWidth: number,
        viewportHeight: number,
      ) =>
        controller.zoomToFit(
          canvasWidth,
          canvasHeight,
          viewportWidth,
          viewportHeight,
        ),
      getViewport: () => controller.getViewport(),
    }),
    [controller],
  );
}

/**
 * Get viewport controller for imperative reads.
 * Re-exported from core for convenience.
 */
export { getViewportController };
