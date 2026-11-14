import { describe, it, expect } from "vitest";
import { isValidFrameRate, SUPPORTED_FRAME_RATES } from "../settingsTypes";

describe("isValidFrameRate", () => {
  it("accepts all 7 supported frame rates", () => {
    for (const fps of SUPPORTED_FRAME_RATES) {
      expect(isValidFrameRate(fps)).toBe(true);
    }
  });

  it.each([
    [0],
    [-1],
    [999],
    [23.975],
    [NaN],
    [null],
    [undefined],
    [""],
  ])("rejects %s", (v) => {
    expect(isValidFrameRate(v)).toBe(false);
  });
});
