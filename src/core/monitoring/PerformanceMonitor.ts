/**
 * Performance Monitoring & Telemetry System
 *
 * Tracks key performance metrics across the application:
 * - Decoder pool hit/miss rates
 * - Memory pressure and eviction rates
 * - Export pipeline performance
 * - Preview rendering performance
 *
 * Architecture:
 * - Lightweight metrics collection (< 1ms overhead)
 * - Aggregated statistics (not per-frame logging)
 * - Console-friendly output for development
 * - Extensible for production telemetry backends
 */

export interface MetricSnapshot {
  timestamp: number;
  name: string;
  value: number;
  unit: string;
  tags?: Record<string, string>;
}

export interface AggregatedMetrics {
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

class PerformanceMonitorImpl {
  private metrics = new Map<string, number[]>();
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private startTimes = new Map<string, number>();

  // Configuration
  private maxSamplesPerMetric = 1000; // Keep last 1000 samples
  private flushIntervalMs = 10000; // Log summary every 10s
  private flushTimer: number | null = null;
  private enabled = true;

  constructor() {
    if (typeof window !== "undefined") {
      // Auto-flush on interval
      this.flushTimer = window.setInterval(() => {
        this.flush();
      }, this.flushIntervalMs);

      // Expose for debugging
      (window as any).__performanceMonitor = this;
    }
  }

  /**
   * Enable/disable monitoring (useful for production)
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Record a timing metric (in milliseconds)
   */
  timing(name: string, durationMs: number, tags?: Record<string, string>): void {
    if (!this.enabled) return;

    const key = this.getKey(name, tags);
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }

    const samples = this.metrics.get(key)!;
    samples.push(durationMs);

    // Keep only recent samples
    if (samples.length > this.maxSamplesPerMetric) {
      samples.shift();
    }
  }

  /**
   * Start a timer for a named operation
   */
  startTimer(name: string, tags?: Record<string, string>): void {
    if (!this.enabled) return;
    const key = this.getKey(name, tags);
    this.startTimes.set(key, performance.now());
  }

  /**
   * End a timer and record the duration
   */
  endTimer(name: string, tags?: Record<string, string>): number {
    if (!this.enabled) return 0;

    const key = this.getKey(name, tags);
    const startTime = this.startTimes.get(key);

    if (startTime === undefined) {
      console.warn(`[PerformanceMonitor] No start time found for: ${key}`);
      return 0;
    }

    const duration = performance.now() - startTime;
    this.startTimes.delete(key);
    this.timing(name, duration, tags);

    return duration;
  }

  /**
   * Increment a counter (e.g., cache hits, errors)
   */
  increment(name: string, delta: number = 1, tags?: Record<string, string>): void {
    if (!this.enabled) return;

    const key = this.getKey(name, tags);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + delta);
  }

  /**
   * Set a gauge value (e.g., pool size, memory usage)
   */
  gauge(name: string, value: number, tags?: Record<string, string>): void {
    if (!this.enabled) return;

    const key = this.getKey(name, tags);
    this.gauges.set(key, value);
  }

  /**
   * Get aggregated statistics for a metric
   */
  getStats(name: string, tags?: Record<string, string>): AggregatedMetrics | null {
    const key = this.getKey(name, tags);
    const samples = this.metrics.get(key);

    if (!samples || samples.length === 0) {
      return null;
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, val) => acc + val, 0);

    return {
      count: sorted.length,
      sum,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / sorted.length,
      p50: this.percentile(sorted, 50),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
    };
  }

  /**
   * Get current counter value
   */
  getCounter(name: string, tags?: Record<string, string>): number {
    const key = this.getKey(name, tags);
    return this.counters.get(key) || 0;
  }

  /**
   * Get current gauge value
   */
  getGauge(name: string, tags?: Record<string, string>): number | null {
    const key = this.getKey(name, tags);
    return this.gauges.get(key) ?? null;
  }

  /**
   * Flush and log all metrics
   */
  flush(): void {
    if (!this.enabled) return;

    const report: string[] = [];
    // report.push("\n═══════════════════════════════════════════════════════════");
    // report.push("🔍 Performance Monitor Report");
    // report.push("═══════════════════════════════════════════════════════════");

    // Timings
    if (this.metrics.size > 0) {
      report.push("\n📊 Timings (ms):");
      for (const [key, _] of this.metrics) {
        const stats = this.getStats(key.split("|")[0], this.parseTags(key));
        if (stats) {
          report.push(`  ${key.padEnd(40)} ` + `avg: ${stats.avg.toFixed(2).padStart(8)} ` + `p95: ${stats.p95.toFixed(2).padStart(8)} ` + `p99: ${stats.p99.toFixed(2).padStart(8)} ` + `(n=${stats.count})`);
        }
      }
    }

    // Counters
    if (this.counters.size > 0) {
      report.push("\n📈 Counters:");
      for (const [key, value] of this.counters) {
        report.push(`  ${key.padEnd(40)} ${value.toString().padStart(10)}`);
      }
    }

    // Gauges
    if (this.gauges.size > 0) {
      report.push("\n📏 Gauges:");
      for (const [key, value] of this.gauges) {
        report.push(`  ${key.padEnd(40)} ${value.toString().padStart(10)}`);
      }
    }

    report.push("═══════════════════════════════════════════════════════════\n");

    console.log(report.join("\n"));
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear();
    this.counters.clear();
    this.gauges.clear();
    this.startTimes.clear();
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.reset();
  }

  // Helper methods
  private getKey(name: string, tags?: Record<string, string>): string {
    if (!tags || Object.keys(tags).length === 0) {
      return name;
    }
    const tagStr = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return `${name}|${tagStr}`;
  }

  private parseTags(key: string): Record<string, string> | undefined {
    const parts = key.split("|");
    if (parts.length < 2) return undefined;

    const tags: Record<string, string> = {};
    parts[1].split(",").forEach((pair) => {
      const [k, v] = pair.split("=");
      tags[k] = v;
    });
    return tags;
  }

  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil((sorted.length * p) / 100) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitorImpl();

// Convenience functions
export const timing = (name: string, durationMs: number, tags?: Record<string, string>) => performanceMonitor.timing(name, durationMs, tags);

export const startTimer = (name: string, tags?: Record<string, string>) => performanceMonitor.startTimer(name, tags);

export const endTimer = (name: string, tags?: Record<string, string>) => performanceMonitor.endTimer(name, tags);

export const increment = (name: string, delta?: number, tags?: Record<string, string>) => performanceMonitor.increment(name, delta, tags);

export const gauge = (name: string, value: number, tags?: Record<string, string>) => performanceMonitor.gauge(name, value, tags);
