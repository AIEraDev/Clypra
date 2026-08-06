import { describe, it, expect } from "vitest";
import { calculateDefaultCoverCrop, getSourceCropRect, rotateCrop } from "../cropMath";
import { calculateCropFromFocalPoint } from "../focalPoint";

describe("Media Math & Crop Transformation Tests", () => {
  // ─── 1. COVER CROP CALCULATIONS ──────────────────────────────────────────
  describe("calculateDefaultCoverCrop", () => {
    it("should calculate centered horizontal crops for 16:9 source in 9:16 target", () => {
      const source = { width: 1920, height: 1080 };
      const target = { width: 1080, height: 1920 };

      const crop = calculateDefaultCoverCrop(source, target);

      // Height matches (top=0, bottom=0), sides cropped equally
      expect(crop.top).toBe(0);
      expect(crop.bottom).toBe(0);
      expect(crop.left).toBeGreaterThan(0);
      expect(crop.right).toBe(crop.left);
    });

    it("should return zero crop for invalid/zero source or target sizes", () => {
      const zeroSize = { width: 0, height: 0 };
      const validSize = { width: 1920, height: 1080 };

      expect(calculateDefaultCoverCrop(zeroSize, validSize)).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
      expect(calculateDefaultCoverCrop(validSize, zeroSize)).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
    });
  });

  // ─── 2. RECTANGLE CONVERSION & OVER-CROP SAFETY ─────────────────────────
  describe("getSourceCropRect", () => {
    it("should convert valid normalized crop bounds to absolute source pixel rect", () => {
      const source = { width: 1000, height: 1000 };
      const crop = { left: 0.1, top: 0.2, right: 0.1, bottom: 0.2 };

      const rect = getSourceCropRect(source, crop);
      expect(rect.x).toBeCloseTo(100);
      expect(rect.y).toBeCloseTo(200);
      expect(rect.width).toBeCloseTo(800);
      expect(rect.height).toBeCloseTo(600);
    });

    it("should protect against over-cropping (left + right >= 1)", () => {
      const source = { width: 1000, height: 1000 };
      const overCrop = { left: 0.6, top: 0.1, right: 0.5, bottom: 0.1 };

      const rect = getSourceCropRect(source, overCrop);
      // Returns full source rect to avoid negative dimensions
      expect(rect).toEqual({
        x: 0,
        y: 0,
        width: 1000,
        height: 1000,
      });
    });
  });

  // ─── 3. CROP ORIENTATION ROTATION ────────────────────────────────────────
  describe("rotateCrop", () => {
    const crop = { left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 };

    it("should return original crop when rotation is 0 or undefined", () => {
      expect(rotateCrop(crop, 0)).toEqual(crop);
      expect(rotateCrop(crop, undefined)).toEqual(crop);
    });

    it("should rotate crop coordinates by 90, 180, and 270 degrees", () => {
      const rot90 = rotateCrop(crop, 90);
      expect(rot90).toEqual({ left: 0.4, top: 0.1, right: 0.2, bottom: 0.3 });

      const rot180 = rotateCrop(crop, 180);
      expect(rot180).toEqual({ left: 0.3, top: 0.4, right: 0.1, bottom: 0.2 });

      const rot270 = rotateCrop(crop, 270);
      expect(rot270).toEqual({ left: 0.2, top: 0.3, right: 0.4, bottom: 0.1 });
    });
  });

  // ─── 4. FOCAL POINT CENTERING ────────────────────────────────────────────
  describe("calculateCropFromFocalPoint", () => {
    it("should center crop window around specified focal point (0.5, 0.5)", () => {
      const source = { width: 1920, height: 1080 };
      const target = { width: 1080, height: 1920 };
      const focalPoint = { x: 0.5, y: 0.5 };

      const crop = calculateCropFromFocalPoint(source, target, focalPoint);
      expect(crop.left).toBeGreaterThan(0);
      expect(crop.left).toBeCloseTo(crop.right, 4);
    });

    it("should clamp focal point outside [0, 1] range to valid bounds", () => {
      const source = { width: 1920, height: 1080 };
      const target = { width: 1080, height: 1920 };
      const extremeFocalPoint = { x: 2.5, y: -1.5 };

      expect(() => {
        calculateCropFromFocalPoint(source, target, extremeFocalPoint);
      }).not.toThrow();
    });
  });
});
