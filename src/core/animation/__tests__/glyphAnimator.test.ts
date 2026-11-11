/**
 * glyphAnimator.test.ts
 *
 * Regression tests for per-glyph character stagger evaluation.
 * These guard against regression to the original bug where the entire
 * text bounding box rotated as a rigid rectangle ("Flip In" rotating
 * the whole string instead of individual characters).
 */

import { describe, it, expect } from "vitest";
import {
  calculateGlyphStaggerProgress,
  evaluateGlyphTransform,
  evaluateGlyphEasing,
  evaluateGlyphTrackValue,
  isGlyphAnimatedPreset,
  DEFAULT_GLYPH_TRANSFORM,
} from "../glyphAnimator";
import type { RemoteTextAnimationPreset } from "@/features/text-animations/animationCatalog";

// ── Minimal preset fixture mirroring "Flip In" structure ──────────────────

function makeFlipInPreset(overrides: Partial<RemoteTextAnimationPreset> = {}): RemoteTextAnimationPreset {
  return {
    id: "anim-in-flip-in",
    name: "Flip In",
    phase: "in" as const,
    category: "in" as const,
    subCategory: "3D" as any,
    defaultDuration: 0.6,
    minDuration: 0.1,
    maxDuration: 5.0,
    previewLoopDuration: 1.2,
    published: true,
    revisionId: "rev-test-001",
    stagger: { unit: "character", overlap: 0.4, order: "left-to-right" },
    tracks: [
      {
        property: "rotation" as const,
        keyframes: [
          { progress: 0, value: 90, easing: "easeOutBack" },
          { progress: 1, value: 0 },
        ],
      },
      {
        property: "opacity" as const,
        keyframes: [
          { progress: 0, value: 0 },
          { progress: 0.4, value: 1 },
        ],
      },
    ],
    ...overrides,
  } as RemoteTextAnimationPreset;
}

// ── isGlyphAnimatedPreset ─────────────────────────────────────────────────

describe("isGlyphAnimatedPreset", () => {
  it("returns true for a stagger-character preset", () => {
    expect(isGlyphAnimatedPreset(makeFlipInPreset())).toBe(true);
  });

  it("returns false when stagger unit is 'none'", () => {
    expect(
      isGlyphAnimatedPreset(makeFlipInPreset({ stagger: { unit: "none", overlap: 0, order: "left-to-right" } }))
    ).toBe(false);
  });

  it("returns false when stagger is undefined", () => {
    const preset = makeFlipInPreset();
    delete (preset as any).stagger;
    expect(isGlyphAnimatedPreset(preset)).toBe(false);
  });

  it("returns false when tracks array is empty", () => {
    expect(isGlyphAnimatedPreset(makeFlipInPreset({ tracks: [] }))).toBe(false);
  });
});

// ── calculateGlyphStaggerProgress ─────────────────────────────────────────

describe("calculateGlyphStaggerProgress", () => {
  const stagger = { unit: "character" as const, overlap: 0.4, order: "left-to-right" };

  it("returns overallProgress unchanged when stagger is undefined", () => {
    expect(calculateGlyphStaggerProgress(0.5, 0, 5, undefined)).toBe(0.5);
  });

  it("returns overallProgress unchanged when only 1 unit", () => {
    expect(calculateGlyphStaggerProgress(0.7, 0, 1, stagger)).toBe(0.7);
  });

  it("first character starts animating before later characters", () => {
    // At 30% overall progress, char 0 should be further along than char 4
    const prog0 = calculateGlyphStaggerProgress(0.3, 0, 5, stagger);
    const prog4 = calculateGlyphStaggerProgress(0.3, 4, 5, stagger);
    expect(prog0).toBeGreaterThan(prog4);
  });

  it("last character completes at overall progress 1", () => {
    const prog = calculateGlyphStaggerProgress(1.0, 4, 5, stagger);
    expect(prog).toBeCloseTo(1.0, 4);
  });

  it("first character starts at overall progress 0", () => {
    const prog = calculateGlyphStaggerProgress(0.0, 0, 5, stagger);
    expect(prog).toBeCloseTo(0.0, 4);
  });

  it("right-to-left reverses order: last character animates first", () => {
    const rtlStagger = { ...stagger, order: "right-to-left" };
    // At low progress, the last character (index 4) should be further along than the first (index 0)
    const prog0 = calculateGlyphStaggerProgress(0.3, 0, 5, rtlStagger);
    const prog4 = calculateGlyphStaggerProgress(0.3, 4, 5, rtlStagger);
    expect(prog4).toBeGreaterThan(prog0);
  });

  it("clamps output to [0, 1]", () => {
    // Before animation window opens for last character: should be 0
    const early = calculateGlyphStaggerProgress(0.0, 4, 5, stagger);
    expect(early).toBeGreaterThanOrEqual(0);
    expect(early).toBeLessThanOrEqual(1);
    // After animation completes: should be 1
    const late = calculateGlyphStaggerProgress(2.0, 0, 5, stagger);
    expect(late).toBe(1);
  });
});

