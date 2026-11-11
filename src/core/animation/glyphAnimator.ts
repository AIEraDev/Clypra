/**
 * glyphAnimator.ts
 *
 * Per-glyph animation evaluation engine for Clypra Editor.
 *
 * Ports the core math from clypra-studio's `animationEvaluator.ts` so the
 * editor rasterizer can produce character-staggered text animations with full
 * parity to Studio's AnimationPreviewStage:
 *   • Per-glyph stagger (character / word / line)
 *   • Individual rotation/scale/skewX/blur/tracking transforms
 *   • All easing curves (linear, easeOut, easeOutBack, easeOutBounce, etc.)
 *
 * This module is intentionally dependency-free (no React, no Zustand) so it
 * can be safely imported inside the OffscreenCanvas Worker.
 */

import type { RemoteTextAnimationPreset } from "@/features/text-animations/animationCatalog";

// ── Re-export Studio-compatible transform shape ────────────────────────────

export interface EvaluatedGlyphTransform {
  opacity: number;
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
  rotation: number;
  skewX: number;
  blur: number;
  tracking: number;
}

export const DEFAULT_GLYPH_TRANSFORM: EvaluatedGlyphTransform = {
  opacity: 1,
  scaleX: 1,
  scaleY: 1,
  translateX: 0,
  translateY: 0,
  rotation: 0,
  skewX: 0,
  blur: 0,
  tracking: 0,
};

// ── Easing ─────────────────────────────────────────────────────────────────

type EasingName =
  | "linear"
  | "easeIn"
  | "easeInQuad"
  | "easeOut"
  | "easeOutQuad"
  | "easeInOut"
  | "easeInCubic"
  | "easeOutCubic"
  | "easeInBack"
  | "easeOutBack"
  | "easeOutBounce"
  | "easeOutElastic"
  | string;

export function evaluateGlyphEasing(curve: EasingName | undefined, t: number): number {
  const p = Math.max(0, Math.min(1, t));
  if (!curve || curve === "linear") return p;

  switch (curve) {
    case "easeIn":
    case "easeInQuad":
      return p * p;
    case "easeOut":
    case "easeOutQuad":
      return p * (2 - p);
    case "easeInOut":
      return p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
    case "easeInCubic":
      return p * p * p;
    case "easeOutCubic": {
      const f = p - 1;
      return f * f * f + 1;
    }
    case "easeInBack": {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return c3 * p * p * p - c1 * p * p;
    }
    case "easeOutBack": {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      const f = p - 1;
      return 1 + c3 * f * f * f + c1 * f * f;
    }
    case "easeOutBounce": {
      const n1 = 7.5625;
      const d1 = 2.75;
      if (p < 1 / d1) {
        return n1 * p * p;
      } else if (p < 2 / d1) {
        const f = p - 1.5 / d1;
        return n1 * f * f + 0.75;
      } else if (p < 2.5 / d1) {
        const f = p - 2.25 / d1;
        return n1 * f * f + 0.9375;
      } else {
        const f = p - 2.625 / d1;
        return n1 * f * f + 0.984375;
      }
    }
    case "easeOutElastic": {
      if (p === 0) return 0;
      if (p === 1) return 1;
      const c4 = (2 * Math.PI) / 3;
      return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * c4) + 1;
    }
    default:
      return p;
  }
}

// ── Track Value Evaluation ─────────────────────────────────────────────────

interface TrackKeyframe {
  progress: number;
  value: number;
  easing?: EasingName;
}

export function evaluateGlyphTrackValue(
  keyframes: TrackKeyframe[],
  progress: number,
): number {
  if (!keyframes || keyframes.length === 0) return 0;
  if (keyframes.length === 1) return keyframes[0].value;

  const p = Math.max(0, Math.min(1, progress));

  // Before first keyframe
  if (p <= keyframes[0].progress) return keyframes[0].value;
  // After last keyframe
  if (p >= keyframes[keyframes.length - 1].progress) {
    return keyframes[keyframes.length - 1].value;
  }

  for (let i = 0; i < keyframes.length - 1; i++) {
    const k0 = keyframes[i];
    const k1 = keyframes[i + 1];
    if (p >= k0.progress && p <= k1.progress) {
      const segSpan = k1.progress - k0.progress;
      if (segSpan <= 0) return k1.value;
      const segProgress = (p - k0.progress) / segSpan;
      const easedProgress = evaluateGlyphEasing(k0.easing, segProgress);
      return k0.value + easedProgress * (k1.value - k0.value);
    }
  }

  return keyframes[keyframes.length - 1].value;
}

