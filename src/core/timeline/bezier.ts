// src/core/timeline/bezier.ts
// Parametric Cubic-Bézier Curve Engine for Frontend Timeline & Keyframe Evaluation

export interface CubicBezierPoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const BEZIER_PRESETS: Record<string, [number, number, number, number]> = {
  linear: [0.0, 0.0, 1.0, 1.0],
  ease: [0.25, 0.1, 0.25, 1.0],
  easeIn: [0.42, 0.0, 1.0, 1.0],
  easeOut: [0.0, 0.0, 0.58, 1.0],
  easeInOut: [0.42, 0.0, 0.58, 1.0],
  easeInCubic: [0.32, 0.0, 0.67, 0.0],
  easeOutCubic: [0.33, 1.0, 0.68, 1.0],
  easeInBack: [0.6, -0.28, 0.735, 0.045],
  easeOutBack: [0.175, 0.885, 0.32, 1.275],
};

function sampleCurve(p1: number, p2: number, t: number): number {
  const invT = 1.0 - t;
  return 3.0 * invT * invT * t * p1 + 3.0 * invT * t * t * p2 + t * t * t;
}

function sampleCurveDerivative(p1: number, p2: number, t: number): number {
  const invT = 1.0 - t;
  return 3.0 * invT * invT * p1 + 6.0 * invT * t * (p2 - p1) + 3.0 * t * t * (1.0 - p2);
}

export function solveTForX(x1: number, x2: number, x: number): number {
  if (x <= 0.0) return 0.0;
  if (x >= 1.0) return 1.0;

  // Newton-Raphson
  let t = x;
  for (let i = 0; i < 8; i++) {
    const currentX = sampleCurve(x1, x2, t) - x;
    if (Math.abs(currentX) < 1e-6) return t;
    const dx = sampleCurveDerivative(x1, x2, t);
    if (Math.abs(dx) < 1e-6) break;
    t -= currentX / dx;
  }

  // Binary bisection fallback
  let tMin = 0.0;
  let tMax = 1.0;
  t = x;

  while (tMin < tMax) {
    const currentX = sampleCurve(x1, x2, t);
    if (Math.abs(currentX - x) < 1e-6) return t;
    if (x > currentX) {
      tMin = t;
    } else {
      tMax = t;
    }
    t = (tMax + tMin) * 0.5;
  }

  return t;
}

export function evaluateCubicBezier(
  points: [number, number, number, number],
  progress: number
): number {
  const [x1, y1, x2, y2] = points;
  if (progress <= 0.0) return 0.0;
  if (progress >= 1.0) return 1.0;

  const t = solveTForX(Math.max(0, Math.min(1, x1)), Math.max(0, Math.min(1, x2)), progress);
  return sampleCurve(y1, y2, t);
}

export function interpolateVisualKeyframe(
  valStart: number,
  valEnd: number,
  timeStart: number,
  timeEnd: number,
  currentTime: number,
  easing: string = "linear",
  customPoints?: [number, number, number, number]
): number {
  if (timeEnd <= timeStart || currentTime <= timeStart) return valStart;
  if (currentTime >= timeEnd) return valEnd;

  const progress = (currentTime - timeStart) / (timeEnd - timeStart);
  const curvePoints = customPoints ?? BEZIER_PRESETS[easing] ?? BEZIER_PRESETS.linear;
  const eased = evaluateCubicBezier(curvePoints, progress);

  return valStart + (valEnd - valStart) * eased;
}
