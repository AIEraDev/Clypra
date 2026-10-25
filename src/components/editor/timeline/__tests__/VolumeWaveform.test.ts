import { describe, expect, it } from "vitest";
import {
  getEnvelopeVolume,
  getKeyframedVolume,
  getWaveformPipeGeometry,
} from "../VolumeWaveform";

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

  it("draws audio pipes symmetrically around the lane centre when alignment is center", () => {
    const geometry = getWaveformPipeGeometry(1, 0.4, 1, 1, 20, "center");

    expect(geometry).not.toBeNull();
    expect(geometry!.top + geometry!.height / 2).toBeCloseTo(10);
    expect(geometry!.height).toBeGreaterThan(1);
  });

  it("defaults to bottom alignment anchoring pipes to the bottom edge", () => {
    const height = 16;
    const geometry = getWaveformPipeGeometry(1, 0.8, 1, 1, height);

    expect(geometry).not.toBeNull();
    expect(geometry!.top + geometry!.height).toBe(height - 1);
  });

  it("anchors audio pipes to the bottom lane edge when alignment is bottom", () => {
    const height = 40;
    const geometry = getWaveformPipeGeometry(1, 0.8, 1, 1, height, "bottom");

    expect(geometry).not.toBeNull();
    expect(geometry!.height).toBeLessThanOrEqual(height * 0.65 + 1);
    expect(geometry!.top + geometry!.height).toBe(height - 1);
  });

  it("does not draw audio pipes when the envelope is silent", () => {
    expect(getWaveformPipeGeometry(1, 1, 1, 0, 20)).toBeNull();
  });

  it("retains minimum body height for quiet passages when volume is active", () => {
    const geometry = getWaveformPipeGeometry(0.01, 0.005, 1, 1, 20, "bottom");
    expect(geometry).not.toBeNull();
    expect(geometry!.height).toBeGreaterThanOrEqual(1.25);
  });

  it("respects maxHeightFraction override when provided", () => {
    const geometry = getWaveformPipeGeometry(1, 1, 1, 1, 100, "bottom", 0.85);
    expect(geometry).not.toBeNull();
    expect(geometry!.height).toBeCloseTo(85);
  });
});
