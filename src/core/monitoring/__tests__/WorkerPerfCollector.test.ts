import { describe, it, expect, beforeEach, vi } from "vitest";
import { WorkerPerfCollector } from "../WorkerPerfCollector";

describe("WorkerPerfCollector", () => {
  let collector: WorkerPerfCollector;

  beforeEach(() => {
    collector = new WorkerPerfCollector();
    collector.clear();
  });

  it("records worker operations and computes percentiles and statistics per domain", () => {
    collector.record({
      domain: "ComputeWorker:KeyframeEval",
      operation: "EVALUATE",
      durationMs: 2.5,
      workerDurationMs: 2.1,
      itemsCount: 10,
      overBudget: false,
    });

    collector.record({
      domain: "ComputeWorker:KeyframeEval",
      operation: "EVALUATE",
      durationMs: 4.5,
      workerDurationMs: 4.0,
      itemsCount: 15,
      overBudget: false,
    });

    collector.record({
      domain: "ComputeWorker:KeyframeEval",
      operation: "EVALUATE",
      durationMs: 18.0,
      workerDurationMs: 17.2,
      itemsCount: 20,
      overBudget: true,
    });

    const summary = collector.getSummary();
    expect(summary.totalOperations).toBe(3);
    expect(summary.totalOverBudget).toBe(1);
    expect(summary.totalErrors).toBe(0);

    const domainStats = summary.domains["ComputeWorker:KeyframeEval"];
    expect(domainStats).toBeDefined();
    expect(domainStats.sampleCount).toBe(3);
    expect(domainStats.overBudgetCount).toBe(1);
    expect(domainStats.maxDurationMs).toBe(18.0);
    expect(domainStats.avgDurationMs).toBeCloseTo(8.33, 1);
    expect(domainStats.avgWorkerDurationMs).toBeCloseTo(7.77, 1);
    expect(domainStats.totalItemsCount).toBe(45);
    expect(domainStats.p50DurationMs).toBe(4.5);
    expect(domainStats.p95DurationMs).toBe(18.0);
    expect(domainStats.recentAnomalies.length).toBe(1);
    expect(domainStats.recentAnomalies[0].durationMs).toBe(18.0);
  });

  it("handles multiple independent worker domains concurrently", () => {
    collector.record({
      domain: "ComputeWorker:TimelineSnap",
      operation: "SNAP_QUERY",
      durationMs: 1.2,
      overBudget: false,
    });

    collector.record({
      domain: "MediaAnalysisWorker:ColorScopes",
      operation: "ANALYZE",
      durationMs: 12.0,
      workerDurationMs: 11.5,
      overBudget: false,
    });

    collector.record({
      domain: "ComputeWorker:Project",
      operation: "DIFF",
      durationMs: 25.0,
      workerDurationMs: 24.0,
      overBudget: true,
    });

    const summary = collector.getSummary();
    expect(summary.totalOperations).toBe(3);
    expect(summary.totalOverBudget).toBe(1);
    expect(Object.keys(summary.domains)).toHaveLength(3);

    expect(summary.domains["ComputeWorker:TimelineSnap"].sampleCount).toBe(1);
    expect(summary.domains["MediaAnalysisWorker:ColorScopes"].sampleCount).toBe(
      1,
    );
    expect(summary.domains["ComputeWorker:Project"].overBudgetCount).toBe(1);
  });

  it("captures worker errors and notifies listeners", () => {
    const errorListener = vi.fn();
    const unsubscribe = collector.onError(errorListener);

    collector.recordError(
      "ComputeWorker:KeyframeEval",
      "Curve solver failed to converge",
      "EVALUATE",
      { clipId: "clip-123" },
    );

    expect(errorListener).toHaveBeenCalledTimes(1);
    expect(errorListener).toHaveBeenCalledWith({
      domain: "ComputeWorker:KeyframeEval",
      error: "Curve solver failed to converge",
      operation: "EVALUATE",
      metadata: { clipId: "clip-123" },
    });

    const summary = collector.getSummary();
    expect(summary.totalErrors).toBe(1);
    const domainStats = summary.domains["ComputeWorker:KeyframeEval"];
    expect(domainStats.errorCount).toBe(1);
    expect(domainStats.lastError).toBe("Curve solver failed to converge");

    unsubscribe();
    collector.recordError("AnotherWorker", "Error after unsubscribe");
    expect(errorListener).toHaveBeenCalledTimes(1);
  });

  it("records animation evaluation telemetry and computes detailed animation metrics", () => {
    collector.recordAnimationEval({
      durationMs: 3.2,
      activeClips: 4,
      visualLayers: 4,
      keyframeEvaluations: 8,
      springEvaluations: 1,
      responsiveRetimes: 2,
      culledLayers: 0,
    });

    collector.recordAnimationEval({
      durationMs: 22.0, // over budget
      activeClips: 10,
      visualLayers: 8,
      keyframeEvaluations: 24,
      springEvaluations: 3,
      responsiveRetimes: 6,
      culledLayers: 2,
    });

    const summary = collector.getSummary();
    expect(summary.animation).toBeDefined();
    const anim = summary.animation!;
    expect(anim.totalEvaluations).toBe(2);
    expect(anim.overBudgetCount).toBe(1);
    expect(anim.maxDurationMs).toBe(22.0);
    expect(anim.avgDurationMs).toBeCloseTo(12.6, 1);
    expect(anim.totalKeyframesEvaluated).toBe(32);
    expect(anim.totalSpringEvaluations).toBe(4);
    expect(anim.totalResponsiveRetimes).toBe(8);
    expect(anim.totalOcclusionCulled).toBe(2);

    // Also tracked in domains
    expect(summary.domains["animation:eval"]).toBeDefined();
    expect(summary.domains["animation:eval"].sampleCount).toBe(2);
  });

  it("flushes and resets state for the next telemetry window", () => {
    collector.record({
      domain: "ComputeWorker:KeyframeEval",
      operation: "EVALUATE",
      durationMs: 5.0,
      overBudget: false,
    });

    collector.recordAnimationEval({
      durationMs: 4.0,
      activeClips: 2,
      visualLayers: 2,
      keyframeEvaluations: 4,
      springEvaluations: 0,
      responsiveRetimes: 0,
      culledLayers: 0,
    });

    const flushed = collector.flush();
    expect(flushed).not.toBeNull();
    expect(flushed!.totalOperations).toBe(2);

    // After flush, state is reset
    const emptyFlush = collector.flush();
    expect(emptyFlush).toBeNull();

    const emptySummary = collector.getSummary();
    expect(emptySummary.totalOperations).toBe(0);
    expect(emptySummary.animation).toBeUndefined();
  });

  it("retains global anomalies up to maximum capacity", () => {
    for (let i = 0; i < 60; i++) {
      collector.record({
        domain: "StressWorker",
        operation: `OP_${i}`,
        durationMs: 20 + i,
        overBudget: true,
      });
    }

    const anomalies = collector.getRecentAnomalies();
    expect(anomalies.length).toBeLessThanOrEqual(50);
    expect(anomalies[anomalies.length - 1].durationMs).toBe(79);
  });

  it("installs onto window.__clypra_diagnostics", () => {
    collector.installGlobalDiagnostics();
    const globalDiag = (window as any).__clypra_diagnostics;
    expect(globalDiag).toBeDefined();
    expect(globalDiag.workerPerf).toBe(collector);
  });
});
