/**
 * viewportTelemetry.ts — Viewport Windowing & Clip Culling Telemetry (Tier 1)
 *
 * Phase 4 of Clypra Multi-Tier Optimization: Multi-Tier Telemetry.
 *
 * Design:
 *   - Module-level singleton, zero-allocation in the hot path.
 *   - Tracks per-window and lifetime culling metrics.
 *   - cullingRatioPct is derived on getSnapshot() to avoid FP accumulation drift.
 */

/** Snapshot of viewport windowing and clip culling counters. */
export interface ViewportWindowTelemetrySnapshot {
  /** Total number of viewport window computations performed since last reset. */
  windowComputationsTotal: number;
  /** N — total clips in the timeline as of the last window computation. */
  totalClipsInTimeline: number;
  /** K — clips mounted/visible in the last window computation. */
  visibleClipsMounted: number;
  /** N - K — clips skipped/culled in the last window computation. */
  culledClipsSkipped: number;
  /** Cumulative count of culled clips across all window computations. */
  lifetimeCulledClipsTotal: number;
  /** Cumulative count of visible clips across all window computations. */
  lifetimeVisibleClipsTotal: number;
  /**
   * Derived culling efficiency: (lifetimeCulled / (lifetimeCulled + lifetimeVisible)) * 100.
   * Range 0–100. Returns 0 when no clips have been processed.
   */
  cullingRatioPct: number;
}

class ViewportWindowTelemetry {
  private _windowComputationsTotal = 0;
  private _totalClipsInTimeline = 0;
  private _visibleClipsMounted = 0;
  private _culledClipsSkipped = 0;
  private _lifetimeCulledClipsTotal = 0;
  private _lifetimeVisibleClipsTotal = 0;

  /**
   * Record a single viewport window computation.
   *
   * @param totalClips   N — total clips present in the timeline.
   * @param visibleClips K — clips that fall within the visible viewport window.
   */
  recordWindowComputation(totalClips: number, visibleClips: number): void {
    const culled = totalClips - visibleClips;
    this._windowComputationsTotal++;
    this._totalClipsInTimeline = totalClips;
    this._visibleClipsMounted = visibleClips;
    this._culledClipsSkipped = culled;
    this._lifetimeCulledClipsTotal += culled;
    this._lifetimeVisibleClipsTotal += visibleClips;
  }

  /** Return a snapshot of current telemetry. No allocations in steady state. */
  getSnapshot(): ViewportWindowTelemetrySnapshot {
    const lifetimeTotal =
      this._lifetimeCulledClipsTotal + this._lifetimeVisibleClipsTotal;
    const cullingRatioPct =
      lifetimeTotal > 0
        ? (this._lifetimeCulledClipsTotal / lifetimeTotal) * 100
        : 0;

    return {
      windowComputationsTotal: this._windowComputationsTotal,
      totalClipsInTimeline: this._totalClipsInTimeline,
      visibleClipsMounted: this._visibleClipsMounted,
      culledClipsSkipped: this._culledClipsSkipped,
      lifetimeCulledClipsTotal: this._lifetimeCulledClipsTotal,
      lifetimeVisibleClipsTotal: this._lifetimeVisibleClipsTotal,
      cullingRatioPct,
    };
  }

  /** Reset all counters to zero. */
  reset(): void {
    this._windowComputationsTotal = 0;
    this._totalClipsInTimeline = 0;
    this._visibleClipsMounted = 0;
    this._culledClipsSkipped = 0;
    this._lifetimeCulledClipsTotal = 0;
    this._lifetimeVisibleClipsTotal = 0;
  }
}

/** Module-level singleton for viewport windowing and clip culling telemetry. */
export const viewportTelemetry = new ViewportWindowTelemetry();
