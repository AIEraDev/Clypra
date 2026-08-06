/**
 * Coordinate System Architecture
 *
 * This module defines the 3-layer coordinate system used throughout Clypra.
 * Understanding these spaces is CRITICAL for correct transform behavior.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ LAYER 1: VIEWPORT SPACE (Editor-Only)                              │
 * │ - Editor zoom/pan for canvas preview                                │
 * │ - NOT exported                                                      │
 * │ - Allows users to zoom in/out and pan around the canvas             │
 * │ - Independent of clip transforms                                    │
 * └─────────────────────────────────────────────────────────────────────┘
 *                              ↓
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ LAYER 2: CANVAS SPACE (Project/Sequence)                           │
 * │ - Project aspect ratio and dimensions                               │
 * │ - THIS is what gets exported                                        │
 * │ - Example: 1080×1920 (9:16 portrait)                               │
 * │ - Defines the render universe                                       │
 * └─────────────────────────────────────────────────────────────────────┘
 *                              ↓
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ LAYER 3: MEDIA SPACE (Per-Clip Transform)                          │
 * │ - Clip transform layer                                              │
 * │ - scale, translate, rotate, crop, anchor                            │
 * │ - Independent from viewport zoom                                    │
 * │ - Stored in canvas coordinates                                      │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * CRITICAL ARCHITECTURAL INSIGHT:
 * CapCut separates:
 *
 * A. Viewport Zoom (Editor-only)
 *    - Changes: how user sees canvas
 *    - NOT exported
 *    - Example: zoom 50%, zoom 200%, pan x/y
 *
 * B. Canvas Aspect Ratio (Project-level)
 *    - Defines: final export dimensions
 *    - Example: 16:9, 9:16, 1:1
 *
 * C. Clip Transform (Per-clip)
 *    - Defines: how media fits into canvas
 *    - Example: scale, move, rotate, crop
 *
 * THE RENDERING PIPELINE:
 *
 * Step 1 — Editor Viewport Transform
 * Applied ONLY in editor UI.
 * screen ← viewport transform ← canvas
 *
 * Step 2 — Canvas Space
 * Render the sequence.
 * Canvas dimensions fixed: 1080×1920
 *
 * Step 3 — Clip Transform
 * Each clip transforms INSIDE canvas.
 * canvas ← clip transform ← media
 */

/**
 * Nominal types to prevent mixing coordinate spaces.
 */
export type ScreenPoint = { x: number; y: number } & { readonly __type: unique symbol };
export type CanvasPoint = { x: number; y: number } & { readonly __type: unique symbol };
export type DisplayPoint = { x: number; y: number } & { readonly __type: unique symbol };

/** Creates a branded ScreenPoint from raw coordinates */
export function makeScreenPoint(x: number, y: number): ScreenPoint {
  return { x, y } as ScreenPoint;
}

/** Creates a branded CanvasPoint from raw coordinates */
export function makeCanvasPoint(x: number, y: number): CanvasPoint {
  return { x, y } as CanvasPoint;
}

/** Creates a branded DisplayPoint from raw coordinates */
export function makeDisplayPoint(x: number, y: number): DisplayPoint {
  return { x, y } as DisplayPoint;
}

/**
 * Viewport Transform State (Editor-Only)
 * This is NEVER exported.
 */
export interface ViewportTransform {
  /** Zoom level (0.1 = 10%, 1.0 = 100%, 5.0 = 500%) */
  zoom: number;
  /** Pan offset X in screen pixels */
  panX: number;
  /** Pan offset Y in screen pixels */
  panY: number;
}

/**
 * Canvas Space (Project/Sequence)
 * This defines the render universe.
 */
export interface CanvasSpace {
  /** Canvas width in pixels (e.g., 1920) */
  width: number;
  /** Canvas height in pixels (e.g., 1080) */
  height: number;
}

/**
 * Clip Transform (Per-Clip)
 * All coordinates are in canvas space.
 */
export interface ClipTransform {
  /** Position X in canvas space */
  x: number;
  /** Position Y in canvas space */
  y: number;
  /** Width in canvas space */
  width: number;
  /** Height in canvas space */
  height: number;
  /** Rotation in degrees (clockwise) */
  rotation: number;
  /** Scale X (1.0 = 100%) */
  scaleX: number;
  /** Scale Y (1.0 = 100%) */
  scaleY: number;
  /** Anchor X (0.0 = left, 0.5 = center, 1.0 = right) */
  anchorX: number;
  /** Anchor Y (0.0 = top, 0.5 = center, 1.0 = bottom) */
  anchorY: number;
  /** Opacity (0.0 = transparent, 1.0 = opaque) */
  opacity: number;
}

