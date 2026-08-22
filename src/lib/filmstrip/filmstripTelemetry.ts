/**
 * Filmstrip Performance & Latency Telemetry
 *
 * Instruments and dissects the end-to-end filmstrip pipeline latency:
 *   cacheLookupMs -> ipcTransferMs -> decodeMs -> bitmapCreationMs -> rasterPaintMs -> totalTimeToVisibleMs
 */

export type FilmstripSourceType =
  | "memory_tier"
  | "disk_atlas"
  | "fresh_decode"
  | "pyramid_fallback";

export interface FilmstripTileTelemetry {
  tileKey: string;
  source: FilmstripSourceType;
  cacheLookupMs: number;
  ipcTransferMs: number;
  decodeMs: number;
  bitmapCreationMs: number;
  rasterPaintMs: number;
  totalTimeToVisibleMs: number;
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
}

export class FilmstripTelemetryRecorder {
  private records: FilmstripTileTelemetry[] = [];
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
  }

  /**
   * Get total count of recorded tile events.
   */
  getRecordCount(): number {
    return this.records.length;
  }

  /**
   * Clear all recorded telemetry records.
   */
  clear(): void {
    this.records = [];
  }

  /**
   * Generate an aggregated performance summary for the current session.
   */
  getSummary(): FilmstripSessionSummary {
    const total = this.records.length;
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
      sumLookup += r.cacheLookupMs;
      sumIpc += r.ipcTransferMs;
      sumBitmap += r.bitmapCreationMs;
      sumPaint += r.rasterPaintMs;
      sumTotal += r.totalTimeToVisibleMs;
    }

    const cacheHits = memoryHits + diskAtlasHits;
    const hitRatePercentage = total > 0 ? (cacheHits / total) * 100 : 0;

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
      avgPaintMs: Math.round((sumPaint / total) * 100) / 100,
      avgTimeToVisibleMs: Math.round((sumTotal / total) * 100) / 100,
    };
  }
}

/** Global singleton telemetry instance for filmstrip pipeline */
export const filmstripTelemetry = new FilmstripTelemetryRecorder();
