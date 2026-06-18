/**
 * Performance Tracing Utility
 *
 * Provides comprehensive performance measurement and logging infrastructure
 * for identifying bottlenecks and monitoring optimization impact.
 *
 * Usage:
 *   import { traceStart, traceEnd, traceMeasure } from '@/lib/debug/performanceTrace';
 *
 *   // Manual start/end
 *   traceStart('my-operation', { userId: 123 });
 *   // ... do work ...
 *   traceEnd('my-operation', { result: 'success' });
 *
 *   // Automatic measurement
 *   traceMeasure('my-sync-fn', () => {
 *     // ... do work ...
 *   });
 *
 *   // Async measurement
 *   await traceMeasureAsync('my-async-fn', async () => {
 *     // ... do async work ...
 *   });
 */

export interface TraceEntry {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, any>;
}

export interface TraceStats {
  count: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  p50Duration: number;
  p95Duration: number;
  p99Duration: number;
}

class PerformanceTracer {
  private traces = new Map<string, TraceEntry>();
  private enabled = import.meta.env.DEV;
  private buffer: TraceEntry[] = [];
  private maxBufferSize = 1000;
  private slowThreshold = 16; // Frame budget at 60fps

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  setSlowThreshold(ms: number) {
    this.slowThreshold = ms;
  }

  start(name: string, metadata?: Record<string, any>) {
    if (!this.enabled) return;

    const entry: TraceEntry = {
      name,
      startTime: performance.now(),
      metadata,
    };

    this.traces.set(name, entry);
    performance.mark(`${name}-start`);
  }

  end(name: string, metadata?: Record<string, any>) {
    if (!this.enabled) return;

    const entry = this.traces.get(name);
    if (!entry) {
      console.warn(`[PerformanceTracer] No start mark for: ${name}`);
      return;
    }

    entry.endTime = performance.now();
    entry.duration = entry.endTime - entry.startTime;
    entry.metadata = { ...entry.metadata, ...metadata };

    performance.mark(`${name}-end`);
    performance.measure(name, `${name}-start`, `${name}-end`);

    this.buffer.push({ ...entry });
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }

    this.traces.delete(name);

    // Log if duration exceeds threshold
    if (entry.duration > this.slowThreshold) {
      console.warn(`[Performance] ${name} took ${entry.duration.toFixed(2)}ms`, entry.metadata);
    }
  }

  measure(name: string, fn: () => void, metadata?: Record<string, any>) {
    this.start(name, metadata);
    try {
      fn();
    } finally {
      this.end(name);
    }
  }

  async measureAsync<T>(name: string, fn: () => Promise<T>, metadata?: Record<string, any>): Promise<T> {
    this.start(name, metadata);
    try {
      return await fn();
    } finally {
      this.end(name);
    }
  }

  getBuffer(): TraceEntry[] {
    return [...this.buffer];
  }

  getStats(name: string): TraceStats | null {
    const entries = this.buffer.filter((e) => e.name === name && e.duration !== undefined);
    if (entries.length === 0) return null;

    const durations = entries.map((e) => e.duration!).sort((a, b) => a - b);

    const percentile = (p: number) => {
      const index = Math.ceil((durations.length * p) / 100) - 1;
      return durations[Math.max(0, index)];
    };

    return {
      count: entries.length,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      p50Duration: percentile(50),
      p95Duration: percentile(95),
      p99Duration: percentile(99),
    };
  }

  getAllStats(): Record<string, TraceStats> {
    const uniqueNames = Array.from(new Set(this.buffer.map((e) => e.name)));
    const stats: Record<string, TraceStats> = {};

    for (const name of uniqueNames) {
      const stat = this.getStats(name);
      if (stat) {
        stats[name] = stat;
      }
    }

    return stats;
  }

  printStats(filter?: string) {
    const stats = this.getAllStats();
    const filtered = filter ? Object.entries(stats).filter(([name]) => name.includes(filter)) : Object.entries(stats);

    console.group("📊 Performance Statistics");
    for (const [name, stat] of filtered) {
      console.log(`\n${name}:`);
      console.log(`  Count: ${stat.count}`);
      console.log(`  Avg: ${stat.avgDuration.toFixed(2)}ms`);
      console.log(`  Min: ${stat.minDuration.toFixed(2)}ms`);
      console.log(`  Max: ${stat.maxDuration.toFixed(2)}ms`);
      console.log(`  P50: ${stat.p50Duration.toFixed(2)}ms`);
      console.log(`  P95: ${stat.p95Duration.toFixed(2)}ms`);
      console.log(`  P99: ${stat.p99Duration.toFixed(2)}ms`);
    }
    console.groupEnd();
  }

  clear() {
    this.traces.clear();
    this.buffer = [];
  }

  exportToJSON(): string {
    return JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        buffer: this.buffer,
        stats: this.getAllStats(),
      },
      null,
      2,
    );
  }
}

// Singleton instance
export const perfTrace = new PerformanceTracer();

// Convenience exports
export const traceStart = perfTrace.start.bind(perfTrace);
export const traceEnd = perfTrace.end.bind(perfTrace);
export const traceMeasure = perfTrace.measure.bind(perfTrace);
export const traceMeasureAsync = perfTrace.measureAsync.bind(perfTrace);
export const traceGetStats = perfTrace.getStats.bind(perfTrace);
export const tracePrintStats = perfTrace.printStats.bind(perfTrace);
export const traceExport = perfTrace.exportToJSON.bind(perfTrace);

// Development console access
if (import.meta.env.DEV) {
  (window as any).perfTrace = perfTrace;
}
