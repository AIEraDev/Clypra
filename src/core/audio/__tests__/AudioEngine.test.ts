import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { AudioEngine } from "../AudioEngine";
import { AudioBufferPool } from "../AudioBufferPool";
import type { Clip, Track } from "@/types";

describe("AudioEngine", () => {
  let engine: AudioEngine;
  let mockCtx: any;
  let mockBufferPool: AudioBufferPool;
  let mockSourceNode: any;
  let mockMasterGain: any;
  let mockMasterLimiter: any;

  const createMockAudioParam = (initialValue: number = 0) => ({
    value: initialValue,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setValueCurveAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    setTargetAtTime: vi.fn(),
  });

  const createMockAudioBuffer = (duration: number = 10): AudioBuffer =>
    ({
      duration,
      length: duration * 44100,
      numberOfChannels: 2,
      sampleRate: 44100,
    }) as unknown as AudioBuffer;

  beforeEach(() => {
    mockMasterGain = {
      gain: createMockAudioParam(1),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    mockMasterLimiter = {
      threshold: createMockAudioParam(-0.5),
      knee: createMockAudioParam(0),
      ratio: createMockAudioParam(20),
      attack: createMockAudioParam(0.001),
      release: createMockAudioParam(0.05),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    mockSourceNode = {
      buffer: null,
      playbackRate: createMockAudioParam(1.0),
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    };

    mockCtx = {
      currentTime: 100.0,
      state: "running",
      destination: {},
      createGain: vi.fn().mockReturnValue(mockMasterGain),
      createDynamicsCompressor: vi.fn().mockReturnValue(mockMasterLimiter),
      createBufferSource: vi.fn().mockImplementation(() => ({
        ...mockSourceNode,
        playbackRate: createMockAudioParam(1.0),
      })),
      createBiquadFilter: vi.fn().mockReturnValue({
        type: "lowshelf",
        frequency: createMockAudioParam(120),
        gain: createMockAudioParam(0),
        Q: createMockAudioParam(1.0),
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
      createStereoPanner: vi.fn().mockReturnValue({
        pan: createMockAudioParam(0),
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
      resume: vi.fn().mockResolvedValue(undefined),
    };

    mockBufferPool = new AudioBufferPool(10 * 1024 * 1024, mockCtx);
    engine = new AudioEngine({
      audioContext: mockCtx,
      bufferPool: mockBufferPool,
    });
  });

  afterEach(() => {
    engine.dispose();
  });

  it("initializes master graph with master gain and transparent safety limiter", () => {
    expect(mockCtx.createGain).toHaveBeenCalled();
    expect(mockCtx.createDynamicsCompressor).toHaveBeenCalled();
    expect(mockMasterGain.connect).toHaveBeenCalledWith(mockMasterLimiter);
    expect(mockMasterLimiter.connect).toHaveBeenCalledWith(mockCtx.destination);
  });

  it("resumes suspended AudioContext when requested", async () => {
    mockCtx.state = "suspended";
    await engine.resume();
    expect(mockCtx.resume).toHaveBeenCalled();
  });

  it("spawns sample-accurate voice when playhead is inside clip boundaries", () => {
    const buffer = createMockAudioBuffer(20);
    mockBufferPool.set("media-1", buffer);

    const clip: Clip = {
      id: "clip-1",
      trackId: "track-1",
      mediaId: "media-1",
      startTime: 5.0,
      duration: 10.0,
      trimIn: 2.0,
      trimOut: 12.0,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      volume: 1.0,
    };

    const tracks: Track[] = [
      {
        id: "track-1",
        type: "audio",
        name: "Audio 1",
        volume: 1.0,
        muted: false,
        locked: false,
        visible: true,
        height: 52,
      },
    ];

    // Timeline time = 7.0s (2.0s into clip)
    engine.syncPlayback([clip], tracks, 7.0, true, 1.0, 100, false);

    expect(engine.getActiveVoiceCount()).toBe(1);
    expect(mockCtx.createBufferSource).toHaveBeenCalled();
    expect(mockSourceNode.start).toHaveBeenCalledWith(100, 4, 8);
  });

  it("terminates voices when timeline playhead moves outside clip boundaries", () => {
    const buffer = createMockAudioBuffer(20);
    mockBufferPool.set("media-1", buffer);

    const clip: Clip = {
      id: "clip-1",
      trackId: "track-1",
      mediaId: "media-1",
      startTime: 5.0,
      duration: 10.0,
      trimIn: 0,
      trimOut: 10.0,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      volume: 1.0,
    };

    const tracks: Track[] = [
      {
        id: "track-1",
        type: "audio",
        name: "Audio 1",
        volume: 1.0,
        muted: false,
        locked: false,
        visible: true,
        height: 52,
      },
    ];

    // 1. Playhead inside clip -> voice spawned
    engine.syncPlayback([clip], tracks, 6.0, true, 1.0, 100, false);
    expect(engine.getActiveVoiceCount()).toBe(1);

    // 2. Playhead outside clip (16.0s > 5.0 + 10.0) -> voice killed
    engine.syncPlayback([clip], tracks, 16.0, true, 1.0, 100, false);
    expect(engine.getActiveVoiceCount()).toBe(0);
  });

  it("flushes all running voices immediately when playback stops or pauses", () => {
    const buffer = createMockAudioBuffer(20);
    mockBufferPool.set("media-1", buffer);

    const clip: Clip = {
      id: "clip-1",
      trackId: "track-1",
      mediaId: "media-1",
      startTime: 0,
      duration: 10.0,
      trimIn: 0,
      trimOut: 10.0,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      volume: 1.0,
    };

    const tracks: Track[] = [
      {
        id: "track-1",
        type: "audio",
        name: "Audio 1",
        volume: 1.0,
        muted: false,
        locked: false,
        visible: true,
        height: 52,
      },
    ];

    engine.syncPlayback([clip], tracks, 2.0, true, 1.0, 100, false);
    expect(engine.getActiveVoiceCount()).toBe(1);

    // Pause playback (isPlaying = false)
    engine.syncPlayback([clip], tracks, 2.0, false, 1.0, 100, false);
    expect(engine.getActiveVoiceCount()).toBe(0);
  });

  it("does not spawn voices for muted or locked tracks", () => {
    const buffer = createMockAudioBuffer(20);
    mockBufferPool.set("media-1", buffer);

    const clip: Clip = {
      id: "clip-1",
      trackId: "track-1",
      mediaId: "media-1",
      startTime: 0,
      duration: 10.0,
      trimIn: 0,
      trimOut: 10.0,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
    };

    const mutedTracks: Track[] = [
      {
        id: "track-1",
        type: "audio",
        name: "Audio 1",
        volume: 1.0,
        muted: true,
        locked: false,
        visible: true,
        height: 52,
      },
    ];

    engine.syncPlayback([clip], mutedTracks, 2.0, true, 1.0, 100, false);
    expect(engine.getActiveVoiceCount()).toBe(0);

    const lockedTracks: Track[] = [
      {
        id: "track-1",
        type: "audio",
        name: "Audio 1",
        volume: 1.0,
        muted: false,
        locked: true,
        visible: true,
        height: 52,
      },
    ];

    engine.syncPlayback([clip], lockedTracks, 2.0, true, 1.0, 100, false);
    expect(engine.getActiveVoiceCount()).toBe(0);
  });

  it("plays short scrub burst with attack/decay envelope on scrubber drag", () => {
    const buffer = createMockAudioBuffer(20);
    mockBufferPool.set("media-1", buffer);

    const clip: Clip = {
      id: "clip-1",
      trackId: "track-1",
      mediaId: "media-1",
      startTime: 0,
      duration: 10.0,
      trimIn: 0,
      trimOut: 10.0,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      volume: 1.0,
    };

    const track: Track = {
      id: "track-1",
      type: "audio",
      name: "Audio 1",
      volume: 1.0,
      muted: false,
      locked: false,
      visible: true,
      height: 52,
    };

    engine.playScrubBurst(clip, track, 3.5, 0.05);

    expect(mockCtx.createBufferSource).toHaveBeenCalled();
    expect(mockCtx.createGain).toHaveBeenCalled();
  });
});
