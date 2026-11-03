/**
 * timing.ts — Frame Timing and Property Composition Engine (Studio side)
 *
 * Mirrors the semantics of clypra-api/src/features/media-animations/mediaAnimationTiming.ts.
 * These are pure math functions — no imports from the API package.
 *
 * All frame arithmetic uses integers. No floating-point frame numbers.
 * Half-open frame intervals: [startFrame, endFrame).
 * Short-clip overlap is resolved deterministically via normalized linear blend.
 */

import type {
  HalfOpenFrameInterval,
  PropertyTrack,
  AnimatableProperty,
} from "../types";

// ── Interval Utilities ─────────────────────────────────────────────────────

/**
 * Returns true when frame falls within the half-open interval [startFrame, endFrame).
 */
export function isFrameInInterval(
  frame: number,
  interval: HalfOpenFrameInterval,
): boolean {
  return frame >= interval.startFrame && frame < interval.endFrame;
}

/**
 * Returns the discrete frame count of a half-open interval.
 * Always ≥ 0.
 */
export function getIntervalDuration(interval: HalfOpenFrameInterval): number {
  return Math.max(0, interval.endFrame - interval.startFrame);
}

/**
 * Computes standard half-open intervals for In, Out, and Combo animations
 * given the clip's timeline duration in frames.
 *
 * In  animation: [0, Tin)
 * Out animation: [D - Tout, D)
 * Combo:         [0, D)
 *
 * Both Tin and Tout are clamped to [1, D] so the interval is always valid.
 */
export function computeAnimationIntervals(
  clipDurationFrames: number,
  inDurationFrames = 30,
  outDurationFrames = 30,
): {
  inInterval: HalfOpenFrameInterval;
  outInterval: HalfOpenFrameInterval;
  comboInterval: HalfOpenFrameInterval;
} {
  const D = Math.max(1, clipDurationFrames);
  const Tin = Math.min(D, Math.max(1, inDurationFrames));
  const Tout = Math.min(D, Math.max(1, outDurationFrames));

  return {
    inInterval: { startFrame: 0, endFrame: Tin },
    outInterval: { startFrame: Math.max(0, D - Tout), endFrame: D },
    comboInterval: { startFrame: 0, endFrame: D },
  };
}

// ── Track Evaluation ───────────────────────────────────────────────────────

/**
 * Evaluates a single property track at a layer-local frame index.
 *
 * Boundary behaviour:
 *   - frame < first keyframe → returns first keyframe value (no extrapolation)
 *   - frame > last keyframe  → returns last keyframe value (no extrapolation)
 *   - single keyframe [frame 0]: returns kf[0].value for any input frame
 *     (handles the defaultFrames === 1 edge case — no division by zero)
 *
 * Interpolation:
 *   - "step": returns the earlier keyframe value with no blending
 *   - "linear": lerps between adjacent keyframes
 *   - "bezier": falls back to linear (cubic bezier easing is applied by the
 *               renderer, not in the keyframe evaluator)
 *
 * @param track        - The property track to evaluate (may be undefined)
 * @param localFrame   - Layer-local integer frame index
 * @param fallbackValue - Value returned when track is undefined or has no keyframes
 */
