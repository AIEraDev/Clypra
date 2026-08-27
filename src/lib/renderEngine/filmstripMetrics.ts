/**
 * Frontend Filmstrip Request & Render Metrics
 *
 * Tracks request counts, dispatch-to-first-artifact latency, cache application time,
 * and paint commit latency aggregated per SpatialTier (L0/L1/L2/L3).
 *
 * Metrics are exposed to the overlay and diagnostics API; they do not emit
 * periodic console output.
 */

import { SpatialTier, normalizeSpatialTier } from "./types";

export class RollingAvg {
  private sum = 0;
  private n = 0;

  record(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.sum += ms;
    this.n += 1;
  }

  takeAndReset(): { n: number; avgMs: number } {
    const n = this.n;
    const avgMs = n === 0 ? 0 : this.sum / n;
    this.sum = 0;
    this.n = 0;
    return { n, avgMs: Math.round(avgMs * 100) / 100 };
  }

  snapshot(): { n: number; avgMs: number } {
    const n = this.n;
    const avgMs = n === 0 ? 0 : this.sum / n;
    return { n, avgMs: Math.round(avgMs * 100) / 100 };
  }
}

export interface TierStats {
  requestCount: number;
  dispatchToFirstArtifactMs: RollingAvg;
  cacheApplyMs: RollingAvg;
  paintCommitMs: RollingAvg;
}

function createEmptyTierStats(): TierStats {
  return {
    requestCount: 0,
    dispatchToFirstArtifactMs: new RollingAvg(),
    cacheApplyMs: new RollingAvg(),
    paintCommitMs: new RollingAvg(),
  };
}

export const filmstripMetrics: Record<SpatialTier, TierStats> = {
  [SpatialTier.L0]: createEmptyTierStats(),
  [SpatialTier.L1]: createEmptyTierStats(),
  [SpatialTier.L2]: createEmptyTierStats(),
  [SpatialTier.L3]: createEmptyTierStats(),
};

export function recordRequestDispatched(tierInput: unknown): void {
  const tier = normalizeSpatialTier(tierInput);
  filmstripMetrics[tier].requestCount += 1;
}

export function recordFirstArtifactLatency(tierInput: unknown, ms: number): void {
  const tier = normalizeSpatialTier(tierInput);
  filmstripMetrics[tier].dispatchToFirstArtifactMs.record(ms);
}

export function recordCacheApply(tierInput: unknown, ms: number): void {
  const tier = normalizeSpatialTier(tierInput);
  filmstripMetrics[tier].cacheApplyMs.record(ms);
}

export function recordPaintCommit(tierInput: unknown, ms: number): void {
  const tier = normalizeSpatialTier(tierInput);
  filmstripMetrics[tier].paintCommitMs.record(ms);
}

let flushLoopStarted = false;

/** Start the rolling reset loop used by the filmstrip metrics overlay. */
export function startMetricsFlushLoop(intervalMs = 5000): void {
  if (flushLoopStarted || typeof window === "undefined") return;
  flushLoopStarted = true;

  setInterval(() => {
    for (const tier of [SpatialTier.L0, SpatialTier.L1, SpatialTier.L2, SpatialTier.L3]) {
      const stats = filmstripMetrics[tier];
      stats.requestCount = 0; // reset window counter
      stats.dispatchToFirstArtifactMs.takeAndReset();
      stats.cacheApplyMs.takeAndReset();
      stats.paintCommitMs.takeAndReset();
    }

    // Keep collecting/resetting the rolling values for the overlay without
    // polluting the developer console during normal editing.
  }, intervalMs);
}

export function getFrontendMetricsSnapshot(): Record<string, any> {
  const tiers = [
    { tier: SpatialTier.L0, label: "L0" },
    { tier: SpatialTier.L1, label: "L1" },
    { tier: SpatialTier.L2, label: "L2" },
    { tier: SpatialTier.L3, label: "L3" },
  ];

  const res: Record<string, any> = {};
  for (const { tier, label } of tiers) {
    const s = filmstripMetrics[tier];
    res[label] = {
      requests: s.requestCount,
      dispatchToFirstMs: s.dispatchToFirstArtifactMs.snapshot().avgMs,
      cacheApplyMs: s.cacheApplyMs.snapshot().avgMs,
      paintCommitMs: s.paintCommitMs.snapshot().avgMs,
    };
  }
  return res;
}
