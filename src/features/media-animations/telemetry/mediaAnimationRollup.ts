/**
 * Media Animation Session Rollup Collector
 *
 * Aggregates per-operation telemetry across the lifetime of a flush window
 * and produces a compact `MediaAnimationRollupSummary` on `flush()`.
 *
 * Called by `perfLogService.flushAnimationRollupSummary()` on each poll interval
 * and at session close.
 *
 * Follows the filmstripTelemetry rollup pattern: accumulate in-process,
 * flush-and-clear on every interval, export singleton.
 */

// ─── Summary interface ────────────────────────────────────────────────────────

export interface MediaAnimationRollupSummary {
  catalogFetches: {
    count: number;
    avgDurationMs: number;
    errorRate: number;
    byCategory: Record<"in" | "out" | "combo", number>;
  };
  downloads: {
    count: number;
    cacheHitRate: number;
    avgDurationMs: number;
    totalSizeBytes: number;
    errorRate: number;
  };
  animationEvals: {
    count: number;
    avgDurationMs: number;
    p95DurationMs: number;
  };
  hydrations: {
    count: number;
    avgManifests: number;
    avgDurationMs: number;
  };
}

// ─── Collector class ──────────────────────────────────────────────────────────

export class MediaAnimationRollupCollector {
  // Catalog fetch accumulators
  private catalogFetches: {
    count: number;
    totalDurationMs: number;
    errorCount: number;
    byCategory: Record<"in" | "out" | "combo", number>;
  } = {
    count: 0,
    totalDurationMs: 0,
    errorCount: 0,
    byCategory: { in: 0, out: 0, combo: 0 },
  };

  // Manifest download accumulators
  private downloads: {
    count: number;
    cacheHits: number;
    cacheMisses: number;
    totalDurationMs: number;
    totalSizeBytes: number;
    errorCount: number;
  } = {
    count: 0,
    cacheHits: 0,
    cacheMisses: 0,
    totalDurationMs: 0,
    totalSizeBytes: 0,
    errorCount: 0,
  };

  // Animation eval accumulators
  private animationEvals: {
    count: number;
    totalDurationMs: number;
    durations: number[];
    maxPresetCount: number;
  } = {
    count: 0,
    totalDurationMs: 0,
    durations: [],
    maxPresetCount: 0,
  };

  // Cache hydration accumulators
  private hydrations: {
    count: number;
    totalManifests: number;
    totalDurationMs: number;
  } = {
    count: 0,
    totalManifests: 0,
    totalDurationMs: 0,
  };

  // ── Public record methods ─────────────────────────────────────────────────

  recordCatalogFetch(
    category: "in" | "out" | "combo",
    durationMs: number,
    error: boolean,
  ): void {
    this.catalogFetches.count++;
    this.catalogFetches.totalDurationMs += durationMs;
    if (error) this.catalogFetches.errorCount++;
    this.catalogFetches.byCategory[category]++;
  }

  recordDownload(
    cacheHit: boolean,
    durationMs: number,
    sizeBytes: number,
    error: boolean,
  ): void {
    this.downloads.count++;
    this.downloads.totalDurationMs += durationMs;
    this.downloads.totalSizeBytes += sizeBytes;
    if (error) {
      this.downloads.errorCount++;
    } else if (cacheHit) {
      this.downloads.cacheHits++;
    } else {
      this.downloads.cacheMisses++;
    }
  }

  recordAnimationEval(durationMs: number, presetCount: number): void {
    this.animationEvals.count++;
    this.animationEvals.totalDurationMs += durationMs;
    this.animationEvals.durations.push(durationMs);
    if (presetCount > this.animationEvals.maxPresetCount) {
      this.animationEvals.maxPresetCount = presetCount;
    }
  }

  recordHydration(manifestCount: number, durationMs: number): void {
    this.hydrations.count++;
    this.hydrations.totalManifests += manifestCount;
    this.hydrations.totalDurationMs += durationMs;
  }

  /** Returns true if any counter has been incremented since the last flush. */
  hasRecordedData(): boolean {
    return (
      this.catalogFetches.count > 0 ||
      this.downloads.count > 0 ||
      this.animationEvals.count > 0 ||
      this.hydrations.count > 0
    );
  }

  /**
   * Computes and returns the summary for the current window, then clears
   * all accumulators so the next window starts fresh.
   */
  flush(): MediaAnimationRollupSummary {
    const cf = this.catalogFetches;
    const dl = this.downloads;
    const ae = this.animationEvals;
    const hy = this.hydrations;

    const catalogAvgDuration =
      cf.count > 0 ? cf.totalDurationMs / cf.count : 0;
    const catalogErrorRate = cf.count > 0 ? cf.errorCount / cf.count : 0;

    const dlAvgDuration = dl.count > 0 ? dl.totalDurationMs / dl.count : 0;
    // Cache hit rate excludes error entries (they are neither hits nor misses)
    const dlNonError = dl.cacheHits + dl.cacheMisses;
    const dlCacheHitRate = dlNonError > 0 ? dl.cacheHits / dlNonError : 0;
    const dlErrorRate = dl.count > 0 ? dl.errorCount / dl.count : 0;

    const aeAvgDuration =
      ae.count > 0 ? ae.totalDurationMs / ae.count : 0;

    // p95: sort durations and pick the value at ceil(n * 0.95) - 1
    const p95Duration =
      ae.durations.length > 0
        ? (() => {
            const sorted = [...ae.durations].sort((a, b) => a - b);
            return sorted[
              Math.min(
                sorted.length - 1,
                Math.ceil(sorted.length * 0.95) - 1,
              )
            ];
          })()
        : 0;

    const hyAvgManifests =
      hy.count > 0 ? hy.totalManifests / hy.count : 0;
    const hyAvgDuration =
      hy.count > 0 ? hy.totalDurationMs / hy.count : 0;

    const summary: MediaAnimationRollupSummary = {
      catalogFetches: {
        count: cf.count,
        avgDurationMs: Math.round(catalogAvgDuration * 100) / 100,
        errorRate: Math.round(catalogErrorRate * 1000) / 1000,
        byCategory: { ...cf.byCategory },
      },
      downloads: {
        count: dl.count,
        cacheHitRate: Math.round(dlCacheHitRate * 1000) / 1000,
        avgDurationMs: Math.round(dlAvgDuration * 100) / 100,
        totalSizeBytes: dl.totalSizeBytes,
        errorRate: Math.round(dlErrorRate * 1000) / 1000,
      },
      animationEvals: {
        count: ae.count,
        avgDurationMs: Math.round(aeAvgDuration * 100) / 100,
        p95DurationMs: p95Duration,
      },
      hydrations: {
        count: hy.count,
        avgManifests: Math.round(hyAvgManifests * 100) / 100,
        avgDurationMs: Math.round(hyAvgDuration * 100) / 100,
      },
    };

    this.clear();
    return summary;
  }

  /** Resets all accumulators to their initial zero state. */
  clear(): void {
    this.catalogFetches = {
      count: 0,
      totalDurationMs: 0,
      errorCount: 0,
      byCategory: { in: 0, out: 0, combo: 0 },
    };
    this.downloads = {
      count: 0,
      cacheHits: 0,
      cacheMisses: 0,
      totalDurationMs: 0,
      totalSizeBytes: 0,
      errorCount: 0,
    };
    this.animationEvals = {
      count: 0,
      totalDurationMs: 0,
      durations: [],
      maxPresetCount: 0,
    };
    this.hydrations = {
      count: 0,
      totalManifests: 0,
      totalDurationMs: 0,
    };
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const mediaAnimationRollup = new MediaAnimationRollupCollector();
