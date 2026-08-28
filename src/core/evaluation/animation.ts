export interface Keyframe<T> {
  time: number; // Normalized time offset (0.0 to 1.0) within clip duration
  value: T;
  easing: "linear" | "ease-in" | "ease-out" | "ease-in-out" | "cubic-bezier";
  controlPoints?: [number, number, number, number]; // [x1, y1, x2, y2] for custom cubic bezier curves
}

export interface KeyframedProperty<T> {
  keyframes: Keyframe<T>[];
  defaultValue: T;
}

export interface NumericKeyframe {
  time: number;
  value: number;
  easing?:
    | "linear"
    | "easeIn"
    | "easeOut"
    | "easeInOut"
    | "ease-in"
    | "ease-out"
    | "ease-in-out"
    | "bezier"
    | "cubic-bezier"
    | "exponential"
    | "logarithmic"
    | "hold"
    | (string & {});
  controlPoints?: [number, number, number, number];
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
  } = {},
): number {
  if (!keyframes?.length) return defaultValue;
  const sorted = options.presorted ? keyframes : [...keyframes].sort((a, b) => a.time - b.time);
  if (time <= sorted[0].time) return sorted[0].value;
  if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value;

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const left = sorted[index];
    const right = sorted[index + 1];
    if (time < left.time || time > right.time) continue;

    const range = right.time - left.time;
    const progress = range <= 0 ? 0 : Math.max(0, Math.min(1, (time - left.time) / range));
    const easingFrame = options.easingSide === "right" ? right : left;
    const easing = easingFrame.easing ?? "linear";

    if (easing === "exponential") {
      const start = Math.max(0.0001, left.value);
      const end = Math.max(0.0001, right.value);
      return start * Math.pow(end / start, progress);
    }

    let easedProgress: number;
    if (easing === "bezier" && !easingFrame.controlPoints) {
      easedProgress = options.bezierFallback === "smoothstep"
        ? progress * progress * (3 - 2 * progress)
        : progress;
    } else {
      const normalizedEasing = easing === "easeIn"
        ? "ease-in"
        : easing === "easeOut"
          ? "ease-out"
          : easing === "easeInOut"
            ? "ease-in-out"
            : easing;
      easedProgress = getEasingProgress(
        normalizedEasing as Keyframe<number>["easing"],
        progress,
        easingFrame.controlPoints,
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
 * Solves cubic bezier curves using Newton-Raphson numerical approximation.
 */
export function solveCubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: number
): number {
  if (t === 0 || t === 1) return t;

  let x = t;
  // Use up to 8 iterations of Newton-Raphson solver
  for (let i = 0; i < 8; i++) {
    const currX = sampleBezierCurve(x1, x2, x) - t;
    if (Math.abs(currX) < 1e-6) break;
    const dX = sampleBezierDerivative(x1, x2, x);
    if (Math.abs(dX) < 1e-6) break;
    x -= currX / dX;
  }
  return sampleBezierCurve(y1, y2, x);
}

function sampleBezierCurve(p1: number, p2: number, t: number): number {
  return 3 * t * (1 - t) * (1 - t) * p1 + 3 * t * t * (1 - t) * p2 + t * t * t;
}

function sampleBezierDerivative(p1: number, p2: number, t: number): number {
  return 3 * (1 - t) * (1 - t) * p1 + 6 * t * (1 - t) * (p2 - p1) + 3 * t * t * (1 - p2);
}

/**
 * Maps standard easing keywords to progress coefficients.
 */
export function getEasingProgress(
  easing: Keyframe<any>["easing"],
  t: number,
  controlPoints?: [number, number, number, number]
): number {
  switch (easing) {
    case "linear":
      return t;
    case "ease-in":
      return solveCubicBezier(0.42, 0.0, 1.0, 1.0, t);
    case "ease-out":
      return solveCubicBezier(0.0, 0.0, 0.58, 1.0, t);
    case "ease-in-out":
      return solveCubicBezier(0.42, 0.0, 0.58, 1.0, t);
    case "cubic-bezier":
      if (controlPoints && controlPoints.length === 4) {
        return solveCubicBezier(
          controlPoints[0],
          controlPoints[1],
          controlPoints[2],
          controlPoints[3],
          t
        );
      }
      return t;
    default:
      return t;
  }
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

  // Handle edge cases of keyframe count
  if (keyframes.length === 0) return defaultValue;
  if (keyframes.length === 1) return keyframes[0].value;

  // Sort keyframes by time offset just to be robust
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  // Bounds checks
  if (timeOffset <= sorted[0].time) return sorted[0].value;
  if (timeOffset >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value;

  // Find surrounding keyframes
  let left = sorted[0];
  let right = sorted[sorted.length - 1];

  for (let i = 0; i < sorted.length - 1; i++) {
    if (timeOffset >= sorted[i].time && timeOffset <= sorted[i + 1].time) {
      left = sorted[i];
      right = sorted[i + 1];
      break;
    }
  }

  // Calculate local progress between left and right keyframes
  const range = right.time - left.time;
  const progress = range === 0 ? 0 : (timeOffset - left.time) / range;

  // Apply easing to the progress
  const easedProgress = getEasingProgress(left.easing, progress, left.controlPoints);

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
  defaultValue: number
): number {
  return evaluateNumericKeyframes(keyframes, timeOffset, defaultValue, {
    easingSide: "left",
    bezierFallback: "linear",
  });
}
