import { describe, expect, it } from "vitest";
import { resolveTextPresentationGeometry } from "../textPresentationGeometry";

describe("text presentation geometry", () => {
  it("CLY-TEXT-024: rotates a cropped raster around the stable text layout pivot", () => {
    const geometry = resolveTextPresentationGeometry(
      { x: 100, y: 200, width: 400, height: 100, rotation: 90 },
      // A tightly cropped italic/underlined raster is offset inside the layout box.
      { x: 120, y: 215, width: 340, height: 70 },
    );

    expect(geometry.pivotX).toBe(300);
    expect(geometry.pivotY).toBe(250);
    // The draw quad moves around the layout-box center, rather than rotating
    // around its own cropped center at (290, 250).
    expect(geometry.drawX).toBe(130);
    expect(geometry.drawY).toBe(205);
    expect(geometry.layout).toEqual({
      x: 100,
      y: 200,
      width: 400,
      height: 100,
      rotation: 90,
    });
  });

  it("keeps an aligned raster centered when its draw and layout centers match", () => {
    const geometry = resolveTextPresentationGeometry(
      { x: 100, y: 200, width: 400, height: 100, rotation: 45 },
      { x: 100, y: 200, width: 400, height: 100 },
    );

    expect(geometry.drawX).toBe(100);
    expect(geometry.drawY).toBe(200);
  });
});
