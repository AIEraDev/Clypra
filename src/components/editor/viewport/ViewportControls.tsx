import React from "react";
import { getViewportController } from "@/core/interactions";

/**
 * Hook for viewport keyboard shortcuts
 *
 * Uses imperative ViewportController to avoid React re-renders on zoom/pan.
 *
 * The containerRef parameter is required so the hook can guard against firing
 * when the pointer is outside the preview panel. Without this guard,
 * Cmd+= / Cmd+- / Cmd+0 would zoom BOTH the preview viewport and the timeline
 * simultaneously (CLY-BUG-ZOOM-SCOPE).
 */
export function useViewportKeyboardShortcuts(
  canvasWidth: number,
  canvasHeight: number,
  containerWidth: number,
  containerHeight: number,
  containerRef: React.RefObject<HTMLElement>,
) {
  React.useEffect(() => {
    const controller = getViewportController();

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if Ctrl/Cmd is pressed
      if (!e.ctrlKey && !e.metaKey) return;

      // Only zoom the preview when the pointer is inside the preview container.
      // This prevents Cmd+= / Cmd+- from zooming both the preview viewport and
      // the timeline ruler simultaneously (CLY-BUG-ZOOM-SCOPE).
      const container = containerRef.current;
      if (!container || !container.matches(":hover")) return;

      // Read fresh viewport state imperatively
      const viewport = controller.getViewport();

      switch (e.key) {
        case "=":
        case "+":
          e.preventDefault();
          controller.setZoom(viewport.zoom * 1.2);
          break;

        case "-":
        case "_":
          e.preventDefault();
          controller.setZoom(viewport.zoom / 1.2);
          break;

        case "0":
          e.preventDefault();
          controller.zoomToFit(canvasWidth, canvasHeight, containerWidth, containerHeight);
          break;

        case "r":
        case "R":
          e.preventDefault();
          controller.reset();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canvasWidth, canvasHeight, containerWidth, containerHeight, containerRef]);
}

/**
 * Hook for viewport mouse wheel zoom
 *
 * Uses imperative ViewportController to avoid React re-renders on every wheel event.
 * Reads fresh viewport state directly from controller, eliminating stale-closure issues.
 */
export function useViewportWheelZoom(containerRef: React.RefObject<HTMLElement>) {
  React.useEffect(() => {
    const controller = getViewportController();

    const handleWheel = (e: WheelEvent) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const target = e.target as Node | null;
      const inPreview = !!target && container.contains(target);
      if (!inPreview) {
        return;
      }

      e.preventDefault();

      // Read fresh viewport state imperatively (no stale closure, no React)
      const viewport = controller.getViewport();

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Smooth zoom behavior across mouse wheels and trackpads.
      // Use exponential scaling with normalized delta for stable feel.
      const lineHeightPx = 16;
      const pageHeightPx = rect.height || 800;
      const deltaPx = e.deltaMode === 1 ? e.deltaY * lineHeightPx : e.deltaMode === 2 ? e.deltaY * pageHeightPx : e.deltaY;
      const zoomFactor = Math.exp(-deltaPx * 0.0015);
      const newZoom = Math.max(0.1, Math.min(5.0, viewport.zoom * zoomFactor));

      // Calculate pan to keep mouse position fixed
      const zoomRatio = newZoom / viewport.zoom;
      const newPanX = mouseX - (mouseX - viewport.panX) * zoomRatio;
      const newPanY = mouseY - (mouseY - viewport.panY) * zoomRatio;

      // Update controller imperatively (no React re-render)
      controller.setZoom(newZoom);
      controller.setPan(newPanX, newPanY);
    };

    // Use window-level listener and scope by contains(target) to avoid
    // event-loss through layered overlays and retargeting quirks.
    window.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", handleWheel, { capture: true } as EventListenerOptions);
  }, [containerRef]);
}

/**
 * Hook for viewport pan (space + drag or middle mouse)
 *
 * Uses refs for mutable pan state and imperative ViewportController.
 * This eliminates stale-closure drift and prevents React re-renders during panning.
 */
export function useViewportPan(containerRef: React.RefObject<HTMLElement>) {
  const [isPanning, setIsPanning] = React.useState(false);
  const [spacePressed, setSpacePressed] = React.useState(false);

  // Use refs for values that change rapidly during pan — avoids effect churn
  const isPanningRef = React.useRef(false);
  const panStartRef = React.useRef({ x: 0, y: 0 });
  const spacePressedRef = React.useRef(false);

  // Keep refs in sync with state (state drives UI, refs drive handlers)
  isPanningRef.current = isPanning;
  spacePressedRef.current = spacePressed;

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        setSpacePressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpacePressed(false);
        setIsPanning(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  React.useEffect(() => {
    const controller = getViewportController();
    const container = containerRef.current;
    if (!container) return;

    const handleMouseDown = (e: MouseEvent) => {
      // Space + left click OR middle mouse button
      if ((spacePressedRef.current && e.button === 0) || e.button === 1) {
        e.preventDefault();
        setIsPanning(true);
        panStartRef.current = { x: e.clientX, y: e.clientY };
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isPanningRef.current) return;

      const deltaX = e.clientX - panStartRef.current.x;
      const deltaY = e.clientY - panStartRef.current.y;

      // Read fresh viewport state imperatively (no React, no Zustand)
      const viewport = controller.getViewport();
      controller.setPan(viewport.panX + deltaX, viewport.panY + deltaY);
      panStartRef.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
      setIsPanning(false);
    };

    container.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      container.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    // Stable deps only — refs handle mutable state, so listeners don't need re-attaching
  }, [containerRef]);

  return { isPanning, spacePressed };
}
