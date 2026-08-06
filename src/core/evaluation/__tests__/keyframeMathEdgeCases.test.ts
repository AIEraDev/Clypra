import { describe, it, expect } from 'vitest';
import {
  evaluateProperty,
  interpolateColor,
  solveCubicBezier,
  getEasingProgress,
} from '../animation';

describe('Keyframe Math & Evaluation Extreme Edge Cases', () => {

  describe('Cubic Bezier & Easing Curve Safeguards', () => {

    it('returns exact progress for linear easing', () => {
      expect(getEasingProgress('linear', 0.0)).toBe(0);
      expect(getEasingProgress('linear', 0.5)).toBe(0.5);
      expect(getEasingProgress('linear', 1.0)).toBe(1);
    });

    it('safely evaluates cubic bezier solver at extremes 0.0 and 1.0', () => {
      expect(solveCubicBezier(0.42, 0.0, 0.58, 1.0, 0.0)).toBe(0);
      expect(solveCubicBezier(0.42, 0.0, 0.58, 1.0, 1.0)).toBe(1);
    });

    it('evaluates ease-in and ease-out non-linear curves correctly', () => {
      expect(getEasingProgress('ease-in', 0.5)).toBeLessThan(0.5);
      expect(getEasingProgress('ease-out', 0.5)).toBeGreaterThan(0.5);
    });

  });

  describe('Out-of-Order & Duplicate Keyframe Invariants', () => {

    it('evaluates static fallback value when keyframes array is empty', () => {
      const prop = { keyframes: [], defaultValue: 100 };
      expect(evaluateProperty(prop, 2.5, 10)).toBe(100);
    });

    it('extrapolates first keyframe value when time is before first keyframe', () => {
      const prop = {
        keyframes: [
          { id: 'k1', time: 2.0, value: 50, easing: 'linear' as const },
          { id: 'k2', time: 5.0, value: 100, easing: 'linear' as const },
        ],
        defaultValue: 0,
      };

      expect(evaluateProperty(prop, 0.5, 10)).toBe(50);
    });

    it('extrapolates last keyframe value when time is after last keyframe', () => {
      const prop = {
        keyframes: [
          { id: 'k1', time: 2.0, value: 50, easing: 'linear' as const },
          { id: 'k2', time: 5.0, value: 100, easing: 'linear' as const },
        ],
        defaultValue: 0,
      };

      expect(evaluateProperty(prop, 8.0, 10)).toBe(100);
    });

    it('handles duplicate keyframe timestamps without division by zero', () => {
      const prop = {
        keyframes: [
          { id: 'k1', time: 2.0, value: 50, easing: 'linear' as const },
          { id: 'k2', time: 2.0, value: 100, easing: 'linear' as const },
        ],
        defaultValue: 0,
      };

      expect(() => evaluateProperty(prop, 2.0, 10)).not.toThrow();
      const val = evaluateProperty(prop, 2.0, 10);
      expect(Number.isNaN(val as number)).toBe(false);
    });

  });

  describe('Color Interpolation Edge Cases', () => {

    it('interpolates between black hex and white hex at mid-point 0.5', () => {
      const result = interpolateColor('#000000', '#ffffff', 0.5);
      expect(result).toContain('128');
    });

    it('handles 0.0 and 1.0 progress boundaries strictly', () => {
      expect(interpolateColor('#ff0000', '#00ff00', 0.0)).toContain('255, 0, 0');
      expect(interpolateColor('#ff0000', '#00ff00', 1.0)).toContain('0, 255, 0');
    });

  });

});
