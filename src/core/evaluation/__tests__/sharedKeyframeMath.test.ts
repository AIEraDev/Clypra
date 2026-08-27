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
});
