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
 *
 * THE BIGGEST MISTAKE BEGINNERS MAKE:
 * They combine viewport zoom with clip scale.
 * This causes: export bugs, selection bugs, transform drift, coordinate hell.
 * DO NOT DO THAT.
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
  /** Pan offset X in canvas space */
  panX: number;
  /** Pan offset Y in canvas space */
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
 * @param screenX - X coordinate in screen space (pixels)
 * @param screenY - Y coordinate in screen space (pixels)
 * @param viewport - Current viewport transform
 * @param canvas - Canvas dimensions
 * @param displayScale - Scale factor from canvas to display (displayWidth / canvasWidth)
 * @param displayOffset - Offset of canvas in display space (for letterboxing)
 * @returns Canvas coordinates
 */
export function screenToCanvas(screenX: number, screenY: number, viewport: ViewportTransform, canvas: CanvasSpace, displayScale: number, displayOffset: { x: number; y: number }): CanvasPoint {
  // Step 1: Screen → Display (remove letterbox offset)
  const displayX = screenX - displayOffset.x;
  const displayY = screenY - displayOffset.y;

  // Step 2: Display → Canvas (remove display scale)
  const canvasX = displayX / displayScale;
  const canvasY = displayY / displayScale;

  // Step 3: Canvas → Viewport (apply viewport transform)
  const viewportX = canvasX / viewport.zoom - viewport.panX;
  const viewportY = canvasY / viewport.zoom - viewport.panY;

  return makeCanvasPoint(viewportX, viewportY);
}

/**
 * Convert canvas coordinates to screen coordinates.
 * Used for: rendering, overlay positioning.
 *
 * @param canvasX - X coordinate in canvas space
 * @param canvasY - Y coordinate in canvas space
 * @param viewport - Current viewport transform
 * @param canvas - Canvas dimensions
 * @param displayScale - Scale factor from canvas to display
 * @param displayOffset - Offset of canvas in display space
 * @returns Screen coordinates
 */
export function canvasToScreen(canvasX: number, canvasY: number, viewport: ViewportTransform, canvas: CanvasSpace, displayScale: number, displayOffset: { x: number; y: number }): ScreenPoint {
  // Step 1: Canvas → Viewport (apply viewport transform)
  const viewportX = (canvasX + viewport.panX) * viewport.zoom;
  const viewportY = (canvasY + viewport.panY) * viewport.zoom;

  // Step 2: Viewport → Display (apply display scale)
  const displayX = viewportX * displayScale;
  const displayY = viewportY * displayScale;

  // Step 3: Display → Screen (add letterbox offset)
  const screenX = displayX + displayOffset.x;
  const screenY = displayY + displayOffset.y;

  return makeScreenPoint(screenX, screenY);
}

/**
 * Calculate display scale and offset for canvas.
 * Handles letterboxing and viewport zoom.
 *
 * IMPORTANT: The returned `scale` value incorporates viewport zoom.
 * It is the ratio: containerPixels / (canvasPixels × zoom).
 * This means coordinate conversion functions (screenToCanvas, canvasToScreen)
 * that also apply zoom will have the zoom factor cancel out — which is correct.
 * The zoom effect is expressed through displayWidth/displayHeight sizing,
 * NOT through the coordinate transform.
 *
 * @param canvas - Canvas dimensions
 * @param viewport - Current viewport transform
 * @param containerWidth - Container width in pixels
 * @param containerHeight - Container height in pixels
 * @param scaleMode - "fit" or "fill"
 * @returns Display scale (zoom-inclusive) and offset
 */
export function calculateDisplayTransform(
  canvas: CanvasSpace,
  viewport: ViewportTransform,
  containerWidth: number,
  containerHeight: number,
  scaleMode: "fit" | "fill" = "fit",
): {
  /** Composite scale factor (zoom-inclusive): containerPixels / (canvasPixels × zoom) */
  scale: number;
  /** Horizontal letterbox offset (container-relative) */
  offsetX: number;
  /** Vertical letterbox offset (container-relative) */
  offsetY: number;
  /** Display width in CSS pixels */
  displayWidth: number;
  /** Display height in CSS pixels */
  displayHeight: number;
} {
  // Apply viewport zoom to canvas dimensions
  const zoomedCanvasWidth = canvas.width * viewport.zoom;
  const zoomedCanvasHeight = canvas.height * viewport.zoom;

  // Calculate scale to fit/fill container
  const scaleX = containerWidth / zoomedCanvasWidth;
  const scaleY = containerHeight / zoomedCanvasHeight;
  const scale = scaleMode === "fit" ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);

  // Calculate display dimensions
  const displayWidth = zoomedCanvasWidth * scale;
  const displayHeight = zoomedCanvasHeight * scale;

  // Calculate letterbox offset (center canvas in container)
  const offsetX = (containerWidth - displayWidth) / 2;
  const offsetY = (containerHeight - displayHeight) / 2;

  return {
    scale,
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
