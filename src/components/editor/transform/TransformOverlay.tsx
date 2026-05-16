/**
 * Transform Overlay
 *
 * Renders transform controls (border + handles) for selected clips in the preview.
 */

import React, { useCallback, useRef, useState } from "react";
import { useUIStore } from "@/store/uiStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useHistoryStore } from "@/store/historyStore";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import { calculateTransform, getCursorForHandle, getDefaultConstraints } from "@/lib/transform/calculator";
import type { Clip, TransformHandle } from "@/types";

interface TransformOverlayProps {
  /** Canvas dimensions for coordinate conversion */
  canvasWidth: number;
  canvasHeight: number;
  /** Scale factor for preview (1 = 100%) */
  scale: number;
}

export const TransformOverlay: React.FC<TransformOverlayProps> = ({ canvasWidth, canvasHeight, scale }) => {
  const { selectedClipIds, activeTransform, startTransform, updateTransform, endTransform } = useUIStore();
  const { clips, updateClip } = useTimelineStore();
  const { execute } = useHistoryStore();

  const [isDragging, setIsDragging] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Get the first selected clip (multi-select transform comes later)
  const selectedClip = clips.find((c) => c.id === selectedClipIds[0]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, handle: TransformHandle) => {
      if (!selectedClip) return;

      e.stopPropagation();
      setIsDragging(true);

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Convert screen coordinates to canvas coordinates
      const startMousePos = {
        x: (e.clientX - rect.left) / scale,
        y: (e.clientY - rect.top) / scale,
      };

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
        startMousePos,
        aspectRatioLocked: selectedClip.aspectRatioLocked ?? true,
        sourceAspectRatio: selectedClip.sourceAspectRatio ?? selectedClip.width / selectedClip.height,
      });
    },
    [selectedClip, scale, startTransform],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !activeTransform || !selectedClip) return;

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Convert screen coordinates to canvas coordinates
      const currentMousePos = {
        x: (e.clientX - rect.left) / scale,
        y: (e.clientY - rect.top) / scale,
      };

      // Calculate new transform
      const constraints = getDefaultConstraints(canvasWidth, canvasHeight, activeTransform.aspectRatioLocked);

      const newTransform = calculateTransform(selectedClip, activeTransform.handle, activeTransform.startMousePos, currentMousePos, constraints);

      // Optimistic update (no history yet)
      updateClip(selectedClip.id, newTransform);
    },
    [isDragging, activeTransform, selectedClip, scale, canvasWidth, canvasHeight, updateClip],
  );

  const handleMouseUp = useCallback(() => {
    if (!isDragging || !activeTransform || !selectedClip) return;

    setIsDragging(false);

    // Commit to history
    const oldTransform = activeTransform.startTransform;
    const newTransform = {
      x: selectedClip.x,
      y: selectedClip.y,
      width: selectedClip.width,
      height: selectedClip.height,
      rotation: selectedClip.rotation,
    };

    // Only create command if something actually changed
    const hasChanged = oldTransform.x !== newTransform.x || oldTransform.y !== newTransform.y || oldTransform.width !== newTransform.width || oldTransform.height !== newTransform.height || oldTransform.rotation !== newTransform.rotation;

    if (hasChanged) {
      execute(new TransformClipCommand(selectedClip.id, oldTransform, newTransform));
    }

    endTransform();
  }, [isDragging, activeTransform, selectedClip, execute, endTransform]);

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

  if (!selectedClip) return null;

  const { x, y, width, height, rotation } = selectedClip;

  // Scale coordinates for display
  const displayX = x * scale;
  const displayY = y * scale;
  const displayWidth = width * scale;
  const displayHeight = height * scale;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 pointer-events-none"
      style={{
        width: canvasWidth * scale,
        height: canvasHeight * scale,
      }}
    >
      {/* Transform border */}
      <div
        className="absolute border-2 border-white pointer-events-auto cursor-move"
        style={{
          left: displayX,
          top: displayY,
          width: displayWidth,
          height: displayHeight,
          transform: `rotate(${rotation}deg)`,
          transformOrigin: "center",
        }}
        onMouseDown={(e) => handleMouseDown(e, "move")}
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
        <Handle position="rotate" onMouseDown={(e) => handleMouseDown(e, "rotate")} />
      </div>
    </div>
  );
};

interface HandleProps {
  position: TransformHandle;
  onMouseDown: (e: React.MouseEvent) => void;
}

const Handle: React.FC<HandleProps> = ({ position, onMouseDown }) => {
  const getHandleStyle = (): React.CSSProperties => {
    const baseStyle: React.CSSProperties = {
      position: "absolute",
      width: "12px",
      height: "12px",
      backgroundColor: "white",
      border: "2px solid #3b82f6",
      borderRadius: "50%",
      cursor: getCursorForHandle(position),
      transform: "translate(-50%, -50%)",
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
      case "rotate":
        return {
          ...baseStyle,
          left: "50%",
          top: -30,
          backgroundColor: "#3b82f6",
          cursor: "grab",
        };
      default:
        return baseStyle;
    }
  };

  return <div style={getHandleStyle()} onMouseDown={onMouseDown} />;
};
