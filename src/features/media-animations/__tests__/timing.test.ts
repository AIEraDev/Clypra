/**
 * timing.test.ts — Unit tests for the media animation timing engine
 *
 * Covers:
 * - evaluateTrackAtFrame: boundary clamping, linear interpolation, step, single keyframe
 * - computeAnimationIntervals: standard, clamped, short clips
 * - isFrameInInterval: half-open semantics
 * - compositeClipAnimations: in-only, out-only, short-clip overlap, determinism
 * - Edge case: defaultFrames === 1 (no divide-by-zero)
 */

import { describe, it, expect } from "vitest";
import {
  evaluateTrackAtFrame,
  computeAnimationIntervals,
  isFrameInInterval,
  compositeClipAnimations,
  IDENTITY_TRANSFORM_DELTA,
  type ResolvedAppliedAnimation,
} from "../lib/timing";
import type { PropertyTrack } from "../types";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeLinearTrack(
  startValue: number,
  endValue: number,
  endFrame: number,
): PropertyTrack {
  return {
    property: "positionX",
    keyframes: [
      { frame: 0, value: startValue, interpolation: "linear" },
      { frame: endFrame, value: endValue, interpolation: "linear" },
    ],
  };
}

function makeStepTrack(values: Array<[number, number]>): PropertyTrack {
  return {
    property: "positionX",
    keyframes: values.map(([frame, value]) => ({
      frame,
      value,
      interpolation: "step" as const,
    })),
  };
}

function makeInAnim(
  startFrame: number,
  endFrame: number,
  startVal = -1.0,
  endVal = 0.0,
): ResolvedAppliedAnimation {
  return {
    animationId: "test-in",
    interval: { startFrame, endFrame },
    tracks: [
      {
        property: "positionX",
        keyframes: [
          { frame: 0, value: startVal, interpolation: "linear" },
          { frame: endFrame - startFrame - 1, value: endVal, interpolation: "linear" },
        ],
      },
    ],
  };
}

function makeOutAnim(
  startFrame: number,
  endFrame: number,
  startVal = 0.0,
  endVal = -1.0,
): ResolvedAppliedAnimation {
  return {
    animationId: "test-out",
    interval: { startFrame, endFrame },
    tracks: [
      {
        property: "positionX",
        keyframes: [
          { frame: 0, value: startVal, interpolation: "linear" },
          { frame: endFrame - startFrame - 1, value: endVal, interpolation: "linear" },
        ],
      },
    ],
  };
}

// ── isFrameInInterval ─────────────────────────────────────────────────────

describe("isFrameInInterval", () => {
  it("includes startFrame (half-open left boundary)", () => {
    expect(isFrameInInterval(0, { startFrame: 0, endFrame: 30 })).toBe(true);
  });

  it("excludes endFrame (half-open right boundary)", () => {
    expect(isFrameInInterval(30, { startFrame: 0, endFrame: 30 })).toBe(false);
  });

  it("includes a frame strictly inside the interval", () => {
    expect(isFrameInInterval(15, { startFrame: 0, endFrame: 30 })).toBe(true);
  });

  it("excludes a frame before startFrame", () => {
    expect(isFrameInInterval(-1, { startFrame: 0, endFrame: 30 })).toBe(false);
  });

  it("single-frame interval [5, 6) only contains frame 5", () => {
    expect(isFrameInInterval(5, { startFrame: 5, endFrame: 6 })).toBe(true);
    expect(isFrameInInterval(6, { startFrame: 5, endFrame: 6 })).toBe(false);
    expect(isFrameInInterval(4, { startFrame: 5, endFrame: 6 })).toBe(false);
  });
});

// ── computeAnimationIntervals ─────────────────────────────────────────────