export function evaluateTrackAtFrame(
  track: PropertyTrack | undefined,
  localFrame: number,
  fallbackValue: number,
): number {
  if (!track || !track.keyframes || track.keyframes.length === 0) {
    return fallbackValue;
  }

  const kfs = track.keyframes;

  // Single keyframe — no interpolation possible, no division by zero
  if (kfs.length === 1) {
    return kfs[0].value;
  }

  // Boundary clamping
  if (localFrame <= kfs[0].frame) return kfs[0].value;
  if (localFrame >= kfs[kfs.length - 1].frame) return kfs[kfs.length - 1].value;

  // Segment search
  for (let i = 0; i < kfs.length - 1; i++) {
    const kfA = kfs[i];
    const kfB = kfs[i + 1];

    if (localFrame >= kfA.frame && localFrame <= kfB.frame) {
      // Exact match on kfB: return its value directly (avoids step holding kfA)
      if (localFrame === kfB.frame) {
        return kfB.value;
      }

      // Step interpolation: hold the earlier value
      if (kfA.interpolation === "step") {
        return kfA.value;
      }

      // Linear interpolation (also used as fallback for "bezier")
      const span = kfB.frame - kfA.frame;
      // Guard: if keyframes are at the same frame (shouldn't happen, but
      // defensive against malformed tracks), return the earlier value
      if (span <= 0) return kfA.value;

      const t = (localFrame - kfA.frame) / span;
      return kfA.value + t * (kfB.value - kfA.value);
    }
  }

  return fallbackValue;
}

// ── Evaluated Transform State ──────────────────────────────────────────────

export interface EvaluatedTransformDelta {
  /** Additive position offset in canvas pixels (after resolving normalized values) */
  x: number;
  y: number;
  /** Multiplicative scale factor */
  scaleX: number;
  scaleY: number;
  /** Additive rotation in degrees */
  rotation: number;
  /** Multiplicative opacity factor [0, 1] */
  opacity: number;
}

export const IDENTITY_TRANSFORM_DELTA: EvaluatedTransformDelta = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
};

// ── Applied Animation Evaluation ───────────────────────────────────────────

export interface ResolvedAppliedAnimation {
  animationId: string;
  interval: HalfOpenFrameInterval;
  tracks: PropertyTrack[];
}

/**
 * Evaluates a resolved applied animation at a global clip frame.
 *
 * NOTE: positionX/positionY track values are normalized offscreen offsets [-1,1].
 * Callers are responsible for multiplying by resolveNormalizedOffset() before use.
 *
 * Returns null if the frame is outside the animation's half-open interval.
 */
export function evaluateAnimationAtClipFrame(
  anim: ResolvedAppliedAnimation | undefined,
  clipFrame: number,
): EvaluatedTransformDelta | null {
  if (!anim || !isFrameInInterval(clipFrame, anim.interval)) {
    return null;
  }

  const localFrame = clipFrame - anim.interval.startFrame;
  const findTrack = (prop: AnimatableProperty): PropertyTrack | undefined =>
    anim.tracks.find((t) => t.property === prop);

  return {
    x: evaluateTrackAtFrame(findTrack("positionX"), localFrame, 0),
    y: evaluateTrackAtFrame(findTrack("positionY"), localFrame, 0),
    scaleX: evaluateTrackAtFrame(findTrack("scaleX"), localFrame, 1),
    scaleY: evaluateTrackAtFrame(findTrack("scaleY"), localFrame, 1),
    rotation: evaluateTrackAtFrame(findTrack("rotation"), localFrame, 0),
    opacity: evaluateTrackAtFrame(findTrack("opacity"), localFrame, 1),
  };
}

/**
 * Deterministically composites active animations (Combo, In, Out) on a media clip.
 *
 * Composition rules (mirrors DEFAULT_COMPOSITION_RULES):
 *   Position (X, Y): additive offsets
 *   Scale (X, Y):    multiplicative
 *   Rotation:        additive
 *   Opacity:         multiplicative, clamped to [0, 1]
 *
 * Short-clip overlap (In and Out both active at clipFrame):
 *   Computed using a normalized linear blend weight across the overlap zone.
 *   The blend is deterministic: same inputs always produce the same output.
 *
 * @param clipDurationFrames - Total clip duration in integer frames
 * @param clipFrame          - Current clip-local frame to evaluate
 * @param animations         - Optional in/out/combo animations to apply
 * @param baseX              - Base X position (canvas pixels, from EvaluatedMediaLayer)
 * @param baseY              - Base Y position
 * @param baseScaleX         - Base scale X
 * @param baseScaleY         - Base scale Y
 * @param baseRotation       - Base rotation (degrees)
 * @param baseOpacity        - Base opacity [0, 1]
 */
