import { describe, it, expect } from "vitest";
import {
  calculateMediaFit,
  calculateDefaultCoverCrop,
  getSourceCropRect,
  calculateCropFromFocalPoint,
  resolveMediaLayout,
  getClipLayout,
} from "../index";

describe("Clypra Media Layout Engine Math Suite", () => {
  describe("calculateMediaFit", () => {
    const target169 = { width: 1920, height: 1080 };
    const source916 = { width: 1080, height: 1920 };

    it("should fit cover (Fill)", () => {
      // 9:16 cover in 16:9 frame: scale is Max(1920/1080 = 1.7777, 1080/1920 = 0.5625) = 1.7777...
      const fit = calculateMediaFit(source916, target169, "cover");
      expect(fit.scaleX).toBeCloseTo(1.7777);
      expect(fit.scaleY).toBeCloseTo(1.7777);
      expect(fit.width).toBeCloseTo(1920);
      expect(fit.height).toBeCloseTo(3413.33);
      expect(fit.x).toBeCloseTo(0);
      expect(fit.y).toBeCloseTo(-1166.67);
    });

    it("should fit contain (Fit)", () => {
      // 9:16 contain in 16:9 frame: scale is Min(1.7777, 0.5625) = 0.5625
      const fit = calculateMediaFit(source916, target169, "contain");
      expect(fit.scaleX).toBeCloseTo(0.5625);
      expect(fit.scaleY).toBeCloseTo(0.5625);
      expect(fit.width).toBeCloseTo(607.5);
      expect(fit.height).toBeCloseTo(1080);
      expect(fit.x).toBeCloseTo(656.25);
      expect(fit.y).toBeCloseTo(0);
    });

    it("should fit stretch", () => {
      const fit = calculateMediaFit(source916, target169, "stretch");
      expect(fit.width).toBe(1920);
      expect(fit.height).toBe(1080);
      expect(fit.x).toBe(0);
      expect(fit.y).toBe(0);
    });

    it("should fit original size", () => {
      const fit = calculateMediaFit(source916, target169, "original");
      expect(fit.width).toBe(1080);
      expect(fit.height).toBe(1920);
      expect(fit.x).toBe((1920 - 1080) / 2);
      expect(fit.y).toBe((1080 - 1920) / 2);
    });
  });

  describe("calculateDefaultCoverCrop", () => {
    it("should center-crop 9:16 source in 16:9 target frame", () => {
      const crop = calculateDefaultCoverCrop({ width: 1080, height: 1920 }, { width: 1920, height: 1080 });
      expect(crop.left).toBe(0);
      expect(crop.right).toBe(0);
      expect(crop.top).toBeCloseTo(0.3418);
      expect(crop.bottom).toBeCloseTo(0.3418);
    });

    it("should return zero crop for same aspect ratio", () => {
      const crop = calculateDefaultCoverCrop({ width: 1920, height: 1080 }, { width: 1920, height: 1080 });
      expect(crop.left).toBe(0);
      expect(crop.right).toBe(0);
      expect(crop.top).toBe(0);
      expect(crop.bottom).toBe(0);
    });
  });

  describe("calculateCropFromFocalPoint", () => {
    const source = { width: 1080, height: 1920 };
    const target = { width: 1920, height: 1080 };

    it("should center on focalPoint {0.5, 0.5}", () => {
      const crop = calculateCropFromFocalPoint(source, target, { x: 0.5, y: 0.5 });
      expect(crop.left).toBe(0);
      expect(crop.top).toBeCloseTo(0.3418);
    });

    it("should adjust top/bottom crop when focalPoint moves vertically", () => {
      // Move focalPoint up (y = 0.1)
      const crop = calculateCropFromFocalPoint(source, target, { x: 0.5, y: 0.1 });
      // top should be clamped to 0 since focalPoint is very high up, so visible window goes to the top edge
      expect(crop.top).toBe(0);
      expect(crop.bottom).toBeCloseTo(0.6836);
    });
  });

  describe("getSourceCropRect", () => {
    it("should return absolute crop bounds", () => {
      const source = { width: 1000, height: 2000 };
      const crop = { left: 0.1, top: 0.2, right: 0.15, bottom: 0.25 };
      const rect = getSourceCropRect(source, crop);
      expect(rect.x).toBe(100);
      expect(rect.y).toBe(400);
      expect(rect.width).toBe(750);
      expect(rect.height).toBe(1100);
    });
  });

  describe("resolveMediaLayout", () => {
    it("should resolve default layout correctly", () => {
      const source = { width: 1080, height: 1920 };
      const target = { width: 1920, height: 1080 };
      const layout = resolveMediaLayout({ sourceSize: source, projectFrame: target });
      expect(layout.fit).toBe("cover");
      expect(layout.width).toBeCloseTo(1920);
      expect(layout.height).toBeCloseTo(1080);
      expect(layout.x).toBe(960);
      expect(layout.y).toBe(540);
    });
  });

  describe("getClipLayout", () => {
    it("should derive MediaLayout from legacy clip fields", () => {
      const clip = {
        x: 100,
        y: 200,
        width: 960,
        height: 540,
        rotation: 45,
        fitMode: "cover" as const,
      };
      const source = { width: 1920, height: 1080 };
      const target = { width: 1920, height: 1080 };
      const layout = getClipLayout(clip, source, target);

      expect(layout.fit).toBe("cover");
      expect(layout.transform.x).toBe(100 + 960 / 2);
      expect(layout.transform.y).toBe(200 + 540 / 2);
      expect(layout.transform.scaleX).toBe(0.5); // 960 / 1920
      expect(layout.transform.scaleY).toBe(0.5); // 540 / 1080
      expect(layout.transform.rotation).toBe(45);
    });
  });
});
