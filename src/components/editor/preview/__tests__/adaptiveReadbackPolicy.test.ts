import { describe, expect, it, vi } from "vitest";
import { AdaptiveReadbackPolicy } from "../adaptiveReadbackPolicy";

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
});
