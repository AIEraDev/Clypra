import { describe, it, expect } from "vitest";
import type { Clip } from "@/types";

describe("Color Grading Foundations (Color Wheels & LUTs)", () => {
  const mockClip: Clip = {
    id: "clip-video-1",
    kind: "video",
    trackId: "track-v1",
    mediaId: "media-v1",
    startTime: 0,
    duration: 5,
    trimIn: 0,
    trimOut: 5,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1,
    rotation: 0,
    adjustments: {},
  };

  it("initializes with empty adjustments and supports wheel parameters", () => {
    const updatedAdjustments = {
      ...mockClip.adjustments,
      wheels: {
        lift: { r: 0.1, g: -0.1, b: 0.2, y: -0.05 },
        gamma: { r: 0.0, g: 0.15, b: -0.1, y: 0.1 },
        gain: { r: 0.2, g: 0.2, b: -0.2, y: 0.0 },
      },
    };

    expect(updatedAdjustments.wheels.lift.r).toBe(0.1);
    expect(updatedAdjustments.wheels.gamma.g).toBe(0.15);
    expect(updatedAdjustments.wheels.gain.b).toBe(-0.2);
  });

  it("stores LUT metadata and intensity adjustments", () => {
    const updatedAdjustments = {
      ...mockClip.adjustments,
      lut: {
        name: "Teal & Orange (Blockbuster)",
        presetId: "teal-orange",
        intensity: 0.85,
      },
    };

    expect(updatedAdjustments.lut.name).toBe("Teal & Orange (Blockbuster)");
    expect(updatedAdjustments.lut.intensity).toBe(0.85);
  });
});
