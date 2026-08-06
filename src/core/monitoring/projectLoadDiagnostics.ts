/**
 * Project Load Diagnostics
 *
 * Helps diagnose slow project loading and timeline rendering
 *
 * Enable: localStorage.setItem("clypra.debug.projectLoad", "1")
 */

import { performanceMonitor } from "./performanceMonitor";

const DEBUG_KEY = "clypra.debug.projectLoad";

export function isProjectLoadDiagnosticsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage?.getItem(DEBUG_KEY) === "1";
}

interface ProjectLoadPhase {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, unknown>;
}

class ProjectLoadDiagnostics {
  private phases: ProjectLoadPhase[] = [];
  private loadStartTime: number = 0;

  startLoad(): void {
    if (!isProjectLoadDiagnosticsEnabled()) return;

    this.phases = [];
    this.loadStartTime = performance.now();
    console.log("🔵 [ProjectLoad] Started loading project");
  }

  startPhase(name: string, metadata?: Record<string, unknown>): void {
    if (!isProjectLoadDiagnosticsEnabled()) return;

    this.phases.push({
      name,
      startTime: performance.now(),
      metadata,
    });

    console.log(`  ⏩ [ProjectLoad:${name}] Started`, metadata || "");
  }

  endPhase(name: string): void {
    if (!isProjectLoadDiagnosticsEnabled()) return;

    const phase = this.phases.find((p) => p.name === name && !p.endTime);
    if (!phase) {
      console.warn(`  ⚠️ [ProjectLoad] Phase "${name}" not found or already ended`);
      return;
    }

    phase.endTime = performance.now();
    phase.duration = phase.endTime - phase.startTime;

    const emoji = phase.duration < 100 ? "✅" : phase.duration < 500 ? "⚠️" : "🔴";
    const color = phase.duration < 100 ? "color: #22c55e" : phase.duration < 500 ? "color: #f59e0b" : "color: #ef4444";
    console.log(`  %c${emoji} [ProjectLoad:${name}] Completed in ${phase.duration.toFixed(2)}ms`, color);
  }

  endLoad(): void {
    if (!isProjectLoadDiagnosticsEnabled()) return;

    const totalDuration = performance.now() - this.loadStartTime;

    console.log(`\n🟢 [ProjectLoad] Completed in ${totalDuration.toFixed(2)}ms\n`);

    // Generate summary
    console.group("📊 Project Load Breakdown");

    const phaseSummary = this.phases
      .filter((p) => p.duration !== undefined)
      .map((p) => ({
        Phase: p.name,
        "Duration (ms)": p.duration!.toFixed(2),
        "% of Total": ((p.duration! / totalDuration) * 100).toFixed(1) + "%",
      }));

    console.table(phaseSummary);

    // Identify bottlenecks
    const slowPhases = this.phases.filter((p) => p.duration && p.duration > 200).sort((a, b) => (b.duration || 0) - (a.duration || 0));

    if (slowPhases.length > 0) {
      console.warn("⚠️ Slow Phases (>200ms):");
      slowPhases.forEach((p) => {
        console.warn(`  • ${p.name}: ${p.duration!.toFixed(2)}ms`, p.metadata || "");
      });
    }

    console.groupEnd();

    // Clear phases
    this.phases = [];
  }

  /**
   * Track component render after project load
   */
  trackComponentRender(componentName: string, renderCount: number): void {
    if (!isProjectLoadDiagnosticsEnabled()) return;

    if (renderCount > 10) {
      console.warn(`⚠️ [ProjectLoad] ${componentName} rendered ${renderCount} times after project load`);
    }
  }

  /**
   * Track timeline clip rendering
   */
  trackClipRender(clipId: string, trackId: string): void {
    if (!isProjectLoadDiagnosticsEnabled()) return;

    // Track in batches to avoid spam
    const key = `clip-render-${clipId}`;
    const count = ((window as any).__clipRenderCounts || {})[key] || 0;

    if (!(window as any).__clipRenderCounts) {
      (window as any).__clipRenderCounts = {};
    }

    (window as any).__clipRenderCounts[key] = count + 1;

    // Log warning if clip re-renders too many times
    if (count === 5 || count === 10 || count === 20) {
      console.warn(`⚠️ [ProjectLoad] Clip ${clipId} on track ${trackId} has rendered ${count + 1} times`);
    }
  }

  /**
   * Clear clip render tracking
   */
  clearClipRenderTracking(): void {
    if (typeof window !== "undefined") {
      (window as any).__clipRenderCounts = {};
    }
  }
}

export const projectLoadDiagnostics = new ProjectLoadDiagnostics();

// Expose to window for console access
if (typeof window !== "undefined") {
  (window as any).__projectLoadDiagnostics = projectLoadDiagnostics;
}

/**
 * Console commands:
 *
 * Enable diagnostics:
 * localStorage.setItem("clypra.debug.projectLoad", "1")
 *
 * Disable diagnostics:
 * localStorage.removeItem("clypra.debug.projectLoad")
 *
 * Clear clip render tracking:
 * __projectLoadDiagnostics.clearClipRenderTracking()
 */
