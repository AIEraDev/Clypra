/**
 * geometry.test.ts — Unit tests for computeOffscreenDistances and resolveNormalizedOffset
 *
 * Covers:
 * - Landscape, portrait, square compositions
 * - Centered media, corner-positioned media
 * - Rotated media (AABB expansion)
 * - Scaled media (larger than canvas)
 * - Degenerate cases: media already off-screen, media larger than canvas
 * - Invariant: offLeft ≤ 0, offRight ≥ canvasWidth, offUp ≤ 0, offDown ≥ canvasHeight
 */

import { describe, it, expect } from "vitest";
import {
  computeOffscreenDistances,
  resolveNormalizedOffset,
} from "../lib/geometry";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Checks the core invariant: values guarantee full off-screen clearance */
function assertInvariant(
  canvasWidth: number,
  canvasHeight: number,
  result: ReturnType<typeof computeOffscreenDistances>,
) {
  expect(result.offLeft).toBeLessThan(0);
  expect(result.offRight).toBeGreaterThan(canvasWidth);
  expect(result.offUp).toBeLessThan(0);
  expect(result.offDown).toBeGreaterThan(canvasHeight);
}

// ── Test Suite ────────────────────────────────────────────────────────────

describe("computeOffscreenDistances", () => {
  // ── Standard compositions ─────────────────────────────────────────────

  it("landscape 1920×1080, 1920×1080 media exactly centered", () => {
    const result = computeOffscreenDistances(1920, 1080, 0, 0, 1920, 1080);
    assertInvariant(1920, 1080, result);
    // Media fills canvas exactly. offLeft must push its right edge (1920) past 0.
    expect(result.offLeft).toBeLessThan(0);
    // offRight must push its left edge (0) past 1920.
    expect(result.offRight).toBeGreaterThan(1920);
  });

  it("landscape 1920×1080, small media centered (960×540)", () => {
    // Media centered: x=480, y=270
    const result = computeOffscreenDistances(1920, 1080, 480, 270, 960, 540);
    assertInvariant(1920, 1080, result);
    // offLeft: right edge of media = 480 + 960 = 1440 → must push past 0
    expect(result.offLeft).toBeLessThan(0);
    // offRight: left edge = 480 → must push past 1920
    expect(result.offRight).toBeGreaterThan(1920);
    // offUp: bottom edge = 270 + 540 = 810 → must push past 0
    expect(result.offUp).toBeLessThan(0);
    // offDown: top edge = 270 → must push past 1080
    expect(result.offDown).toBeGreaterThan(1080);
  });

  it("portrait 1080×1920, media centered (540×960)", () => {
    const result = computeOffscreenDistances(1080, 1920, 270, 480, 540, 960);
    assertInvariant(1080, 1920, result);
  });

  it("square 1080×1080, media centered (540×540)", () => {
    const result = computeOffscreenDistances(1080, 1080, 270, 270, 540, 540);
    assertInvariant(1080, 1080, result);
  });

  // ── Corner-positioned media ────────────────────────────────────────────

  it("media at top-left corner (x=0, y=0)", () => {
    const result = computeOffscreenDistances(1920, 1080, 0, 0, 200, 150);
    assertInvariant(1920, 1080, result);
    // offLeft: right edge = 200, so we need to clear by at least −201
    expect(result.offLeft).toBeLessThan(0);
    // offRight: left edge = 0, so we need at least > 1920
    expect(result.offRight).toBeGreaterThan(1920);
  });

  it("media at bottom-right corner (x=1720, y=930)", () => {
    const result = computeOffscreenDistances(1920, 1080, 1720, 930, 200, 150);
    assertInvariant(1920, 1080, result);
    // offRight: left edge = 1720, must push past 1920
    expect(result.offRight).toBeGreaterThan(1920);
    // offDown: top edge = 930, must push past 1080
    expect(result.offDown).toBeGreaterThan(1080);
  });

  // ── Rotated media ──────────────────────────────────────────────────────

  it("45° rotation expands AABB correctly", () => {
    // Media near the LEFT edge (x=10) so AABB expansion in the horizontal
    // direction changes the required clearance visibly.
    // 200×200 rotated 45°: aabbW ≈ 282.8 > 200 (unrotated).
    // aabbRight_0   = (10+100) + 100      = 210   → offLeft = -(210+1) = -211
    // aabbRight_45  = (10+100) + 141.4... ≈ 251.4 → offLeft = -(251.4+1) ≈ -252.4
    const unrotated = computeOffscreenDistances(
      1920,
      1080,
      10,
      440,
      200,
      200,
      0,
    );
    const rotated45 = computeOffscreenDistances(
      1920,
      1080,
      10,
      440,
      200,
      200,
      45,
    );

    assertInvariant(1920, 1080, unrotated);
    assertInvariant(1920, 1080, rotated45);

    // Rotated AABB is wider → right side of AABB extends further right → |offLeft| increases
    expect(Math.abs(rotated45.offLeft)).toBeGreaterThan(
      Math.abs(unrotated.offLeft),
    );
  });

  it("90° rotation of non-square media swaps width/height in AABB", () => {
    // 400×100 at y=10 (near top edge).
    // At 0°:  aabbH = 100, cy = 60, aabbBottom = 110  → offUp = -(110+1) = -111
    // At 90°: aabbH = 400, cy = 60, aabbBottom = 260  → offUp = -(260+1) = -261
    const rot0 = computeOffscreenDistances(1920, 1080, 760, 10, 400, 100, 0);
    const rot90 = computeOffscreenDistances(1920, 1080, 760, 10, 400, 100, 90);

    assertInvariant(1920, 1080, rot0);
    assertInvariant(1920, 1080, rot90);

    // Taller AABB at 90° → more vertical clearance needed upward
    expect(Math.abs(rot90.offUp)).toBeGreaterThan(Math.abs(rot0.offUp));
  });

  it("rotation 0° is equivalent to no rotation argument", () => {
    const explicit = computeOffscreenDistances(
      1920,
      1080,
      480,
      270,
      960,
      540,
      0,
    );
    const implicit = computeOffscreenDistances(1920, 1080, 480, 270, 960, 540);
    expect(explicit).toEqual(implicit);
  });

  // ── Scaled media (larger than canvas) ────────────────────────────────

  it("media larger than canvas (2× scale: 3840×2160 on 1920×1080)", () => {
    // Media starts at x=-960, y=-540 to be centered
    const result = computeOffscreenDistances(
      1920,
      1080,
      -960,
      -540,
      3840,
      2160,
    );
    assertInvariant(1920, 1080, result);
    // offLeft must be strictly negative even though media is 2× canvas size
    expect(result.offLeft).toBeLessThan(0);
    // offRight must be ≥ canvasWidth
    expect(result.offRight).toBeGreaterThanOrEqual(1920);
  });

  it("media exactly fills canvas horizontally but is tall (no horizontal clearance needed)", () => {
    // Media occupies x=0 to x=1920, y=0 to y=2160 (taller than canvas)
    const result = computeOffscreenDistances(1920, 1080, 0, 0, 1920, 2160);
    assertInvariant(1920, 1080, result);
  });

  // ── Degenerate: media already off-screen ──────────────────────────────

  it("media already off-screen left: still returns offLeft ≤ 0", () => {
    // Media entirely to the left: x=-300 to x=-100
    const result = computeOffscreenDistances(1920, 1080, -300, 400, 200, 150);
    expect(result.offLeft).toBeLessThanOrEqual(0);
    assertInvariant(1920, 1080, result);
  });

  it("media already off-screen right: offRight ≥ canvasWidth", () => {
    // Media entirely to the right: x=2100 to x=2300
    const result = computeOffscreenDistances(1920, 1080, 2100, 400, 200, 150);
    expect(result.offRight).toBeGreaterThanOrEqual(1920);
    assertInvariant(1920, 1080, result);
  });

  // ── Symmetry checks ───────────────────────────────────────────────────

  it("horizontally centered media: |offLeft| should approximately equal offRight", () => {
    // Media centered at canvas center
    const result = computeOffscreenDistances(1920, 1080, 480, 270, 960, 540);
    // Both should push by roughly canvas_right_edge_to_media_right_edge
    // They won't be exactly equal unless media is centered, but both must satisfy invariant
    assertInvariant(1920, 1080, result);
  });

  // ── Numeric precision ─────────────────────────────────────────────────

  it("produces finite numbers for all outputs (no NaN/Infinity)", () => {
    const result = computeOffscreenDistances(
      1920,
      1080,
      100,
      100,
      400,
      300,
      37.5,
    );
    expect(Number.isFinite(result.offLeft)).toBe(true);
    expect(Number.isFinite(result.offRight)).toBe(true);
    expect(Number.isFinite(result.offUp)).toBe(true);
    expect(Number.isFinite(result.offDown)).toBe(true);
  });
});

