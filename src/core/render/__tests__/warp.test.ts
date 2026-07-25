import { describe, it, expect } from "vitest";
import { getArcPath, drawTextOnArc, applyWarpDisplacement } from "../warp";

describe("Typography Warping & Path Layout Engine", () => {
  describe("getArcPath", () => {
    it("computes accurate arc coordinate vectors", () => {
      const path = getArcPath(100, 100, 50, 0, 180, 5);
      expect(path).toHaveLength(5);
      // At start angle (0 deg = 0 rad), x should be centerX + radius
      expect(path[0].x).toBeCloseTo(150, 4);
      expect(path[0].y).toBeCloseTo(100, 4);
    });
  });

  describe("drawTextOnArc", () => {
    it("coordinates character callback draws on path", () => {
      // Mock Canvas 2D context
      const dummyCtx = {
        save: () => {},
        restore: () => {},
        translate: () => {},
        rotate: () => {},
      } as unknown as CanvasRenderingContext2D;

      const drawnChars: string[] = [];
      drawTextOnArc(dummyCtx, "VIREOSTUDIO", 0, 0, 100, 45, 1.0, (char) => {
        drawnChars.push(char);
      });

      expect(drawnChars).toEqual(["C", "L", "Y", "P", "R", "A"]);
    });
  });

  describe("applyWarpDisplacement", () => {
    it("runs displacement loop without throwing", () => {
      // Mock ImageData buffer
      const buffer = new Uint8ClampedArray(4 * 10 * 10);
      const mockImageData = {
        data: buffer,
        width: 10,
        height: 10,
      } as unknown as ImageData;

      const dummyCtx = {
        getImageData: () => mockImageData,
        createImageData: () => mockImageData,
        putImageData: () => {},
      } as unknown as CanvasRenderingContext2D;

      expect(() => {
        applyWarpDisplacement(dummyCtx, 10, 10, "wave", 2);
      }).not.toThrow();
    });
  });
});
