/**
 * Zero-PII Text Performance Telemetry (v3).
 *
 * Implements telemetry observation requirements:
 * 1. Counters for renderer by clip kind (plain / effect / template)
 * 2. Raster asset registrations per second and bytes uploaded per second
 * 3. outputPixels per upload
 * 4. Frontend raster-cache hit rate
 * 5. Animation achieved Hz
 * 6. Dynamic-import and font-load times on first use
 *
 * Privacy / Non-PII Guarantee:
 * - NO user text content or strings
 * - NO font family names or user asset paths
 * - NO hashes of user text
 * - Only counts, durations, dimensions, and categorical enums
 */

export interface TextMetricsSnapshot {
  /** Count of render passes by clip kind and renderer */
  rendererByKind: Record<string, Record<string, number>>;
  /** Upload throughput and IPC performance metrics */
  uploads: {
    totalRegistrations: number;
    totalBytes: number;
    totalOutputPixels: number;
    registrationsPerSec: number;
    bytesPerSec: number;
    outputPixelsAvg: number;
    outputPixelsP95: number;
    durationMsAvg: number;
    durationMsMax: number;
  };
  /** Frontend browser raster cache metrics */
  cache: {
    hits: number;
    misses: number;
    hitRate: number;
  };
  /** Achieved animation refresh rate (Hz) */
  animation: {
    samples: number;
    achievedHzAvg: number;
    achievedHzMin: number;
    achievedHzMax: number;
  };
  /** First-use initialization latencies */
  firstUseTimings: {
    dynamicImports: Record<string, number>;
    fontLoadMs?: number;
  };
}

class TextMetricsCollector {
  private rendererByKindMap = new Map<string, Map<string, number>>();

  // Upload metrics (running accumulators + bounded sample buffer for P95)
  private totalRegistrations = 0;
  private totalBytes = 0;
  private totalOutputPixels = 0;
  private uploadDurationMsSum = 0;
  private uploadDurationMsMax = 0;
  private uploadDurationCount = 0;
  private readonly MAX_UPLOAD_SAMPLES = 100;
  private uploadOutputPixelsList: number[] = [];
  private uploadWindowStartMs: number = Date.now();

  // Cache metrics
  private cacheHits = 0;
  private cacheMisses = 0;

  // Animation Hz metrics (bounded tracked layers and bounded samples)
  private readonly MAX_TRACKED_LAYERS = 64;
  private lastAnimTimestampByLayer = new Map<string, number>();
  private animHzSum = 0;
  private animHzMin = Number.POSITIVE_INFINITY;
  private animHzMax = 0;
  private animHzCount = 0;
  private animHzSamples: number[] = [];
  private readonly MAX_ANIM_SAMPLES = 100;

  // First-use timings
  private readonly MAX_DYNAMIC_IMPORTS = 32;
  private dynamicImports = new Map<string, number>();
  private firstFontLoadMs: number | undefined = undefined;

  /**
   * Record a text render invocation by clip kind and renderer.
   * Only broad categoricals ("plain" | "effect" | "template" and renderer ID) are stored.
   */
  recordRendererByClipKind(
    kind: "plain" | "effect" | "template" | string,
    renderer: string,
  ): void {
    let rendererMap = this.rendererByKindMap.get(kind);
    if (!rendererMap) {
      if (this.rendererByKindMap.size >= 16) return;
      rendererMap = new Map();
      this.rendererByKindMap.set(kind, rendererMap);
    }
    if (rendererMap.size >= 16 && !rendererMap.has(renderer)) return;
    const current = rendererMap.get(renderer) ?? 0;
    rendererMap.set(renderer, current + 1);
  }

