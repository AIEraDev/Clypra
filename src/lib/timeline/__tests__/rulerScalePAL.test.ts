import { describe, it, expect } from "vitest";
import { getTimelineRulerScale } from "../rulerScale";

describe("getTimelineRulerScale — PAL and broadcast rates", () => {
  it.each([
    [100, 25],
    [100, 50],
    [100, 23.976],
    [100, 29.97],
  ])("returns finite intervals for pixelsPerSecond=%i frameRate=%s", (pps, fps) => {
    const scale = getTimelineRulerScale(pps, fps);
    expect(Number.isFinite(scale.majorIntervalSeconds)).toBe(true);
    expect(Number.isNaN(scale.majorIntervalSeconds)).toBe(false);
    expect(Number.isFinite(scale.minorIntervalSeconds)).toBe(true);
    expect(Number.isNaN(scale.minorIntervalSeconds)).toBe(false);
    expect(scale.majorIntervalSeconds).toBeGreaterThan(0);
    expect(scale.minorIntervalSeconds).toBeGreaterThan(0);
  });
});
