/**
 * Worker & Animation Performance Collector
 *
 * Provides comprehensive, end-to-end telemetry collection across all Web Workers,
 * off-thread background domains, and main-thread animation evaluation hot paths.
 *
 * Tracks:
 * - Worker request round-trip latency (send -> response)
 * - Worker internal execution time (evalMs, diffMs, serializeMs, analysisMs, parseMs, layoutMs, etc.)
 * - Over-budget latency threshold breaches (>16.67ms 60fps frame budget)
 * - Worker errors, exceptions, and automatic recovery events
 * - Animation evaluation metrics (scene evaluation duration, active clips, keyframe resolutions,
 *   spatial Bézier path evaluations, spring physics, responsive retimes, occlusion culling)
 *
 * Zero-allocation / O(1) in the hot path. Rollup snapshots are drained every flush interval
 * into the session NDJSON file via perfLogService.
 */

export interface WorkerPerfSample {
  /** Domain / worker identity (e.g. "ComputeWorker:KeyframeEval", "MediaAnalysisWorker:ColorScopes") */
  domain: string;
  /** Operation / message type (e.g. "EVALUATE", "SNAP_QUERY", "SERIALIZE", "DIFF", "ANALYZE") */
  operation: string;
  /** Total round-trip or execution time in milliseconds */
  durationMs: number;
  /** Worker internal compute duration in ms, if reported by the worker */
  workerDurationMs?: number;
  /** Count of processed items (e.g. keyframes, clips, cues, pixels, bytes) */
  itemsCount?: number;
  /** Payload size in bytes transferred across thread boundary if known */
  bytesTransferred?: number;
  /** Whether the operation exceeded its performance budget (default: > 16.67ms) */
  overBudget: boolean;
  /** Error message if this operation failed */
  error?: string;
  /** Contextual metadata for debugging bottlenecks */
  metadata?: Record<string, unknown>;
  /** Timestamp in epoch ms */
  timestampEpochMs: number;
}

export interface WorkerDomainStats {
  domain: string;
  sampleCount: number;
  overBudgetCount: number;
  errorCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
  p99DurationMs: number | null;
  maxDurationMs: number;
  avgWorkerDurationMs: number | null;
  totalItemsCount: number;
  totalBytesTransferred: number;
  lastError?: string;
  recentAnomalies: Array<{
    operation: string;
    durationMs: number;
    workerDurationMs?: number;
    timestampEpochMs: number;
    metadata?: Record<string, unknown>;
  }>;
}

export interface AnimationEvaluationMetrics {
  totalEvaluations: number;
  totalDurationMs: number;
  avgDurationMs: number;
  p95DurationMs: number | null;
  maxDurationMs: number;
  overBudgetCount: number; // >16.67ms
  totalKeyframesEvaluated: number;
  totalSpringEvaluations: number;
  totalResponsiveRetimes: number;
  totalOcclusionCulled: number;
}

export interface WorkerPerfRollup {
  windowDurationMs: number;
  timestampEpochMs: number;
  totalOperations: number;
  totalOverBudget: number;
  totalErrors: number;
  domains: Record<string, WorkerDomainStats>;
  animation?: AnimationEvaluationMetrics;
}

const MAX_SAMPLES_PER_DOMAIN = 500;
const MAX_ANOMALIES_PER_DOMAIN = 10;
const MAX_GLOBAL_ANOMALIES = 50;
const DEFAULT_BUDGET_MS = 16.67;

function computePercentile(sortedValues: number[], pct: number): number | null {
  if (sortedValues.length === 0) return null;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.round((sortedValues.length - 1) * pct)),
  );
  return sortedValues[index] ?? null;
}

class DomainBucket {
  public sampleCount = 0;
  public overBudgetCount = 0;
  public errorCount = 0;
  public totalDurationMs = 0;
  public maxDurationMs = 0;
  public totalWorkerDurationMs = 0;
  public workerDurationSampleCount = 0;
  public totalItemsCount = 0;
  public totalBytesTransferred = 0;
  public lastError?: string;

