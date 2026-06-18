import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimelineEffectSection, getEffectIntensityPercent } from "../TimelineEffectSection";
import type { Clip } from "@/types";

const baseEffectClip: Clip = {
  id: "effect-1",
  kind: "video-effect",
  name: "Glow",
  trackId: "track-1",
  mediaId: "glow",
  startTime: 0,
  duration: 5,
  trimIn: 0,
  trimOut: 5,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  opacity: 1,
  rotation: 0,
};

describe("TimelineEffectSection", () => {
  it("normalizes canonical and legacy intensity values", () => {
    expect(getEffectIntensityPercent(0.8)).toBe(80);
    expect(getEffectIntensityPercent(80)).toBe(80);
    expect(getEffectIntensityPercent(200)).toBe(100);
    expect(getEffectIntensityPercent(-1)).toBe(0);
  });

  it("writes timeline effect intensity in canonical 0..1 form", () => {
    const handleUpdate = vi.fn();

    render(<TimelineEffectSection selectedClip={{ ...baseEffectClip, intensity: 0.8 } as Clip} handleUpdate={handleUpdate} />);

    const intensityInput = screen.getByRole("spinbutton");
    expect((intensityInput as HTMLInputElement).value).toBe("80");

    fireEvent.change(intensityInput, { target: { value: "35" } });

    expect(handleUpdate).toHaveBeenCalledWith("intensity", 0.35);
  });
});