export function compositeClipAnimations(
  clipDurationFrames: number,
  clipFrame: number,
  animations: {
    in?: ResolvedAppliedAnimation;
    out?: ResolvedAppliedAnimation;
    combo?: ResolvedAppliedAnimation;
  },
  baseX = 0,
  baseY = 0,
  baseScaleX = 1,
  baseScaleY = 1,
  baseRotation = 0,
  baseOpacity = 1,
): EvaluatedTransformDelta {
  // Frame outside valid range — return base state unchanged
  if (clipFrame < 0 || clipFrame >= clipDurationFrames) {
    return {
      x: baseX,
      y: baseY,
      scaleX: baseScaleX,
      scaleY: baseScaleY,
      rotation: baseRotation,
      opacity: baseOpacity,
    };
  }

  let posX = baseX;
  let posY = baseY;
  let scaleX = baseScaleX;
  let scaleY = baseScaleY;
  let rotation = baseRotation;
  let opacity = baseOpacity;

  // 1. Combo animation (baseline transform across the entire clip)
  if (animations.combo) {
    const comboState = evaluateAnimationAtClipFrame(
      animations.combo,
      clipFrame,
    );
    if (comboState) {
      posX += comboState.x;
      posY += comboState.y;
      scaleX *= comboState.scaleX;
      scaleY *= comboState.scaleY;
      rotation += comboState.rotation;
      opacity *= comboState.opacity;
    }
  }

  // 2. Determine active In / Out states
  const inActive = animations.in
    ? isFrameInInterval(clipFrame, animations.in.interval)
    : false;
  const outActive = animations.out
    ? isFrameInInterval(clipFrame, animations.out.interval)
    : false;

  if (inActive && !outActive) {
    // Only In is active
    const inState = evaluateAnimationAtClipFrame(animations.in, clipFrame)!;
    posX += inState.x;
    posY += inState.y;
    scaleX *= inState.scaleX;
    scaleY *= inState.scaleY;
    rotation += inState.rotation;
    opacity *= inState.opacity;
  } else if (!inActive && outActive) {
    // Only Out is active
    const outState = evaluateAnimationAtClipFrame(animations.out, clipFrame)!;
    posX += outState.x;
    posY += outState.y;
    scaleX *= outState.scaleX;
    scaleY *= outState.scaleY;
    rotation += outState.rotation;
    opacity *= outState.opacity;
  } else if (inActive && outActive) {
    // Short-clip overlap: both In and Out are active simultaneously.
    // Blend using a normalized weight across the overlap zone.
    //
    // Overlap zone: [outStart, inEnd)
    // weight 0 → full In influence; weight 1 → full Out influence
    const inEnd = animations.in!.interval.endFrame;
    const outStart = animations.out!.interval.startFrame;
    const overlapSpan = Math.max(1, inEnd - outStart);
    const weight = Math.max(
      0,
      Math.min(1, (clipFrame - outStart) / overlapSpan),
    );

    const inState = evaluateAnimationAtClipFrame(animations.in, clipFrame)!;
    const outState = evaluateAnimationAtClipFrame(animations.out, clipFrame)!;

    posX += (1 - weight) * inState.x + weight * outState.x;
    posY += (1 - weight) * inState.y + weight * outState.y;
    scaleX *= (1 - weight) * inState.scaleX + weight * outState.scaleX;
    scaleY *= (1 - weight) * inState.scaleY + weight * outState.scaleY;
    rotation += (1 - weight) * inState.rotation + weight * outState.rotation;
    opacity *= (1 - weight) * inState.opacity + weight * outState.opacity;
  }

  return {
    x: posX,
    y: posY,
    scaleX,
    scaleY,
    rotation,
    opacity: Math.max(0, Math.min(1, opacity)),
  };
}