  /**
   * Record a raster asset upload over IPC.
   * Tracks bytes, outputPixels, and upload latency using bounded memory.
   */
  recordRasterUpload(
    outputPixels: number,
    bytes: number,
    durationMs: number,
  ): void {
    if (!Number.isFinite(outputPixels) || outputPixels <= 0) return;
    this.totalRegistrations += 1;
    this.totalBytes += Math.max(0, bytes);
    this.totalOutputPixels += outputPixels;

    const validDuration = Math.max(0, durationMs);
    this.uploadDurationMsSum += validDuration;
    this.uploadDurationMsMax = Math.max(this.uploadDurationMsMax, validDuration);
    this.uploadDurationCount += 1;

    // Bounded reservoir for P95 calculation
    this.uploadOutputPixelsList.push(outputPixels);
    if (this.uploadOutputPixelsList.length > this.MAX_UPLOAD_SAMPLES) {
      this.uploadOutputPixelsList.shift();
    }
  }

  /**
   * Record a hit in the browser text raster cache.
   */
  recordRasterCacheHit(): void {
    this.cacheHits += 1;
  }

  /**
   * Record a miss in the browser text raster cache.
   */
  recordRasterCacheMiss(): void {
    this.cacheMisses += 1;
  }

  /**
   * Record an animation frame arrival for a layer.
   * Computes inter-frame dt and records the achieved refresh frequency in Hz.
   */
  recordAnimationAchievedFrame(layerId: string, timestampMs = Date.now()): void {
    const prev = this.lastAnimTimestampByLayer.get(layerId);
    this.lastAnimTimestampByLayer.set(layerId, timestampMs);

    // Evict oldest tracked layer if table exceeds bound
    if (this.lastAnimTimestampByLayer.size > this.MAX_TRACKED_LAYERS) {
      const oldestKey = this.lastAnimTimestampByLayer.keys().next().value;
      if (oldestKey !== undefined) {
        this.lastAnimTimestampByLayer.delete(oldestKey);
      }
    }

    if (prev !== undefined && timestampMs > prev) {
      const dtMs = timestampMs - prev;
      if (dtMs > 0 && dtMs < 5000) {
        // Only consider intervals between 1ms and 5s
        const hz = 1000 / dtMs;
        this.animHzSum += hz;
        this.animHzMin = Math.min(this.animHzMin, hz);
        this.animHzMax = Math.max(this.animHzMax, hz);
        this.animHzCount += 1;

        this.animHzSamples.push(hz);
        if (this.animHzSamples.length > this.MAX_ANIM_SAMPLES) {
          this.animHzSamples.shift();
        }
      }
    }
  }

  /**
   * Record dynamic import duration for a module.
   */
  recordDynamicImport(moduleName: string, durationMs: number): void {
    if (
      !this.dynamicImports.has(moduleName) &&
      this.dynamicImports.size < this.MAX_DYNAMIC_IMPORTS
    ) {
      this.dynamicImports.set(moduleName, Math.max(0, durationMs));
    }
  }

  /**
   * Record first-use font load duration.
   * NO font name is stored.
   */
  recordFontLoad(durationMs: number): void {
    if (this.firstFontLoadMs === undefined && Number.isFinite(durationMs)) {
      this.firstFontLoadMs = Math.max(0, durationMs);
    }
  }

