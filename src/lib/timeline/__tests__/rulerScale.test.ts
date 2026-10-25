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

  it("selects 2-frame major interval with 1-frame minor ticks at deepest zoom (CapCut parity)", () => {
    const scale = getTimelineRulerScale(1000, 30);

    expect(scale).toMatchObject({
      majorIntervalSeconds: 2 / 30,
      minorIntervalSeconds: 1 / 30,
      labelMode: "frames",
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
