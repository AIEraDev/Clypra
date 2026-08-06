import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { calculateMediaFit } from "../mediaFit";
import { calculateCropFromFocalPoint } from "../focalPoint";
import { resolveMediaLayout, getClipLayout } from "../mediaTransform";

describe("Media Fit & Transform Edge Cases & Invariants", () => {
  describe("calculateMediaFit", () => {
    it("safely handles 0 or negative dimensions", () => {
      const res = calculateMediaFit({ width: 0, height: 1080 }, { width: 1920, height: 1080 }, "cover");
      expect(res.width).toBe(1920);
      expect(res.height).toBe(1080);
      expect(res.scaleX).toBe(1);
      expect(res.scaleY).toBe(1);
    });

    it("calculates cover, contain, stretch, and original fit modes", () => {
      const source = { width: 1920, height: 1080 };
      const target = { width: 1080, height: 1920 };

      const cover = calculateMediaFit(source, target, "cover");
      expect(cover.width).toBeGreaterThanOrEqual(target.width);

      const contain = calculateMediaFit(source, target, "contain");
      expect(contain.width).toBeLessThanOrEqual(target.width);

      const stretch = calculateMediaFit(source, target, "stretch");
      expect(stretch.width).toBe(target.width);
      expect(stretch.height).toBe(target.height);
    });

    it("property test: calculateMediaFit never produces NaN or infinite output bounds", () => {
      fc.assert(
        fc.property(
          fc.record({ width: fc.double(), height: fc.double() }),
          fc.record({ width: fc.double(), height: fc.double() }),
          fc.constantFrom<"cover" | "contain" | "stretch" | "original">("cover", "contain", "stretch", "original"),
          (source, target, mode) => {
            const fit = calculateMediaFit(source, target, mode);
            expect(Number.isFinite(fit.scaleX)).toBe(true);
            expect(Number.isFinite(fit.scaleY)).toBe(true);
            expect(Number.isFinite(fit.width)).toBe(true);
            expect(Number.isFinite(fit.height)).toBe(true);
            expect(Number.isFinite(fit.x)).toBe(true);
            expect(Number.isFinite(fit.y)).toBe(true);
          }
        )
      );
    });
  });

  describe("calculateCropFromFocalPoint", () => {
    it("clamps focal point coordinates to [0, 1]", () => {
      const crop = calculateCropFromFocalPoint(
        { width: 1920, height: 1080 },
        { width: 1080, height: 1920 },
        { x: -5, y: 10 }
      );
      expect(crop.left).toBeGreaterThanOrEqual(0);
      expect(crop.top).toBeGreaterThanOrEqual(0);
      expect(crop.right).toBeGreaterThanOrEqual(0);
      expect(crop.bottom).toBeGreaterThanOrEqual(0);
    });

    it("property test: normalized crop bounds are always within valid range [0, 1]", () => {
      fc.assert(
        fc.property(
          fc.record({ width: fc.double(), height: fc.double() }),
          fc.record({ width: fc.double(), height: fc.double() }),
          fc.record({ x: fc.double(), y: fc.double() }),
          (source, target, focalPoint) => {
            const crop = calculateCropFromFocalPoint(source, target, focalPoint);
            expect(crop.left).toBeGreaterThanOrEqual(0);
            expect(crop.top).toBeGreaterThanOrEqual(0);
            expect(crop.right).toBeGreaterThanOrEqual(0);
            expect(crop.bottom).toBeGreaterThanOrEqual(0);
            expect(crop.left + crop.right).toBeLessThanOrEqual(1.0001);
            expect(crop.top + crop.bottom).toBeLessThanOrEqual(1.0001);
          }
        )
      );
    });
  });

  describe("resolveMediaLayout & getClipLayout", () => {
    it("resolves default layout configuration", () => {
      const res = resolveMediaLayout({
        sourceSize: { width: 1920, height: 1080 },
        projectFrame: { width: 1920, height: 1080 },
      });
      expect(res.fit).toBe("cover");
      expect(res.scaleX).toBe(1);
      expect(res.scaleY).toBe(1);
    });

    it("derives clip layout safely", () => {
      const layout = getClipLayout(
        { x: 0, y: 0, width: 1920, height: 1080, rotation: 0 },
        { width: 1920, height: 1080 },
        { width: 1920, height: 1080 }
      );
      expect(layout.fit).toBe("cover");
      expect(layout.transform.x).toBe(960);
      expect(layout.transform.y).toBe(540);
    });
  });
});
