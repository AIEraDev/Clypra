import { describe, expect, it } from "vitest";
import { getFilmstripRenderWindow } from "../filmstripLayout";

describe("getFilmstripRenderWindow", () => {
  it("keeps the raster surface bounded at deep zoom", () => {
    const window = getFilmstripRenderWindow({
      clipStartTime: 0,
      clipWidthPx: 35_600,
      trimIn: 0,
      trimOut: 89,
      viewportScrollLeft: 20_000,
      viewportWidth: 2_200,
      pixelsPerSecond: 400,
    });

    expect(window.isVisible).toBe(true);
    expect(window.leftPx).toBe(18_900);
    expect(window.widthPx).toBe(4_400);
    expect(window.trimIn).toBeCloseTo(47.25, 5);
    expect(window.trimOut).toBeCloseTo(58.25, 5);
  });

  it("moves the bounded surface when the viewport scrolls", () => {
    const first = getFilmstripRenderWindow({
      clipStartTime: 0,
      clipWidthPx: 10_000,
      trimIn: 0,
      trimOut: 100,
      viewportScrollLeft: 0,
      viewportWidth: 1_000,
      pixelsPerSecond: 100,
    });
    const second = getFilmstripRenderWindow({
      clipStartTime: 0,
      clipWidthPx: 10_000,
      trimIn: 0,
      trimOut: 100,
      viewportScrollLeft: 2_000,
      viewportWidth: 1_000,
      pixelsPerSecond: 100,
    });

    expect(second.leftPx).toBeGreaterThan(first.leftPx);
    expect(second.trimIn).toBeGreaterThan(first.trimIn);
  });
});
