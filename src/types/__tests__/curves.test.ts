import { describe, it, expect } from "vitest";
import {
  evaluateMonotoneSpline,
  DEFAULT_LINEAR_CURVE,
  type CurvePoint,
} from "../curves";

describe("Color Curves Monotone Spline Evaluator", () => {
  it("evaluates default linear identity curve with zero error", () => {
    expect(evaluateMonotoneSpline(DEFAULT_LINEAR_CURVE, 0.0)).toBe(0.0);
    expect(evaluateMonotoneSpline(DEFAULT_LINEAR_CURVE, 0.25)).toBe(0.25);
    expect(evaluateMonotoneSpline(DEFAULT_LINEAR_CURVE, 0.5)).toBe(0.5);
    expect(evaluateMonotoneSpline(DEFAULT_LINEAR_CURVE, 0.75)).toBe(0.75);
    expect(evaluateMonotoneSpline(DEFAULT_LINEAR_CURVE, 1.0)).toBe(1.0);
  });

  it("evaluates S-curve contrast with strict monotonicity (no negative slopes)", () => {
    const sCurve: CurvePoint[] = [
      { x: 0.0, y: 0.0 },
      { x: 0.25, y: 0.15 },
      { x: 0.75, y: 0.85 },
      { x: 1.0, y: 1.0 },
    ];

    let prevY = -1;
    for (let step = 0; step <= 100; step++) {
      const x = step / 100;
      const y = evaluateMonotoneSpline(sCurve, x);
      expect(y).toBeGreaterThanOrEqual(prevY);
      expect(y).toBeGreaterThanOrEqual(0.0);
      expect(y).toBeLessThanOrEqual(1.0);
      prevY = y;
    }

    const mid = evaluateMonotoneSpline(sCurve, 0.5);
    expect(Math.abs(mid - 0.5)).toBeLessThan(0.02);
  });

  it("handles out-of-order points and boundary clamps", () => {
    const unordered: CurvePoint[] = [
      { x: 1.0, y: 1.0 },
      { x: 0.0, y: 0.0 },
      { x: 0.5, y: 0.8 },
    ];

    expect(evaluateMonotoneSpline(unordered, -0.2)).toBe(0.0);
    expect(evaluateMonotoneSpline(unordered, 1.2)).toBe(1.0);
    expect(evaluateMonotoneSpline(unordered, 0.5)).toBe(0.8);
  });
});
