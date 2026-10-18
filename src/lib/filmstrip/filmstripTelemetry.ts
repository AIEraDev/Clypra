/**
 * Filmstrip Performance & Latency Telemetry
 *
 * Instruments and dissects the end-to-end filmstrip pipeline latency:
 *   queueWaitMs -> cacheLookupMs -> ipcTransferMs -> decodeMs -> bitmapCreationMs -> rasterPaintMs -> totalTimeToVisibleMs
 */

export type FilmstripSourceType =
  "memory_tier" | "disk_atlas" | "fresh_decode" | "pyramid_fallback";

export type FilmstripTierLabel = "l0" | "l1" | "l2" | "l3";

export interface FilmstripTileTelemetry {
  tileKey: string;
  source: FilmstripSourceType;
  spatialTier?: FilmstripTierLabel;
  cacheLookupMs: number;
  ipcTransferMs: number;
  decodeMs: number;
  bitmapCreationMs: number;
  rasterPaintMs: number;
  totalTimeToVisibleMs: number;
  queueWaitMs?: number;
  /** Whether this tile was requested after a spatial-tier change. */
  requestReason?: "viewport" | "zoom";
  recordedAt: number;
}

export interface FilmstripSessionSummary {
  totalTilesRequested: number;
  memoryHits: number;
  diskAtlasHits: number;
  freshDecodes: number;
  pyramidFallbacks: number;
  hitRatePercentage: number;
  avgLookupMs: number;
  avgIpcMs: number;
  avgBitmapMs: number;
  avgPaintMs: number;
  avgTimeToVisibleMs: number;
  p95TimeToVisibleMs: number;
  tierDistribution: Record<FilmstripTierLabel, number>;
  cancelledRequests: number;
  stallCount: number;
  coalescedBatchesDispatched: number;
  /** Viewport demands painted from retained tiles while interaction was active. */
  retainedDemands: number;
  /** Settled demands which resulted in native/cache work. */
  dispatchedDemands: number;
  /** Settled demands skipped because their geometry was already dispatched. */
  duplicateDemandsSuppressed: number;
  avgQueueWaitMs: number;
  zoomTiles: number;
  zoomGestures: number;
  zoomInputEvents: number;
  zoomDurationMs: number;
  zoomTierTransitions: number;
  avgZoomTimeToVisibleMs: number;
  p95ZoomTimeToVisibleMs: number;
  dominantBottleneck:
    "native-request" | "bitmap" | "paint" | "cache-lookup" | "none";
}

import { workerPerfCollector } from "@/core/monitoring/WorkerPerfCollector";

export class FilmstripTelemetryRecorder {
  private records: FilmstripTileTelemetry[] = [];
  private paintTimesMs: number[] = [];
  private completedZoomGestures: Array<{
    durationMs: number;
    inputEvents: number;
  }> = [];
  private activeZoomGesture: { startedAt: number; inputEvents: number } | null =
    null;
  private zoomTierTransitions = 0;
  private cancelledRequests = 0;
  private stallCount = 0;
  private coalescedBatchesDispatched = 0;
  private retainedDemands = 0;
  private dispatchedDemands = 0;
  private duplicateDemandsSuppressed = 0;
  private queueWaitTimesMs: number[] = [];
  private readonly maxRecords: number;

  constructor(maxRecords = 1000) {
    this.maxRecords = maxRecords;
  }

  /**
   * Record a completed tile presentation lifecycle.
   */
  record(telemetry: Omit<FilmstripTileTelemetry, "recordedAt">): void {
    if (this.records.length >= this.maxRecords) {
      this.records.shift(); // Evict oldest telemetry item
    }
    this.records.push({
      ...telemetry,
      recordedAt: performance.now(),
    });
    workerPerfCollector.record({
      domain: "filmstrip:tile",
      operation: telemetry.source,
      durationMs: telemetry.totalTimeToVisibleMs,
      workerDurationMs: telemetry.decodeMs,
      overBudget: telemetry.totalTimeToVisibleMs > 16.67,
      metadata: {
        source: telemetry.source,
        spatialTier: telemetry.spatialTier,
        cacheLookupMs: telemetry.cacheLookupMs,
        ipcTransferMs: telemetry.ipcTransferMs,
        rasterPaintMs: telemetry.rasterPaintMs,
        queueWaitMs: telemetry.queueWaitMs,
      },
    });
  }

  /** Record cancelled or superseded in-flight requests. */
  recordCancellation(count = 1): void {
    if (count > 0) this.cancelledRequests += count;
  }

  /** Record visual timeline stalls / placeholder occurrences. */
  recordStall(): void {
    this.stallCount++;
  }

  /** Record dispatch of a coalesced tile batch and its queue wait duration. */
  recordBatchDispatched(queueWaitMs = 0): void {
    this.coalescedBatchesDispatched++;
    if (Number.isFinite(queueWaitMs) && queueWaitMs >= 0) {
      if (this.queueWaitTimesMs.length >= this.maxRecords) {
        this.queueWaitTimesMs.shift();
      }
      this.queueWaitTimesMs.push(queueWaitMs);
    }
  }