// ── Stagger Calculation ────────────────────────────────────────────────────

interface StaggerConfig {
  unit: "character" | "word" | "line" | "none";
  overlap: number;
  order: string;
}

/**
 * Computes the local animation progress [0,1] for a single glyph given the
 * overall animation progress and stagger configuration.
 *
 * Matches clypra-studio's `calculateStaggerProgress` exactly so visual output
 * is identical between Studio preview and editor playback.
 */
export function calculateGlyphStaggerProgress(
  overallProgress: number,
  itemIndex: number,
  totalItems: number,
  stagger?: StaggerConfig,
): number {
  if (!stagger || stagger.unit === "none" || totalItems <= 1) {
    return overallProgress;
  }

  const { overlap = 0.5, order = "left-to-right" } = stagger;

  let seqIndex = itemIndex;
  if (order === "right-to-left") {
    seqIndex = totalItems - 1 - itemIndex;
  } else if (order === "center-out") {
    const center = (totalItems - 1) / 2;
    seqIndex = Math.abs(itemIndex - center);
  } else if (order === "random") {
    seqIndex = ((itemIndex * 9301 + 49297) % 233280) % totalItems;
  }

  const clampedOverlap = Math.max(0, Math.min(0.98, overlap));
  const activeWindow = 1 / (1 + (totalItems - 1) * (1 - clampedOverlap));
  const stepDelay = activeWindow * (1 - clampedOverlap);
  const startTime = seqIndex * stepDelay;

  const localT = (overallProgress - startTime) / activeWindow;
  return Math.max(0, Math.min(1, localT));
}

// ── Composite Glyph Evaluation ─────────────────────────────────────────────

/**
 * Evaluates the full per-glyph transform for a given overall animation
 * progress, glyph index, and total glyph count.
 *
 * Mirrors clypra-studio's `evaluatePresetTransform`.
 */
export function evaluateGlyphTransform(
  preset: RemoteTextAnimationPreset,
  overallProgress: number,
  glyphIndex: number,
  totalGlyphs: number,
): EvaluatedGlyphTransform {
  if (!preset.tracks || !Array.isArray(preset.tracks)) {
    return { ...DEFAULT_GLYPH_TRANSFORM };
  }

  const glyphProgress = calculateGlyphStaggerProgress(
    overallProgress,
    glyphIndex,
    totalGlyphs,
    preset.stagger as StaggerConfig | undefined,
  );

  const result: EvaluatedGlyphTransform = { ...DEFAULT_GLYPH_TRANSFORM };

  for (const track of preset.tracks) {
    const val = evaluateGlyphTrackValue(
      track.keyframes as TrackKeyframe[],
      glyphProgress,
    );
    switch (track.property) {
      case "opacity":
        result.opacity = val;
        break;
      case "scale":
        result.scaleX = val;
        result.scaleY = val;
        break;
      case "scaleX":
        result.scaleX = val;
        break;
      case "scaleY":
        result.scaleY = val;
        break;
      case "translateX":
        result.translateX = val;
        break;
      case "translateY":
        result.translateY = val;
        break;
      case "rotation":
        result.rotation = val;
        break;
      case "skewX":
        result.skewX = val;
        break;
      case "blur":
        result.blur = val;
        break;
      case "tracking":
        result.tracking = val;
        break;
    }
  }

  return result;
}

// ── Predicate ──────────────────────────────────────────────────────────────

/**
 * Returns true if the preset requires per-glyph canvas rendering (i.e. it has
 * a stagger config with a non-"none" unit). These presets must NOT be compiled
 * into clip-level visualKeyframes — they are handled entirely by the rasterizer.
 */
export function isGlyphAnimatedPreset(preset: RemoteTextAnimationPreset): boolean {
  return Boolean(
    preset.stagger &&
      preset.stagger.unit !== "none" &&
      preset.tracks &&
      preset.tracks.length > 0,
  );
}
