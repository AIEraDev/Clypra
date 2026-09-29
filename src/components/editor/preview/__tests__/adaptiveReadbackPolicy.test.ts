import { describe, expect, it, vi } from "vitest";
import {
  AdaptiveReadbackPolicy,
  defaultEmbeddedReadbackLimit,
} from "../adaptiveReadbackPolicy";

describe("AdaptiveReadbackPolicy", () => {
  it("reduces the embedded readback size after sustained over-budget transfers", () => {
    const policy = new AdaptiveReadbackPolicy(960);

    policy.recordReadback(18);
    policy.recordReadback(20);
    policy.recordReadback(24);

    expect(policy.maxDimension).toBe(840);
    expect(policy.cap({ width: 1080, height: 1920 })).toEqual({
      width: 472,
      height: 840,
    });
  });

  it("recovers quality only after a long stable interval", () => {
    const policy = new AdaptiveReadbackPolicy(960);
    for (let index = 0; index < 3; index += 1) policy.recordReadback(20);
    expect(policy.maxDimension).toBe(840);

    for (let index = 0; index < 89; index += 1) policy.recordReadback(6);
    expect(policy.maxDimension).toBe(840);
    policy.recordReadback(6);
    expect(policy.maxDimension).toBe(960);
  });

  it("paces fallback playback by its current quality tier", () => {
    vi.spyOn(performance, "now").mockReturnValue(100);
    const policy = new AdaptiveReadbackPolicy(720);

    policy.markPlaybackDispatch();
    expect(policy.canDispatchPlayback(140)).toBe(false);
    expect(policy.canDispatchPlayback(142)).toBe(true);
    vi.restoreAllMocks();
  });

  it("starts embedded Windows playback at a bounded bridge proxy", () => {
    const userAgent = Object.getOwnPropertyDescriptor(navigator, "userAgent");
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });

    expect(defaultEmbeddedReadbackLimit()).toBe(480);

    if (userAgent) Object.defineProperty(navigator, "userAgent", userAgent);
  });

  it("uses a 10fps safety cadence at the smallest bridge tier", () => {
    const policy = new AdaptiveReadbackPolicy(320);
    policy.markPlaybackDispatch(100);
    expect(policy.canDispatchPlayback(199)).toBe(false);
    expect(policy.canDispatchPlayback(200)).toBe(true);
  });

  it("keeps CPU-readback work bounded in wall-clock time at 2x", () => {
    const policy = new AdaptiveReadbackPolicy(480);

    expect(policy.presentationAt(2, 30)).toEqual({
      cadenceFps: 20,
      sourceFramesPerPresentation: 3,
    });
    expect(policy.presentationAt(1.5, 30)).toEqual({
      cadenceFps: 20,
      sourceFramesPerPresentation: 3,
    });
  });
});
