/**
 * Transform Calculator
 *
 * Core transform math for clip manipulation in canvas space.
 * Handles coordinate conversions, constraint enforcement, and transform operations.
 */

import type { Clip, TransformHandle, TransformConstraints } from "@/types";

const MIN_CLIP_SIZE = 20; // Minimum width/height in pixels

/**
 * Calculate new transform from handle drag operation.
 * Returns partial clip update with new position/dimensions.
 */
export function calculateTransform(clip: Clip, handle: TransformHandle, startMousePos: { x: number; y: number }, currentMousePos: { x: number; y: number }, constraints: TransformConstraints): Partial<Clip> {
  const delta = {
    x: currentMousePos.x - startMousePos.x,
    y: currentMousePos.y - startMousePos.y,
  };

  switch (handle) {
    case "move":
      return handleMove(clip, delta, constraints);

    case "nw":
    case "ne":
    case "sw":
    case "se":
      return handleCornerDrag(clip, handle, delta, constraints);

    case "n":
    case "s":
    case "e":
    case "w":
      return handleEdgeDrag(clip, handle, delta, constraints);

    case "rotate":
      return handleRotation(clip, currentMousePos, constraints);

    default:
      return {};
  }
}

/**
 * Handle move operation (drag border).
 * Constrains position to canvas bounds.
 */
function handleMove(clip: Clip, delta: { x: number; y: number }, constraints: TransformConstraints): Partial<Clip> {
  let newX = clip.x + delta.x;
  let newY = clip.y + delta.y;

  if (import.meta.env.DEV) {
    console.log("[Transform Calculator] handleMove", {
      clipPosition: { x: clip.x, y: clip.y },
      delta,
      calculatedNew: { x: newX, y: newY },
    });
  }

  // Constrain to canvas bounds (allow partial off-canvas)
  const minX = -clip.width * 0.5;
  const maxX = constraints.canvasWidth - clip.width * 0.5;
  const minY = -clip.height * 0.5;
  const maxY = constraints.canvasHeight - clip.height * 0.5;

  newX = Math.max(minX, Math.min(maxX, newX));
  newY = Math.max(minY, Math.min(maxY, newY));

  if (import.meta.env.DEV) {
    console.log("[Transform Calculator] handleMove - after constraints", {
      constraints: { minX, maxX, minY, maxY },
      finalPosition: { x: newX, y: newY },
    });
  }

  return { x: newX, y: newY };
}

/**
 * Handle corner drag for scaling.
 * Maintains aspect ratio if locked.
 */
function handleCornerDrag(clip: Clip, handle: "nw" | "ne" | "sw" | "se", delta: { x: number; y: number }, constraints: TransformConstraints): Partial<Clip> {
  const aspectRatio = clip.sourceAspectRatio ?? clip.width / clip.height;
  const isLocked = constraints.aspectRatioLocked;

  // Determine scale direction based on handle
  const scaleX = handle === "ne" || handle === "se" ? 1 : -1;
  const scaleY = handle === "sw" || handle === "se" ? 1 : -1;

  let newWidth = clip.width + delta.x * scaleX;
  let newHeight = clip.height + delta.y * scaleY;

  // Enforce minimum size
  newWidth = Math.max(constraints.minWidth, newWidth);
  newHeight = Math.max(constraints.minHeight, newHeight);

  if (isLocked) {
    // Maintain aspect ratio - use the dimension that changed more
    const widthChange = Math.abs(newWidth - clip.width);
    const heightChange = Math.abs(newHeight - clip.height);

    if (widthChange > heightChange) {
      newHeight = newWidth / aspectRatio;
    } else {
      newWidth = newHeight * aspectRatio;
    }
  }

  // Calculate new position (opposite corner stays fixed)
  let newX = clip.x;
  let newY = clip.y;

  if (handle === "nw" || handle === "sw") {
    // Left edge moved
    newX = clip.x + (clip.width - newWidth);
  }

  if (handle === "nw" || handle === "ne") {
    // Top edge moved
    newY = clip.y + (clip.height - newHeight);
  }

  return {
    x: newX,
    y: newY,
    width: newWidth,
    height: newHeight,
  };
}

/**
 * Handle edge drag for single-axis scaling.
 */
function handleEdgeDrag(clip: Clip, handle: "n" | "s" | "e" | "w", delta: { x: number; y: number }, constraints: TransformConstraints): Partial<Clip> {
  let newX = clip.x;
  let newY = clip.y;
  let newWidth = clip.width;
  let newHeight = clip.height;

  switch (handle) {
    case "n":
      newHeight = clip.height - delta.y;
      newHeight = Math.max(constraints.minHeight, newHeight);
      newY = clip.y + (clip.height - newHeight);
      break;

    case "s":
      newHeight = clip.height + delta.y;
      newHeight = Math.max(constraints.minHeight, newHeight);
      break;

    case "e":
      newWidth = clip.width + delta.x;
      newWidth = Math.max(constraints.minWidth, newWidth);
      break;

    case "w":
      newWidth = clip.width - delta.x;
      newWidth = Math.max(constraints.minWidth, newWidth);
      newX = clip.x + (clip.width - newWidth);
      break;
  }

  return {
    x: newX,
    y: newY,
    width: newWidth,
    height: newHeight,
  };
}

/**
 * Handle rotation around clip center.
 */
function handleRotation(clip: Clip, mousePos: { x: number; y: number }, constraints: TransformConstraints): Partial<Clip> {
  // Calculate clip center
  const centerX = clip.x + clip.width / 2;
  const centerY = clip.y + clip.height / 2;

  // Calculate angle from center to mouse
  const angle = Math.atan2(mousePos.y - centerY, mousePos.x - centerX);
  let degrees = (angle * 180) / Math.PI;

  // Normalize to 0-360
  degrees = (degrees + 360) % 360;

  // Optional: Snap to 15-degree increments
  const snapThreshold = 5; // degrees
  const snapAngles = [0, 45, 90, 135, 180, 225, 270, 315, 360];

  for (const snapAngle of snapAngles) {
    if (Math.abs(degrees - snapAngle) < snapThreshold) {
      degrees = snapAngle % 360;
      break;
    }
  }

  return { rotation: degrees };
}

/**
 * Get the cursor style for a transform handle.
 */
export function getCursorForHandle(handle: TransformHandle, rotation: number = 0): string {
  // TODO: Account for rotation when determining cursor
  const cursors: Record<TransformHandle, string> = {
    move: "move",
    nw: "nwse-resize",
    ne: "nesw-resize",
    sw: "nesw-resize",
    se: "nwse-resize",
    n: "ns-resize",
    s: "ns-resize",
    e: "ew-resize",
    w: "ew-resize",
    rotate: "grab",
  };

  return cursors[handle] || "default";
}

/**
 * Check if a point is inside a clip's bounds.
 */
export function isPointInClip(point: { x: number; y: number }, clip: Clip): boolean {
  return point.x >= clip.x && point.x <= clip.x + clip.width && point.y >= clip.y && point.y <= clip.y + clip.height;
}

/**
 * Get default transform constraints for a clip.
 */
export function getDefaultConstraints(canvasWidth: number, canvasHeight: number, aspectRatioLocked: boolean = true): TransformConstraints {
  return {
    aspectRatioLocked,
    minWidth: MIN_CLIP_SIZE,
    minHeight: MIN_CLIP_SIZE,
    canvasWidth,
    canvasHeight,
    snapToGrid: false,
    snapThreshold: 10,
  };
}
