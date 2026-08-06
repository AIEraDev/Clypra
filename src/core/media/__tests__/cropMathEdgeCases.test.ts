import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculateDefaultCoverCrop, getSourceCropRect } from '../cropMath';

describe('Media Crop Math & Normalized Coordinates Edge Cases', () => {

  describe('Cover Crop Calculations', () => {

    it('calculates equal left/right crop for landscape source (1920x1080) in square canvas (1080x1080)', () => {
      const source = { width: 1920, height: 1080 };
      const target = { width: 1080, height: 1080 };
      const crop = calculateDefaultCoverCrop(source, target);

      expect(crop.top).toBe(0);
      expect(crop.bottom).toBe(0);
      expect(crop.left).toBeGreaterThan(0);
      expect(crop.right).toBe(crop.left);
    });

    it('returns zero crop when source and target match aspect ratio', () => {
      const source = { width: 1920, height: 1080 };
      const target = { width: 1280, height: 720 };
      const crop = calculateDefaultCoverCrop(source, target);

      expect(crop.left).toBeCloseTo(0, 5);
      expect(crop.top).toBeCloseTo(0, 5);
      expect(crop.right).toBeCloseTo(0, 5);
      expect(crop.bottom).toBeCloseTo(0, 5);
    });

    it('handles zero or negative source/target dimensions safely', () => {
      const invalidSource = { width: 0, height: 1080 };
      const validTarget = { width: 1920, height: 1080 };
      const crop = calculateDefaultCoverCrop(invalidSource, validTarget);

      expect(crop).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
    });

    it('property test: calculateDefaultCoverCrop never produces NaN bounds', () => {
      fc.assert(
        fc.property(
          fc.record({ width: fc.double(), height: fc.double() }),
          fc.record({ width: fc.double(), height: fc.double() }),
          (source, target) => {
            const crop = calculateDefaultCoverCrop(source, target);
            expect(Number.isFinite(crop.left)).toBe(true);
            expect(Number.isFinite(crop.top)).toBe(true);
            expect(Number.isFinite(crop.right)).toBe(true);
            expect(Number.isFinite(crop.bottom)).toBe(true);
          }
        )
      );
    });

  });

  describe('Source Crop Rect & Over-Crop Defense', () => {

    it('converts valid normalized crop to absolute pixel coordinates', () => {
      const source = { width: 1000, height: 1000 };
      const crop = { left: 0.1, top: 0.2, right: 0.1, bottom: 0.2 };
      const rect = getSourceCropRect(source, crop);

      expect(rect.x).toBeCloseTo(100, 5);
      expect(rect.y).toBeCloseTo(200, 5);
      expect(rect.width).toBeCloseTo(800, 5);
      expect(rect.height).toBeCloseTo(600, 5);
    });

    it('guards against invalid over-cropping (left + right >= 1) by returning full source rect', () => {
      const source = { width: 1920, height: 1080 };
      const invalidOverCrop = { left: 0.6, top: 0, right: 0.5, bottom: 0 };
      const rect = getSourceCropRect(source, invalidOverCrop);

      expect(rect).toEqual({
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
    });

    it('clamps negative crop coordinates to 0..1 range', () => {
      const source = { width: 1000, height: 1000 };
      const outOfBoundsCrop = { left: -0.5, top: -0.1, right: 0.2, bottom: 0.2 };
      const rect = getSourceCropRect(source, outOfBoundsCrop);

      expect(rect.x).toBe(0);
      expect(rect.y).toBe(0);
      expect(rect.width).toBeCloseTo(800, 5);
      expect(rect.height).toBeCloseTo(800, 5);
    });

  });

});
