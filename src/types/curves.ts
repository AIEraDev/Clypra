/**
 * Color Curves Data Types
 *
 * Supports Master (Luma), Red, Green, and Blue monotone spline curves.
 */

export interface CurvePoint {
  x: number; // [0.0, 1.0] normalized input code value
  y: number; // [0.0, 1.0] normalized output code value
}

export interface CurvesAdjustment {
  master: CurvePoint[];
  red: CurvePoint[];
  green: CurvePoint[];
  blue: CurvePoint[];
}

export const DEFAULT_LINEAR_CURVE: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

export const DEFAULT_CURVES_ADJUSTMENT: CurvesAdjustment = {
  master: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  red: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
};

/**
 * Evaluates a monotone cubic Hermite spline at input `x` in [0.0, 1.0].
 * Matches the Rust Fritsch-Carlson algorithm in `wgpu_compositor/curves.rs`.
 */
export function evaluateMonotoneSpline(points: CurvePoint[], x: number): number {
  if (!points || points.length === 0) return Math.max(0, Math.min(1, x));
  if (points.length === 1) return Math.max(0, Math.min(1, points[0].y));

  // Sort and deduplicate by X coordinate
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const filtered: CurvePoint[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].x - sorted[i - 1].x) >= 1e-4) {
      filtered.push(sorted[i]);
    }
  }

  const n = filtered.length;
  if (n === 1) return Math.max(0, Math.min(1, filtered[0].y));

  if (x <= filtered[0].x) return Math.max(0, Math.min(1, filtered[0].y));
  if (x >= filtered[n - 1].x) return Math.max(0, Math.min(1, filtered[n - 1].y));

  // Secants
  const deltas: number[] = [];
  const h: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    const dx = Math.max(1e-6, filtered[k + 1].x - filtered[k].x);
    const dy = filtered[k + 1].y - filtered[k].y;
    h.push(dx);
    deltas.push(dy / dx);
  }

  // Tangents
  const m: number[] = [deltas[0]];
  for (let k = 1; k < n - 1; k++) {
    if (deltas[k - 1] * deltas[k] <= 0) {
      m.push(0);
    } else {
      m.push((deltas[k - 1] + deltas[k]) * 0.5);
    }
  }
  m.push(deltas[n - 2]);

  // Fritsch-Carlson monotonicity correction
  for (let k = 0; k < n - 1; k++) {
    if (Math.abs(deltas[k]) < 1e-7) {
      m[k] = 0;
      m[k + 1] = 0;
      continue;
    }
    const alpha = m[k] / deltas[k];
    const beta = m[k + 1] / deltas[k];
    const sumSq = alpha * alpha + beta * beta;
    if (sumSq > 9) {
      const tau = 3 / Math.sqrt(sumSq);
      m[k] = tau * alpha * deltas[k];
      m[k + 1] = tau * beta * deltas[k];
    }
  }

  // Active interval
  let k = 0;
  while (k < n - 2 && filtered[k + 1].x < x) {
    k++;
  }

  const hk = h[k];
  const t = (x - filtered[k].x) / hk;
  const t2 = t * t;
  const t3 = t2 * t;

  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  const y = h00 * filtered[k].y + h10 * hk * m[k] + h01 * filtered[k + 1].y + h11 * hk * m[k + 1];
  return Math.max(0, Math.min(1, y));
}
