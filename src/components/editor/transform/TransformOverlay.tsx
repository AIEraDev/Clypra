/**
 * Transform Overlay
 *
 * Renders transform controls (border + handles) for selected clips in the preview.
 *
 * Coordinate System Contract:
 * - All mouse events arrive in screen space (clientX/clientY).
 * - We subtract the overlay's bounding rect to get overlay-local coordinates.
 * - Then convert to canvas space via screenToCanvas (which accounts for viewport zoom/pan).
 * - Transform calculations operate exclusively in canvas space.
 * - The overlay div already occupies displayWidth × displayHeight, so displayOffset
 *   relative to the overlay itself is (0, 0).
 */

import React, { useCallback, useRef, useState } from "react";
import { useUIStore } from "@/store/uiStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useHistoryStore } from "@/store/historyStore";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import { calculateTransform, getCursorForHandle, getDefaultConstraints } from "@/lib/transform/calculator";
import { screenToCanvas, canvasToScreen, hitTestClip, type ViewportTransform } from "@/lib/coordinateSystem";
import type { TransformHandle } from "@/types";

interface TransformOverlayProps {
  /** Canvas dimensions for coordinate conversion */
  canvasWidth: number;
  canvasHeight: number;
  /** Scale factor for preview (1 = 100%) */
  scale: number;
  /** Viewport transform (editor zoom/pan) */
  viewport: ViewportTransform;
  /** Display offset for letterboxing */
  displayOffset: { x: number; y: number };
  /** Display dimensions (from calculateDisplayTransform) */
  displayWidth: number;
  displayHeight: number;
}

/**
 * Convert a mouse event to canvas coordinates, properly accounting for
 * the overlay's position on screen. The overlay is already positioned
 * inside the display viewport div, so the letterbox offset relative to
 * the overlay is always (0, 0).
 */
function mouseToCanvas(
  clientX: number,
  clientY: number,
  overlayRect: DOMRect,
  viewport: ViewportTransform,
  canvasWidth: number,
  canvasHeight: number,
  scale: number,
): { x: number; y: number } {
  // Step 1: Screen → overlay-local (subtract overlay's screen position)
  const localX = clientX - overlayRect.left;
  const localY = clientY - overlayRect.top;

  // Step 2: Overlay-local → canvas (the overlay sits at displayOffset=(0,0)
  // relative to itself, so pass zero offset)
  return screenToCanvas(localX, localY, viewport, { width: canvasWidth, height: canvasHeight }, scale, { x: 0, y: 0 });
}