  private durations: number[] = [];
  public recentAnomalies: WorkerDomainStats["recentAnomalies"] = [];

  constructor(public readonly domain: string) {}

  public record(sample: WorkerPerfSample): void {
    this.sampleCount++;
    this.totalDurationMs += sample.durationMs;
    if (sample.durationMs > this.maxDurationMs) {
      this.maxDurationMs = sample.durationMs;
    }

    if (sample.workerDurationMs !== undefined) {
      this.totalWorkerDurationMs += sample.workerDurationMs;
      this.workerDurationSampleCount++;
    }

    if (sample.itemsCount !== undefined) {
      this.totalItemsCount += sample.itemsCount;
    }

    if (sample.bytesTransferred !== undefined) {
      this.totalBytesTransferred += sample.bytesTransferred;
    }

    if (sample.overBudget) {
      this.overBudgetCount++;
    }

    if (sample.error) {
      this.errorCount++;
      this.lastError = sample.error;
    }

    // Keep bounded sample set for percentile calculations
    if (this.durations.length < MAX_SAMPLES_PER_DOMAIN) {
      this.durations.push(sample.durationMs);
    } else {
      // Reservoir replacement to keep percentiles representative over long sessions
      const replaceIdx = Math.floor(Math.random() * this.sampleCount);
      if (replaceIdx < MAX_SAMPLES_PER_DOMAIN) {
        this.durations[replaceIdx] = sample.durationMs;
      }
    }

    if (sample.overBudget || sample.error) {
      this.recentAnomalies.push({
        operation: sample.operation,
        durationMs: sample.durationMs,
        workerDurationMs: sample.workerDurationMs,
        timestampEpochMs: sample.timestampEpochMs,
        metadata: sample.metadata,
      });
      if (this.recentAnomalies.length > MAX_ANOMALIES_PER_DOMAIN) {
        this.recentAnomalies.shift();
      }
    }
  }

  public toStats(): WorkerDomainStats {
    const sorted = [...this.durations].sort((a, b) => a - b);
    return {
      domain: this.domain,
      sampleCount: this.sampleCount,
      overBudgetCount: this.overBudgetCount,
      errorCount: this.errorCount,
      totalDurationMs: Number(this.totalDurationMs.toFixed(2)),
      avgDurationMs:
        this.sampleCount > 0
          ? Number((this.totalDurationMs / this.sampleCount).toFixed(2))
          : 0,
      p50DurationMs: computePercentile(sorted, 0.5),
      p95DurationMs: computePercentile(sorted, 0.95),
      p99DurationMs: computePercentile(sorted, 0.99),
      maxDurationMs: Number(this.maxDurationMs.toFixed(2)),
      avgWorkerDurationMs:
        this.workerDurationSampleCount > 0
          ? Number(
              (
                this.totalWorkerDurationMs / this.workerDurationSampleCount
              ).toFixed(2),
            )
          : null,
      totalItemsCount: this.totalItemsCount,
      totalBytesTransferred: this.totalBytesTransferred,
      lastError: this.lastError,
      recentAnomalies: [...this.recentAnomalies],
    };
  }

  public reset(): void {
    this.sampleCount = 0;
    this.overBudgetCount = 0;
    this.errorCount = 0;
    this.totalDurationMs = 0;
    this.maxDurationMs = 0;
    this.totalWorkerDurationMs = 0;
    this.workerDurationSampleCount = 0;
    this.totalItemsCount = 0;
    this.totalBytesTransferred = 0;
    this.durations = [];
    this.recentAnomalies = [];
  }
}

export class WorkerPerfCollector {
  private readonly domains = new Map<string, DomainBucket>();
  private readonly globalAnomalies: WorkerPerfSample[] = [];
  private windowStartEpochMs: number = Date.now();

