import { useRef, useCallback, useState, useEffect } from "react";

interface UsePanelResizeOptions {
  /** Initial size in px */
  initial: number;
  /** Minimum size in px */
  min: number;
  /** Maximum size in px — can be a static number or a function evaluated at drag time */
  max: number | (() => number);
  /** Default size to reset to on double click (defaults to initial) */
  defaultSize?: number;
  /** Snap points in px (e.g. [368]) */
  snapPoints?: number[];
  /** Snap distance threshold in px (default 5) */
  snapThreshold?: number;
  /** Which axis/mode to track */
  direction: "horizontal" | "horizontal-reverse" | "vertical";
  /** Invert delta direction if true */
  invert?: boolean;
  /** Called on every frame during drag with the clamped new size */
  onResize?: (size: number) => void;
  /** Called once when the user releases the drag handle */
  onCommit?: (size: number) => void;
}

interface UsePanelResizeResult {
  size: number;
  isDragging: boolean;
  setSize: (n: number) => void;
  handlePointerDown: (e: React.PointerEvent) => void;
  handleDoubleClick: () => void;
  resetToDefault: () => void;
}

/**
 * Professional pointer-capture resize hook for panel drag handles.
 *
 * Features:
 * - Live dimension tracking with `isDragging` state for HUD displays
 * - Snapping to standard default sizes (e.g. 368px / 300px)
 * - Double-click to reset to default size
 * - Active document cursor lock (ns-resize / ew-resize) during drag
 * - Supports horizontal, reverse horizontal (right panel), and vertical axes
 */
export function usePanelResize({
  initial,
  min,
  max,
  defaultSize = initial,
  snapPoints = [initial],
  snapThreshold = 5,
  direction,
  invert = false,
  onResize,
  onCommit,
}: UsePanelResizeOptions): UsePanelResizeResult {
  const [size, setSize] = useState(initial);
  const [isDragging, setIsDragging] = useState(false);
  const startCoordRef = useRef(0);
  const startSizeRef = useRef(0);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  // Sync size when initial prop updates externally (e.g. workspace preset switch)
  useEffect(() => {
    setSize(initial);
    sizeRef.current = initial;
  }, [initial]);

  const resolveMax = useCallback(
    () => (typeof max === "function" ? max() : max),
    [max],
  );

  const resetToDefault = useCallback(() => {
    setSize(defaultSize);
    sizeRef.current = defaultSize;
    onCommit?.(defaultSize);
  }, [defaultSize, onCommit]);

  const handleDoubleClick = useCallback(() => {
    resetToDefault();
  }, [resetToDefault]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setIsDragging(true);
      startCoordRef.current = direction === "vertical" ? e.clientY : e.clientX;
      startSizeRef.current = sizeRef.current;

      const cursorType = direction === "vertical" ? "row-resize" : "col-resize";
      document.body.style.cursor = cursorType;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const coord = direction === "vertical" ? moveEvent.clientY : moveEvent.clientX;

        let delta = 0;
        if (direction === "vertical") {
          // Vertical: drag UP increases height
          delta = startCoordRef.current - coord;
        } else if (direction === "horizontal-reverse" || invert) {
          // Horizontal reverse (right panel): drag LEFT increases width
          delta = startCoordRef.current - coord;
        } else {
          // Horizontal standard (left panel): drag RIGHT increases width
          delta = coord - startCoordRef.current;
        }

        let rawNewSize = Math.max(min, Math.min(resolveMax(), startSizeRef.current + delta));

        // Snap to points if within threshold
        if (snapPoints && snapPoints.length > 0) {
          for (const snapPoint of snapPoints) {
            if (Math.abs(rawNewSize - snapPoint) <= snapThreshold) {
              rawNewSize = snapPoint;
              break;
            }
          }
        }

        setSize(rawNewSize);
        sizeRef.current = rawNewSize;
        onResize?.(rawNewSize);
      };

      const handlePointerUp = () => {
        setIsDragging(false);
        document.body.style.cursor = "";
        onCommit?.(sizeRef.current);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [direction, invert, min, resolveMax, snapPoints, snapThreshold, onResize, onCommit],
  );

  return {
    size,
    isDragging,
    setSize,
    handlePointerDown,
    handleDoubleClick,
    resetToDefault,
  };
}
