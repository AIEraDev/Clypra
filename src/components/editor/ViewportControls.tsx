/**
 * Viewport Controls
 *
 * Controls for editor viewport zoom/pan (NOT clip transforms).
 * This is editor-only and does NOT affect export.
 */

import React from "react";
import { ZoomIn, ZoomOut, Maximize2, Move } from "lucide-react";
import { useUIStore } from "@/store/uiStore";
import { cn } from "@/lib/utils";

interface ViewportControlsProps {
  canvasWidth: number;
  canvasHeight: number;
  containerWidth: number;
  containerHeight: number;
}

export const ViewportControls: React.FC<ViewportControlsProps> = ({ canvasWidth, canvasHeight, containerWidth, containerHeight }) => {
  const { previewViewport, setPreviewZoom, resetPreviewViewport, zoomPreviewToFit } = useUIStore();

  const handleZoomIn = () => {
    setPreviewZoom(previewViewport.zoom * 1.2);
  };

  const handleZoomOut = () => {
    setPreviewZoom(previewViewport.zoom / 1.2);
  };

  const handleZoomToFit = () => {
    zoomPreviewToFit(canvasWidth, canvasHeight, containerWidth, containerHeight);
  };

  const handleReset = () => {
    resetPreviewViewport();
  };

  const zoomPercentage = Math.round(previewViewport.zoom * 100);

  return (
    <div className="absolute bottom-4 left-4 z-10 flex items-center gap-2 rounded-lg bg-bg-elevated/90 p-2 shadow-lg backdrop-blur-sm">
      {/* Zoom Out */}
      <button onClick={handleZoomOut} disabled={previewViewport.zoom <= 0.1} className={cn("flex h-8 w-8 items-center justify-center rounded-md transition-colors", "hover:bg-bg-hover active:bg-bg-active", "disabled:opacity-50 disabled:cursor-not-allowed")} title="Zoom Out (Ctrl + -)">
        <ZoomOut className="h-4 w-4" />
      </button>

      {/* Zoom Percentage */}
      <div className="flex h-8 min-w-[60px] items-center justify-center rounded-md bg-bg px-2 text-sm font-medium">{zoomPercentage}%</div>

      {/* Zoom In */}
      <button onClick={handleZoomIn} disabled={previewViewport.zoom >= 5.0} className={cn("flex h-8 w-8 items-center justify-center rounded-md transition-colors", "hover:bg-bg-hover active:bg-bg-active", "disabled:opacity-50 disabled:cursor-not-allowed")} title="Zoom In (Ctrl + +)">
        <ZoomIn className="h-4 w-4" />
      </button>

      {/* Divider */}
      <div className="h-6 w-px bg-border-soft" />

      {/* Zoom to Fit */}
      <button onClick={handleZoomToFit} className={cn("flex h-8 w-8 items-center justify-center rounded-md transition-colors", "hover:bg-bg-hover active:bg-bg-active")} title="Zoom to Fit (Ctrl + 0)">
        <Maximize2 className="h-4 w-4" />
      </button>

      {/* Reset Viewport */}
      <button onClick={handleReset} className={cn("flex h-8 w-8 items-center justify-center rounded-md transition-colors", "hover:bg-bg-hover active:bg-bg-active")} title="Reset Viewport (Ctrl + R)">
        <Move className="h-4 w-4" />
      </button>
    </div>
  );
};

/**
 * Hook for viewport keyboard shortcuts
 */
export function useViewportKeyboardShortcuts(canvasWidth: number, canvasHeight: number, containerWidth: number, containerHeight: number) {
  const { previewViewport, setPreviewZoom, resetPreviewViewport, zoomPreviewToFit } = useUIStore();

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if Ctrl/Cmd is pressed
      if (!e.ctrlKey && !e.metaKey) return;

      switch (e.key) {
        case "=":
        case "+":
          e.preventDefault();
          setPreviewZoom(previewViewport.zoom * 1.2);
          break;

        case "-":
        case "_":
          e.preventDefault();
          setPreviewZoom(previewViewport.zoom / 1.2);
          break;

        case "0":
          e.preventDefault();
          zoomPreviewToFit(canvasWidth, canvasHeight, containerWidth, containerHeight);
          break;

        case "r":
        case "R":
          e.preventDefault();
          resetPreviewViewport();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewViewport.zoom, canvasWidth, canvasHeight, containerWidth, containerHeight, setPreviewZoom, resetPreviewViewport, zoomPreviewToFit]);
}

/**
 * Hook for viewport mouse wheel zoom
 *
 * Uses Zustand getState() to read fresh viewport state in the wheel handler,
 * avoiding stale-closure issues and eliminating effect re-subscriptions during zoom.
 */
export function useViewportWheelZoom(containerRef: React.RefObject<HTMLElement>) {
  const setPreviewZoom = useUIStore((s) => s.setPreviewZoom);
  const setPreviewPan = useUIStore((s) => s.setPreviewPan);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // Only handle if Ctrl/Cmd is pressed (zoom)
      if (!e.ctrlKey && !e.metaKey) return;

      e.preventDefault();

      // Read fresh viewport state (avoids stale closure)
      const { previewViewport } = useUIStore.getState();

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Calculate zoom delta
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(5.0, previewViewport.zoom * delta));

      // Calculate pan to keep mouse position fixed
      const zoomRatio = newZoom / previewViewport.zoom;
      const newPanX = mouseX - (mouseX - previewViewport.panX) * zoomRatio;
      const newPanY = mouseY - (mouseY - previewViewport.panY) * zoomRatio;

      setPreviewZoom(newZoom);
      setPreviewPan(newPanX, newPanY);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [containerRef, setPreviewZoom, setPreviewPan]);
}

/**
 * Hook for viewport pan (space + drag or middle mouse)
 *
 * Uses refs for mutable pan state and Zustand getState() for fresh viewport reads.
 * This eliminates stale-closure drift and prevents effect re-subscriptions during panning.
 */
export function useViewportPan(containerRef: React.RefObject<HTMLElement>) {
  const setPreviewPan = useUIStore((s) => s.setPreviewPan);
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

      // Read fresh viewport state (avoids stale closure)
      const { previewViewport } = useUIStore.getState();
      setPreviewPan(previewViewport.panX + deltaX, previewViewport.panY + deltaY);
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
  }, [containerRef, setPreviewPan]);

  return { isPanning, spacePressed };
}
