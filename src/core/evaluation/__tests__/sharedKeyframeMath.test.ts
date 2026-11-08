import { describe, expect, it } from "vitest";
import { evaluateNumericKeyframes, evaluateVisualPropertyKeyframes } from "../animation";
import { evaluateAudioKeyframes } from "@/core/audio/effectiveAudioState";

describe("shared audio/visual keyframe math", () => {
  it("uses the same cubic-bezier solver for visual and audio easing", () => {
    const controlPoints: [number, number, number, number] = [0.2, 0.1, 0.8, 0.9];
    const visual = evaluateVisualPropertyKeyframes([
      { id: "visual-a", time: 0, value: 0, easing: "bezier", controlPoints },
      { id: "visual-b", time: 1, value: 100, easing: "linear" },
    ], 0.35, 0);
    const numeric = evaluateNumericKeyframes([
      { time: 0, value: 0, easing: "bezier", controlPoints },
      { time: 1, value: 100, easing: "linear" },
    ], 0.35, 0);

    expect(visual).toBe(numeric);
  });

  it("keeps audio's right-keyframe convention while sharing interpolation math", () => {
    const audio = evaluateAudioKeyframes([
      { id: "audio-a", time: 0, gain: 0, easing: "linear" },
      { id: "audio-b", time: 1, gain: 1, easing: "exponential" },
    ], 0.5);
    const numeric = evaluateNumericKeyframes([
      { time: 0, value: 0, easing: "linear" },
      { time: 1, value: 1, easing: "exponential" },
    ], 0.5, 1, { easingSide: "right" });

    expect(audio).toBe(numeric);
  });

  it("verifies generic Keyframe<number> contract compatibility", () => {
    const genericKeyframes: import("@/types").Keyframe<number>[] = [
      { id: "kf-1", time: 0, value: 10, easing: "easeIn" },
      { id: "kf-2", time: 2, value: 50, easing: "easeOut" },
    ];
    const evaluated = evaluateNumericKeyframes(genericKeyframes, 1.0, 0);
    expect(evaluated).toBeGreaterThan(10);
    expect(evaluated).toBeLessThan(50);
  });

  it("recovers from degenerate keyframe tracks where all keyframes have time <= 0", () => {
    const degenerateKeyframes = [
      { id: "kf-1", time: 0, value: -1815, easing: "easeOut" as const },
      { id: "kf-2", time: 0, value: 0, easing: "linear" as const },
    ];
    // At t=0, starts at initial value
    expect(evaluateVisualPropertyKeyframes(degenerateKeyframes, 0, 0)).toBe(-1815);
    // At t=0.25 (half of 0.5s default), interpolating between -1815 and 0
    const mid = evaluateVisualPropertyKeyframes(degenerateKeyframes, 0.25, 0);
    expect(mid).toBeGreaterThan(-1815);
    expect(mid).toBeLessThan(0);
    // At t=0.5 (end of fallback span), settled at target value
    expect(evaluateVisualPropertyKeyframes(degenerateKeyframes, 0.5, 0)).toBe(0);
  });
});