  /**
   * Take an aggregated snapshot of all text metrics.
   */
  getSnapshot(): TextMetricsSnapshot {
    const rendererByKind: Record<string, Record<string, number>> = {};
    for (const [k, rMap] of this.rendererByKindMap.entries()) {
      rendererByKind[k] = {};
      for (const [r, count] of rMap.entries()) {
        rendererByKind[k][r] = count;
      }
    }

    const elapsedSec = Math.max(
      0.001,
      (Date.now() - this.uploadWindowStartMs) / 1000,
    );
    const registrationsPerSec =
      this.totalRegistrations > 0
        ? Number((this.totalRegistrations / elapsedSec).toFixed(2))
        : 0;
    const bytesPerSec =
      this.totalBytes > 0
        ? Number((this.totalBytes / elapsedSec).toFixed(2))
        : 0;

    const outputPixelsAvg =
      this.totalRegistrations > 0
        ? Math.round(this.totalOutputPixels / this.totalRegistrations)
        : 0;

    const sortedPixels = [...this.uploadOutputPixelsList].sort((a, b) => a - b);
    const p95Idx = Math.floor(sortedPixels.length * 0.95);
    const outputPixelsP95 = sortedPixels[p95Idx] ?? 0;

    const durationMsAvg =
      this.uploadDurationCount > 0
        ? Number(
            (this.uploadDurationMsSum / this.uploadDurationCount).toFixed(2),
          )
        : 0;
    const durationMsMax =
      this.uploadDurationCount > 0
        ? Number(this.uploadDurationMsMax.toFixed(2))
        : 0;

    const totalLookups = this.cacheHits + this.cacheMisses;
    const hitRate =
      totalLookups > 0
        ? Number((this.cacheHits / totalLookups).toFixed(4))
        : 0;

    let achievedHzAvg = 0;
    let achievedHzMin = 0;
    let achievedHzMax = 0;
    if (this.animHzSamples.length > 0) {
      achievedHzAvg = Number(
        (
          this.animHzSamples.reduce((a, b) => a + b, 0) /
          this.animHzSamples.length
        ).toFixed(2),
      );
      achievedHzMin = Number(Math.min(...this.animHzSamples).toFixed(2));
      achievedHzMax = Number(Math.max(...this.animHzSamples).toFixed(2));
    }

    const dynamicImportsObj: Record<string, number> = {};
    for (const [name, dur] of this.dynamicImports.entries()) {
      dynamicImportsObj[name] = Number(dur.toFixed(2));
    }

    return {
      rendererByKind,
      uploads: {
        totalRegistrations: this.totalRegistrations,
        totalBytes: this.totalBytes,
        totalOutputPixels: this.totalOutputPixels,
        registrationsPerSec,
        bytesPerSec,
        outputPixelsAvg,
        outputPixelsP95,
        durationMsAvg,
        durationMsMax,
      },
      cache: {
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate,
      },
      animation: {
        samples: this.animHzSamples.length,
        achievedHzAvg,
        achievedHzMin,
        achievedHzMax,
      },
      firstUseTimings: {
        dynamicImports: dynamicImportsObj,
        fontLoadMs:
          this.firstFontLoadMs !== undefined
            ? Number(this.firstFontLoadMs.toFixed(2))
            : undefined,
      },
    };
  }

  /**
   * Reset all counters and buffers (useful for testing).
   */
  resetForTests(): void {
    this.rendererByKindMap.clear();
    this.totalRegistrations = 0;
    this.totalBytes = 0;
    this.totalOutputPixels = 0;
    this.uploadDurationMsSum = 0;
    this.uploadDurationMsMax = 0;
    this.uploadDurationCount = 0;
    this.uploadOutputPixelsList = [];
    this.uploadWindowStartMs = Date.now();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.lastAnimTimestampByLayer.clear();
    this.animHzSum = 0;
    this.animHzMin = Number.POSITIVE_INFINITY;
    this.animHzMax = 0;
    this.animHzCount = 0;
    this.animHzSamples = [];
    this.dynamicImports.clear();
    this.firstFontLoadMs = undefined;
  }
}

export const textMetrics = new TextMetricsCollector();

export function recordRendererByClipKind(
  kind: "plain" | "effect" | "template" | string,
  renderer: string,
): void {
  textMetrics.recordRendererByClipKind(kind, renderer);
}

export function recordRasterUpload(
  outputPixels: number,
  bytes: number,
  durationMs: number,
): void {
  textMetrics.recordRasterUpload(outputPixels, bytes, durationMs);
}

export function recordBrowserTextRasterCacheHit(): void {
  textMetrics.recordRasterCacheHit();
}

export function recordBrowserTextRasterCacheMiss(): void {
  textMetrics.recordRasterCacheMiss();
}

export function recordAnimationAchievedFrame(
  layerId: string,
  timestampMs?: number,
): void {
  textMetrics.recordAnimationAchievedFrame(layerId, timestampMs);
}

export function recordDynamicImport(
  moduleName: string,
  durationMs: number,
): void {
  textMetrics.recordDynamicImport(moduleName, durationMs);
}

export function recordFontLoad(durationMs: number): void {
  textMetrics.recordFontLoad(durationMs);
}

export function getTextMetricsSnapshot(): TextMetricsSnapshot {
  return textMetrics.getSnapshot();
}

export function resetTextMetricsForTests(): void {
  textMetrics.resetForTests();
}
