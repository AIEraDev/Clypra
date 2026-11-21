import { describe, it, expect, beforeEach } from "vitest";
import { evaluatorTelemetry } from "../evaluatorTelemetry";

describe("evaluatorTelemetry", () => {
  beforeEach(() => {
    evaluatorTelemetry.reset();
  });

  it("starts with empty default snapshot", () => {
    const snap = evaluatorTelemetry.getSnapshot();
    expect(snap.evaluationsTotal).toBe(0);
    expect(snap.intervalTreeQueriesTotal).toBe(0);
    expect(snap.intervalTreeRebuildsTotal).toBe(0);
    expect(snap.totalClipsScanned).toBe(0);
    expect(snap.totalClipsMatched).toBe(0);
    expect(snap.avgQueryDurationUs).toBe(0);
    expect(snap.p95QueryDurationUs).toBe(0);
    expect(snap.cacheHitRatio).toBe(0);
  });

  it("accumulates evaluation passes and computes cache hit ratio", () => {
    evaluatorTelemetry.recordEvaluation(100, 5, 25.0, false);
    evaluatorTelemetry.recordEvaluation(100, 5, 0.0, true);
    evaluatorTelemetry.recordEvaluation(100, 5, 0.0, true);

    const snap = evaluatorTelemetry.getSnapshot();
    expect(snap.evaluationsTotal).toBe(3);
    expect(snap.intervalTreeQueriesTotal).toBe(3);
    expect(snap.totalClipsScanned).toBe(300);
    expect(snap.totalClipsMatched).toBe(15);
    expect(snap.cacheHitRatio).toBeCloseTo(2 / 3);
  });

  it("tracks interval-tree rebuilds", () => {
    evaluatorTelemetry.recordIntervalTreeRebuild();
    evaluatorTelemetry.recordIntervalTreeRebuild();
    const snap = evaluatorTelemetry.getSnapshot();
    expect(snap.intervalTreeRebuildsTotal).toBe(2);
  });

  it("computes rolling average and p95 duration from ring buffer", () => {
    // Record 100 samples with durations from 1 to 100 µs
    for (let i = 1; i <= 100; i++) {
      evaluatorTelemetry.recordEvaluation(50, 2, i * 10, false);
    }

    const snap = evaluatorTelemetry.getSnapshot();
    expect(snap.evaluationsTotal).toBe(100);
    // Average of 10, 20, ..., 1000 is (10 + 1000) / 2 = 505
    expect(snap.avgQueryDurationUs).toBeCloseTo(505);
    // p95 of 1..100 items at index 95 is 96 * 10 = 960
    expect(snap.p95QueryDurationUs).toBeGreaterThanOrEqual(950);
  });

  it("resets cleanly", () => {
    evaluatorTelemetry.recordEvaluation(10, 2, 5.0, true);
    evaluatorTelemetry.recordIntervalTreeRebuild();
    evaluatorTelemetry.reset();

    const snap = evaluatorTelemetry.getSnapshot();
    expect(snap.evaluationsTotal).toBe(0);
    expect(snap.intervalTreeRebuildsTotal).toBe(0);
  });
});
