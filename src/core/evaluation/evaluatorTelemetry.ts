/**
 * evaluatorTelemetry.ts — Evaluator & Interval-Tree Performance Telemetry (Tier 1)
 *
 * Phase 4 of Clypra Multi-Tier Optimization: Multi-Tier Telemetry.
 *
 * Design:
 *   - Module-level singleton, zero-allocation in the hot path.
 *   - 128-sample Float64Array ring buffer for query durations — no GC pressure.
 *   - Rolling counters for evaluations, queries, rebuilds, clips scanned/matched,
 *     and cache hits/misses.
 *   - p95 computed by sorting a copy of the ring buffer — called only on getSnapshot().
 */

/** Snapshot of evaluator and interval-tree performance counters. */
export interface EvaluatorTelemetrySnapshot {
  /** Total number of full evaluations performed since last reset. */
  evaluationsTotal: number;
  /** Total interval-tree queries performed since last reset. */
  intervalTreeQueriesTotal: number;
  /** Total interval-tree rebuilds triggered since last reset. */
  intervalTreeRebuildsTotal: number;
  /** N — cumulative clips scanned before spatial query (all evaluations). */
  totalClipsScanned: number;
  /** K — cumulative clips matched after spatial query (all evaluations). */
  totalClipsMatched: number;
  /** Rolling average query duration in microseconds (last 128 samples). */
  avgQueryDurationUs: number;
  /** 95th-percentile query duration in microseconds (last 128 samples). */
  p95QueryDurationUs: number;
  /** Cache-hit ratio in the range 0.0–1.0. */
  cacheHitRatio: number;
}

const RING_SIZE = 128;

class EvaluatorTelemetry {
  // Fixed 128-sample ring buffer — Float64Array avoids GC in hot path.
  private readonly _ring: Float64Array = new Float64Array(RING_SIZE);
  private _ringHead = 0;
  private _ringCount = 0;
  private _runningSumUs = 0;

  // Rolling counters
  private _evaluationsTotal = 0;
  private _intervalTreeQueriesTotal = 0;
  private _intervalTreeRebuildsTotal = 0;
  private _totalClipsScanned = 0;
  private _totalClipsMatched = 0;
  private _cacheHits = 0;
  private _cacheMisses = 0;

  /**
   * Record a single evaluation pass.
   *
   * @param clipsScanned N — total clips considered before spatial index query.
   * @param clipsMatched K — clips active at the query time (after spatial filter).
   * @param durationUs   Duration of the interval-tree query in microseconds.
   * @param cacheHit     Whether this evaluation was served from cache.
   */
  recordEvaluation(
    clipsScanned: number,
    clipsMatched: number,
    durationUs: number,
    cacheHit: boolean,
  ): void {
    this._evaluationsTotal++;
    this._intervalTreeQueriesTotal++;
    this._totalClipsScanned += clipsScanned;
    this._totalClipsMatched += clipsMatched;

    if (cacheHit) {
      this._cacheHits++;
    } else {
      this._cacheMisses++;
    }

    // Update ring buffer and running sum.
    const slot = this._ringHead & (RING_SIZE - 1);
    if (this._ringCount === RING_SIZE) {
      // Evict oldest value from running sum.
      this._runningSumUs -= this._ring[slot];
    } else {
      this._ringCount++;
    }
    this._ring[slot] = durationUs;
    this._runningSumUs += durationUs;
    this._ringHead = (this._ringHead + 1) & (RING_SIZE - 1);
  }

  /** Record a single interval-tree rebuild event. */
  recordIntervalTreeRebuild(): void {
    this._intervalTreeRebuildsTotal++;
  }

  /** Return a snapshot of current telemetry. Allocates only during this call. */
  getSnapshot(): EvaluatorTelemetrySnapshot {
    const count = this._ringCount;
    const avgQueryDurationUs = count > 0 ? this._runningSumUs / count : 0;

    let p95QueryDurationUs = 0;
    if (count > 0) {
      // Copy only the populated portion of the ring for sorting.
      const samples = new Float64Array(count);
      for (let i = 0; i < count; i++) {
        // Ring entries are stored from (head - count) onwards, wrapping.
        samples[i] = this._ring[(this._ringHead - count + i + RING_SIZE) & (RING_SIZE - 1)];
      }
      samples.sort();
      const p95Index = Math.min(Math.floor(count * 0.95), count - 1);
      p95QueryDurationUs = samples[p95Index];
    }

    const totalCacheAccesses = this._cacheHits + this._cacheMisses;
    const cacheHitRatio = totalCacheAccesses > 0 ? this._cacheHits / totalCacheAccesses : 0;

    return {
      evaluationsTotal: this._evaluationsTotal,
      intervalTreeQueriesTotal: this._intervalTreeQueriesTotal,
      intervalTreeRebuildsTotal: this._intervalTreeRebuildsTotal,
      totalClipsScanned: this._totalClipsScanned,
      totalClipsMatched: this._totalClipsMatched,
      avgQueryDurationUs,
      p95QueryDurationUs,
      cacheHitRatio,
    };
  }

  /** Reset all counters and the ring buffer. */
  reset(): void {
    this._ring.fill(0);
    this._ringHead = 0;
    this._ringCount = 0;
    this._runningSumUs = 0;
    this._evaluationsTotal = 0;
    this._intervalTreeQueriesTotal = 0;
    this._intervalTreeRebuildsTotal = 0;
    this._totalClipsScanned = 0;
    this._totalClipsMatched = 0;
    this._cacheHits = 0;
    this._cacheMisses = 0;
  }
}

/** Module-level singleton for evaluator and interval-tree telemetry. */
export const evaluatorTelemetry = new EvaluatorTelemetry();
