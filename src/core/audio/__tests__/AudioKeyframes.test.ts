import { describe, it, expect, beforeEach, vi } from "vitest";
import { AudioFXNodeChain, evaluateKeyframes } from "../AudioFXNodeChain";
import type { AudioKeyframe, Clip } from "@/types";

describe("Audio Keyframe Automation", () => {
  let mockCtx: any;

  beforeEach(() => {
    mockCtx = {
      currentTime: 10.0,
      state: "running",
      createGain: vi.fn(() => ({
        gain: {
          value: 1.0,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
          setValueCurveAtTime: vi.fn(),
          cancelScheduledValues: vi.fn(),
          setTargetAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      createBiquadFilter: vi.fn(() => ({
        type: "lowshelf",
        frequency: { value: 120 },
        gain: { value: 0, setValueAtTime: vi.fn() },
        Q: { value: 1.0 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      createStereoPanner: vi.fn(() => ({
        pan: { value: 0, setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      createDynamicsCompressor: vi.fn(() => ({
        threshold: { value: -24, setValueAtTime: vi.fn() },
        knee: { value: 0, setValueAtTime: vi.fn() },
        ratio: { value: 4, setValueAtTime: vi.fn() },
        attack: { value: 0.001, setValueAtTime: vi.fn() },
        release: { value: 0.05, setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      createBufferSource: vi.fn(() => ({
        buffer: null,
        playbackRate: { value: 1.0 },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      })),
      destination: {},
    };
  });

  describe("evaluateKeyframes mathematical interpolation", () => {
    const keyframes: AudioKeyframe[] = [
      { id: "kf-1", time: 2.0, gain: 0.2, easing: "linear" },
      { id: "kf-2", time: 4.0, gain: 1.0, easing: "linear" },
      { id: "kf-3", time: 6.0, gain: 0.5, easing: "exponential" },
      { id: "kf-4", time: 8.0, gain: 1.5, easing: "bezier" },
    ];

    it("returns default gain for empty keyframes", () => {
      expect(evaluateKeyframes([], 3.0, 0.8)).toBe(0.8);
    });

    it("clamps to first keyframe when before start", () => {
      expect(evaluateKeyframes(keyframes, 1.0)).toBe(0.2);
    });

    it("clamps to last keyframe when after end", () => {
      expect(evaluateKeyframes(keyframes, 10.0)).toBe(1.5);
    });

    it("interpolates linear segments correctly", () => {
      // Halfway between 2.0s (0.2) and 4.0s (1.0) is 3.0s => 0.6
      const midVal = evaluateKeyframes(keyframes, 3.0);
      expect(midVal).toBeCloseTo(0.6, 4);
    });

    it("interpolates exponential segments correctly", () => {
      // 4.0s (1.0) to 6.0s (0.5) at 5.0s (halfway) => 1.0 * (0.5/1.0)^0.5 = sqrt(0.5) ≈ 0.7071
      const expVal = evaluateKeyframes(keyframes, 5.0);
      expect(expVal).toBeCloseTo(Math.sqrt(0.5), 3);
    });

    it("interpolates bezier smoothstep segments correctly", () => {
      // 6.0s (0.5) to 8.0s (1.5) at 7.0s (t=0.5) => smooth = 3(0.25) - 2(0.125) = 0.5 => 1.0
      const bezierVal = evaluateKeyframes(keyframes, 7.0);
      expect(bezierVal).toBeCloseTo(1.0, 3);
    });
  });

  describe("AudioFXNodeChain Web Audio Scheduling", () => {
    it("schedules remaining future keyframes slaved to hardware audio clock", () => {
      const fxChain = new AudioFXNodeChain(mockCtx);
      const gainNode = (fxChain as any).gainNode;

      const clip: Clip = {
        id: "clip-1",
        trackId: "track-1",
        mediaId: "media-1",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        x: 0, y: 0, width: 100, height: 100, opacity: 1, rotation: 0,
        volume: 1.0,
        volumeKeyframes: [
          { id: "kf-1", time: 2.0, gain: 0.5, easing: "linear" },
          { id: "kf-2", time: 5.0, gain: 1.5, easing: "linear" },
          { id: "kf-3", time: 8.0, gain: 0.2, easing: "exponential" },
        ],
      };

      // Playhead starts at 1.0s into clip, AudioContext.currentTime is 10.0s
      fxChain.applyClipConfig(clip, 1.0, false, 1.0, false, 1.0, 10.0, 1.0);

      // Should cancel prior schedules
      expect(gainNode.gain.cancelScheduledValues).toHaveBeenCalledWith(10.0);

      // Should start with anti-click ramp to interpolated volume at 1.0s (gain = 0.5 because before first kf at 2.0s)
      expect(gainNode.gain.setValueAtTime).toHaveBeenCalledWith(0.0001, 10.0);
      expect(gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, 10.003);

      // Future keyframes:
      // kf-1 (time: 2.0s): delta = 2.0 - 1.0 = 1.0s => target audio time = 10.0 + 1.0 = 11.0s
      expect(gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, 11.0);

      // kf-2 (time: 5.0s): delta = 5.0 - 1.0 = 4.0s => target audio time = 10.0 + 4.0 = 14.0s
      expect(gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1.5, 14.0);

      // kf-3 (time: 8.0s, exponential): delta = 8.0 - 1.0 = 7.0s => target audio time = 10.0 + 7.0 = 17.0s
      expect(gainNode.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.2, 17.0);
    });

    it("applies varispeed scaling to keyframe target times", () => {
      const fxChain = new AudioFXNodeChain(mockCtx);
      const gainNode = (fxChain as any).gainNode;

      const clip: Clip = {
        id: "clip-speed",
        trackId: "track-1",
        mediaId: "media-1",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        x: 0, y: 0, width: 100, height: 100, opacity: 1, rotation: 0,
        volumeKeyframes: [
          { id: "kf-1", time: 4.0, gain: 1.2, easing: "linear" },
        ],
      };

      // Playhead at 0s, 2.0x playback speed, audioStartTime = 10.0
      fxChain.applyClipConfig(clip, 1.0, false, 1.0, false, 0.0, 10.0, 2.0);

      // Delta time = (4.0 - 0) / 2.0 = 2.0s => target audio time = 10.0 + 2.0 = 12.0s
      expect(gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1.2, 12.0);
    });
  });
});
