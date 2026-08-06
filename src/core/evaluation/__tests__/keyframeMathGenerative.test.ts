import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { solveCubicBezier, getEasingProgress, parseColor, isKeyframed } from "../animation";

describe("Keyframe Animation Math & Bezier Solver Invariants", () => {
  describe("solveCubicBezier Boundary & Range Invariants", () => {
    it("always returns 0 when t is 0 and 1 when t is 1", () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          (x1, y1, x2, y2) => {
            expect(solveCubicBezier(x1, y1, x2, y2, 0)).toBe(0);
            expect(solveCubicBezier(x1, y1, x2, y2, 1)).toBe(1);
          }
        )
      );
    });

    it("returns finite non-NaN numbers for all valid control points and progress t in [0, 1]", () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: -2, max: 2, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: -2, max: 2, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          (x1, y1, x2, y2, t) => {
            const res = solveCubicBezier(x1, y1, x2, y2, t);
            expect(Number.isFinite(res)).toBe(true);
            expect(Number.isNaN(res)).toBe(false);
          }
        )
      );
    });
  });

  describe("getEasingProgress Standard Curves", () => {
    it("returns linear progress t for linear easing", () => {
      fc.assert(
        fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (t) => {
          expect(getEasingProgress("linear", t)).toBe(t);
        })
      );
    });

    it("evaluates ease-in, ease-out, ease-in-out monotonically between 0 and 1", () => {
      const easings: Array<"ease-in" | "ease-out" | "ease-in-out"> = ["ease-in", "ease-out", "ease-in-out"];

      easings.forEach((easing) => {
        let prev = 0;
        const steps = 10;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const val = getEasingProgress(easing, t);
          expect(val).toBeGreaterThanOrEqual(prev - 1e-5);
          expect(val).toBeGreaterThanOrEqual(0);
          expect(val).toBeLessThanOrEqual(1.00001);
          prev = val;
        }
      });
    });
  });

  describe("parseColor Parsing & Safety", () => {
    it("correctly parses standard transparency keyword", () => {
      expect(parseColor("transparent")).toEqual([0, 0, 0, 0]);
    });

    it("correctly parses 6-character hex colors #RRGGBB", () => {
      expect(parseColor("#ff0000")).toEqual([255, 0, 0, 1]);
      expect(parseColor("#00ff00")).toEqual([0, 255, 0, 1]);
      expect(parseColor("#0000ff")).toEqual([0, 0, 255, 1]);
    });

    it("correctly parses 3-character short hex colors #RGB", () => {
      expect(parseColor("#f00")).toEqual([255, 0, 0, 1]);
      expect(parseColor("#0f0")).toEqual([0, 255, 0, 1]);
    });

    it("never throws or returns NaN on garbage input strings", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 50 }), (colorStr) => {
          const result = parseColor(colorStr);
          expect(Array.isArray(result)).toBe(true);
          expect(result.length).toBe(4);
          result.forEach((val) => {
            expect(Number.isFinite(val)).toBe(true);
            expect(Number.isNaN(val)).toBe(false);
          });
        })
      );
    });
  });

  describe("isKeyframed Type Guard Invariants", () => {
    it("correctly identifies keyframed properties", () => {
      expect(isKeyframed({ keyframes: [{ time: 0, value: 1, easing: "linear" }], defaultValue: 1 })).toBe(true);
      expect(isKeyframed({ defaultValue: 1 })).toBe(false);
      expect(isKeyframed(null)).toBe(false);
      expect(isKeyframed(undefined)).toBe(false);
      expect(isKeyframed("string")).toBe(false);
      expect(isKeyframed(42)).toBe(false);
    });
  });
});
