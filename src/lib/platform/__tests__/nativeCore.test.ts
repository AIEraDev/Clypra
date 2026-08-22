import { describe, expect, it } from "vitest";
import { DEFAULT_NATIVE_COLOR_POLICY, frameIndexToNativeTime, secondsToNativeTime } from "../nativeCore";

describe("native core contracts", () => {
  it("converts time to integral microsecond ticks", () => {
    expect(secondsToNativeTime(1.25, 38)).toEqual({
      frameIndex: 38,
      ticks: 1_250_000,
      timescale: 1_000_000,
    });
  });

  it("maps frame indices deterministically", () => {
    expect(frameIndexToNativeTime(30, 30)).toEqual({
      frameIndex: 30,
      ticks: 1_000_000,
      timescale: 1_000_000,
    });
  });

  it("defaults editing output to linear Rec.709 math and SDR presentation", () => {
    expect(DEFAULT_NATIVE_COLOR_POLICY).toMatchObject({
      workingSpace: "linear-rec709",
      outputFormat: "rgba8Srgb",
      toneMapHdrToSdr: true,
    });
  });
});
