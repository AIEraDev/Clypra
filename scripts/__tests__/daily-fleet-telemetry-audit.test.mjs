import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateFleetTelemetry,
  computeMedianOfInstallMedians,
  computeWeightedPlatformStats,
  MIN_DISTINCT_INSTALLS,
  MAX_SAMPLES_PER_INSTALL,
} from "../daily-fleet-telemetry-audit.mjs";

describe("Daily Fleet Telemetry Audit Evaluation & Gating", () => {
  it("enforces MIN_DISTINCT_INSTALLS = 5 and MAX_SAMPLES_PER_INSTALL = 10", () => {
    assert.equal(MIN_DISTINCT_INSTALLS, 5);
    assert.equal(MAX_SAMPLES_PER_INSTALL, 10);
  });

  it("computes median of install medians (one vote per install) and worst cohort p95", () => {
    const cohorts = [
      { gpuModel: "GPU-Skewed", sampleCount: 100, p50RenderTimeUs: 500_000, p95RenderTimeUs: 5_000_000 },
      { gpuModel: "GPU-Fast-1", sampleCount: 10, p50RenderTimeUs: 10_000, p95RenderTimeUs: 20_000 },
      { gpuModel: "GPU-Fast-2", sampleCount: 10, p50RenderTimeUs: 15_000, p95RenderTimeUs: 25_000 },
    ];
    const installsByGpu = new Map([
      ["GPU-Skewed", 1], // 1 install despite 100 samples
      ["GPU-Fast-1", 1],
      ["GPU-Fast-2", 1],
    ]);

    const stats = computeMedianOfInstallMedians(cohorts, installsByGpu);
    assert.ok(stats);
    assert.equal(stats.distinctInstalls, 3);
    // Medians array: [10ms, 15ms, 500ms] -> median (index 1) is 15ms! Not skewed by GPU-Skewed's 100 samples!
    assert.equal(stats.medianOfMediansMs, 15);
    // 2 of 3 installs under 33.3ms SLA (Fast-1 at 10ms, Fast-2 at 15ms)
    assert.equal(stats.installsUnderSla, 2);
    // Clusters: fast cluster has [10, 15] -> median 15; slow cluster has [500] -> median 500
    assert.equal(stats.fastClusterMedianMs, 15);
    assert.equal(stats.slowClusterMedianMs, 500);
    assert.equal(stats.fastClusterCount, 2);
    assert.equal(stats.slowClusterCount, 1);
    // Worst cohort p95 is preserved:
    assert.equal(stats.worstCohortP95Ms, 5000);
    assert.equal(stats.worstCohortModel, "GPU-Skewed");
  });

  it("accurately splits bimodal cohorts into fast and slow clusters", () => {
    const cohorts = [
      { gpuModel: "Fast-1", sampleCount: 1, p50RenderTimeUs: 200, p95RenderTimeUs: 500 }, // 0.2 ms
      { gpuModel: "Fast-2", sampleCount: 1, p50RenderTimeUs: 300, p95RenderTimeUs: 600 }, // 0.3 ms
      { gpuModel: "Slow-1", sampleCount: 1, p50RenderTimeUs: 400_000, p95RenderTimeUs: 800_000 }, // 400 ms
      { gpuModel: "Slow-2", sampleCount: 1, p50RenderTimeUs: 600_000, p95RenderTimeUs: 1_200_000 }, // 600 ms
    ];
    const stats = computeMedianOfInstallMedians(cohorts, new Map(), 33.3);
    assert.ok(stats);
    assert.equal(stats.installsUnderSla, 2);
    assert.equal(stats.distinctInstalls, 4);
    assert.equal(stats.fastClusterCount, 2);
    assert.equal(stats.slowClusterCount, 2);
    assert.equal(stats.fastClusterMedianMs, 0.3);
    assert.equal(stats.slowClusterMedianMs, 600);
  });

  it("recomputes weighted platform stats with install sample capping", () => {
    const cohorts = [
      { gpuModel: "GPU-A", sampleCount: 100, p50RenderTimeUs: 500_000 }, // capped at 10
      { gpuModel: "GPU-B", sampleCount: 10, p50RenderTimeUs: 10_000 },   // 10 samples
      { gpuModel: "GPU-C", sampleCount: 5, p50RenderTimeUs: 20_000 },    // 5 samples
    ];

    const stats = computeWeightedPlatformStats(cohorts, 10);
    assert.ok(stats);
    assert.equal(stats.totalCappedSamples, 25); // 10 + 10 + 5
    // Values: 10 of 10ms, 5 of 20ms, 10 of 500ms -> median (index 12) is 20ms
    assert.equal(stats.p50Ms, 20);
    assert.equal(stats.p95Ms, 500);
  });

  it("handles single-install dominance (GTS 450 case) as canary without release hold", () => {
    const mockHardwareData = {
      gpuMatrix: [
        {
          gpuVendor: "nvidia",
          gpuModel: "NVIDIA GeForce GTS 450",
          sampleCount: 100,
          p50RenderTimeUs: 521_825,
          p95RenderTimeUs: 3_084_254,
          fallbackRate: 0,
          primaryBottleneck: "decode",
          meetsSLA: false,
        },
        {
          gpuVendor: "nvidia",
          gpuModel: "NVIDIA GeForce RTX 4080",
          sampleCount: 12,
          p50RenderTimeUs: 418_869,
          p95RenderTimeUs: 478_600,
          fallbackRate: 0,
          primaryBottleneck: "none",
          meetsSLA: false,
        },
      ],
    };

    const mockFleetConsistency = {
      byMode: [
        {
          workloadMode: "playback",
          gpuBreakdown: [
            {
              gpuModel: "NVIDIA GeForce GTS 450",
              sampleCount: 100,
              uniqueSessionCount: 1, // Only 1 install
            },
            {
              gpuModel: "NVIDIA GeForce RTX 4080",
              sampleCount: 12,
              uniqueSessionCount: 1, // Only 1 install
            },
          ],
        },
      ],
    };

    const mockOsData = {
      osMatrix: [
        {
          osFamily: "windows",
          sampleCount: 112,
          p50RenderTimeUs: 521_825,
          p95RenderTimeUs: 3_084_254,
          fallbackRate: 0,
          meetsSLA: false,
        },
      ],
    };

    const result = evaluateFleetTelemetry({
      osData: mockOsData,
      hardwareData: mockHardwareData,
      fleetConsistency: mockFleetConsistency,
      sessionRollup: {},
      fallbacksData: {},
      worstData: { results: [] },
    });

    assert.equal(result.gts450Dominates, true);
    assert.ok(result.cappedWinStats);
    // 10 capped of GTS 450 + 10 capped of RTX 4080 = 20 total
    assert.equal(result.cappedWinStats.totalCappedSamples, 20);

    // Assert that GTS 450 cohort is reported as canary observation, NOT a blocking release hold alert
    const gts450Cohort = result.allGpuCohorts.find(c => c.gpuModel.includes("GTS 450"));
    assert.ok(gts450Cohort);

    // Alerts array should not have an SLA violation alert for GTS 450 because distinct installs < 5
    const gtsAlerts = result.alerts.filter(a => a.includes("GTS 450"));
    assert.equal(gtsAlerts.length, 0);

    // It should be present in lowSampleObservations
    const gtsObservation = result.lowSampleObservations.find(o => o.includes("GTS 450"));
    assert.ok(gtsObservation);
    assert.ok(gtsObservation.includes("Requires ≥ 5 installs before release-blocking gate action"));
  });

  it("triggers SLA release alert when a cohort has ≥ 5 installs and fails SLA", () => {
    const mockHardwareData = {
      gpuMatrix: [
        {
          gpuVendor: "nvidia",
          gpuModel: "NVIDIA GeForce RTX 4090",
          sampleCount: 50,
          p50RenderTimeUs: 40_000,
          p95RenderTimeUs: 120_000,
          fallbackRate: 0.08, // > 5% fallback budget!
          primaryBottleneck: "readback",
          meetsSLA: false,
        },
      ],
    };

    const mockFleetConsistency = {
      byMode: [
        {
          workloadMode: "playback",
          gpuBreakdown: [
            {
              gpuModel: "NVIDIA GeForce RTX 4090",
              sampleCount: 50,
              uniqueSessionCount: 6, // 6 installs >= 5
            },
          ],
        },
      ],
    };

    const result = evaluateFleetTelemetry({
      osData: { osMatrix: [] },
      hardwareData: mockHardwareData,
      fleetConsistency: mockFleetConsistency,
      sessionRollup: {},
      fallbacksData: {},
      worstData: { results: [] },
    });

    // With 6 installs, fallbackRate of 8% must trigger a release gate alert
    const alert = result.alerts.find(a => a.includes("RTX 4090"));
    assert.ok(alert);
    assert.ok(alert.includes("Elevated fallback rate: 8.0%"));
  });
});
