import { describe, it, expect } from "vitest";
import {
  screenToCanvas,
  canvasToScreen,
  hitTestClip,
  type ViewportTransform,
  type CanvasSpace,
} from "../coordinateSystem";

describe("Coordinate System Math", () => {
  it("should be mathematical inverses (property-based round-trip test)", () => {
    // Generate thousands of random permutations of viewport, canvas size, and points
    const ITERATIONS = 10000;

    for (let i = 0; i < ITERATIONS; i++) {
      // Random canvas size (e.g. 1920x1080, 1080x1920, 1000x1000)
      const canvas: CanvasSpace = {
        width: 100 + Math.random() * 3000,
        height: 100 + Math.random() * 3000,
      };

      // Random viewport zoom and pan
      const viewport: ViewportTransform = {
        zoom: 0.1 + Math.random() * 4.9, // 0.1 to 5.0
        panX: -5000 + Math.random() * 10000,
        panY: -5000 + Math.random() * 10000,
      };

      // Random display parameters (container bounds, letterbox offset, scale)
      const displayScale = 0.05 + Math.random() * 2.0;
      const displayOffset = {
        x: -500 + Math.random() * 1000,
        y: -500 + Math.random() * 1000,
      };

      // Random point in screen space
      const originalScreen = {
        x: -10000 + Math.random() * 20000,
        y: -10000 + Math.random() * 20000,
      };

      // Screen -> Canvas
      const canvasPoint = screenToCanvas(
        originalScreen.x,
        originalScreen.y,
        viewport,
        canvas, // Not actually used by the math directly, but in signature
        displayScale,
        displayOffset
      );

      // Canvas -> Screen
      const roundTripScreen = canvasToScreen(
        canvasPoint.x,
        canvasPoint.y,
        viewport,
        canvas,
        displayScale,
        displayOffset
      );

      // Verify they are inverses (within floating point precision)
      expect(roundTripScreen.x).toBeCloseTo(originalScreen.x, 3);
      expect(roundTripScreen.y).toBeCloseTo(originalScreen.y, 3);
    }
  });

  describe("hitTestClip", () => {
    it("should accurately hit-test a standard un-rotated clip", () => {
      const clip = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };
      
      // Inside
      expect(hitTestClip(150, 150, clip)).toBe(true);
      expect(hitTestClip(100, 100, clip)).toBe(true);
      expect(hitTestClip(300, 200, clip)).toBe(true);
      
      // Outside
      expect(hitTestClip(99, 150, clip)).toBe(false);
      expect(hitTestClip(150, 99, clip)).toBe(false);
      expect(hitTestClip(301, 150, clip)).toBe(false);
      expect(hitTestClip(150, 201, clip)).toBe(false);
    });

    it("should accurately hit-test a rotated clip (90 degrees)", () => {
      // Square clip at 100,100 (size 100x100) -> Center is 150,150
      // Rotate 90 degrees -> Bounds should be same visually since it's a square rotated around center
      const clip = { x: 100, y: 100, width: 100, height: 100, rotation: 90 };
      
      // The center should be a hit
      expect(hitTestClip(150, 150, clip)).toBe(true);
      
      // Edges should be hits
      expect(hitTestClip(100, 150, clip)).toBe(true);
      
      // Outside edges should miss
      expect(hitTestClip(99, 150, clip)).toBe(false);
    });

    it("should accurately hit-test a rotated rectangle (45 degrees)", () => {
      // 100x20 rectangle centered at 0,0
      const clip = { x: -50, y: -10, width: 100, height: 20, rotation: 45 };
      
      // Center is a hit
      expect(hitTestClip(0, 0, clip)).toBe(true);
      
      // (40, 40) is roughly on the rotated +X axis of the rect
      // Before rotation it would be at x=~56, y=0. Since width is 100 (x: -50 to 50),
      // this should be OUTSIDE the clip.
      expect(hitTestClip(40, 40, clip)).toBe(false);
      
      // (30, 30) is x=~42, y=0 unrotated -> INSIDE the clip
      expect(hitTestClip(30, 30, clip)).toBe(true);
      
      // (-30, -30) is x=~-42, y=0 unrotated -> INSIDE the clip
      expect(hitTestClip(-30, -30, clip)).toBe(true);
      
      // (-30, 30) is on the rotated Y axis -> OUTSIDE (height is only 20)
      expect(hitTestClip(-30, 30, clip)).toBe(false);
    });
  });
});