  /**
   * Records only demand outcomes, never clip IDs, source paths, or signatures.
   * This distinguishes a legitimately changed viewport from redundant demand
   * when investigating a fallback-only zoom session.
   */
  recordDemandOutcome(
    outcome: "retained" | "dispatched" | "duplicate-suppressed",
  ): void {
    if (outcome === "retained") this.retainedDemands++;
    else if (outcome === "dispatched") this.dispatchedDemands++;
    else this.duplicateDemandsSuppressed++;
  }

  /**
   * Get total count of recorded tile events.
   */
  getRecordCount(): number {
    return this.records.length;
  }

  /** True when this interval contains a tile or lifecycle observation. */
  hasRecordedData(): boolean {
    return (
      this.records.length > 0 ||
      this.paintTimesMs.length > 0 ||
      this.completedZoomGestures.length > 0 ||
      this.activeZoomGesture !== null ||
      this.zoomTierTransitions > 0 ||
      this.cancelledRequests > 0 ||
      this.stallCount > 0 ||
      this.coalescedBatchesDispatched > 0 ||
      this.retainedDemands > 0 ||
      this.dispatchedDemands > 0 ||
      this.duplicateDemandsSuppressed > 0 ||
      this.queueWaitTimesMs.length > 0
    );
  }

  /** Records a batched canvas/WebGL filmstrip presentation commit. */
  recordPaintCommit(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    if (this.paintTimesMs.length >= this.maxRecords) this.paintTimesMs.shift();
    this.paintTimesMs.push(durationMs);
  }

  /** Starts or extends one wheel/trackpad zoom gesture; never records raw wheel events. */
  beginZoomGesture(): void {
    if (this.activeZoomGesture) {
      this.activeZoomGesture.inputEvents++;
      return;
    }
    this.activeZoomGesture = { startedAt: performance.now(), inputEvents: 1 };
  }

  /** Completes the compact gesture summary once input and spring motion settle. */
  endZoomGesture(): void {
    const gesture = this.activeZoomGesture;
    if (!gesture) return;
    this.activeZoomGesture = null;
    if (this.completedZoomGestures.length >= this.maxRecords) {
      this.completedZoomGestures.shift();
    }
    this.completedZoomGestures.push({
      durationMs: Math.max(0, performance.now() - gesture.startedAt),
      inputEvents: gesture.inputEvents,
    });
  }

  isZoomGestureActive(): boolean {
    return this.activeZoomGesture !== null;
  }

  recordZoomTierTransition(): void {
    if (this.activeZoomGesture) this.zoomTierTransitions++;
  }

  /**
   * Clear all recorded telemetry records.
   */
  clear(): void {
    this.records = [];
    this.paintTimesMs = [];
    this.completedZoomGestures = [];
    this.activeZoomGesture = null;
    this.zoomTierTransitions = 0;
    this.cancelledRequests = 0;
    this.stallCount = 0;
    this.coalescedBatchesDispatched = 0;
    this.retainedDemands = 0;
    this.dispatchedDemands = 0;
    this.duplicateDemandsSuppressed = 0;
    this.queueWaitTimesMs = [];
  }

