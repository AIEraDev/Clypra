import { describe, expect, it } from "vitest";
import { getEnvelopeVolume, getKeyframedVolume } from "../VolumeWaveform";

describe("VolumeWaveform envelope", () => {
  it("scales the wave height with the vertical clip volume", () => {
    expect(getEnvelopeVolume(2, 4, 1, [], 0, 0)).toBe(1);
    expect(getEnvelopeVolume(2, 4, 0.5, [], 0, 0)).toBe(0.5);
  });

  it("follows volume keyframes and fades across the clip", () => {
    const keyframes = [
      { id: "quiet", time: 0, gain: 0.25 },
      { id: "loud", time: 4, gain: 1 },
    ] as const;

    expect(getKeyframedVolume([...keyframes], 2, 1)).toBeCloseTo(0.625);
    expect(getEnvelopeVolume(2, 4, 1, [...keyframes], 0, 4)).toBeCloseTo(
      0.3125,
    );
  });
});
