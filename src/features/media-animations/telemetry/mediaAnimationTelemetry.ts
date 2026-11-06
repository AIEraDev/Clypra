/**
 * Media Animation Performance Telemetry
 *
 * Zero-PII, fire-and-forget telemetry for the media animation subsystem:
 *   - Catalog category fetches (per-category HTTP timings and preset counts)
 *   - Manifest downloads (cache-hit vs network spans, size, integrity timing)
 *   - Cache hydration (startup manifest restore timing)
 *   - Animation evaluation (keyframe compilation latency)
 *
 * Follows the EditorFeatureTelemetry static pattern exactly.
 * Every method is wrapped in try/catch — telemetry never throws into the caller.
 */

import { perfLogService } from "@/services/perfLogService";

// ─── Payload interfaces ───────────────────────────────────────────────────────

export interface CatalogFetchPayload {
  /** Which of the three animation categories was fetched. */
  category: "in" | "out" | "combo";
  /** Wall-clock duration from fetch start to setSnapshot(). */
  durationMs: number;
  /** Number of valid presets returned by the API. */
  presetCount: number;
  /** Whether the request completed without error. */
  status: "success" | "error";
  /** HTTP status code on success. */
  httpStatus?: number;
  /** Error message if status is "error". */
  error?: string;
}

export interface ManifestDownloadPayload {
  /** Non-identifying preset slug key (e.g. "slide-in-left"). Never a file path or user content. */
  slug: string;
  /** Whether the manifest was served from the local disk cache. */
  cacheHit: boolean;
  /** Total span duration (verify + fetch + write). */
  durationMs: number;
  /** File size in bytes as recorded in the cache index or response. */
  sizeBytes: number;
  /** Time spent computing and verifying SHA-256 on a cache-hit path (ms). */
  sha256VerifyMs?: number;
  /** Network fetch duration (cache-miss path only). */
  fetchDurationMs?: number;
  /** Disk write duration (cache-miss path only). */
  writeDurationMs?: number;
  /** Outcome of the download attempt. */
  status: "success" | "hash-mismatch" | "missing" | "error";
  /** Error message if status is "error". */
  error?: string;
}

export interface CacheHydrationPayload {
  /** Wall-clock duration of the full loadIndex() + hydrateManifests() block. */
  durationMs: number;
  /** Number of manifests successfully loaded into memory. */
  manifestCount: number;
  /** Number of entries read from the on-disk index file. */
  indexEntryCount: number;
  /** Number of index entries evicted due to missing or corrupt files. */
  errorCount: number;
  /** Manifests successfully read from disk (equals manifestCount). */
  fromDiskCount: number;
}

export interface AnimationEvalPayload {
  /** Wall-clock duration of the keyframe compilation call (ms). */
  durationMs: number;
  /** Clip type as stored in the clip object (e.g. "video", "image"). */
  clipType: string;
  /** Preset slug applied to the clip (if any). Never a user file path. */
  presetId?: string;
  /** Number of animation tracks compiled. */
  trackCount: number;
  /** Total keyframe count across all compiled tracks. */
  keyframeCount: number;
}

// ─── Telemetry class ──────────────────────────────────────────────────────────

/**
 * Static fire-and-forget telemetry methods for the media animation subsystem.
 * Each method enqueues one PerfLogEntry and swallows all errors.
 */
export class MediaAnimationTelemetry {
  /**
   * Record a per-category catalog HTTP fetch span.
   */
  static recordCatalogFetch(payload: CatalogFetchPayload): void {
    try {
      const sessionId = perfLogService.getSessionId() ?? "unknown";
      perfLogService.enqueue({
        kind: "media-animation-catalog-fetch",
        sessionId,
        timestampEpochMs: Date.now(),
        payload,
      });
    } catch {
      // Non-blocking telemetry
    }
  }

  /**
   * Record a manifest download span (cache-hit verification or network fetch).
   */
  static recordManifestDownload(payload: ManifestDownloadPayload): void {
    try {
      const sessionId = perfLogService.getSessionId() ?? "unknown";
      perfLogService.enqueue({
        kind: "media-animation-download",
        sessionId,
        timestampEpochMs: Date.now(),
        payload,
      });
    } catch {
      // Non-blocking telemetry
    }
  }

  /**
   * Record the startup cache-hydration span (loadIndex + hydrateManifests).
   */
  static recordCacheHydration(payload: CacheHydrationPayload): void {
    try {
      const sessionId = perfLogService.getSessionId() ?? "unknown";
      perfLogService.enqueue({
        kind: "media-animation-cache-hydration",
        sessionId,
        timestampEpochMs: Date.now(),
        payload,
      });
    } catch {
      // Non-blocking telemetry
    }
  }

  /**
   * Record a keyframe compilation (animation eval) span.
   */
  static recordAnimationEval(payload: AnimationEvalPayload): void {
    try {
      const sessionId = perfLogService.getSessionId() ?? "unknown";
      perfLogService.enqueue({
        kind: "animation-eval",
        sessionId,
        timestampEpochMs: Date.now(),
        payload,
      });
    } catch {
      // Non-blocking telemetry
    }
  }
}
