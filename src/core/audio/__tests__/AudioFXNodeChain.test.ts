import { describe, it, expect, beforeEach, vi } from "vitest";
import { AudioFXNodeChain } from "../AudioFXNodeChain";
import type { Clip } from "@/types";

describe("AudioFXNodeChain", () => {
  let mockCtx: any;
  let mockGainNode: any;
  let mockEqLow: any;
  let mockEqMid: any;
  let mockEqHigh: any;
  let mockPannerNode: any;
  let mockCompressorNode: any;

  const createMockAudioParam = (initialValue: number = 0) => ({
    value: initialValue,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setValueCurveAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  });

  beforeEach(() => {
    mockGainNode = {
      gain: createMockAudioParam(1),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    mockEqLow = {
      type: "lowshelf",
      frequency: createMockAudioParam(120),
      gain: createMockAudioParam(0),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    mockEqMid = {
      type: "peaking",
      frequency: createMockAudioParam(1000),
      Q: createMockAudioParam(1.0),
      gain: createMockAudioParam(0),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    mockEqHigh = {
      type: "highshelf",
      frequency: createMockAudioParam(4500),
      gain: createMockAudioParam(0),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    mockPannerNode = {
      pan: createMockAudioParam(0),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    mockCompressorNode = {
      threshold: createMockAudioParam(-24),
      ratio: createMockAudioParam(4),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    let biquadIndex = 0;
    mockCtx = {
      currentTime: 10.0,
      createGain: vi.fn().mockReturnValue(mockGainNode),
      createBiquadFilter: vi.fn().mockImplementation(() => {
        biquadIndex++;
        if (biquadIndex === 1) return mockEqLow;
        if (biquadIndex === 2) return mockEqMid;
        return mockEqHigh;
      }),
      createStereoPanner: vi.fn().mockReturnValue(mockPannerNode),
      createDynamicsCompressor: vi.fn().mockReturnValue(mockCompressorNode),
    };
  });

  it("constructs full DSP graph (EQ -> Panner -> Gain)", () => {
    const chain = new AudioFXNodeChain(mockCtx);

    expect(chain.inputNode).toBe(mockEqLow);
    expect(chain.outputNode).toBe(mockGainNode);
    expect(mockEqLow.connect).toHaveBeenCalledWith(mockEqMid);
    expect(mockEqMid.connect).toHaveBeenCalledWith(mockEqHigh);
    expect(mockEqHigh.connect).toHaveBeenCalledWith(mockPannerNode);
    expect(mockPannerNode.connect).toHaveBeenCalledWith(mockGainNode);
  });

  it("applies EQ and Panner settings from Clip audioFX config", () => {
    const chain = new AudioFXNodeChain(mockCtx);

    const clip: Clip = {
      id: "clip-1",
      trackId: "track-1",
      mediaId: "media-1",
      startTime: 0,
      duration: 10,
      trimIn: 0,
      trimOut: 10,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      volume: 0.8,
      audioFX: {
        eq: { low: 3, mid: -2, high: 4 },
        pan: -0.5,
      },
    };

    chain.applyClipConfig(clip, 1.0, false, 1.0, false, 0, 10.0);

    expect(mockEqLow.gain.setValueAtTime).toHaveBeenCalledWith(3, 10.0);
    expect(mockEqMid.gain.setValueAtTime).toHaveBeenCalledWith(-2, 10.0);
    expect(mockEqHigh.gain.setValueAtTime).toHaveBeenCalledWith(4, 10.0);
    expect(mockPannerNode.pan.setValueAtTime).toHaveBeenCalledWith(-0.5, 10.0);
  });

  it("applies anti-click attack micro-fade and combined volume", () => {
    const chain = new AudioFXNodeChain(mockCtx);

    const clip: Clip = {
      id: "clip-1",
      trackId: "track-1",
      mediaId: "media-1",
      startTime: 0,
      duration: 10,
      trimIn: 0,
      trimOut: 10,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      volume: 0.5,
    };

    // Clip volume (0.5) * Track volume (0.8) * Master volume (0.5) = 0.20
    chain.applyClipConfig(clip, 0.8, false, 0.5, false, 0, 10.0);

    expect(mockGainNode.gain.cancelScheduledValues).toHaveBeenCalledWith(10.0);
    expect(mockGainNode.gain.setValueAtTime).toHaveBeenCalledWith(0.0001, 10.0);
    expect(mockGainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.2, 10.003);
  });

  it("schedules Fade-In and Fade-Out curves accurately", () => {
    const chain = new AudioFXNodeChain(mockCtx);

    const clip: Clip = {
      id: "clip-1",
      trackId: "track-1",
      mediaId: "media-1",
      startTime: 5.0,
      duration: 10.0,
      trimIn: 0,
      trimOut: 10,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      volume: 1.0,
      fadeIn: 2.0,
      fadeOut: 2.0,
      fadeInCurve: "linear",
      fadeOutCurve: "exponential",
    };

    // Playhead is at startTime (5.0s on timeline, 10.0s on AudioContext clock)
    chain.applyClipConfig(clip, 1.0, false, 1.0, false, 5.0, 10.0);

    // Fade in: from 10.0s to 12.0s
    expect(mockGainNode.gain.setValueAtTime).toHaveBeenCalledWith(0.0001, 10.0);
    expect(mockGainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1.0, 12.0);

    // Fade out: starts at 10.0 + (10 - 2) = 18.0s, ends at 10.0 + 10 = 20.0s
    expect(mockGainNode.gain.setValueAtTime).toHaveBeenCalledWith(1.0, 18.0);
    expect(mockGainNode.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.0001, 20.0);
  });

  it("releases and disconnects all DSP nodes with a micro-fade", async () => {
    vi.useFakeTimers();
    const chain = new AudioFXNodeChain(mockCtx);

    const releasePromise = chain.releaseAndDisconnect(0.003);

    expect(mockGainNode.gain.cancelScheduledValues).toHaveBeenCalledWith(10.0);
    expect(mockGainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.0001, 10.003);

    vi.advanceTimersByTime(20);
    await releasePromise;

    expect(mockEqLow.disconnect).toHaveBeenCalled();
    expect(mockEqMid.disconnect).toHaveBeenCalled();
    expect(mockEqHigh.disconnect).toHaveBeenCalled();
    expect(mockPannerNode.disconnect).toHaveBeenCalled();
    expect(mockGainNode.disconnect).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
