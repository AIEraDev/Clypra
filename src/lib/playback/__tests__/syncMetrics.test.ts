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

  it("records UI-to-audio drift and paint intervals", () => {
    recordAudioPoll(100, 103);
    recordAudioPoll(200, 196);
    recordPlayheadPaint(1000);
    recordPlayheadPaint(1016);
    recordPlayheadPaint(1033);

    expect(getSyncMetricsSnapshot()).toEqual({
      ui_playhead_drift: { n: 2, avg: -0.5, maxAbs: 4 },
      playhead_paint_jitter: { n: 2, avg: 16.5, maxAbs: 17 },
      seek_user_latency: { n: 0, avg: 0, maxAbs: 0 },
    });
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
