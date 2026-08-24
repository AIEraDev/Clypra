/**
 * Frontend Filmstrip Request & Render Metrics
 *
 * Tracks request counts, dispatch-to-first-artifact latency, cache application time,
 * and paint commit latency aggregated per SpatialTier (L0/L1/L2/L3).
 *
 * Automatically flushes a periodic console.table summary every 5 seconds.
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

export interface TierMetricsRow {
  tier: string;
  "req/5s": number;
  "dispatch→first(ms)": number;
  "cacheApply(ms)": number;
  "paintCommit(ms)": number;
}

let flushLoopStarted = false;

/**
 * Start the 5-second console.table summary loop.
 */
export function startMetricsFlushLoop(intervalMs = 5000): void {
  if (flushLoopStarted || typeof window === "undefined") return;
  flushLoopStarted = true;

  setInterval(() => {
    const rows: TierMetricsRow[] = [];
    const tiers: Array<{ tier: SpatialTier; label: string }> = [
      { tier: SpatialTier.L0, label: "L0 (160x90)" },
      { tier: SpatialTier.L1, label: "L1 (240x135)" },
      { tier: SpatialTier.L2, label: "L2 (320x180)" },
      { tier: SpatialTier.L3, label: "L3 (480x270)" },
    ];

    let hasActivity = false;

    for (const { tier, label } of tiers) {
      const stats = filmstripMetrics[tier];
      const reqCount = stats.requestCount;
      stats.requestCount = 0; // reset window counter

      const firstLat = stats.dispatchToFirstArtifactMs.takeAndReset();
      const cacheApp = stats.cacheApplyMs.takeAndReset();
      const paintCom = stats.paintCommitMs.takeAndReset();

      if (reqCount > 0 || firstLat.n > 0 || cacheApp.n > 0 || paintCom.n > 0) {
        hasActivity = true;
        rows.push({
          tier: label,
          "req/5s": reqCount,
          "dispatch→first(ms)": firstLat.avgMs,
          "cacheApply(ms)": cacheApp.avgMs,
          "paintCommit(ms)": paintCom.avgMs,
        });
      }
    }

    if (hasActivity && console.table) {
      console.log("🎬 [Filmstrip Frontend Metrics: 5s Window]");
      console.table(rows);
    }
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
