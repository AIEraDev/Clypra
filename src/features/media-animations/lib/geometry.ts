/**
 * geometry.ts — Offscreen Distance Computation for Media Animation
 *
 * Computes the minimum pixel translations required to move a media element
 * completely off each edge of the composition canvas.
 *
 * Design principles:
 * - No hardcoded pixel distances — all distances derived from canvas + media bounds
 * - Handles landscape (1920×1080), portrait (1080×1920), and square (1080×1080)
 * - Correctly handles rotated media via axis-aligned bounding box (AABB) expansion
 * - Handles degenerate cases: media larger than canvas, media positioned off-center
 * - Pure function — no side effects, fully deterministic
 *
 * Usage in preset keyframes:
 *   positionX value -1.0 → pixelOffsetX = -1.0 * Math.abs(offLeft)  (off-screen left)
 *   positionX value +1.0 → pixelOffsetX = +1.0 * offRight           (off-screen right)
 *   positionY value -1.0 → pixelOffsetY = -1.0 * Math.abs(offUp)    (off-screen top)
 *   positionY value +1.0 → pixelOffsetY = +1.0 * offDown            (off-screen bottom)
 */

import type { OffscreenDistances } from "../types";

/**
 * Computes the minimum pixel translations required to place a media element
 * fully outside each canvas edge.
 *
 * @param canvasWidth  - Composition canvas width in pixels (e.g. project.canvasWidth)
 * @param canvasHeight - Composition canvas height in pixels (e.g. project.canvasHeight)
 * @param mediaX       - Evaluated media position X (top-left corner, canvas pixels)
 * @param mediaY       - Evaluated media position Y (top-left corner, canvas pixels)
 * @param mediaWidth   - Evaluated media render width in canvas pixels
 * @param mediaHeight  - Evaluated media render height in canvas pixels
 * @param mediaRotation - Media rotation in degrees (default 0)
 *
 * @returns OffscreenDistances where:
 *   offLeft  ≤ 0            (always clears left edge when applied as translateX)
 *   offRight ≥ canvasWidth  (always clears right edge when applied as translateX)
 *   offUp    ≤ 0            (always clears top edge when applied as translateY)
 *   offDown  ≥ canvasHeight (always clears bottom edge when applied as translateY)
 */
export function computeOffscreenDistances(
  canvasWidth: number,
  canvasHeight: number,
  mediaX: number,
  mediaY: number,
  mediaWidth: number,
  mediaHeight: number,
  mediaRotation = 0,
): OffscreenDistances {
  // ── Step 1: Axis-Aligned Bounding Box of the rotated media element ─────────
  //
  // For a rectangle of (mediaWidth × mediaHeight) rotated by angle θ,
  // the AABB dimensions are:
  //   aabbWidth  = mediaWidth  * |cos θ| + mediaHeight * |sin θ|
  //   aabbHeight = mediaWidth  * |sin θ| + mediaHeight * |cos θ|
  //
  // For θ = 0, this reduces to the original dimensions.
  const rotRad = (mediaRotation * Math.PI) / 180;
  const abscos = Math.abs(Math.cos(rotRad));
  const abssin = Math.abs(Math.sin(rotRad));
  const aabbWidth = mediaWidth * abscos + mediaHeight * abssin;
  const aabbHeight = mediaWidth * abssin + mediaHeight * abscos;

  // ── Step 2: AABB center (rotation preserves the center point) ─────────────
  const cx = mediaX + mediaWidth / 2;
  const cy = mediaY + mediaHeight / 2;

  // ── Step 3: AABB edges ─────────────────────────────────────────────────────
  const aabbLeft = cx - aabbWidth / 2;
  const aabbRight = cx + aabbWidth / 2;
  const aabbTop = cy - aabbHeight / 2;
  const aabbBottom = cy + aabbHeight / 2;

  // ── Step 4: Minimum translations to clear each canvas edge ────────────────
  //
  // The goal is: applying the returned value as a plain translateX/Y to the
  // media's current position must place the entire AABB completely outside
  // the canvas boundary (not touching, fully clear).
  //
  // offLeft:  translateX so that aabbRight ends up at ≤ −1 (clear of left edge).
  //           = −aabbRight − 1
  //           Always < 0.
  //
  // offRight: translateX so that aabbLeft ends up at ≥ canvasWidth + 1.
  //           = canvasWidth + 1 − aabbLeft
  //           Always > canvasWidth (since aabbLeft ≥ 0 for normal positions).
  //
  //   For degenerate cases (media already off-screen), we still guarantee
  //   the invariant by taking the maximum/minimum with boundary values.
  //
  const offLeft = Math.min(-aabbRight - 1, -1);
  const offRight = Math.max(canvasWidth + 1 - aabbLeft, canvasWidth + 1);

  // offUp:   translateY so that aabbBottom ends up at ≤ −1.
  //           = −aabbBottom − 1
  //           Always < 0.
  const offUp = Math.min(-aabbBottom - 1, -1);

  // offDown: translateY so that aabbTop ends up at ≥ canvasHeight + 1.
  //           = canvasHeight + 1 − aabbTop
  //           Always > canvasHeight.
  const offDown = Math.max(canvasHeight + 1 - aabbTop, canvasHeight + 1);

  return { offLeft, offRight, offUp, offDown };
}

/**
 * Resolves a normalized keyframe position value to actual canvas pixels.
 *
 * Normalized convention:
 *   value = -1.0 → fully off-screen in the negative direction (left or up)
 *   value =  0.0 → no offset (original media position)
 *   value = +1.0 → fully off-screen in the positive direction (right or down)
 *
 * @param value      - Normalized value from the keyframe track [-1, 1]
 * @param distances  - Pre-computed OffscreenDistances for this media+canvas
 * @param axis       - "x" for horizontal movement, "y" for vertical
 */
export function resolveNormalizedOffset(
  value: number,
  distances: OffscreenDistances,
  axis: "x" | "y",
): number {
  if (axis === "x") {
    if (value < 0) {
      // Negative: towards off-screen left
      // offLeft is ≤ 0, so Math.abs(offLeft) gives the distance
      return value * Math.abs(distances.offLeft);
    } else {
      // Positive: towards off-screen right
      return value * distances.offRight;
    }
  } else {
    if (value < 0) {
      // Negative: towards off-screen top
      return value * Math.abs(distances.offUp);
    } else {
      // Positive: towards off-screen bottom
      return value * distances.offDown;
    }
  }
}