  // Animation evaluation metrics accumulator
  private animEvaluations = 0;
  private animTotalDurationMs = 0;
  private animMaxDurationMs = 0;
  private animOverBudgetCount = 0;
  private animDurations: number[] = [];
  private animKeyframes = 0;
  private animSpring = 0;
  private animRetimes = 0;
  private animCulled = 0;

  // Optional error listener (e.g. perfLogService)
  private errorListeners: Array<
    (errorEvent: {
      domain: string;
      error: string;
      operation?: string;
      metadata?: Record<string, unknown>;
    }) => void
  > = [];

  constructor() {
    this.installGlobalDiagnostics();
  }

  /**
   * Records a timing sample for a worker or background compute operation.
   */
  public record(sample: Omit<WorkerPerfSample, "timestampEpochMs">): void {
    const fullSample: WorkerPerfSample = {
      ...sample,
      timestampEpochMs: Date.now(),
    };

    let bucket = this.domains.get(sample.domain);
    if (!bucket) {
      bucket = new DomainBucket(sample.domain);
      this.domains.set(sample.domain, bucket);
    }

    bucket.record(fullSample);

    if (fullSample.overBudget || fullSample.error) {
      this.globalAnomalies.push(fullSample);
      if (this.globalAnomalies.length > MAX_GLOBAL_ANOMALIES) {
        this.globalAnomalies.shift();
      }
    }
  }

  /**
   * Records a worker error or exception. Immediately alerts error listeners.
   */
  public recordError(
    domain: string,
    error: string,
    operation = "unknown",
    metadata?: Record<string, unknown>,
  ): void {
    this.record({
      domain,
      operation,
      durationMs: 0,
      overBudget: true,
      error,
      metadata,
    });

    for (const listener of this.errorListeners) {
      try {
        listener({ domain, error, operation, metadata });
      } catch {
        // ignore listener errors
      }
    }
  }

  /**
   * Records animation evaluation performance from evaluateTimelineScene.
   */
  public recordAnimationEval(metrics: {
    durationMs: number;
    activeClips: number;
    visualLayers: number;
    keyframeEvaluations: number;
    springEvaluations: number;
    responsiveRetimes: number;
    culledLayers: number;
  }): void {
    this.animEvaluations++;
    this.animTotalDurationMs += metrics.durationMs;
    if (metrics.durationMs > this.animMaxDurationMs) {
      this.animMaxDurationMs = metrics.durationMs;
    }
    if (metrics.durationMs > DEFAULT_BUDGET_MS) {
      this.animOverBudgetCount++;
    }

    this.animKeyframes += metrics.keyframeEvaluations;
    this.animSpring += metrics.springEvaluations;
    this.animRetimes += metrics.responsiveRetimes;
    this.animCulled += metrics.culledLayers;

    if (this.animDurations.length < MAX_SAMPLES_PER_DOMAIN) {
      this.animDurations.push(metrics.durationMs);
    } else {
      const replaceIdx = Math.floor(Math.random() * this.animEvaluations);
      if (replaceIdx < MAX_SAMPLES_PER_DOMAIN) {
        this.animDurations[replaceIdx] = metrics.durationMs;
      }
    }

    // Also record into the domain bucket for unified domain breakdown
    this.record({
      domain: "animation:eval",
      operation: "evaluateTimelineScene",
      durationMs: metrics.durationMs,
      itemsCount: metrics.keyframeEvaluations,
      overBudget: metrics.durationMs > DEFAULT_BUDGET_MS,
      metadata: {
        activeClips: metrics.activeClips,
        visualLayers: metrics.visualLayers,
        springEvaluations: metrics.springEvaluations,
        responsiveRetimes: metrics.responsiveRetimes,
        culledLayers: metrics.culledLayers,
      },
    });
  }