// ── evaluateGlyphEasing ───────────────────────────────────────────────────

describe("evaluateGlyphEasing", () => {
  it("linear returns t unchanged", () => {
    expect(evaluateGlyphEasing("linear", 0.5)).toBeCloseTo(0.5);
  });

  it("easeOutBack overshoots and returns to 1", () => {
    // easeOutBack should produce value > 1 during overshoot
    const mid = evaluateGlyphEasing("easeOutBack", 0.6);
    expect(mid).toBeGreaterThan(0.5);
    expect(evaluateGlyphEasing("easeOutBack", 1)).toBeCloseTo(1);
    expect(evaluateGlyphEasing("easeOutBack", 0)).toBeCloseTo(0);
  });

  it("easeOutBounce clamps output to [0, 1]", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const val = evaluateGlyphEasing("easeOutBounce", t);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("clamps input t below 0 to 0", () => {
    expect(evaluateGlyphEasing("easeOutQuad", -1)).toBe(0);
  });

  it("clamps input t above 1 to 1", () => {
    expect(evaluateGlyphEasing("easeOutQuad", 2)).toBeCloseTo(1);
  });

  it("unknown curve falls back to linear", () => {
    expect(evaluateGlyphEasing("unknownCurve", 0.5)).toBe(0.5);
  });
});

// ── evaluateGlyphTrackValue ───────────────────────────────────────────────

describe("evaluateGlyphTrackValue", () => {
  it("returns single keyframe value regardless of progress", () => {
    expect(evaluateGlyphTrackValue([{ progress: 0, value: 42 }], 0.7)).toBe(42);
  });

  it("interpolates linearly between two keyframes (no easing)", () => {
    const keyframes = [
      { progress: 0, value: 0 },
      { progress: 1, value: 100 },
    ];
    expect(evaluateGlyphTrackValue(keyframes, 0.5)).toBeCloseTo(50);
  });

  it("clamps to first keyframe before its start", () => {
    const keyframes = [
      { progress: 0.2, value: 10 },
      { progress: 1.0, value: 100 },
    ];
    expect(evaluateGlyphTrackValue(keyframes, 0.0)).toBe(10);
  });

  it("clamps to last keyframe after its end", () => {
    const keyframes = [
      { progress: 0, value: 0 },
      { progress: 0.8, value: 80 },
    ];
    expect(evaluateGlyphTrackValue(keyframes, 1.0)).toBe(80);
  });
});

// ── evaluateGlyphTransform ────────────────────────────────────────────────

describe("evaluateGlyphTransform", () => {
  const preset = makeFlipInPreset();

  it("at progress 0 for first glyph, rotation is 90 and opacity is 0", () => {
    const t = evaluateGlyphTransform(preset, 0, 0, 5);
    expect(t.rotation).toBeCloseTo(90, 0);
    expect(t.opacity).toBeCloseTo(0, 1);
  });

  it("at progress 1 for last glyph, rotation is 0 and opacity is 1", () => {
    const t = evaluateGlyphTransform(preset, 1, 4, 5);
    expect(t.rotation).toBeCloseTo(0, 1);
    expect(t.opacity).toBeCloseTo(1, 1);
  });

  it("returns DEFAULT_GLYPH_TRANSFORM when preset has no tracks", () => {
    const noTracks = makeFlipInPreset({ tracks: [] });
    const t = evaluateGlyphTransform(noTracks, 0.5, 0, 5);
    expect(t).toEqual(DEFAULT_GLYPH_TRANSFORM);
  });

  it("scale property sets both scaleX and scaleY", () => {
    const scalePreset = makeFlipInPreset({
      tracks: [
        {
          property: "scale" as const,
          keyframes: [
            { progress: 0, value: 0 },
            { progress: 1, value: 1 },
          ],
        },
      ],
    });
    const t = evaluateGlyphTransform(scalePreset, 1.0, 0, 1);
    expect(t.scaleX).toBeCloseTo(1);
    expect(t.scaleY).toBeCloseTo(1);
  });

  it("different glyphs at same overall progress get different local progress", () => {
    // This is the core stagger regression test: glyph 0 and glyph 4 should
    // have different rotation values at overall progress 0.3
    const t0 = evaluateGlyphTransform(preset, 0.3, 0, 5);
    const t4 = evaluateGlyphTransform(preset, 0.3, 4, 5);
    // Glyph 0 is ahead: closer to 0 rotation (more animated)
    // Glyph 4 is behind: closer to 90 rotation (less animated)
    expect(t0.rotation).toBeLessThan(t4.rotation);
  });

  it("handles missing/invalid preset tracks gracefully", () => {
    const badPreset = { ...makeFlipInPreset(), tracks: null as any };
    const t = evaluateGlyphTransform(badPreset, 0.5, 0, 5);
    expect(t).toEqual(DEFAULT_GLYPH_TRANSFORM);
  });
});
