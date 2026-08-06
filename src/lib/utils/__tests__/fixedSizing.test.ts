import { describe, it, expect } from "vitest";
import {
  REFERENCE_CANVAS,
  getFixedScaleFactor,
  normalizeFontSize,
  normalizeIconSize,
  getTextRenderMetrics,
  getFixedSizingConfig,
} from "../fixedSizing";

describe("Fixed Sizing System (Cross-OS Normalization)", () => {
  describe("getFixedScaleFactor", () => {
    it("returns 1.0 for standard 1920x1080 reference canvas", () => {
      expect(getFixedScaleFactor(1920, 1080)).toBe(1.0);
    });

    it("scales down correctly for 1280x720 canvas", () => {
      // scaleX = 1280/1920 = 0.666..., scaleY = 720/1080 = 0.666...
      expect(getFixedScaleFactor(1280, 720)).toBeCloseTo(0.6667, 3);
    });

    it("scales up correctly for 3840x2160 (4K UHD) canvas", () => {
      expect(getFixedScaleFactor(3840, 2160)).toBe(2.0);
    });

    it("handles portrait 1080x1920 canvas correctly", () => {
      // min(1080/1920, 1920/1080) = min(0.5625, 1.7777) = 0.5625
      expect(getFixedScaleFactor(1080, 1920)).toBe(0.5625);
    });

    it("returns 1.0 for non-positive dimensions defensively", () => {
      expect(getFixedScaleFactor(0, 1080)).toBe(1.0);
      expect(getFixedScaleFactor(1920, -100)).toBe(1.0);
    });
  });

  describe("normalizeFontSize", () => {
    it("preserves font size on 1920x1080 canonical reference canvas", () => {
      expect(normalizeFontSize(48, 1920, 1080)).toBe(48);
      expect(normalizeFontSize(24, 1920, 1080)).toBe(24);
    });

    it("produces identical font size regardless of OS devicePixelRatio", () => {
      const macRetina = normalizeFontSize(32, 1920, 1080, { dpr: 2.0 });
      const winScale125 = normalizeFontSize(32, 1920, 1080, { dpr: 1.25 });
      const winScale150 = normalizeFontSize(32, 1920, 1080, { dpr: 1.50 });
      const standardDpr = normalizeFontSize(32, 1920, 1080, { dpr: 1.0 });

      expect(macRetina).toBe(32);
      expect(winScale125).toBe(32);
      expect(winScale150).toBe(32);
      expect(standardDpr).toBe(32);
    });

    it("scales font size proportionally for 4K canvas", () => {
      expect(normalizeFontSize(48, 3840, 2160)).toBe(96);
    });

    it("handles invalid or zero font size gracefully", () => {
      expect(normalizeFontSize(0)).toBe(1);
      expect(normalizeFontSize(-10)).toBe(1);
    });
  });

  describe("normalizeIconSize", () => {
    it("preserves icon dimensions on 1920x1080 canonical canvas", () => {
      const icon = normalizeIconSize(64, 64, 1920, 1080);
      expect(icon).toEqual({ width: 64, height: 64 });
    });

    it("is immune to OS devicePixelRatio variations", () => {
      const macIcon = normalizeIconSize(120, 80, 1920, 1080, { dpr: 2.0 });
      const winIcon = normalizeIconSize(120, 80, 1920, 1080, { dpr: 1.25 });

      expect(macIcon).toEqual({ width: 120, height: 80 });
      expect(winIcon).toEqual({ width: 120, height: 80 });
    });

    it("scales icon bounds proportionally for 4K canvas", () => {
      const icon = normalizeIconSize(100, 100, 3840, 2160);
      expect(icon).toEqual({ width: 200, height: 200 });
    });

    it("handles non-positive inputs defensively", () => {
      const icon = normalizeIconSize(-50, 0, 1920, 1080);
      expect(icon).toEqual({ width: 1, height: 1 });
    });
  });

  describe("getTextRenderMetrics", () => {
    it("calculates standardized baseline offset (0.82 * fontSize)", () => {
      const metrics = getTextRenderMetrics(50);
      expect(metrics.fontSize).toBe(50);
      expect(metrics.baselineOffset).toBe(41); // 50 * 0.82 = 41
      expect(metrics.lineHeight).toBe(60); // 50 * 1.2 = 60
      expect(metrics.paddingX).toBe(12.5); // 50 * 0.25 = 12.5
      expect(metrics.paddingY).toBe(12.5);
    });

    it("handles custom line height scale factor", () => {
      const metrics = getTextRenderMetrics(40, 1.5);
      expect(metrics.lineHeight).toBe(60);
    });
  });

  describe("getFixedSizingConfig", () => {
    it("provides consolidated configuration helpers", () => {
      const config = getFixedSizingConfig(1920, 1080);
      expect(config.scaleFactor).toBe(1.0);
      expect(config.referenceCanvas).toEqual(REFERENCE_CANVAS);
      expect(config.normalizeFont(36)).toBe(36);
      expect(config.normalizeIcon(48, 48)).toEqual({ width: 48, height: 48 });
      expect(config.getTextMetrics(30).baselineOffset).toBe(24.6);
    });
  });
});
