/**
 * Transform Calculator
 *
 * Core transform math for clip manipulation in canvas space.
 * Handles coordinate conversions, constraint enforcement, and transform operations.
 *
 * IMPORTANT: The `clip` parameter in calculateTransform must be the clip state
 * captured at drag start (startTransform), NOT the live clip state. Delta is
 * computed as (currentMouse - startMouse) and applied to the start state,
 * producing an absolute result that does not compound across frames.
 */

import type { Clip, TransformHandle, TransformConstraints } from "@/types";

const MIN_CLIP_SIZE_ABSOLUTE = 64; // Absolute floor (px)
const MIN_CLIP_SIZE_RATIO_OF_SHORT_EDGE = 0.12; // 12% of sequence short edge
const MAX_CLIP_SCALE_FROM_CANVAS = 8; // Professional guardrail against runaway scaling
const ASPECT_RATIO_SNAP_EPSILON = 0.02; // 2% snap band for "perfect shape" feel

function calculateTextHeight(
  text: string,
  fontFamily: string,
  fontSize: number,
  bold: boolean,
  maxWidth: number,
  lineHeight: number = 1.2
): number {
  try {
    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
    const ctx = canvas.getContext("2d") as any;
    if (!ctx) return fontSize * lineHeight * 1.5;
    ctx.font = `${bold ? "bold" : "normal"} ${fontSize}px ${fontFamily}`;

    // Break text character-by-character (like CapCut) so that when
    // the user drags the width handle, every character wraps exactly
    // at the bounding box edge — no word overflows.
    let lineCount = 0;
    let currentLine = "";

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      // Hard line-break: count it and start a fresh line
      if (char === "\n") {
        lineCount++;
        currentLine = "";
        continue;
      }
      const testLine = currentLine + char;
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && currentLine.length > 0) {
        lineCount++;
        currentLine = char;
      } else {
        currentLine = testLine;
      }
    }
    // Count the last partial line
    if (currentLine.length > 0) {
      lineCount++;
    }
    return Math.max(1, lineCount) * fontSize * lineHeight;
  } catch (e) {
    return fontSize * lineHeight * 1.5;
  }
}

/**
 * Calculate new transform from handle drag operation.
 * Returns partial clip update with new position/dimensions.
 *
 * @param clip - The clip state at drag start (NOT live state — avoids compounding)
 * @param handle - Which handle is being dragged
 * @param startMousePos - Mouse position at drag start (canvas space)
 * @param currentMousePos - Current mouse position (canvas space)
 * @param constraints - Transform constraints
 * @param startAngle - For rotation: the initial angle at mousedown (radians). Optional.
 */
