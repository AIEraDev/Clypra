import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseCSSFilterToIR, resolveFilterToIR, normalizeFilterIntensity } from "../filterIR";

describe("filterIR Edge Cases & Property Invariants", () => {
  describe("normalizeFilterIntensity", () => {
    it("defaults to 0.8 for undefined, NaN, or non-finite numbers", () => {
      expect(normalizeFilterIntensity(undefined)).toBe(0.8);
      expect(normalizeFilterIntensity(NaN)).toBe(0.8);
      expect(normalizeFilterIntensity(Infinity)).toBe(0.8);
    });

    it("clamps numeric intensity to [0, 1]", () => {
      expect(normalizeFilterIntensity(-0.5)).toBe(0);
      expect(normalizeFilterIntensity(1.5)).toBe(1);
      expect(normalizeFilterIntensity(0.5)).toBe(0.5);
    });
  });

  describe("parseCSSFilterToIR & resolveFilterToIR Safety", () => {
    it("parses valid CSS filter strings correctly", () => {
      const ir = parseCSSFilterToIR("sepia(50%) saturate(150%) hue-rotate(90deg)");
      expect(ir.sepia).toBe(0.5);
      expect(ir.saturate).toBe(1.5);
      expect(ir.hueRotate).toBe(90);
    });

    it("property test: parseCSSFilterToIR and resolveFilterToIR never return NaN values on arbitrary strings", () => {
      fc.assert(
        fc.property(fc.string(), (cssStr) => {
          const ir = parseCSSFilterToIR(cssStr);
          Object.values(ir).forEach((val) => {
            if (val !== undefined) {
              expect(Number.isNaN(val)).toBe(false);
              expect(Number.isFinite(val)).toBe(true);
            }
          });

          const resolved = resolveFilterToIR("vintage", 0.5, cssStr);
          Object.values(resolved).forEach((val) => {
            if (val !== undefined) {
              expect(Number.isNaN(val)).toBe(false);
              expect(Number.isFinite(val)).toBe(true);
            }
          });
        })
      );
    });
  });
});
