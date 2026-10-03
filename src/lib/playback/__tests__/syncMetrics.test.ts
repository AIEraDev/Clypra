import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getSyncMetricsSnapshot,
  recordAudioPoll,
  recordPlayheadPaint,
  recordSeekRequested,
  recordSeekResolved,
  resetSyncMetricsForTests,
  RollingDriftStats,
} from "../syncMetrics";

describe("RollingDriftStats", () => {
  it("keeps a bounded rolling window and resets atomically", () => {
    const stats = new RollingDriftStats(3);
    [1, 3, 5, 7].forEach((value) => stats.record(value));

    expect(stats.snapshot()).toEqual({ n: 3, avg: 5, maxAbs: 7 });
    expect(stats.takeAndReset()).toEqual({ n: 3, avg: 5, maxAbs: 7 });
    expect(stats.snapshot()).toEqual({ n: 0, avg: 0, maxAbs: 0 });
  });

  it("ignores non-finite samples", () => {
    const stats = new RollingDriftStats();
    stats.record(Number.NaN);
    stats.record(Number.POSITIVE_INFINITY);
    stats.record(-4);

    expect(stats.snapshot()).toEqual({ n: 1, avg: -4, maxAbs: 4 });
  });
});

describe("frontend sync metric collection", () => {
  beforeEach(() => resetSyncMetricsForTests());
  afterEach(() => resetSyncMetricsForTests());

  it("records UI-to-audio drift and paint intervals (no sampledAtNs → no extrapolation error)", () => {
    // Calls without sampledAtNs: uiPlayheadDrift is recorded but
    // audioExtrapolationError is not (jitter requires two consecutive sampledAtNs values).
    recordAudioPoll(100, 103);
    recordAudioPoll(200, 196);
    recordPlayheadPaint(1000);
    recordPlayheadPaint(1016);
    recordPlayheadPaint(1033);

    const snapshot = getSyncMetricsSnapshot();
    expect(snapshot.ui_playhead_drift).toEqual({ n: 2, avg: -0.5, maxAbs: 4 });
    expect(snapshot.playhead_paint_jitter).toEqual({
      n: 2,
      avg: 16.5,
      maxAbs: 17,
    });
    expect(snapshot.seek_user_latency).toEqual({ n: 0, avg: 0, maxAbs: 0 });
    // No sampledAtNs provided → no jitter sample → field absent from snapshot.
    expect(snapshot.audio_extrapolation_error).toBeUndefined();
  });

  it("records audio poll RTT and extrapolation jitter when sampledAtNs provided", () => {
    // Pass explicit receivedAtMs so jitter is deterministic.
    // Poll 1: received at t=1000 ms, sampled at 1_000_000 ns
    // Poll 2: received at t=1100 ms, sampled at 2_000_000 ns
    // JS elapsed  = 1100 − 1000 = 100 ms
    // Native elapsed = (2_000_000 − 1_000_000) / 1_000_000 = 1 ms
    // jitter = 100 − 1 = 99 ms
    recordAudioPoll(100, 102, 14.5, 1_000_000, 1000);
    recordAudioPoll(200, 203, 16.5, 2_000_000, 1100);

    const snapshot = getSyncMetricsSnapshot();
    expect(snapshot.audio_poll_rtt).toEqual({
      n: 2,
      avg: 15.5,
      maxAbs: 16.5,
    });
    expect(snapshot.audio_extrapolation_error).toEqual({
      n: 1,
      avg: 99,
      maxAbs: 99,
    });
    expect(snapshot.sampledAtNs).toBe(2_000_000);
  });

  it("does not record jitter on the first sampledAtNs call (no previous baseline)", () => {
    recordAudioPoll(100, 102, 14.5, 1_000_000, 1000);

    const snapshot = getSyncMetricsSnapshot();
    // First call establishes the baseline; no jitter sample yet.
    expect(snapshot.audio_extrapolation_error).toBeUndefined();
  });

  it("resolves seek latency on the confirmed playhead paint", () => {
    const handle = recordSeekRequested(2000);
    recordSeekResolved(handle, 2048);

    expect(getSyncMetricsSnapshot().seek_user_latency).toEqual({
      n: 1,
      avg: 48,
      maxAbs: 48,
    });
  });
});
