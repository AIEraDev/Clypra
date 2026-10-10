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

  it("recovers quality only after a stable interval (30 samples)", () => {
    const policy = new AdaptiveReadbackPolicy(960);
    for (let index = 0; index < 3; index += 1) policy.recordReadback(20);
    expect(policy.maxDimension).toBe(840);

    // Bug 4 fix: recovery threshold is 30 samples (~500ms at 60fps)
    for (let index = 0; index < 29; index += 1) policy.recordReadback(6);
    expect(policy.maxDimension).toBe(840);
    policy.recordReadback(6);
    expect(policy.maxDimension).toBe(960);
  });

  it("paces fallback playback by its current quality tier", () => {
    vi.spyOn(performance, "now").mockReturnValue(100);
    const policy = new AdaptiveReadbackPolicy(720);

    // Tier 720 (tier 3) targetCadenceFps is 30fps (interval ~33.3ms)
    policy.markPlaybackDispatch(100);
    expect(policy.canDispatchPlayback(133)).toBe(false);
    expect(policy.canDispatchPlayback(134)).toBe(true);
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

  it("uses a 15fps safety cadence at the smallest bridge tier", () => {
    // Bug 4 fix: tier 0 (320px) safety cadence was raised from 10fps to 15fps (interval ~66.7ms)
    const policy = new AdaptiveReadbackPolicy(320);
    policy.markPlaybackDispatch(100);
    expect(policy.canDispatchPlayback(166)).toBe(false);
    expect(policy.canDispatchPlayback(167)).toBe(true);
  });

  it("keeps CPU-readback work bounded in wall-clock time at 2x", () => {
    // Bug 4 fix: tier 1 (480px, Windows default) cadence was raised from 20fps to 24fps
    const policy = new AdaptiveReadbackPolicy(480);

    expect(policy.presentationAt(2, 30)).toEqual({
      cadenceFps: 24,
      sourceFramesPerPresentation: 3,
    });
    expect(policy.presentationAt(1.5, 30)).toEqual({
      cadenceFps: 24,
      sourceFramesPerPresentation: 2,
    });
  });
});