  /**
   * Generate an aggregated performance summary for the current session.
   */
  getSummary(): FilmstripSessionSummary {
    const total = this.records.length;
    const tierDistribution: Record<FilmstripTierLabel, number> = {
      l0: 0,
      l1: 0,
      l2: 0,
      l3: 0,
    };

    if (total === 0) {
      return {
        totalTilesRequested: 0,
        memoryHits: 0,
        diskAtlasHits: 0,
        freshDecodes: 0,
        pyramidFallbacks: 0,
        hitRatePercentage: 0,
        avgLookupMs: 0,
        avgIpcMs: 0,
        avgBitmapMs: 0,
        avgPaintMs: 0,
        avgTimeToVisibleMs: 0,
        p95TimeToVisibleMs: 0,
        tierDistribution,
        cancelledRequests: this.cancelledRequests,
        stallCount: this.stallCount,
        coalescedBatchesDispatched: this.coalescedBatchesDispatched,
        retainedDemands: this.retainedDemands,
        dispatchedDemands: this.dispatchedDemands,
        duplicateDemandsSuppressed: this.duplicateDemandsSuppressed,
        avgQueueWaitMs: 0,
        zoomTiles: 0,
        zoomGestures: 0,
        zoomInputEvents: 0,
        zoomDurationMs: 0,
        zoomTierTransitions: 0,
        avgZoomTimeToVisibleMs: 0,
        p95ZoomTimeToVisibleMs: 0,
        dominantBottleneck: "none",
      };
    }

    let memoryHits = 0;
    let diskAtlasHits = 0;
    let freshDecodes = 0;
    let pyramidFallbacks = 0;

    let sumLookup = 0;
    let sumIpc = 0;
    let sumBitmap = 0;
    let sumPaint = 0;
    let sumTotal = 0;
    let zoomTiles = 0;
    const totals: number[] = [];
    const zoomTotals: number[] = [];
    const stages = { nativeRequest: 0, bitmap: 0, paint: 0, cacheLookup: 0 };

    for (const r of this.records) {
      switch (r.source) {
        case "memory_tier":
          memoryHits++;
          break;
        case "disk_atlas":
          diskAtlasHits++;
          break;
        case "fresh_decode":
          freshDecodes++;
          break;
        case "pyramid_fallback":
          pyramidFallbacks++;
          break;
      }
      if (r.spatialTier && r.spatialTier in tierDistribution) {
        tierDistribution[r.spatialTier]++;
      }
      sumLookup += r.cacheLookupMs;
      sumIpc += r.ipcTransferMs;
      sumBitmap += r.bitmapCreationMs;
      sumPaint += r.rasterPaintMs;
      sumTotal += r.totalTimeToVisibleMs;
      totals.push(r.totalTimeToVisibleMs);
      if (r.requestReason === "zoom") {
        zoomTiles++;
        zoomTotals.push(r.totalTimeToVisibleMs);
      }
      stages.nativeRequest += r.ipcTransferMs + r.decodeMs;
      stages.bitmap += r.bitmapCreationMs;
      stages.paint += r.rasterPaintMs;
      stages.cacheLookup += r.cacheLookupMs;
    }

    const paintTotal = this.paintTimesMs.reduce((sum, value) => sum + value, 0);
    const zoomGestures = this.completedZoomGestures.length;
    const zoomInputEvents = this.completedZoomGestures.reduce(
      (sum, gesture) => sum + gesture.inputEvents,
      0,
    );
    const zoomDurationMs = this.completedZoomGestures.reduce(
      (sum, gesture) => sum + gesture.durationMs,
      0,
    );
    const cacheHits = memoryHits + diskAtlasHits;
    const hitRatePercentage = total > 0 ? (cacheHits / total) * 100 : 0;

    const avgQueueWaitMs =
      this.queueWaitTimesMs.length > 0
        ? Math.round(
            (this.queueWaitTimesMs.reduce((sum, v) => sum + v, 0) /
              this.queueWaitTimesMs.length) *
              100,
          ) / 100
        : 0;

    const avgZoomTimeToVisibleMs =
      zoomTotals.length > 0
        ? Math.round(
            (zoomTotals.reduce((sum, v) => sum + v, 0) / zoomTotals.length) *
              100,
          ) / 100
        : 0;

    const p95ZoomTimeToVisibleMs =
      zoomTotals.length > 0
        ? Math.round(percentile(zoomTotals, 0.95) * 100) / 100
        : 0;

    return {
      totalTilesRequested: total,
      memoryHits,
      diskAtlasHits,
      freshDecodes,
      pyramidFallbacks,
      hitRatePercentage: Math.round(hitRatePercentage * 10) / 10,
      avgLookupMs: Math.round((sumLookup / total) * 100) / 100,
      avgIpcMs: Math.round((sumIpc / total) * 100) / 100,
      avgBitmapMs: Math.round((sumBitmap / total) * 100) / 100,
      avgPaintMs:
        Math.round(
          (paintTotal / Math.max(1, this.paintTimesMs.length) ||
            sumPaint / total) * 100,
        ) / 100,
      avgTimeToVisibleMs: Math.round((sumTotal / total) * 100) / 100,
      p95TimeToVisibleMs: Math.round(percentile(totals, 0.95) * 100) / 100,
      tierDistribution,
      cancelledRequests: this.cancelledRequests,
      stallCount: this.stallCount,
      coalescedBatchesDispatched: this.coalescedBatchesDispatched,
      retainedDemands: this.retainedDemands,
      dispatchedDemands: this.dispatchedDemands,
      duplicateDemandsSuppressed: this.duplicateDemandsSuppressed,
      avgQueueWaitMs,
      zoomTiles,
      zoomGestures,
      zoomInputEvents,
      zoomDurationMs: Math.round(zoomDurationMs),
      zoomTierTransitions: this.zoomTierTransitions,
      avgZoomTimeToVisibleMs,
      p95ZoomTimeToVisibleMs,
      dominantBottleneck: dominantStage({
        ...stages,
        paint: stages.paint + paintTotal,
      }),
    };
  }
}

function percentile(values: readonly number[], fraction: number): number {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered.length === 0
    ? 0
    : ordered[
        Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)
      ];
}

function dominantStage(
  stages: Record<"nativeRequest" | "bitmap" | "paint" | "cacheLookup", number>,
): FilmstripSessionSummary["dominantBottleneck"] {
  const winner = (
    Object.entries(stages) as Array<[keyof typeof stages, number]>
  ).sort(([, a], [, b]) => b - a)[0];
  if (!winner || winner[1] <= 0) return "none";
  const labels: Record<
    keyof typeof stages,
    FilmstripSessionSummary["dominantBottleneck"]
  > = {
    nativeRequest: "native-request",
    bitmap: "bitmap",
    paint: "paint",
    cacheLookup: "cache-lookup",
  };
  return labels[winner[0]];
}

/** Global singleton telemetry instance for filmstrip pipeline */
export const filmstripTelemetry = new FilmstripTelemetryRecorder();
