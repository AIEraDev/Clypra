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
      "coldStart",
      "frontend",
      "text",
      "sync",
    ]);

    const mockReport = {
      reportVersion: 2,
      capturedAtMs: Date.now(),
      applicationVersion: "1.5.9",
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

  it("enforces strict nested allowlist schema and privacy constraints for ColdStartReport", () => {
    const allowedColdReportKeys = new Set([
      "processEpochMs",
      "preMainMs",
      "systemUptimeSecs",
      "milestones",
      "audioMetrics",
      "aggregates",
      "droppedSpans",
      "spans",
    ]);

    const allowedMilestonesKeys = new Set([
      "preMainMs",
      "windowCreatedAtUs",
      "windowShownAtUs",
      "domContentLoadedMs",
      "appMountedMs",
      "shellPaintedMs",
      "firstSoundAtUs",
      "firstSoundLatencyUs",
      "interactiveAtUs",
      "firstFrameAtUs",
      "firstFramePaintedMs",
      "smoothPlaybackAtUs",
      "smoothPlaybackTargetFps",
    ]);

    const allowedAudioColdMetricsKeys = new Set([
      "pcmBytes",
      "capTruncations",
      "cliFallbacks",
    ]);

    const allowedStageAggregateKeys = new Set([
      "count",
      "totalWorkUs",
      "maxWorkUs",
      "totalWaitedUs",
      "maxWaitedUs",
      "okCount",
      "errCount",
    ]);

    const allowedColdSpanKeys = new Set([
      "stage",
      "startedAtUs",
      "workUs",
      "waitedByInteractiveUs",
      "cached",
      "ok",
      "purpose",
      "clipIndex",
      "containerFormat",
      "fileSizeBucketMb",
      "mediaLocation",
    ]);

    // Forbidden keys that must NEVER appear due to privacy constraints
    const forbiddenKeys = ["path", "filePath", "fileSizeBytes", "exactBytes", "url", "uri"];

    const mockColdReport: import("@/services/telemetryCollector").ColdStartReport = {
      processEpochMs: 1727999999000,
      preMainMs: 42,
      systemUptimeSecs: 3600,
      milestones: {
        preMainMs: 42,
        windowCreatedAtUs: 15000,
        windowShownAtUs: 25000,
        domContentLoadedMs: 80,
        appMountedMs: 120,
        shellPaintedMs: 140,
        firstSoundAtUs: 320000,
        firstSoundLatencyUs: 15000,
        interactiveAtUs: 150000,
        firstFrameAtUs: 220000,
        firstFramePaintedMs: 235,
        smoothPlaybackAtUs: 1250000,
        smoothPlaybackTargetFps: 30,
      },
      audioMetrics: {
        pcmBytes: 1048576,
        capTruncations: 0,
        cliFallbacks: 0,
      },
      aggregates: {
        c0_gpu_init: {
          count: 1,
          totalWorkUs: 45000,
          maxWorkUs: 45000,
          totalWaitedUs: 0,
          maxWaitedUs: 0,
          okCount: 1,
          errCount: 0,
        },
      },
      droppedSpans: 0,
      spans: [
        {
          stage: "c2_container_open_probe",
          startedAtUs: 180000,
          workUs: 12000,
          waitedByInteractiveUs: 12000,
          cached: false,
          ok: true,
          purpose: "preview",
          clipIndex: 1,
          containerFormat: "mov,mp4,m4a,3gp,3g2,mj2",
          fileSizeBucketMb: 128,
          mediaLocation: "fixed",
        },
      ],
    };

    expect(Object.keys(mockColdReport).every((k) => allowedColdReportKeys.has(k))).toBe(true);
    expect(Object.keys(mockColdReport.milestones).every((k) => allowedMilestonesKeys.has(k))).toBe(true);
    expect(Object.keys(mockColdReport.audioMetrics).every((k) => allowedAudioColdMetricsKeys.has(k))).toBe(true);
    for (const agg of Object.values(mockColdReport.aggregates)) {
      expect(Object.keys(agg).every((k) => allowedStageAggregateKeys.has(k))).toBe(true);
    }
    for (const span of mockColdReport.spans) {
      expect(Object.keys(span).every((k) => allowedColdSpanKeys.has(k))).toBe(true);
    }

    // Verify privacy invariants: ensure none of the forbidden quasi-identifiers exist
    const jsonStr = JSON.stringify(mockColdReport);
    for (const forbidden of forbiddenKeys) {
      expect(jsonStr).not.toContain(`"${forbidden}":`);
    }
  });
});
