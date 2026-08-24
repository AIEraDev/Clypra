import { describe, it, expect, beforeEach } from "vitest";
import {
  RollingAvg,
  filmstripMetrics,
  recordRequestDispatched,
  recordFirstArtifactLatency,
  recordCacheApply,
  recordPaintCommit,
  getFrontendMetricsSnapshot,
} from "../filmstripMetrics";
import { SpatialTier } from "../types";

describe("filmstripMetrics", () => {
  it("RollingAvg correctly calculates average, snapshot, and resets", () => {
    const avg = new RollingAvg();
    expect(avg.snapshot()).toEqual({ n: 0, avgMs: 0 });

    avg.record(10);
    avg.record(20);
    avg.record(30);

    expect(avg.snapshot()).toEqual({ n: 3, avgMs: 20 });

    const result = avg.takeAndReset();
    expect(result).toEqual({ n: 3, avgMs: 20 });

    // After reset, it should be empty
    expect(avg.snapshot()).toEqual({ n: 0, avgMs: 0 });
  });

  it("records metrics per spatial tier accurately", () => {
    recordRequestDispatched(SpatialTier.L2);
    recordRequestDispatched(SpatialTier.L2);
    recordFirstArtifactLatency(SpatialTier.L2, 45.5);
    recordCacheApply(SpatialTier.L2, 0.8);
    recordPaintCommit(SpatialTier.L2, 2.1);

    const snapshot = getFrontendMetricsSnapshot();
    expect(snapshot["L2"].requests).toBeGreaterThanOrEqual(2);
    expect(snapshot["L2"].dispatchToFirstMs).toBe(45.5);
    expect(snapshot["L2"].cacheApplyMs).toBe(0.8);
    expect(snapshot["L2"].paintCommitMs).toBe(2.1);
  });

  it("handles string tier labels gracefully", () => {
    recordRequestDispatched("l0");
    recordFirstArtifactLatency("l0", 12.3);

    const snapshot = getFrontendMetricsSnapshot();
    expect(snapshot["L0"].requests).toBeGreaterThanOrEqual(1);
    expect(snapshot["L0"].dispatchToFirstMs).toBe(12.3);
  });
});
