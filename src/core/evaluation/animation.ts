import {
  getCurveEvaluator,
  solveCubicBezier as robustSolveCubicBezier,
  resolveResponsiveKeyframes,
} from "@/core/animation";
import type { KeyframeEasing, KeyframeSpringConfig, KeyframeTimeAnchor } from "@/types";

export interface Keyframe<T> {
  time: number; // Normalized time offset within clip duration or seconds from anchor
  value: T;
  anchor?: KeyframeTimeAnchor;
  easing: KeyframeEasing | (string & {});
  controlPoints?: [number, number, number, number]; // [x1, y1, x2, y2] for custom cubic bezier curves
  spring?: KeyframeSpringConfig;
}

export interface KeyframedProperty<T> {
  keyframes: Keyframe<T>[];
  defaultValue: T;
}

export interface NumericKeyframe {
  time: number;
  value: number;
  anchor?: KeyframeTimeAnchor;
  easing?: KeyframeEasing | (string & {});
  controlPoints?: [number, number, number, number];
  spring?: KeyframeSpringConfig;
}

/**
 * Shared numeric keyframe evaluator used by visual and audio timelines.
 * `easingSide` preserves the existing serialized convention for each model
 * while keeping sorting, bounds, interpolation, and curve math in one place.
 */
export function evaluateNumericKeyframes(
  keyframes: readonly NumericKeyframe[] | undefined,
  time: number,
  defaultValue: number,
  options: {
    presorted?: boolean;
    easingSide?: "left" | "right";
    bezierFallback?: "linear" | "smoothstep";
    clipDuration?: number;
  } = {},
): number {
  if (!keyframes?.length) return defaultValue;
  const resolved =
    options.clipDuration != null && options.clipDuration > 0
      ? resolveResponsiveKeyframes(keyframes, options.clipDuration)
      : options.presorted
        ? keyframes.map((k) => ({ ...k, resolvedTime: k.time }))
        : [...keyframes]
            .map((k) => ({ ...k, resolvedTime: k.time }))
            .sort((a, b) => a.resolvedTime - b.resolvedTime);

  // Recover from degenerate tracks where all keyframes collapsed to resolvedTime <= 0
  if (
    resolved.length >= 2 &&
    resolved[resolved.length - 1].resolvedTime <= resolved[0].resolvedTime
  ) {
    const effectiveDuration = Math.min(0.5, options.clipDuration ?? 0.5);
    for (let i = 0; i < resolved.length; i++) {
      resolved[i].resolvedTime =
        resolved[0].resolvedTime + (i / (resolved.length - 1)) * effectiveDuration;
    }
  }

  if (time <= resolved[0].resolvedTime) return resolved[0].value;
  if (time >= resolved[resolved.length - 1].resolvedTime)
    return resolved[resolved.length - 1].value;

  for (let index = 0; index < resolved.length - 1; index += 1) {
    const left = resolved[index];
    const right = resolved[index + 1];
    if (time < left.resolvedTime || time > right.resolvedTime) continue;

    const range = right.resolvedTime - left.resolvedTime;
    const progress =
      range <= 0 ? 0 : Math.max(0, Math.min(1, (time - left.resolvedTime) / range));
    const easingFrame = options.easingSide === "right" ? right : left;
    const easing = easingFrame.easing ?? "linear";

    if (easing === "exponential") {
      const start = Math.max(0.0001, left.value);
      const end = Math.max(0.0001, right.value);
      return start * Math.pow(end / start, progress);
    }

    let easedProgress: number;
    if (easing === "bezier" && !easingFrame.controlPoints) {
      easedProgress =
        options.bezierFallback === "smoothstep"
          ? progress * progress * (3 - 2 * progress)
          : progress;
    } else {
      easedProgress = getEasingProgress(
        easing,
        progress,
        easingFrame.controlPoints,
        easingFrame.spring,
      );
    }

    return left.value + (right.value - left.value) * easedProgress;
  }

  return defaultValue;
}

/**
 * Checks if a property value has keyframes.
 */
export function isKeyframed<T>(prop: any): prop is KeyframedProperty<T> {
  return (
    prop !== null &&
    typeof prop === "object" &&
    "keyframes" in prop &&
    Array.isArray(prop.keyframes)
  );
}

/**
 * Solves cubic bezier curves using Newton-Raphson numerical approximation with bisection fallback.
 */
export function solveCubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: number
): number {
  return robustSolveCubicBezier(x1, y1, x2, y2, t);
}

/**
 * Maps standard easing keywords, kinetic curves, and spring configs to progress coefficients.
 */
export function getEasingProgress(
  easing: Keyframe<any>["easing"] | string | undefined,
  t: number,
  controlPoints?: [number, number, number, number],
  spring?: KeyframeSpringConfig
): number {
  return getCurveEvaluator(easing ?? "linear", controlPoints, spring)(t);
}

/**
 * Parses any color format (HEX, RGB, RGBA) into HSL/RGBA arrays.
 */