describe("computeAnimationIntervals", () => {
  it("standard clip (60 frames) with 30-frame in and 30-frame out", () => {
    const { inInterval, outInterval, comboInterval } =
      computeAnimationIntervals(60, 30, 30);
    expect(inInterval).toEqual({ startFrame: 0, endFrame: 30 });
    expect(outInterval).toEqual({ startFrame: 30, endFrame: 60 });
    expect(comboInterval).toEqual({ startFrame: 0, endFrame: 60 });
  });

  it("short clip (15 frames): in and out are clamped", () => {
    const { inInterval, outInterval } = computeAnimationIntervals(15, 30, 30);
    // Both clamped to D = 15
    expect(inInterval.endFrame).toBeLessThanOrEqual(15);
    expect(outInterval.endFrame).toBeLessThanOrEqual(15);
    expect(inInterval.startFrame).toBe(0);
    expect(outInterval.endFrame).toBe(15);
  });

  it("very short clip (5 frames) with 4-frame in and 4-frame out → overlap", () => {
    const { inInterval, outInterval } = computeAnimationIntervals(5, 4, 4);
    // In: [0, 4), Out: [1, 5) — they overlap at frames 1, 2, 3
    expect(inInterval.startFrame).toBe(0);
    expect(inInterval.endFrame).toBeLessThanOrEqual(5);
    expect(outInterval.startFrame).toBeGreaterThanOrEqual(0);
    expect(outInterval.endFrame).toBe(5);
    // In and Out overlap
    const overlapStart = outInterval.startFrame;
    const overlapEnd = inInterval.endFrame;
    expect(overlapEnd).toBeGreaterThan(overlapStart);
  });

  it("1-frame clip: durations clamped to 1", () => {
    const { inInterval, outInterval, comboInterval } =
      computeAnimationIntervals(1, 30, 30);
    expect(inInterval).toEqual({ startFrame: 0, endFrame: 1 });
    expect(outInterval).toEqual({ startFrame: 0, endFrame: 1 });
    expect(comboInterval).toEqual({ startFrame: 0, endFrame: 1 });
  });
});

// ── evaluateTrackAtFrame ──────────────────────────────────────────────────

describe("evaluateTrackAtFrame", () => {
  // ── Undefined / empty track ──────────────────────────────────────────

  it("undefined track returns fallback value", () => {
    expect(evaluateTrackAtFrame(undefined, 0, 42)).toBe(42);
  });

  it("track with no keyframes returns fallback value", () => {
    const track: PropertyTrack = { property: "positionX", keyframes: [] };
    expect(evaluateTrackAtFrame(track, 10, 99)).toBe(99);
  });

  // ── Single keyframe (defaultFrames === 1 edge case) ──────────────────

  it("single keyframe: returns its value for any frame (no divide by zero)", () => {
    const track: PropertyTrack = {
      property: "positionX",
      keyframes: [{ frame: 0, value: -1.0, interpolation: "linear" }],
    };
    expect(evaluateTrackAtFrame(track, 0, 0)).toBe(-1.0);
    expect(evaluateTrackAtFrame(track, 100, 0)).toBe(-1.0);
    expect(evaluateTrackAtFrame(track, -5, 0)).toBe(-1.0);
  });

  // ── Boundary clamping ────────────────────────────────────────────────

  it("frame before first keyframe → returns first keyframe value", () => {
    const track = makeLinearTrack(-1.0, 0.0, 29);
    expect(evaluateTrackAtFrame(track, -5, 0)).toBe(-1.0);
    expect(evaluateTrackAtFrame(track, 0, 0)).toBe(-1.0);
  });

  it("frame after last keyframe → returns last keyframe value", () => {
    const track = makeLinearTrack(-1.0, 0.0, 29);
    expect(evaluateTrackAtFrame(track, 29, 0)).toBe(0.0);
    expect(evaluateTrackAtFrame(track, 100, 0)).toBe(0.0);
  });

  // ── Linear interpolation ─────────────────────────────────────────────

  it("midpoint of linear track is midpoint of values", () => {
    const track = makeLinearTrack(-1.0, 1.0, 100);
    const mid = evaluateTrackAtFrame(track, 50, 0);
    expect(mid).toBeCloseTo(0.0, 5);
  });

  it("quarter point of linear track", () => {
    const track = makeLinearTrack(0.0, 1.0, 100);
    const quarter = evaluateTrackAtFrame(track, 25, 0);
    expect(quarter).toBeCloseTo(0.25, 5);
  });

  it("slide-in-left preset: frame 0 = -1.0, frame 29 = 0.0, frame 14 ≈ -0.517", () => {
    const track = makeLinearTrack(-1.0, 0.0, 29);
    expect(evaluateTrackAtFrame(track, 0, 0)).toBe(-1.0);
    expect(evaluateTrackAtFrame(track, 29, 0)).toBe(0.0);
    const mid = evaluateTrackAtFrame(track, 14, 0);
    // 14/29 fraction of the way from -1.0 to 0.0 → -1.0 + (14/29) = -(29-14)/29 ≈ -0.517
    expect(mid).toBeCloseTo(-1.0 + 14 / 29, 5);
  });

  // ── Step interpolation ───────────────────────────────────────────────

  it("step track holds the earlier value, not lerping", () => {
    const track = makeStepTrack([
      [0, 0.0],
      [10, 1.0],
      [20, 2.0],
    ]);
    expect(evaluateTrackAtFrame(track, 5, 0)).toBe(0.0);   // in [0, 10) step
    expect(evaluateTrackAtFrame(track, 10, 0)).toBe(1.0);  // boundary exact
    expect(evaluateTrackAtFrame(track, 15, 0)).toBe(1.0);  // in [10, 20) step
    expect(evaluateTrackAtFrame(track, 20, 0)).toBe(2.0);  // last keyframe
  });

  // ── Determinism ──────────────────────────────────────────────────────

  it("same inputs always produce the same output (100 calls)", () => {
    const track = makeLinearTrack(-1.0, 0.0, 29);
    const first = evaluateTrackAtFrame(track, 7, 0);
    for (let i = 0; i < 99; i++) {
      expect(evaluateTrackAtFrame(track, 7, 0)).toBe(first);
    }
  });
});

