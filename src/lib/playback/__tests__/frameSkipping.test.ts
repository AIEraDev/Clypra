import { describe, it, expect } from "vitest";
import { 
  calculateFrameSkip, 
  FrameSkipController, 
  calculateOptimalSkipInterval, 
  estimateFrameBudget 
} from "../frameSkipping";

describe("Playback Frame Skipping System", () => {
  
  describe("calculateFrameSkip", () => {
    it("should render every frame at normal speed (1x)", () => {
      const result = calculateFrameSkip(0.1, { speed: 1.0, projectFps: 30 });
      expect(result.shouldRender).toBe(true);
      expect(result.skipInterval).toBe(1);
      expect(result.expectedFps).toBe(30);
      expect(result.frameBudgetMs).toBe(1000 / 30);
    });

    it("should calculate correct skip intervals at high speeds", () => {
      // 2x speed at 30fps project rate
      const resultFrame0 = calculateFrameSkip(0.0, { speed: 2.0, projectFps: 30 }); // frame 0
      const resultFrame1 = calculateFrameSkip(1 / 30, { speed: 2.0, projectFps: 30 }); // frame 1

      expect(resultFrame0.skipInterval).toBe(2);
      expect(resultFrame0.shouldRender).toBe(true); // 0 % 2 === 0
      
      expect(resultFrame1.shouldRender).toBe(false); // 1 % 2 !== 0
    });

    it("should not skip frames if frame skipping is disabled", () => {
      const result = calculateFrameSkip(1 / 30, { speed: 4.0, projectFps: 30, enabled: false });
      expect(result.shouldRender).toBe(true);
      expect(result.skipInterval).toBe(1);
    });
  });

  describe("FrameSkipController", () => {
    it("should update speeds and tracks frame render statistics statefully", () => {
      const controller = new FrameSkipController({ speed: 2.0, projectFps: 30 });

      // Frame 0: should render
      const r0 = controller.shouldRenderFrame(0.0);
      expect(r0.shouldRender).toBe(true);

      // Frame 1: should be skipped (at 2x speed)
      const r1 = controller.shouldRenderFrame(1 / 30);
      expect(r1.shouldRender).toBe(false);

      const stats = controller.getStats();
      expect(stats.totalFrames).toBe(2);
      expect(stats.renderedFrames).toBe(1);
      expect(stats.skippedFrames).toBe(1);
      expect(stats.skipRate).toBe(0.5);
      expect(stats.lastRenderedFrame).toBe(0);

      // Reset statistics
      controller.resetStats();
      expect(controller.getStats().totalFrames).toBe(0);
      expect(controller.getStats().lastRenderedFrame).toBe(-1);
    });

    it("should react to dynamic configuration updates", () => {
      const controller = new FrameSkipController({ speed: 1.0, projectFps: 30 });
      expect(controller.shouldRenderFrame(1 / 30).shouldRender).toBe(true);

      // Update speed to 4x
      controller.setSpeed(4.0);
      
      // Frame 1 should now be skipped at 4x speed (1 % 4 !== 0)
      expect(controller.shouldRenderFrame(1 / 30).shouldRender).toBe(false);
    });
  });

  describe("calculateOptimalSkipInterval", () => {
    it("should compute optimal skipping thresholds for visual frame targets", () => {
      expect(calculateOptimalSkipInterval(1.0, 30, 30)).toBe(1);
      expect(calculateOptimalSkipInterval(2.0, 30, 30)).toBe(2);
      expect(calculateOptimalSkipInterval(4.0, 30, 30)).toBe(4);
    });
  });

  describe("estimateFrameBudget", () => {
    it("should calculate rendering budget in milliseconds correctly", () => {
      // 30fps target = 33.33ms budget per frame
      expect(estimateFrameBudget(1, 30)).toBeCloseTo(33.33, 1);
      // With skipInterval 2, budget doubles to 66.67ms
      expect(estimateFrameBudget(2, 30)).toBeCloseTo(66.67, 1);
    });
  });
});