export const TransformOverlay: React.FC<TransformOverlayProps> = ({ canvasWidth, canvasHeight, scale, viewport, displayOffset, displayWidth, displayHeight }) => {
  const { selectedClipIds, activeTransform, startTransform, endTransform, selectClip } = useUIStore();
  const { clips, updateClip } = useTimelineStore();
  const { execute } = useHistoryStore();

  const [isDragging, setIsDragging] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Get the first selected clip (multi-select transform comes later)
  const selectedClip = clips.find((c) => c.id === selectedClipIds[0]);

  // Handle click on canvas to select clips
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't handle if clicking on a handle or during drag
      if (isDragging || (e.target as HTMLElement).closest("[data-transform-handle]")) {
        return;
      }

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Convert screen coordinates to canvas coordinates using overlay-local mapping
      const canvasCoords = mouseToCanvas(e.clientX, e.clientY, rect, viewport, canvasWidth, canvasHeight, scale);

      if (import.meta.env.DEV) {
        console.log("[TransformOverlay] Click →", { screen: { x: e.clientX, y: e.clientY }, canvas: canvasCoords });
      }

      // Find all clips at this position (reverse order = top to bottom)
      const clipsAtPoint = [...clips]
        .reverse() // Top clips first
        .filter((clip) => hitTestClip(canvasCoords.x, canvasCoords.y, clip));

      if (clipsAtPoint.length > 0) {
        // Select the topmost clip
        selectClip(clipsAtPoint[0].id);
      } else {
        // Clicked on empty area - deselect
        selectClip(null);
      }
    },
    [clips, scale, viewport, canvasWidth, canvasHeight, isDragging, selectClip],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, handle: TransformHandle) => {
      if (!selectedClip) return;

      e.stopPropagation();
      setIsDragging(true);

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Convert screen coordinates to canvas coordinates using overlay-local mapping
      const canvasCoords = mouseToCanvas(e.clientX, e.clientY, rect, viewport, canvasWidth, canvasHeight, scale);

      if (import.meta.env.DEV) {
        console.log("[TransformOverlay] Mouse DOWN", { handle, canvasCoords, clip: { x: selectedClip.x, y: selectedClip.y, w: selectedClip.width, h: selectedClip.height } });
      }

      startTransform({
        clipId: selectedClip.id,
        handle,
        startTransform: {
          x: selectedClip.x,
          y: selectedClip.y,
          width: selectedClip.width,
          height: selectedClip.height,
          rotation: selectedClip.rotation,
        },
        startMousePos: canvasCoords,
        aspectRatioLocked: selectedClip.aspectRatioLocked ?? true,
        sourceAspectRatio: selectedClip.sourceAspectRatio ?? selectedClip.width / selectedClip.height,
      });
    },
    [selectedClip, scale, viewport, canvasWidth, canvasHeight, startTransform],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !activeTransform) return;

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Convert screen coordinates to canvas coordinates using overlay-local mapping
      const canvasCoords = mouseToCanvas(e.clientX, e.clientY, rect, viewport, canvasWidth, canvasHeight, scale);

      // Calculate new transform from the ORIGINAL start state (not current clip state)
      // This prevents transform drift / acceleration during drag.
      const constraints = getDefaultConstraints(canvasWidth, canvasHeight, activeTransform.aspectRatioLocked);

      // Build a synthetic "clip" from the start transform to apply delta against.
      // This ensures delta is always relative to the original position.
      const startClip = {
        ...activeTransform.startTransform,
        opacity: 1,
        id: activeTransform.clipId,
        trackId: "",
        mediaId: "",
        startTime: 0,
        duration: 0,
        trimIn: 0,
        trimOut: 0,
        aspectRatioLocked: activeTransform.aspectRatioLocked,
        sourceAspectRatio: activeTransform.sourceAspectRatio,
      };

      const newTransform = calculateTransform(startClip, activeTransform.handle, activeTransform.startMousePos, canvasCoords, constraints);

      // Optimistic update (no history yet)
      updateClip(activeTransform.clipId, newTransform);
    },
    [isDragging, activeTransform, scale, viewport, canvasWidth, canvasHeight, updateClip],
  );

  const handleMouseUp = useCallback(() => {
    if (!isDragging || !activeTransform) return;

    setIsDragging(false);

    // Read final clip state from store for history
    const finalClip = useTimelineStore.getState().clips.find((c) => c.id === activeTransform.clipId);
    if (!finalClip) {
      endTransform();
      return;
    }

    // Commit to history
    const oldTransform = activeTransform.startTransform;
    const newTransform = {
      x: finalClip.x,
      y: finalClip.y,
      width: finalClip.width,
      height: finalClip.height,
      rotation: finalClip.rotation,
    };

    if (import.meta.env.DEV) {
      console.log("[TransformOverlay] Mouse UP", { handle: activeTransform.handle, oldTransform, newTransform });
    }

    // Only create command if something actually changed
    const hasChanged = oldTransform.x !== newTransform.x || oldTransform.y !== newTransform.y || oldTransform.width !== newTransform.width || oldTransform.height !== newTransform.height || oldTransform.rotation !== newTransform.rotation;

    if (hasChanged) {
      execute(new TransformClipCommand(activeTransform.clipId, oldTransform, newTransform));
    }

    endTransform();
  }, [isDragging, activeTransform, execute, endTransform]);

  // Attach global mouse listeners during drag
  React.useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Convert clip bounds to screen coordinates for handle rendering
  if (!selectedClip) {
    return (
      <div
        ref={overlayRef}
        className="absolute inset-0 pointer-events-none z-50"
        style={{
          width: displayWidth,
          height: displayHeight,
        }}
      >
        {/* Click capture layer - always active for selection/deselection */}
        <div
          className="absolute inset-0"
          onClick={handleCanvasClick}
          style={{
            background: "transparent",
            pointerEvents: "auto",
            zIndex: 1,
          }}
        />
      </div>
    );
  }

  // Use canvasToScreen for proper coordinate conversion
  const topLeft = canvasToScreen(selectedClip.x, selectedClip.y, viewport, { width: canvasWidth, height: canvasHeight }, scale, displayOffset);

  const bottomRight = canvasToScreen(selectedClip.x + selectedClip.width, selectedClip.y + selectedClip.height, viewport, { width: canvasWidth, height: canvasHeight }, scale, displayOffset);

  const handleDisplayX = topLeft.x;
  const handleDisplayY = topLeft.y;
  const handleDisplayWidth = bottomRight.x - topLeft.x;
  const handleDisplayHeight = bottomRight.y - topLeft.y;
  const rotation = selectedClip.rotation ?? 0;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 pointer-events-none z-50"
      style={{
        width: displayWidth,
        height: displayHeight,
      }}
    >
      {/* Click capture layer - always active for selection/deselection.
          Sits behind the transform border (lower z-index) so handle clicks
          pass through, but covers the entire overlay so empty-area clicks
          trigger deselection even when a clip is selected. */}
      <div
        className="absolute inset-0"
        onClick={handleCanvasClick}
        style={{
          background: "transparent",
          pointerEvents: "auto",
          zIndex: 1,
        }}
      />

      {/* Transform border - on top of click capture layer */}
      <div
        className="absolute border-2 border-white pointer-events-auto cursor-move shadow-lg"
        data-transform-handle="move"
        style={{
          left: handleDisplayX,
          top: handleDisplayY,
          width: handleDisplayWidth,
          height: handleDisplayHeight,
          transform: `rotate(${rotation}deg)`,
          transformOrigin: "center",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)",
          zIndex: 10,
        }}
        onMouseDown={(e) => {
          handleMouseDown(e, "move");
        }}
      >
        {/* Corner handles */}
        <Handle position="nw" onMouseDown={(e) => handleMouseDown(e, "nw")} />
        <Handle position="ne" onMouseDown={(e) => handleMouseDown(e, "ne")} />
        <Handle position="sw" onMouseDown={(e) => handleMouseDown(e, "sw")} />
        <Handle position="se" onMouseDown={(e) => handleMouseDown(e, "se")} />

        {/* Edge handles */}
        <Handle position="n" onMouseDown={(e) => handleMouseDown(e, "n")} />
        <Handle position="s" onMouseDown={(e) => handleMouseDown(e, "s")} />
        <Handle position="e" onMouseDown={(e) => handleMouseDown(e, "e")} />
        <Handle position="w" onMouseDown={(e) => handleMouseDown(e, "w")} />

        {/* Rotation handle */}
        <Handle position="rotate" onMouseDown={(e) => handleMouseDown(e, "rotate")} scale={scale} />
      </div>
    </div>
  );
};

