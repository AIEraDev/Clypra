import { describe, expect, it } from "vitest";
import {
  formatTimelineRulerLabel,
  getTimelineRulerScale,
} from "../rulerScale";

const timecode = (seconds: number) =>
  `tc:${Math.round(seconds * 1000) / 1000}`;

describe("timeline ruler scale", () => {
  it("uses integral frame labels at close zoom", () => {
    const scale = getTimelineRulerScale(500, 30);

    expect(scale).toMatchObject({
      majorIntervalSeconds: 5 / 30,
      minorIntervalSeconds: 1 / 30,
      labelMode: "frames",
    });
    expect(
      formatTimelineRulerLabel(5 / 30, 30, scale.labelMode, timecode),
    ).toBe("5f");
  });

  it("promotes labels through readable second intervals as zooms out", () => {
    expect(getTimelineRulerScale(100, 30)).toMatchObject({
      majorIntervalSeconds: 1,
      labelMode: "timecode",
    });
    expect(getTimelineRulerScale(50, 30)).toMatchObject({
      majorIntervalSeconds: 2,
      labelMode: "timecode",
    });
    expect(getTimelineRulerScale(10, 30)).toMatchObject({
      majorIntervalSeconds: 10,
      labelMode: "timecode",
    });
  });

  it("keeps frame labels frame-accurate for non-30fps sequences", () => {
    const scale = getTimelineRulerScale(400, 24);

    expect(scale.majorIntervalSeconds).toBeCloseTo(5 / 24);
    expect(scale.minorIntervalSeconds).toBeCloseTo(1 / 24);
    expect(scale.labelMode).toBe("frames");
    expect(
      formatTimelineRulerLabel(5 / 24, 24, scale.labelMode, timecode),
    ).toBe("5f");
  });
});
