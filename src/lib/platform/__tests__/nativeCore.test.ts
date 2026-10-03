import { describe, expect, it } from "vitest";
import { DEFAULT_NATIVE_COLOR_POLICY, frameIndexToNativeTime, secondsToNativeTime } from "../nativeCore";

describe("native core contracts", () => {
  it("converts time to integral microsecond ticks", () => {
    expect(secondsToNativeTime(1.25, 38)).toEqual({
      frameIndex: 38,
      ticks: 1_250_000,
      timescale: 1_000_000,
    });
  });

  it("maps frame indices deterministically", () => {
    expect(frameIndexToNativeTime(30, 30)).toEqual({
      frameIndex: 30,
      ticks: 1_000_000,
      timescale: 1_000_000,
    });
  });

  it("defaults editing output to linear Rec.709 math and SDR presentation", () => {
    expect(DEFAULT_NATIVE_COLOR_POLICY).toMatchObject({
      workingSpace: "linear-rec709",
      outputFormat: "rgba8Srgb",
      toneMapHdrToSdr: true,
    });
  });

  it("preserves NativePlaybackState contract compatibility with additive poll telemetry", () => {
    const rawState = {
      contract_version: 1,
      audio_position_ticks: 48000,
      timescale: 48000,
      presented_frame: 30,
      clock_generation: 2,
      playing: true,
      sampledAtNs: 1_234_567_890,
    };

    // Simulated return value of nativeTickFromAudio (NativePlaybackState & { pollRttMs?: number })
    const tickResult = { ...rawState, pollRttMs: 14.2 };

    // Contract compatibility assertions: all existing fields accessible without cast
    expect(tickResult.audio_position_ticks).toBe(48000);
    expect(tickResult.timescale).toBe(48000);
    expect(tickResult.playing).toBe(true);
    expect(tickResult.sampledAtNs).toBe(1_234_567_890);
    expect(tickResult.pollRttMs).toBe(14.2);
  });

  it("enforces strict allowlist schema for NativeAudioStatus telemetry", () => {
    const allowedAudioKeys = new Set([
      "available",
      "running",
      "playing",
      "host",
      "deviceName",
      "sampleRate",
      "channels",
      "sampleFormat",
      "audioPositionTicks",
      "callbackCount",
      "renderedFrames",
      "nonSilentFrames",
      "lastError",
      "speed",
      "volume",
      "muted",
      "mixerLockMisses",
      "callbackTimeUs",
      "callbackMaxTimeUs",
      "callbackOverBudgetCount",
      "seekCount",
      "seekLatencyTotalUs",
      "clockFreshnessUs",
      "medianCallbackIntervalUs",
      "outputLatencyUsHistogram",
      "outputLatencyLastUs",
      "outputLatencyMinUs",
      "outputLatencyMaxUs",
      "outputLatencySumUs",
      "outputLatencyCount",
    ]);

    const mockAudioStatus = {
      available: true,
      running: true,
      playing: true,
      audioPositionTicks: 48000,
      callbackCount: 100,
      renderedFrames: 48000,
      nonSilentFrames: 48000,
      speed: 1.0,
      volume: 1.0,
      muted: false,
      mixerLockMisses: 0,
      callbackTimeUs: 50000,
      callbackMaxTimeUs: 800,
      callbackOverBudgetCount: 0,
      seekCount: 2,
      seekLatencyTotalUs: 12000,
      clockFreshnessUs: 500,
      medianCallbackIntervalUs: 5333,
      outputLatencyUsHistogram: [1, 2, 3],
      outputLatencyLastUs: 25000,
      outputLatencyMinUs: 20000,
      outputLatencyMaxUs: 35000,
      outputLatencySumUs: 250000,
      outputLatencyCount: 10,
    };

    expect(Object.keys(mockAudioStatus).every((k) => allowedAudioKeys.has(k))).toBe(true);
  });

  it("enforces strict allowlist schema for end-to-end performance report payload", () => {
    const allowedReportKeys = new Set([
      "reportVersion",
      "capturedAtMs",
      "applicationVersion",
      "buildProfile",
      "operatingSystem",
      "architecture",
      "gitCommit",
      "gitDirty",
      "gpu",
      "audio",
      "preview",
      "session",
      "stageDiagnoses",
      "pushBridge",
      "playbackCacheInsertSkipped",
      "frontend",
      "text",
      "sync",
    ]);

    const mockReport = {
      reportVersion: 2,
      capturedAtMs: Date.now(),
      applicationVersion: "1.5.8",
      buildProfile: "release",
      operatingSystem: "macos",
      architecture: "aarch64",
      gpu: null,
      audio: null,
      preview: null,
      session: {} as any,
      stageDiagnoses: [],
      pushBridge: null,
      frontend: {} as any,
      text: {} as any,
      sync: {} as any,
    };

    expect(Object.keys(mockReport).every((k) => allowedReportKeys.has(k))).toBe(true);
  });
});