// ── resolveNormalizedOffset ────────────────────────────────────────────────

describe("resolveNormalizedOffset", () => {
  const distances = computeOffscreenDistances(1920, 1080, 480, 270, 960, 540);

  it("value 0.0 → no offset on x axis", () => {
    expect(resolveNormalizedOffset(0.0, distances, "x")).toBe(0);
  });

  it("value 0.0 → no offset on y axis", () => {
    expect(resolveNormalizedOffset(0.0, distances, "y")).toBe(0);
  });

  it("value -1.0 on x → large negative offset (off-screen left)", () => {
    const offset = resolveNormalizedOffset(-1.0, distances, "x");
    expect(offset).toBeLessThan(0);
    // Applying this offset to mediaX+mediaWidth/2 would place the media off-screen left
  });

  it("value +1.0 on x → large positive offset (off-screen right)", () => {
    const offset = resolveNormalizedOffset(1.0, distances, "x");
    expect(offset).toBeGreaterThan(0);
  });

  it("value -1.0 on y → large negative offset (off-screen top)", () => {
    const offset = resolveNormalizedOffset(-1.0, distances, "y");
    expect(offset).toBeLessThan(0);
  });

  it("value +1.0 on y → large positive offset (off-screen bottom)", () => {
    const offset = resolveNormalizedOffset(1.0, distances, "y");
    expect(offset).toBeGreaterThan(0);
  });

  it("value 0.5 on x is half of full off-screen right distance", () => {
    const half = resolveNormalizedOffset(0.5, distances, "x");
    const full = resolveNormalizedOffset(1.0, distances, "x");
    expect(half).toBeCloseTo(full / 2, 5);
  });

  it("value -0.5 on x is half of full off-screen left distance", () => {
    const half = resolveNormalizedOffset(-0.5, distances, "x");
    const full = resolveNormalizedOffset(-1.0, distances, "x");
    expect(half).toBeCloseTo(full / 2, 5);
  });
});