/**
 * Convert screen coordinates to canvas coordinates.
 * Used for: mouse clicks, drag operations, hit testing.
 *
 * Pipeline: screen → remove offset → remove (baseScale × zoom) → canvas
 *
 * @param screenX - X coordinate in screen space (pixels)
 * @param screenY - Y coordinate in screen space (pixels)
 * @param viewport - Current viewport transform
 * @param canvas - Canvas dimensions (unused in math, kept for API consistency)
 * @param displayScale - Base scale factor (zoom-exclusive, from calculateDisplayTransform)
 * @param displayOffset - Offset of canvas in display space (includes pan)
 * @returns Canvas coordinates
 */
export function screenToCanvas(screenX: number, screenY: number, viewport: ViewportTransform, canvas: CanvasSpace, displayScale: number, displayOffset: { x: number; y: number }): CanvasPoint {
  // Step 1: Remove offset (includes letterbox centering + pan)
  const relativeX = screenX - displayOffset.x;
  const relativeY = screenY - displayOffset.y;

  // Step 2: Remove combined scale (baseScale × zoom)
  const canvasX = relativeX / (displayScale * viewport.zoom);
  const canvasY = relativeY / (displayScale * viewport.zoom);

  return makeCanvasPoint(canvasX, canvasY);
}

/**
 * Convert canvas coordinates to screen coordinates.
 * Used for: rendering, overlay positioning.
 *
 * Pipeline: canvas → apply (baseScale × zoom) → add offset → screen
 *
 * @param canvasX - X coordinate in canvas space
 * @param canvasY - Y coordinate in canvas space
 * @param viewport - Current viewport transform
 * @param canvas - Canvas dimensions (unused in math, kept for API consistency)
 * @param displayScale - Base scale factor (zoom-exclusive, from calculateDisplayTransform)
 * @param displayOffset - Offset of canvas in display space (includes pan)
 * @returns Screen coordinates
 */
export function canvasToScreen(canvasX: number, canvasY: number, viewport: ViewportTransform, canvas: CanvasSpace, displayScale: number, displayOffset: { x: number; y: number }): ScreenPoint {
  // Step 1: Apply combined scale (baseScale × zoom)
  const scaledX = canvasX * displayScale * viewport.zoom;
  const scaledY = canvasY * displayScale * viewport.zoom;

  // Step 2: Add offset (includes letterbox centering + pan)
  const screenX = scaledX + displayOffset.x;
  const screenY = scaledY + displayOffset.y;

  return makeScreenPoint(screenX, screenY);
}

/**
 * Calculate display scale and offset for canvas.
 * Handles letterboxing. Viewport zoom is applied to display dimensions
 * but NOT baked into the returned `scale`.
 *
 * ARCHITECTURE:
 * - `scale` is the BASE fit ratio: containerPixels / canvasPixels.
 *   It does NOT include viewport zoom.
 * - `displayWidth/Height` = canvas × zoom × baseScale — the actual CSS size
 *   of the preview element. Zooming in makes this larger than the container.
 * - `screenToCanvas` and `canvasToScreen` receive this base `scale` and
 *   apply viewport zoom separately, keeping coordinate math correct.
 * - `offsetX/Y` center the (possibly zoomed-beyond-container) canvas.
 *   When zoomed in, offsets can be negative (canvas overflows container).
 *   Pan offsets are added to these for camera movement.
 *
 * @param canvas - Canvas dimensions
 * @param viewport - Current viewport transform
 * @param containerWidth - Container width in pixels
 * @param containerHeight - Container height in pixels
 * @param scaleMode - "fit" or "fill"
 * @returns Display scale (zoom-exclusive) and offset
 */
export function calculateDisplayTransform(
  canvas: CanvasSpace,
  viewport: ViewportTransform,
  containerWidth: number,
  containerHeight: number,
  scaleMode: "fit" | "fill" = "fit",
): {
  /** Base scale factor (zoom-exclusive): how canvas maps to container at zoom=1 */
  scale: number;
  /** Horizontal offset (container-relative, includes pan) */
  offsetX: number;
  /** Vertical offset (container-relative, includes pan) */
  offsetY: number;
  /** Display width in CSS pixels (zoom-inclusive) */
  displayWidth: number;
  /** Display height in CSS pixels (zoom-inclusive) */
  displayHeight: number;
} {
  // Base scale: canvas → container WITHOUT viewport zoom
  const scaleX = containerWidth / canvas.width;
  const scaleY = containerHeight / canvas.height;
  const baseScale = scaleMode === "fit" ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);

  // Display dimensions: canvas scaled to container, then zoom applied
  const displayWidth = canvas.width * baseScale * viewport.zoom;
  const displayHeight = canvas.height * baseScale * viewport.zoom;

  // Center in container + apply pan (pan is in screen pixels)
  const offsetX = (containerWidth - displayWidth) / 2 + viewport.panX;
  const offsetY = (containerHeight - displayHeight) / 2 + viewport.panY;

  return {
    scale: baseScale,
    offsetX,
    offsetY,
    displayWidth,
    displayHeight,
  };
}

