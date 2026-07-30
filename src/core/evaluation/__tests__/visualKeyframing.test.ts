import { describe, it, expect } from "vitest";
import { evaluateVisualPropertyKeyframes } from "../animation";
import type { VisualPropertyKeyframe } from "@/types";

describe("Visual Property Keyframing & Easing Engine", () => {
  it("returns default value when no keyframes exist", () => {
    const val = evaluateVisualPropertyKeyframes([], 2.0, 100);
    expect(val).toBe(100);
  });

  it("interpolates linearly between keyframes", () => {
    const keyframes: VisualPropertyKeyframe[] = [
      { id: "kf-1", time: 1.0, value: 0, easing: "linear" },
      { id: "kf-2", time: 3.0, value: 180, easing: "linear" },
    ];

    expect(evaluateVisualPropertyKeyframes(keyframes, 1.0, 0)).toBe(0);
    expect(evaluateVisualPropertyKeyframes(keyframes, 2.0, 0)).toBe(90);
    expect(evaluateVisualPropertyKeyframes(keyframes, 3.0, 0)).toBe(180);
  });

  it("applies cubic bezier easing curves to keyframe progress", () => {
    const keyframes: VisualPropertyKeyframe[] = [
      { id: "kf-1", time: 0.0, value: 0, easing: "easeInOut" },
      { id: "kf-2", time: 2.0, value: 100, easing: "easeInOut" },
    ];

    const midVal = evaluateVisualPropertyKeyframes(keyframes, 1.0, 0);
    // At t=0.5 normalized progress, easeInOut stays smooth at ~50
    expect(midVal).toBeGreaterThan(45);
    expect(midVal).toBeLessThan(55);
  });

  it("clamps values outside keyframe time range", () => {
    const keyframes: VisualPropertyKeyframe[] = [
      { id: "kf-1", time: 1.0, value: 10, easing: "linear" },
      { id: "kf-2", time: 5.0, value: 50, easing: "linear" },
    ];

    expect(evaluateVisualPropertyKeyframes(keyframes, 0.5, 0)).toBe(10);
    expect(evaluateVisualPropertyKeyframes(keyframes, 6.0, 0)).toBe(50);
  });
});
