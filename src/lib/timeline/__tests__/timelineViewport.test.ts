import { describe, expect, it } from "vitest";
import { getFitSequencePixelsPerSecond, getScrollLeftToRevealTime } from "../timelineViewport";

describe("timeline viewport editing helpers", () => {
  it("fits the full sequence into the lane after subtracting labels", () => {
    expect(getFitSequencePixelsPerSecond(1160, 100, true)).toBe(10);
    expect(getFitSequencePixelsPerSecond(1160, 10_000, true)).toBe(0.1);
  });

  it("clamps extremely long sequence fit to the supported overview floor", () => {
    expect(getFitSequencePixelsPerSecond(1160, 10_000_000, true)).toBe(0.0001);
  });

  it("keeps visible edit points still and reveals offscreen edit points", () => {
    expect(
      getScrollLeftToRevealTime({
        time: 7,
        currentScrollLeft: 500,
        containerWidth: 1160,
        pixelsPerSecond: 100,
        viewportEndSeconds: 100,
        hasClips: true,
      }),
    ).toBe(500);

    expect(
      getScrollLeftToRevealTime({
        time: 50,
        currentScrollLeft: 0,
        containerWidth: 1160,
        pixelsPerSecond: 100,
        viewportEndSeconds: 100,
        hasClips: true,
      }),
    ).toBe(4150);
  });
});