/**
 * Clamp viewport zoom to valid range.
 */
export function clampViewportZoom(zoom: number, min = 0.1, max = 5.0): number {
  return Math.max(min, Math.min(max, zoom));
}

/**
 * Calculate zoom to fit canvas in container.
 * Never zooms in beyond 100%.
 */
export function calculateZoomToFit(canvas: CanvasSpace, containerWidth: number, containerHeight: number): number {
  const scaleX = containerWidth / canvas.width;
  const scaleY = containerHeight / canvas.height;
  return Math.min(scaleX, scaleY, 1.0);
}

/**
 * Hit test: check if point is inside clip bounds.
 * All coordinates in canvas space.
 * Handles rotated clips by inverse-rotating the test point around the clip center.
 */
export function hitTestClip(pointX: number, pointY: number, clip: { x: number; y: number; width: number; height: number; rotation?: number }): boolean {
  const rotation = clip.rotation ?? 0;

  // Fast path: no rotation — simple AABB test
  if (rotation === 0) {
    return pointX >= clip.x && pointX <= clip.x + clip.width && pointY >= clip.y && pointY <= clip.y + clip.height;
  }

  // Rotation-aware: un-rotate the point around the clip's center, then AABB test
  const centerX = clip.x + clip.width / 2;
  const centerY = clip.y + clip.height / 2;

  // Translate point to clip-center origin
  const dx = pointX - centerX;
  const dy = pointY - centerY;

  // Inverse rotation (negate angle)
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const unrotatedX = dx * cos - dy * sin + centerX;
  const unrotatedY = dx * sin + dy * cos + centerY;

  // Standard AABB test in un-rotated space
  return unrotatedX >= clip.x && unrotatedX <= clip.x + clip.width && unrotatedY >= clip.y && unrotatedY <= clip.y + clip.height;
}

/**
 * Transform point by clip transform.
 * Used for: rotation, anchor point, etc.
 */
export function transformPoint(pointX: number, pointY: number, transform: ClipTransform): CanvasPoint {
  // Apply anchor offset
  const anchorOffsetX = transform.width * transform.anchorX;
  const anchorOffsetY = transform.height * transform.anchorY;

  // Translate to origin
  let x = pointX - transform.x - anchorOffsetX;
  let y = pointY - transform.y - anchorOffsetY;

  // Apply rotation
  if (transform.rotation !== 0) {
    const rad = (transform.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rotatedX = x * cos - y * sin;
    const rotatedY = x * sin + y * cos;
    x = rotatedX;
    y = rotatedY;
  }

  // Apply scale
  x *= transform.scaleX;
  y *= transform.scaleY;

  // Translate back
  x += transform.x + anchorOffsetX;
  y += transform.y + anchorOffsetY;

  return makeCanvasPoint(x, y);
}

/**
 * Inverse transform point by clip transform.
 * Used for: hit testing with rotation.
 */
export function inverseTransformPoint(pointX: number, pointY: number, transform: ClipTransform): CanvasPoint {
  // Apply anchor offset
  const anchorOffsetX = transform.width * transform.anchorX;
  const anchorOffsetY = transform.height * transform.anchorY;

  // Translate to origin
  let x = pointX - transform.x - anchorOffsetX;
  let y = pointY - transform.y - anchorOffsetY;

  // Apply inverse scale
  x /= transform.scaleX;
  y /= transform.scaleY;

  // Apply inverse rotation
  if (transform.rotation !== 0) {
    const rad = (-transform.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rotatedX = x * cos - y * sin;
    const rotatedY = x * sin + y * cos;
    x = rotatedX;
    y = rotatedY;
  }

  // Translate back
  x += transform.x + anchorOffsetX;
  y += transform.y + anchorOffsetY;

  return makeCanvasPoint(x, y);
}

export {
  REFERENCE_CANVAS,
  getFixedScaleFactor,
  normalizeFontSize,
  normalizeIconSize,
  getTextRenderMetrics,
  getFixedSizingConfig,
} from "./fixedSizing";
export type { CanvasDimensions, NormalizedFontSizeOptions, NormalizedIconSizeOptions, TextRenderMetrics } from "./fixedSizing";