export function calculateTransform(
  clip: Clip,
  handle: TransformHandle,
  startMousePos: { x: number; y: number },
  currentMousePos: { x: number; y: number },
  constraints: TransformConstraints,
  startAngle?: number,
): Partial<Clip> {
  const rawDelta = {
    x: currentMousePos.x - startMousePos.x,
    y: currentMousePos.y - startMousePos.y,
  };

  const rotationRad = ((clip.rotation || 0) * Math.PI) / 180;
  const cosTheta = Math.cos(rotationRad);
  const sinTheta = Math.sin(rotationRad);

  // Project mouse delta into clip's rotated local coordinate system
  const localDelta = {
    x: rawDelta.x * cosTheta + rawDelta.y * sinTheta,
    y: -rawDelta.x * sinTheta + rawDelta.y * cosTheta,
  };

  switch (handle) {
    case "move":
      return handleMove(clip, rawDelta, constraints);

    case "nw":
    case "ne":
    case "sw":
    case "se":
      return handleCornerDrag(clip, handle, localDelta, constraints);

    case "n":
    case "s":
    case "e":
    case "w":
      return handleEdgeDrag(clip, handle, localDelta, constraints, cosTheta, sinTheta);

    case "rotate":
      return handleRotation(clip, currentMousePos, constraints, startAngle);

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

  // Constrain to canvas bounds (allow partial off-canvas)
  const minX = -clip.width * 0.5;
  const maxX = constraints.canvasWidth - clip.width * 0.5;
  const minY = -clip.height * 0.5;
  const maxY = constraints.canvasHeight - clip.height * 0.5;

  newX = Math.max(minX, Math.min(maxX, newX));
  newY = Math.max(minY, Math.min(maxY, newY));

  return { x: newX, y: newY };
}

/**
 * Handle corner drag for scaling.
 * Maintains aspect ratio if locked.
 */
function handleCornerDrag(clip: Clip, handle: "nw" | "ne" | "sw" | "se", delta: { x: number; y: number }, constraints: TransformConstraints): Partial<Clip> {
  const aspectRatio = clip.sourceAspectRatio ?? clip.width / clip.height;
  // Respect the aspect-ratio lock setting from the user's toggle
  const isLocked = constraints.aspectRatioLocked;
  // Professional NLE feel: corner resize scales around the clip center.
  // Corner drag direction still controls whether size grows or shrinks,
  // but geometry expands/contracts symmetrically on both sides.
  const centerX = clip.x + clip.width / 2;
  const centerY = clip.y + clip.height / 2;
  const dirX = handle === "ne" || handle === "se" ? 1 : -1;
  const dirY = handle === "sw" || handle === "se" ? 1 : -1;
  const primaryDelta = Math.abs(delta.x) >= Math.abs(delta.y) ? delta.x * dirX : delta.y * dirY;
  // Proportional scaling: derive a scale factor from the dominant axis to avoid
  // additive delta fighting the aspect-ratio correction (eliminates stutter).
  const refDim = Math.max(1, Math.max(clip.width, clip.height));
  const scaleFactor = 1 + (primaryDelta * 2) / refDim;
  let newWidth = clip.width * scaleFactor;
  let newHeight = clip.height * scaleFactor;

  const clamped = clampDimensions(newWidth, newHeight, clip, constraints, isLocked);
  newWidth = clamped.width;
  newHeight = clamped.height;

  if (!isLocked) {
    const snapped = snapToSourceAspectIfNear(clip, newWidth, newHeight, constraints);
    newWidth = snapped.width;
    newHeight = snapped.height;
  }

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

  // Re-center after resize so scaling happens symmetrically from center.
  const newX = centerX - newWidth / 2;
  const newY = centerY - newHeight / 2;

  return {
    x: newX,
    y: newY,
    width: newWidth,
    height: newHeight,
  };
}

/**
 * Handle edge drag for single-axis scaling.
 * Enforces aspect ratio when locked (adjusts the perpendicular axis proportionally).
 */
function handleEdgeDrag(
  clip: Clip,
  handle: "n" | "s" | "e" | "w",
  delta: { x: number; y: number },
  constraints: TransformConstraints,
  cosTheta: number = 1,
  sinTheta: number = 0
): Partial<Clip> {
  const isLocked = false;

  let newWidth = clip.width;
  let newHeight = clip.height;
  const centerX = clip.x + clip.width / 2;
  const centerY = clip.y + clip.height / 2;
  let newCenterX = centerX;
  let newCenterY = centerY;

  switch (handle) {
    case "n": {
      newHeight = Math.max(constraints.minHeight, clip.height - delta.y);
      const dh = newHeight - clip.height;
      newCenterX = centerX + (dh / 2) * sinTheta;
      newCenterY = centerY - (dh / 2) * cosTheta;
      break;
    }

    case "s": {
      newHeight = Math.max(constraints.minHeight, clip.height + delta.y);
      const dh = newHeight - clip.height;
      newCenterX = centerX - (dh / 2) * sinTheta;
      newCenterY = centerY + (dh / 2) * cosTheta;
      break;
    }

    case "e": {
      newWidth = Math.max(constraints.minWidth, clip.width + delta.x);
      const dw = newWidth - clip.width;
      newCenterX = centerX + (dw / 2) * cosTheta;
      newCenterY = centerY + (dw / 2) * sinTheta;
      if (clip.kind === "text") {
        const textClip = clip as any;
        const isBold = textClip.fontWeight === "bold" || textClip.bold === true;
        newHeight = calculateTextHeight(
          textClip.text || "",
          textClip.fontFamily || "Inter, system-ui, sans-serif",
          textClip.fontSize || 48,
          isBold,
          newWidth,
          textClip.lineHeight || 1.2
        );
      }
      break;
    }

    case "w": {
      newWidth = Math.max(constraints.minWidth, clip.width - delta.x);
      const dw = newWidth - clip.width;
      newCenterX = centerX - (dw / 2) * cosTheta;
      newCenterY = centerY - (dw / 2) * sinTheta;
      if (clip.kind === "text") {
        const textClip = clip as any;
        const isBold = textClip.fontWeight === "bold" || textClip.bold === true;
        newHeight = calculateTextHeight(
          textClip.text || "",
          textClip.fontFamily || "Inter, system-ui, sans-serif",
          textClip.fontSize || 48,
          isBold,
          newWidth,
          textClip.lineHeight || 1.2
        );
      }
      break;
    }
  }

  const clamped = clampDimensions(newWidth, newHeight, clip, constraints, isLocked);
  newWidth = clamped.width;
  newHeight = clamped.height;

  const newX = newCenterX - newWidth / 2;
  const newY = newCenterY - newHeight / 2;

  return {
    x: newX,
    y: newY,
    width: newWidth,
    height: newHeight,
  };
}

function clampDimensions(width: number, height: number, clip: Clip, constraints: TransformConstraints, keepAspect: boolean): { width: number; height: number } {
  const defaultMaxWidth = Math.max(constraints.canvasWidth * MAX_CLIP_SCALE_FROM_CANVAS, constraints.minWidth);
  const defaultMaxHeight = Math.max(constraints.canvasHeight * MAX_CLIP_SCALE_FROM_CANVAS, constraints.minHeight);
  const maxWidth = constraints.maxWidth ?? defaultMaxWidth;
  const maxHeight = constraints.maxHeight ?? defaultMaxHeight;

  let w = Math.max(constraints.minWidth, Math.min(maxWidth, width));
  let h = Math.max(constraints.minHeight, Math.min(maxHeight, height));

  if (keepAspect) {
    const aspect = clip.sourceAspectRatio ?? clip.width / Math.max(1, clip.height);
    const scaleFromWidth = w / Math.max(1, clip.width);
    const scaleFromHeight = h / Math.max(1, clip.height);
    const scale = Math.min(scaleFromWidth, scaleFromHeight);
    w = Math.max(constraints.minWidth, Math.min(maxWidth, clip.width * scale));
    h = Math.max(constraints.minHeight, Math.min(maxHeight, clip.height * scale));
  }

  return { width: w, height: h };
}

function snapToSourceAspectIfNear(clip: Clip, width: number, height: number, constraints: TransformConstraints): { width: number; height: number } {
  const targetAspect = clip.sourceAspectRatio ?? clip.width / Math.max(1, clip.height);
  if (!Number.isFinite(targetAspect) || targetAspect <= 0) return { width, height };

  const currentAspect = width / Math.max(1, height);
  const relError = Math.abs(currentAspect - targetAspect) / targetAspect;
  if (relError > ASPECT_RATIO_SNAP_EPSILON) return { width, height };

  // Snap along the dominant dimension to avoid perceptible jump direction changes.
  const widthScaledHeight = width / targetAspect;
  const heightScaledWidth = height * targetAspect;
  const useWidthAsAnchor = Math.abs(width - clip.width) >= Math.abs(height - clip.height);

  const candidate = useWidthAsAnchor
    ? { width, height: widthScaledHeight }
    : { width: heightScaledWidth, height };

  return clampDimensions(candidate.width, candidate.height, clip, constraints, false);
}

/**
 * Handle rotation around clip center.
 * Uses delta-angle from drag start to prevent initial snap.
 *
 * @param clip - Clip at drag start
 * @param mousePos - Current mouse position (canvas space)
 * @param constraints - Transform constraints
 * @param startAngle - Angle (radians) from clip center to mouse at drag start
 */
function handleRotation(clip: Clip, mousePos: { x: number; y: number }, constraints: TransformConstraints, startAngle?: number): Partial<Clip> {
  // Calculate clip center
  const centerX = clip.x + clip.width / 2;
  const centerY = clip.y + clip.height / 2;

  // Calculate current angle from center to mouse
  const currentAngle = Math.atan2(mousePos.y - centerY, mousePos.x - centerX);

  // If we have a start angle, compute rotation as delta from it
  // This prevents the initial 90° snap since rotation starts from the clip's current angle
  let degrees: number;
  if (startAngle !== undefined) {
    const deltaAngle = currentAngle - startAngle;
    degrees = clip.rotation + (deltaAngle * 180) / Math.PI;
  } else {
    // Fallback: absolute angle (will snap on first frame)
    degrees = (currentAngle * 180) / Math.PI;
  }

  // Normalize to -180..180
  degrees = ((degrees % 360) + 540) % 360 - 180;

  // Optional: Snap to 15-degree increments
  const snapThreshold = 5; // degrees
  const snapAngles = [0, 45, 90, 135, 180, -45, -90, -135, -180];

  for (const snapAngle of snapAngles) {
    if (Math.abs(degrees - snapAngle) < snapThreshold) {
      degrees = snapAngle;
      break;
    }
  }

  return { rotation: degrees };
}

/**
 * Get the cursor style for a transform handle.
 * Accounts for clip rotation to show the correct resize direction.
 */
export function getCursorForHandle(handle: TransformHandle, rotation: number = 0): string {
  const baseCursors: Record<TransformHandle, string> = {
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

  if (handle === "move" || handle === "rotate") {
    return baseCursors[handle];
  }

  // For resize handles, rotate the cursor to match clip rotation
  // Cursor directions cycle every 45° through 8 directions
  const cursorAngles: string[] = [
    "ns-resize",    // 0°
    "nesw-resize",  // 45°
    "ew-resize",    // 90°
    "nwse-resize",  // 135°
    "ns-resize",    // 180°
    "nesw-resize",  // 225°
    "ew-resize",    // 270°
    "nwse-resize",  // 315°
  ];

  const handleBaseAngle: Record<string, number> = {
    n: 0, ne: 45, e: 90, se: 135,
    s: 180, sw: 225, w: 270, nw: 315,
  };

  const baseAngle = handleBaseAngle[handle] ?? 0;
  const totalAngle = (baseAngle + rotation + 360) % 360;
  const index = Math.round(totalAngle / 45) % 8;

  return cursorAngles[index];
}

/**
 * Check if a point is inside a clip's bounds.
 * Handles rotation by inverse-rotating the point around clip center.
 */
export function isPointInClip(point: { x: number; y: number }, clip: Clip): boolean {
  const rotation = clip.rotation ?? 0;

  // Fast path: no rotation — simple AABB test
  if (rotation === 0) {
    return point.x >= clip.x && point.x <= clip.x + clip.width && point.y >= clip.y && point.y <= clip.y + clip.height;
  }

  // Rotation-aware: un-rotate the point around clip center, then AABB test
  const centerX = clip.x + clip.width / 2;
  const centerY = clip.y + clip.height / 2;

  const dx = point.x - centerX;
  const dy = point.y - centerY;

  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const unrotatedX = dx * cos - dy * sin + centerX;
  const unrotatedY = dx * sin + dy * cos + centerY;

  return unrotatedX >= clip.x && unrotatedX <= clip.x + clip.width && unrotatedY >= clip.y && unrotatedY <= clip.y + clip.height;
}

/**
 * Get default transform constraints for a clip.
 */
export function getDefaultConstraints(canvasWidth: number, canvasHeight: number, aspectRatioLocked: boolean = true): TransformConstraints {
  const shortEdge = Math.max(1, Math.min(canvasWidth, canvasHeight));
  const dynamicMin = Math.max(MIN_CLIP_SIZE_ABSOLUTE, Math.round(shortEdge * MIN_CLIP_SIZE_RATIO_OF_SHORT_EDGE));
  return {
    aspectRatioLocked,
    minWidth: dynamicMin,
    minHeight: dynamicMin,
    maxWidth: canvasWidth * MAX_CLIP_SCALE_FROM_CANVAS,
    maxHeight: canvasHeight * MAX_CLIP_SCALE_FROM_CANVAS,
    canvasWidth,
    canvasHeight,
    snapToGrid: false,
    snapThreshold: 10,
  };
}