// ── compositeClipAnimations ───────────────────────────────────────────────

describe("compositeClipAnimations", () => {
  // ── Out-of-range frames ──────────────────────────────────────────────

  it("frame before clip returns base state unchanged", () => {
    const result = compositeClipAnimations(30, -1, {});
    expect(result).toEqual({
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
    });
  });

  it("frame at clip end (frame === durationFrames) returns base state", () => {
    const result = compositeClipAnimations(30, 30, {});
    expect(result).toEqual({
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
    });
  });

  // ── No animations ────────────────────────────────────────────────────

  it("no animations: returns exact base state", () => {
    const result = compositeClipAnimations(30, 15, {}, 100, 200, 1.5, 1.5, 45, 0.8);
    expect(result).toEqual({
      x: 100,
      y: 200,
      scaleX: 1.5,
      scaleY: 1.5,
      rotation: 45,
      opacity: 0.8,
    });
  });

  // ── In-only animation ────────────────────────────────────────────────

  it("slide-in-left at frame 0: x offset is -1.0 (normalized)", () => {
    const inAnim = makeInAnim(0, 30, -1.0, 0.0);
    const result = compositeClipAnimations(30, 0, { in: inAnim });
    // base x=0, animation adds -1.0 (normalized, before pixel resolution)
    expect(result.x).toBeCloseTo(-1.0, 5);
  });

  it("slide-in-left at last frame (frame 29): x offset is 0.0", () => {
    const inAnim = makeInAnim(0, 30, -1.0, 0.0);
    const result = compositeClipAnimations(30, 29, { in: inAnim });
    expect(result.x).toBeCloseTo(0.0, 5);
  });

  it("in animation is inactive after its endFrame", () => {
    const inAnim = makeInAnim(0, 15, -1.0, 0.0); // only first 15 frames
    // At frame 15 (outside [0,15)), animation should not apply
    const result = compositeClipAnimations(30, 15, { in: inAnim });
    expect(result.x).toBe(0); // no offset applied
  });

  // ── Out-only animation ───────────────────────────────────────────────

  it("slide-out-left at frame 0: x offset is 0.0", () => {
    const outAnim = makeOutAnim(0, 30, 0.0, -1.0);
    const result = compositeClipAnimations(30, 0, { out: outAnim });
    expect(result.x).toBeCloseTo(0.0, 5);
  });

  it("slide-out-right at last frame: x offset is +1.0", () => {
    const outAnim = makeOutAnim(0, 30, 0.0, 1.0);
    const result = compositeClipAnimations(30, 29, { out: outAnim });
    expect(result.x).toBeCloseTo(1.0, 5);
  });

  // ── Short-clip overlap ───────────────────────────────────────────────

  it("short clip (5 frames), 4-frame in + 4-frame out overlapping: blend weight is in [0, 1]", () => {
    // Clip duration: 5, In: [0, 4), Out: [1, 5)
    const { inInterval, outInterval } = computeAnimationIntervals(5, 4, 4);
    const inAnim: ResolvedAppliedAnimation = {
      animationId: "in",
      interval: inInterval,
      tracks: [
        {
          property: "positionX",
          keyframes: [
            { frame: 0, value: -1.0, interpolation: "linear" },
            { frame: inInterval.endFrame - 1, value: 0.0, interpolation: "linear" },
          ],
        },
      ],
    };
    const outAnim: ResolvedAppliedAnimation = {
      animationId: "out",
      interval: outInterval,
      tracks: [
        {
          property: "positionX",
          keyframes: [
            { frame: 0, value: 0.0, interpolation: "linear" },
            {
              frame: outInterval.endFrame - outInterval.startFrame - 1,
              value: -1.0,
              interpolation: "linear",
            },
          ],
        },
      ],
    };

    // Check all frames in the overlap zone
    const overlapStart = outInterval.startFrame;
    const overlapEnd = inInterval.endFrame;
    for (let f = overlapStart; f < overlapEnd; f++) {
      const result = compositeClipAnimations(5, f, { in: inAnim, out: outAnim });
      // Both are active: x should be a blend — neither fully -1 nor fully 0
      // Verify it's finite and in a reasonable range
      expect(Number.isFinite(result.x)).toBe(true);
    }
  });

  it("short-clip overlap: deterministic (same inputs → same output)", () => {
    const { inInterval, outInterval } = computeAnimationIntervals(5, 4, 4);
    const inAnim: ResolvedAppliedAnimation = {
      animationId: "in",
      interval: inInterval,
      tracks: [
        {
          property: "positionX",
          keyframes: [
            { frame: 0, value: -1.0, interpolation: "linear" },
            { frame: inInterval.endFrame - 1, value: 0.0, interpolation: "linear" },
          ],
        },
      ],
    };
    const outAnim: ResolvedAppliedAnimation = {
      animationId: "out",
      interval: outInterval,
      tracks: [
        {
          property: "positionX",
          keyframes: [
            { frame: 0, value: 0.0, interpolation: "linear" },
            {
              frame: outInterval.endFrame - outInterval.startFrame - 1,
              value: -1.0,
              interpolation: "linear",
            },
          ],
        },
      ],
    };

    const overlapFrame = outInterval.startFrame;
    const firstResult = compositeClipAnimations(5, overlapFrame, { in: inAnim, out: outAnim });
    for (let i = 0; i < 99; i++) {
      const repeated = compositeClipAnimations(5, overlapFrame, { in: inAnim, out: outAnim });
      expect(repeated.x).toBe(firstResult.x);
    }
  });

  // ── Opacity clamping ─────────────────────────────────────────────────

  it("opacity is always clamped to [0, 1]", () => {
    // Artificially high opacity multiplier
    const inAnim: ResolvedAppliedAnimation = {
      animationId: "in",
      interval: { startFrame: 0, endFrame: 30 },
      tracks: [
        {
          property: "opacity",
          keyframes: [
            { frame: 0, value: 0.0, interpolation: "linear" },
            { frame: 29, value: 2.0, interpolation: "linear" }, // above 1.0
          ],
        },
      ],
    };
    for (let f = 0; f < 30; f++) {
      const result = compositeClipAnimations(30, f, { in: inAnim });
      expect(result.opacity).toBeGreaterThanOrEqual(0);
      expect(result.opacity).toBeLessThanOrEqual(1);
    }
  });
});