interface HandleProps {
  position: TransformHandle;
  onMouseDown: (e: React.MouseEvent) => void;
  /** Current display scale — used to keep rotation handle at a constant visual distance */
  scale?: number;
}

const Handle: React.FC<HandleProps> = ({ position, onMouseDown, scale = 1 }) => {
  const getHandleStyle = (): React.CSSProperties => {
    const baseStyle: React.CSSProperties = {
      position: "absolute",
      width: "14px",
      height: "14px",
      backgroundColor: "white",
      border: "2px solid #3b82f6",
      borderRadius: "50%",
      cursor: getCursorForHandle(position),
      transform: "translate(-50%, -50%)",
      boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
      zIndex: 10,
    };

    switch (position) {
      case "nw":
        return { ...baseStyle, left: 0, top: 0 };
      case "ne":
        return { ...baseStyle, right: 0, top: 0, left: "auto", transform: "translate(50%, -50%)" };
      case "sw":
        return { ...baseStyle, left: 0, bottom: 0, top: "auto", transform: "translate(-50%, 50%)" };
      case "se":
        return { ...baseStyle, right: 0, bottom: 0, left: "auto", top: "auto", transform: "translate(50%, 50%)" };
      case "n":
        return { ...baseStyle, left: "50%", top: 0 };
      case "s":
        return { ...baseStyle, left: "50%", bottom: 0, top: "auto", transform: "translate(-50%, 50%)" };
      case "e":
        return { ...baseStyle, right: 0, top: "50%", left: "auto", transform: "translate(50%, -50%)" };
      case "w":
        return { ...baseStyle, left: 0, top: "50%" };
      case "rotate": {
        // Scale-compensated offset so the rotation handle stays at a constant
        // visual distance (~30px) regardless of viewport zoom.
        const offset = Math.max(20, Math.min(60, 30 / Math.max(0.1, scale)));
        return {
          ...baseStyle,
          left: "50%",
          top: -offset,
          backgroundColor: "#3b82f6",
          cursor: "grab",
          width: "16px",
          height: "16px",
        };
      }
      default:
        return baseStyle;
    }
  };

  return <div style={getHandleStyle()} onMouseDown={onMouseDown} data-transform-handle={position} />;
};

// Memoize to prevent unnecessary re-renders
export const TransformOverlayMemoized = React.memo(TransformOverlay);
