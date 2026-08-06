import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { resolveExportDimensions, QUALITY_TIERS } from "../exportDimensions";

describe("Export Pipeline Validation & Dimension Invariants", () => {
  it("always produces positive, even dimensions for landscape projects", () => {
    QUALITY_TIERS.forEach((tier) => {
      const { width, height } = resolveExportDimensions(1920, 1080, tier);
      expect(width % 2).toBe(0);
      expect(height % 2).toBe(0);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      expect(width).toBe(tier.longEdge);
    });
  });

  it("always produces positive, even dimensions for portrait projects (9:16)", () => {
    QUALITY_TIERS.forEach((tier) => {
      const { width, height } = resolveExportDimensions(1080, 1920, tier);
      expect(width % 2).toBe(0);
      expect(height % 2).toBe(0);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      expect(height).toBe(tier.longEdge);
    });
  });

  it("always produces positive, even dimensions for square projects (1:1)", () => {
    QUALITY_TIERS.forEach((tier) => {
      const { width, height } = resolveExportDimensions(1080, 1080, tier);
      expect(width % 2).toBe(0);
      expect(height % 2).toBe(0);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      expect(width).toBe(tier.longEdge);
      expect(height).toBe(tier.longEdge);
    });
  });

  it("property test: arbitrary project dimensions always produce even width and height for H.264/H.265 compliance", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 8000 }),
        fc.integer({ min: 100, max: 8000 }),
        fc.constantFrom(...QUALITY_TIERS),
        (projW, projH, tier) => {
          const { width, height } = resolveExportDimensions(projW, projH, tier);
          expect(width % 2).toBe(0);
          expect(height % 2).toBe(0);
          expect(width).toBeGreaterThan(0);
          expect(height).toBeGreaterThan(0);
          expect(Number.isInteger(width)).toBe(true);
          expect(Number.isInteger(height)).toBe(true);
        }
      )
    );
  });
});