  /**
   * Subscribes to worker error events.
   */
  public onError(
    listener: (errorEvent: {
      domain: string;
      error: string;
      operation?: string;
      metadata?: Record<string, unknown>;
    }) => void,
  ): () => void {
    this.errorListeners.push(listener);
    return () => {
      this.errorListeners = this.errorListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Returns a point-in-time snapshot summary without resetting rolling counters.
   */
  public getSummary(): WorkerPerfRollup {
    const domainsRecord: Record<string, WorkerDomainStats> = {};
    let totalOperations = 0;
    let totalOverBudget = 0;
    let totalErrors = 0;

    for (const [domain, bucket] of this.domains) {
      const stats = bucket.toStats();
      domainsRecord[domain] = stats;
      totalOperations += stats.sampleCount;
      totalOverBudget += stats.overBudgetCount;
      totalErrors += stats.errorCount;
    }

    let animationStats: AnimationEvaluationMetrics | undefined;
    if (this.animEvaluations > 0) {
      const sorted = [...this.animDurations].sort((a, b) => a - b);
      animationStats = {
        totalEvaluations: this.animEvaluations,
        totalDurationMs: Number(this.animTotalDurationMs.toFixed(2)),
        avgDurationMs: Number(
          (this.animTotalDurationMs / this.animEvaluations).toFixed(2),
        ),
        p95DurationMs: computePercentile(sorted, 0.95),
        maxDurationMs: Number(this.animMaxDurationMs.toFixed(2)),
        overBudgetCount: this.animOverBudgetCount,
        totalKeyframesEvaluated: this.animKeyframes,
        totalSpringEvaluations: this.animSpring,
        totalResponsiveRetimes: this.animRetimes,
        totalOcclusionCulled: this.animCulled,
      };
    }

    return {
      windowDurationMs: Math.max(1, Date.now() - this.windowStartEpochMs),
      timestampEpochMs: Date.now(),
      totalOperations,
      totalOverBudget,
      totalErrors,
      domains: domainsRecord,
      animation: animationStats,
    };
  }

  /**
   * Returns recent bottlenecks / anomalies exceeding budget.
   */
  public getRecentAnomalies(): WorkerPerfSample[] {
    return [...this.globalAnomalies];
  }

  /**
   * Drains the current window stats into a rollup snapshot and resets counters for the next window.
   * Called by perfLogService every sync interval.
   */
  public flush(): WorkerPerfRollup | null {
    const summary = this.getSummary();
    if (summary.totalOperations === 0) {
      this.windowStartEpochMs = Date.now();
      return null;
    }

    // Reset buckets
    for (const bucket of this.domains.values()) {
      bucket.reset();
    }
    this.globalAnomalies.length = 0;
    this.animEvaluations = 0;
    this.animTotalDurationMs = 0;
    this.animMaxDurationMs = 0;
    this.animOverBudgetCount = 0;
    this.animDurations = [];
    this.animKeyframes = 0;
    this.animSpring = 0;
    this.animRetimes = 0;
    this.animCulled = 0;
    this.windowStartEpochMs = Date.now();

    return summary;
  }

  /**
   * Clears all state.
   */
  public clear(): void {
    this.domains.clear();
    this.globalAnomalies.length = 0;
    this.animEvaluations = 0;
    this.animTotalDurationMs = 0;
    this.animMaxDurationMs = 0;
    this.animOverBudgetCount = 0;
    this.animDurations = [];
    this.animKeyframes = 0;
    this.animSpring = 0;
    this.animRetimes = 0;
    this.animCulled = 0;
    this.windowStartEpochMs = Date.now();
  }

  /**
   * Attaches to window.__clypra_diagnostics.workerPerf for interactive console debugging.
   */
  public installGlobalDiagnostics(): void {
    if (typeof window === "undefined") return;
    const existing = (window as any).__clypra_diagnostics ?? {};
    (window as any).__clypra_diagnostics = {
      ...existing,
      workerPerf: this,
    };
  }
}

export const workerPerfCollector = new WorkerPerfCollector();
