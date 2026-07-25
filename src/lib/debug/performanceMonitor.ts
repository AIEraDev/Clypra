/**
 * Performance Monitor
 *
 * Usage:
 * 1. Enable monitoring: localStorage.setItem("vireostudio.debug.performance", "1")
 * 2. Refresh page
 * 3. Use performanceMonitor.startMeasure() / endMeasure() in your code
 * 4. Check console for performance reports
 */

const DEBUG_KEY = "vireostudio.debug.performance";

export function isPerformanceMonitorEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage?.getItem(DEBUG_KEY) === "1";
}

interface PerformanceMeasurement {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

class PerformanceMonitor {
  private measurements: PerformanceMeasurement[] = [];
  private marks: Map<string, number> = new Map();
  private renderCounts: Map<string, number> = new Map();

  /**
   * Start timing an operation
   */
  startMeasure(name: string, metadata?: Record<string, unknown>): void {
    if (!isPerformanceMonitorEnabled()) return;

    const key = `${name}-${Date.now()}`;
    this.marks.set(key, performance.now());

    if (metadata) {
      console.log(`🔷 [PerfStart] ${name}`, metadata);
    }
  }

  /**
   * End timing an operation and log the result
   */
  endMeasure(name: string, metadata?: Record<string, unknown>): number | null {
    if (!isPerformanceMonitorEnabled()) return null;

    // Find the most recent mark with this name
    const matchingKeys = Array.from(this.marks.keys()).filter((k) => k.startsWith(name));
    if (matchingKeys.length === 0) {
      console.warn(`⚠️ [PerfMonitor] No start mark found for: ${name}`);
      return null;
    }

    const key = matchingKeys[matchingKeys.length - 1];
    const startTime = this.marks.get(key);

    if (startTime === undefined) return null;

    const endTime = performance.now();
    const duration = endTime - startTime;

    this.marks.delete(key);

    const measurement: PerformanceMeasurement = {
      name,
      duration,
      timestamp: Date.now(),
      metadata,
    };

    this.measurements.push(measurement);

    // Color code based on duration
    const emoji = duration < 16 ? "✅" : duration < 50 ? "⚠️" : "🔴";
    const color = duration < 16 ? "color: green" : duration < 50 ? "color: orange" : "color: red";

    console.log(`%c${emoji} [PerfEnd] ${name}: ${duration.toFixed(2)}ms`, color, metadata || "");

    return duration;
  }

  /**
   * Measure a function execution time
   */
  async measureAsync<T>(name: string, fn: () => Promise<T>, metadata?: Record<string, unknown>): Promise<T> {
    this.startMeasure(name, metadata);
    try {
      const result = await fn();
      this.endMeasure(name);
      return result;
    } catch (error) {
      this.endMeasure(name, { error: true });
      throw error;
    }
  }

  /**
   * Measure a synchronous function execution time
   */
  measureSync<T>(name: string, fn: () => T, metadata?: Record<string, unknown>): T {
    this.startMeasure(name, metadata);
    try {
      const result = fn();
      this.endMeasure(name);
      return result;
    } catch (error) {
      this.endMeasure(name, { error: true });
      throw error;
    }
  }

  /**
   * Track component render count
   */
  trackRender(componentName: string): void {
    if (!isPerformanceMonitorEnabled()) return;

    const count = (this.renderCounts.get(componentName) || 0) + 1;
    this.renderCounts.set(componentName, count);

    // Log warning if component renders too frequently
    if (count > 50 && count % 10 === 0) {
      console.warn(`⚠️ [RenderCount] ${componentName} has rendered ${count} times`);
    }
  }

  /**
   * Get render statistics
   */
  getRenderStats(): Record<string, number> {
    return Object.fromEntries(this.renderCounts.entries());
  }

  /**
   * Get performance summary
   */
  getSummary(): void {
    if (!isPerformanceMonitorEnabled()) return;

    console.group("📊 Performance Summary");

    // Group measurements by name
    const grouped = this.measurements.reduce(
      (acc, m) => {
        if (!acc[m.name]) {
          acc[m.name] = [];
        }
        acc[m.name].push(m.duration);
        return acc;
      },
      {} as Record<string, number[]>,
    );

    // Calculate stats for each operation
    const stats = Object.entries(grouped).map(([name, durations]) => {
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      const min = Math.min(...durations);
      const max = Math.max(...durations);
      const total = durations.reduce((a, b) => a + b, 0);

      return {
        Operation: name,
        Count: durations.length,
        "Avg (ms)": avg.toFixed(2),
        "Min (ms)": min.toFixed(2),
        "Max (ms)": max.toFixed(2),
        "Total (ms)": total.toFixed(2),
      };
    });

    console.table(stats);

    // Render counts
    if (this.renderCounts.size > 0) {
      console.log("🔄 Render Counts:");
      console.table(Object.fromEntries(this.renderCounts.entries()));
    }

    console.groupEnd();
  }

  /**
   * Clear all measurements and render counts
   */
  clear(): void {
    this.measurements = [];
    this.renderCounts.clear();
    this.marks.clear();
    console.log("🧹 Performance monitor cleared");
  }

  /**
   * Detect memory leaks by tracking object creation/destruction
   */
  trackMemory(label: string): void {
    if (!isPerformanceMonitorEnabled()) return;
    if (typeof performance === "undefined" || !(performance as any).memory) {
      console.warn("Memory API not available");
      return;
    }

    const memory = (performance as any).memory;
    console.log(`💾 [Memory] ${label}`, {
      usedJSHeapSize: `${(memory.usedJSHeapSize / 1048576).toFixed(2)} MB`,
      totalJSHeapSize: `${(memory.totalJSHeapSize / 1048576).toFixed(2)} MB`,
      heapLimit: `${(memory.jsHeapSizeLimit / 1048576).toFixed(2)} MB`,
    });
  }
}

export const performanceMonitor = new PerformanceMonitor();

// Expose to window for console access
if (typeof window !== "undefined") {
  (window as any).__performanceMonitor = performanceMonitor;
}

/**
 * React hook to track component render performance
 */
export function useRenderTracker(componentName: string): void {
  if (!isPerformanceMonitorEnabled()) return;

  performanceMonitor.trackRender(componentName);

  // Track render time
  const startTime = performance.now();

  // Use useEffect to measure render completion
  React.useEffect(() => {
    const duration = performance.now() - startTime;
    if (duration > 16) {
      // More than one frame
      console.warn(`⚠️ [SlowRender] ${componentName} took ${duration.toFixed(2)}ms to render`);
    }
  });
}

// React import for useEffect
import React from "react";
