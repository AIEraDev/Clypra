import { describe, expect, it } from "vitest";
import {
  formatTimelineRulerLabel,
  getTimelineRulerScale,
} from "../rulerScale";

const timecode = (seconds: number) =>
  `tc:${Math.round(seconds * 1000) / 1000}`;

describe("timeline ruler scale", () => {
  it("uses integral frame labels at close zoom", () => {
    const scale = getTimelineRulerScale(600, 30);

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
    const scale = getTimelineRulerScale(480, 24);

    expect(scale.majorIntervalSeconds).toBeCloseTo(5 / 24);
    expect(scale.minorIntervalSeconds).toBeCloseTo(1 / 24);
    expect(scale.labelMode).toBe("frames");
    expect(
      formatTimelineRulerLabel(5 / 24, 24, scale.labelMode, timecode),
    ).toBe("5f");
  });

  it("selects 2-frame major interval with 1-frame minor ticks at deepest zoom (CapCut parity)", () => {
    const scale = getTimelineRulerScale(1500, 30);

    expect(scale).toMatchObject({
      majorIntervalSeconds: 2 / 30,
      minorIntervalSeconds: 1 / 30,
      labelMode: "frames",
    });
  });

  it("asserts reference screenshot cadences at 30 fps (R1/R2 parity)", () => {
    // Screenshot 3: 1,110 pps -> 3f major / 1f minor
    expect(getTimelineRulerScale(1110, 30)).toMatchObject({
      majorIntervalSeconds: 3 / 30,
      minorIntervalSeconds: 1 / 30,
      labelMode: "frames",
    });

    // Screenshot 4: 1,549 pps -> 2f major / 1f minor
    expect(getTimelineRulerScale(1549, 30)).toMatchObject({
      majorIntervalSeconds: 2 / 30,
      minorIntervalSeconds: 1 / 30,
      labelMode: "frames",
    });

    // Screenshot 2: 2,449 pps -> 2f major / 1f minor
    expect(getTimelineRulerScale(2449, 30)).toMatchObject({
      majorIntervalSeconds: 2 / 30,
      minorIntervalSeconds: 1 / 30,
      labelMode: "frames",
    });

    // Screenshot 1 (deepest): 6,000 pps -> 2f major / 1f minor
    expect(getTimelineRulerScale(6000, 30)).toMatchObject({
      majorIntervalSeconds: 2 / 30,
      minorIntervalSeconds: 1 / 30,
      labelMode: "frames",
    });
  });

  it("asserts equivalent cadences for 24 fps and 60 fps", () => {
    // 24 fps: 2f threshold is 90 * 12 = 1080 pps
    expect(getTimelineRulerScale(6000, 24)).toMatchObject({
      majorIntervalSeconds: 2 / 24,
      minorIntervalSeconds: 1 / 24,
      labelMode: "frames",
    });
    expect(getTimelineRulerScale(1549, 24)).toMatchObject({
      majorIntervalSeconds: 2 / 24,
      minorIntervalSeconds: 1 / 24,
      labelMode: "frames",
    });
    expect(getTimelineRulerScale(1110, 24)).toMatchObject({
      majorIntervalSeconds: 2 / 24,
      minorIntervalSeconds: 1 / 24,
      labelMode: "frames",
    });
    expect(getTimelineRulerScale(800, 24)).toMatchObject({
      majorIntervalSeconds: 3 / 24,
      minorIntervalSeconds: 1 / 24,
      labelMode: "frames",
    });

    // 60 fps: 2f threshold is 90 * 30 = 2700 pps, 3f threshold is 90 * 20 = 1800 pps
    expect(getTimelineRulerScale(6000, 60)).toMatchObject({
      majorIntervalSeconds: 2 / 60,
      minorIntervalSeconds: 1 / 60,
      labelMode: "frames",
    });
    expect(getTimelineRulerScale(2449, 60)).toMatchObject({
      majorIntervalSeconds: 3 / 60,
      minorIntervalSeconds: 1 / 60,
      labelMode: "frames",
    });
    expect(getTimelineRulerScale(1549, 60)).toMatchObject({
      majorIntervalSeconds: 5 / 60,
      minorIntervalSeconds: 1 / 60,
      labelMode: "frames",
    });
    expect(getTimelineRulerScale(1110, 60)).toMatchObject({
      majorIntervalSeconds: 5 / 60,
      minorIntervalSeconds: 1 / 60,
      labelMode: "frames",
    });
  });

  it("verifies threshold stability without hysteresis or flipping at +/-1 px/s around switch points", () => {
    // 2f <-> 3f switch at 1350 pps (30 fps)
    expect(getTimelineRulerScale(1351, 30).majorIntervalSeconds).toBeCloseTo(2 / 30);
    expect(getTimelineRulerScale(1350, 30).majorIntervalSeconds).toBeCloseTo(2 / 30);
    expect(getTimelineRulerScale(1349, 30).majorIntervalSeconds).toBeCloseTo(3 / 30);

    // 3f <-> 5f switch at 900 pps (30 fps)
    expect(getTimelineRulerScale(901, 30).majorIntervalSeconds).toBeCloseTo(3 / 30);
    expect(getTimelineRulerScale(900, 30).majorIntervalSeconds).toBeCloseTo(3 / 30);
    expect(getTimelineRulerScale(899, 30).majorIntervalSeconds).toBeCloseTo(5 / 30);

    // 5f <-> 10f switch at 540 pps (30 fps)
    expect(getTimelineRulerScale(541, 30).majorIntervalSeconds).toBeCloseTo(5 / 30);
    expect(getTimelineRulerScale(540, 30).majorIntervalSeconds).toBeCloseTo(5 / 30);
    expect(getTimelineRulerScale(539, 30).majorIntervalSeconds).toBeCloseTo(10 / 30);

    // 10f <-> 15f switch at 270 pps (30 fps)
    expect(getTimelineRulerScale(271, 30).majorIntervalSeconds).toBeCloseTo(10 / 30);
    expect(getTimelineRulerScale(270, 30).majorIntervalSeconds).toBeCloseTo(10 / 30);
    expect(getTimelineRulerScale(269, 30).majorIntervalSeconds).toBeCloseTo(15 / 30);

    // 15f <-> 1s switch at 180 pps (30 fps)
    expect(getTimelineRulerScale(181, 30)).toMatchObject({
      majorIntervalSeconds: 15 / 30,
      labelMode: "frames",
    });
    expect(getTimelineRulerScale(180, 30)).toMatchObject({
      majorIntervalSeconds: 15 / 30,
      labelMode: "frames",
    });
    expect(getTimelineRulerScale(179, 30)).toMatchObject({
      majorIntervalSeconds: 1,
      labelMode: "timecode",
    });
  });

  it("selects overview cadences at fitted / low zoom levels", () => {
    // 4.2 px/s -> 30s major interval
    expect(getTimelineRulerScale(4.2, 30)).toMatchObject({
      majorIntervalSeconds: 30,
      minorIntervalSeconds: 5,
      labelMode: "timecode",
    });

    // 2.0 px/s -> 60s major interval
    expect(getTimelineRulerScale(2.0, 30)).toMatchObject({
      majorIntervalSeconds: 60,
      minorIntervalSeconds: 10,
      labelMode: "timecode",
    });
  });

  it("formats second boundaries as timecode and intra-second ticks as frame offsets (CapCut parity)", () => {
    const mockFormatTimecode = (seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    };

    const fps = 30;

    // At exact 28.00s boundary: displays timecode "00:28" (Image 3)
    expect(formatTimelineRulerLabel(28.0, fps, "frames", mockFormatTimecode)).toBe("00:28");

    // Intra-second frame ticks (Images 1 & 3): displays relative frame offset
    expect(formatTimelineRulerLabel(28.0 + 2 / fps, fps, "frames", mockFormatTimecode)).toBe("2f");
    expect(formatTimelineRulerLabel(28.0 + 4 / fps, fps, "frames", mockFormatTimecode)).toBe("4f");
    expect(formatTimelineRulerLabel(28.0 + 6 / fps, fps, "frames", mockFormatTimecode)).toBe("6f");
    expect(formatTimelineRulerLabel(28.0 + 8 / fps, fps, "frames", mockFormatTimecode)).toBe("8f");
    expect(formatTimelineRulerLabel(28.0 + 10 / fps, fps, "frames", mockFormatTimecode)).toBe("10f");

    // Next second rollover: displays timecode "00:29"
    expect(formatTimelineRulerLabel(29.0, fps, "frames", mockFormatTimecode)).toBe("00:29");

    // And continues within next second
    expect(formatTimelineRulerLabel(29.0 + 2 / fps, fps, "frames", mockFormatTimecode)).toBe("2f");
  });

  it("handles minute rollovers cleanly in frame mode", () => {
    const mockFormatTimecode = (seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    };

    const fps = 30;
    // 59s + 28f
    expect(formatTimelineRulerLabel(59.0 + 28 / fps, fps, "frames", mockFormatTimecode)).toBe("28f");
    // 60s (1m:00s boundary)
    expect(formatTimelineRulerLabel(60.0, fps, "frames", mockFormatTimecode)).toBe("01:00");
    // 60s + 2f
    expect(formatTimelineRulerLabel(60.0 + 2 / fps, fps, "frames", mockFormatTimecode)).toBe("2f");
  });
});