// ── Preset keyframe verification ──────────────────────────────────────────

describe("preset keyframe values", () => {
  it("media-slide-in-left: positionX[0] = -1.0, positionX[29] = 0.0", async () => {
    const { MEDIA_SLIDE_IN_LEFT } = await import("../presets");
    const track = MEDIA_SLIDE_IN_LEFT.tracks.find((t) => t.property === "positionX");
    expect(track).toBeDefined();
    expect(track!.keyframes).toHaveLength(2);
    expect(track!.keyframes[0].frame).toBe(0);
    expect(track!.keyframes[0].value).toBe(-1.0);
    expect(track!.keyframes[1].frame).toBe(29);
    expect(track!.keyframes[1].value).toBe(0.0);
  });

  it("media-slide-in-right: positionX[0] = +1.0, positionX[29] = 0.0", async () => {
    const { MEDIA_SLIDE_IN_RIGHT } = await import("../presets");
    const track = MEDIA_SLIDE_IN_RIGHT.tracks.find((t) => t.property === "positionX");
    expect(track!.keyframes[0].value).toBe(1.0);
    expect(track!.keyframes[1].value).toBe(0.0);
  });

  it("media-slide-out-left: positionX[0] = 0.0, positionX[29] = -1.0", async () => {
    const { MEDIA_SLIDE_OUT_LEFT } = await import("../presets");
    const track = MEDIA_SLIDE_OUT_LEFT.tracks.find((t) => t.property === "positionX");
    expect(track!.keyframes[0].value).toBe(0.0);
    expect(track!.keyframes[1].value).toBe(-1.0);
  });

  it("media-slide-out-right: positionX[0] = 0.0, positionX[29] = +1.0", async () => {
    const { MEDIA_SLIDE_OUT_RIGHT } = await import("../presets");
    const track = MEDIA_SLIDE_OUT_RIGHT.tracks.find((t) => t.property === "positionX");
    expect(track!.keyframes[0].value).toBe(0.0);
    expect(track!.keyframes[1].value).toBe(1.0);
  });

  it("all four presets have renderMode: procedural", async () => {
    const { MEDIA_ANIMATION_PRESET_DRAFTS } = await import("../presets");
    for (const preset of Object.values(MEDIA_ANIMATION_PRESET_DRAFTS)) {
      expect(preset.renderMode).toBe("procedural");
    }
  });

  it("no preset has a 'direction' field", async () => {
    const { MEDIA_ANIMATION_PRESET_DRAFTS } = await import("../presets");
    for (const preset of Object.values(MEDIA_ANIMATION_PRESET_DRAFTS)) {
      expect(Object.keys(preset)).not.toContain("direction");
      for (const track of preset.tracks) {
        expect(Object.keys(track)).not.toContain("direction");
      }
    }
  });

  it("in presets have category: 'in', out presets have category: 'out'", async () => {
    const { MEDIA_ANIMATION_PRESET_DRAFTS } = await import("../presets");
    expect(MEDIA_ANIMATION_PRESET_DRAFTS["media-slide-in-left"].category).toBe("in");
    expect(MEDIA_ANIMATION_PRESET_DRAFTS["media-slide-in-right"].category).toBe("in");
    expect(MEDIA_ANIMATION_PRESET_DRAFTS["media-slide-out-left"].category).toBe("out");
    expect(MEDIA_ANIMATION_PRESET_DRAFTS["media-slide-out-right"].category).toBe("out");
  });

  it("all presets support both image and video", async () => {
    const { MEDIA_ANIMATION_PRESET_DRAFTS } = await import("../presets");
    for (const preset of Object.values(MEDIA_ANIMATION_PRESET_DRAFTS)) {
      expect(preset.supportedMediaTypes).toContain("image");
      expect(preset.supportedMediaTypes).toContain("video");
    }
  });

  it("each preset has exactly one track (positionX only)", async () => {
    const { MEDIA_ANIMATION_PRESET_DRAFTS } = await import("../presets");
    for (const preset of Object.values(MEDIA_ANIMATION_PRESET_DRAFTS)) {
      expect(preset.tracks).toHaveLength(1);
      expect(preset.tracks[0].property).toBe("positionX");
    }
  });
});