export function parseColor(colorStr: string): [number, number, number, number] {
  const c = colorStr.trim().toLowerCase();

  // Handle transparent
  if (c === "transparent") return [0, 0, 0, 0];

  // Hex format: #rgb, #rgba, #rrggbb, #rrggbbaa
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    let r = 255,
      g = 255,
      b = 255,
      a = 1;

    if (hex.length === 3 || hex.length === 4) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
      if (hex.length === 4) a = parseInt(hex[3] + hex[3], 16) / 255;
    } else if (hex.length === 6 || hex.length === 8) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
      if (hex.length === 8) a = parseInt(hex.slice(6, 8), 16) / 255;
    }
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b) && !Number.isNaN(a)) {
      return [r, g, b, a];
    }
  }

  // Handle rgb / rgba formats
  const match = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (match) {
    const r = parseInt(match[1], 10);
    const g = parseInt(match[2], 10);
    const b = parseInt(match[3], 10);
    const a = match[4] !== undefined ? parseFloat(match[4]) : 1.0;
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b) && !Number.isNaN(a)) {
      return [r, g, b, a];
    }
  }

  // Fallback
  return [255, 255, 255, 1];
}

/**
 * Interpolates two color strings.
 */
export function interpolateColor(startColor: string, endColor: string, t: number): string {
  const [r1, g1, b1, a1] = parseColor(startColor);
  const [r2, g2, b2, a2] = parseColor(endColor);

  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  const a = a1 + (a2 - a1) * t;

  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

/**
 * Interpolates numeric value.
 */
export function interpolateNumber(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

/**
 * Evaluates any dynamic, keyframed, or static property at a specific normalized time offset.
 */
export function evaluateProperty<T>(
  property: KeyframedProperty<T> | T | undefined,
  timeOffset: number,
  clipDuration: number
): T {
  // If property is undefined, return default/fallback
  if (property === undefined) {
    return undefined as unknown as T;
  }

  // If static, return directly
  if (!isKeyframed<T>(property)) {
    return property;
  }

  const { keyframes, defaultValue } = property;

  // Resolve responsive keyframes relative to clip duration
  const resolved = resolveResponsiveKeyframes(keyframes, clipDuration);

  // Handle edge cases of keyframe count
  if (resolved.length === 0) return defaultValue;
  if (resolved.length === 1) return resolved[0].value;

  // Recover from degenerate tracks where all keyframes collapsed to resolvedTime <= 0
  if (
    resolved.length >= 2 &&
    resolved[resolved.length - 1].resolvedTime <= resolved[0].resolvedTime
  ) {
    const effectiveDuration = Math.min(0.5, clipDuration ?? 0.5);
    for (let i = 0; i < resolved.length; i++) {
      resolved[i].resolvedTime =
        resolved[0].resolvedTime + (i / (resolved.length - 1)) * effectiveDuration;
    }
  }

  // Bounds checks
  if (timeOffset <= resolved[0].resolvedTime) return resolved[0].value;
  if (timeOffset >= resolved[resolved.length - 1].resolvedTime) return resolved[resolved.length - 1].value;

  // Find surrounding keyframes
  let left = resolved[0];
  let right = resolved[resolved.length - 1];

  for (let i = 0; i < resolved.length - 1; i++) {
    if (timeOffset >= resolved[i].resolvedTime && timeOffset <= resolved[i + 1].resolvedTime) {
      left = resolved[i];
      right = resolved[i + 1];
      break;
    }
  }

  // Calculate local progress between left and right keyframes
  const range = right.resolvedTime - left.resolvedTime;
  const progress = range === 0 ? 0 : (timeOffset - left.resolvedTime) / range;

  // Apply easing to the progress
  const easedProgress = getEasingProgress(left.easing, progress, left.controlPoints, left.spring);

  // Interpolate based on type
  if (typeof left.value === "number" && typeof right.value === "number") {
    return interpolateNumber(left.value, right.value, easedProgress) as unknown as T;
  }

  if (typeof left.value === "string" && typeof right.value === "string") {
    // Check if they look like colors
    const isColor =
      left.value.startsWith("#") ||
      left.value.startsWith("rgb") ||
      left.value === "transparent" ||
      right.value.startsWith("#") ||
      right.value.startsWith("rgb") ||
      right.value === "transparent";

    if (isColor) {
      return interpolateColor(left.value, right.value, easedProgress) as unknown as T;
    }
  }

  // Fallback to step value
  return (easedProgress >= 0.5 ? right.value : left.value) as T;
}

import type { VisualPropertyKeyframe } from "@/types";

/**
 * Evaluates a visual property keyframe track at a given clip time offset (seconds)
 */
export function evaluateVisualPropertyKeyframes(
  keyframes: VisualPropertyKeyframe[] | undefined,
  timeOffset: number,
  defaultValue: number,
  clipDuration?: number
): number {
  return evaluateNumericKeyframes(keyframes, timeOffset, defaultValue, {
    easingSide: "left",
    bezierFallback: "linear",
    clipDuration,
  });
}

/**
 * Offloads multi-track keyframe evaluation for clips at a given presentation time
 * to the KeyframeEval background worker.
 */
export async function evaluateKeyframesAsync(
  time: number,
  clips: import("@/workers/types").SerializedKeyframeClip[],
  frameRate = 30,
): Promise<Map<string, import("@/core/workers/keyframeEvalWorkerClient").EvaluatedClipProperties>> {
  const { getKeyframeEvalWorkerClient } = await import(
    "@/core/workers/keyframeEvalWorkerClient"
  );
  return getKeyframeEvalWorkerClient().evaluateKeyframes(time, clips, frameRate);
}


