import { describe, it, expect, vi } from 'vitest';
import { TransitionsApi } from '../api/transitionsApi';

describe('Transition Engine Progress Math & Edge Cases', () => {

  describe('Transition API Client Contract', () => {
    it('handles network failure on getCategories gracefully', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
      await expect(TransitionsApi.getCategories()).rejects.toThrow('Network error');
      vi.unstubAllGlobals();
    });
  });

  describe('Transition Progress Clamp & Bounds Math', () => {
    it('clamps transition progress t cleanly within [0.0, 1.0]', () => {
      const clampProgress = (t: number): number => {
        if (Number.isNaN(t)) return 0;
        return Math.max(0, Math.min(1, t));
      };

      expect(clampProgress(-0.5)).toBe(0);
      expect(clampProgress(0.0)).toBe(0);
      expect(clampProgress(0.5)).toBe(0.5);
      expect(clampProgress(1.0)).toBe(1);
      expect(clampProgress(1.5)).toBe(1);
      expect(clampProgress(NaN)).toBe(0);
    });

    it('calculates transition overlap duration safely without division by zero', () => {
      const calculateOverlap = (duration: number, clipADuration: number, clipBDuration: number): number => {
        if (duration <= 0 || clipADuration <= 0 || clipBDuration <= 0) return 0;
        const maxAllowed = Math.min(clipADuration / 2, clipBDuration / 2);
        return Math.min(duration, maxAllowed);
      };

      expect(calculateOverlap(1.0, 5.0, 5.0)).toBe(1.0);
      expect(calculateOverlap(4.0, 2.0, 2.0)).toBe(1.0);
      expect(calculateOverlap(0, 5.0, 5.0)).toBe(0);
      expect(calculateOverlap(-1.0, 5.0, 5.0)).toBe(0);
    });
  });

});
