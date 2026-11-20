/**
 * React Hook for Unified Cache Management
 *
 * Bridges Clypra's in-memory CacheCoordinator telemetry with the
 * Tauri disk-cache IPC commands, providing a single interface for
 * monitoring, configuring, purging, and verifying the unified cache.
 */

import { useState, useCallback, useEffect } from "react";
import { getCacheCoordinator, type CacheCoordinatorStats } from "@/core/cache/cacheCoordinator";
import { isTauriRuntime } from "@/lib/platform/tauri";

// ---------------------------------------------------------------------------
// Exported TypeScript mirrors of the Rust disk_cache types
// ---------------------------------------------------------------------------

/** Mirrors Rust `UnifiedCacheStats` (snake_case → camelCase). */
export interface UnifiedCacheStats {
  /** Total bytes currently stored on disk across all namespaces. */
  totalBytes: number;
  /** Configured disk budget ceiling in bytes (0 = unlimited). */
  limitBytes: number;
  /** Per-namespace byte totals keyed by namespace string (e.g. "thumbnails"). */
  namespaceBytes: Record<string, number>;
  /** Per-namespace entry counts. */
  namespaceCounts: Record<string, number>;
  /** Cumulative disk-cache hits since process start. */
  hitCount: number;
  /** Cumulative disk-cache misses since process start. */
  missCount: number;
  /** Hit rate expressed as a percentage (0–100). */
  hitRatePct: number;
  /** Number of entries evicted under disk pressure. */
  evictionCount: number;
  /** Absolute path of the cache root directory on the host OS. */
  rootDir: string;
}

/** Mirrors Rust `IntegrityReport`. */
export interface IntegrityReport {
  /** Total number of files scanned during verification. */
  scannedFiles: number;
  /** Number of files moved to quarantine due to corruption or orphaning. */
  quarantinedFiles: number;
  /** Total bytes quarantined. */
  quarantinedBytes: number;
  /** Human-readable error messages encountered during verification. */
  errors: string[];
}

/** Mirrors Rust `PurgeResult`. */
export interface PurgeResult {
  purgedFiles: number;
  purgedBytes: number;
  remainingBytes: number;
}

// ---------------------------------------------------------------------------
// Raw Rust response shapes (snake_case) used only inside the hook
// ---------------------------------------------------------------------------

interface RawUnifiedCacheStats {
  total_bytes: number;
  limit_bytes: number;
  namespace_bytes: Record<string, number>;
  namespace_counts: Record<string, number>;
  hit_count: number;
  miss_count: number;
  hit_rate_pct: number;
  eviction_count: number;
  root_dir: string;
}

interface RawIntegrityReport {
  scanned_files: number;
  quarantined_files: number;
  quarantined_bytes: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapStats(raw: RawUnifiedCacheStats): UnifiedCacheStats {
  return {
    totalBytes: raw.total_bytes,
    limitBytes: raw.limit_bytes,
    namespaceBytes: raw.namespace_bytes,
    namespaceCounts: raw.namespace_counts,
    hitCount: raw.hit_count,
    missCount: raw.miss_count,
    hitRatePct: raw.hit_rate_pct,
    evictionCount: raw.eviction_count,
    rootDir: raw.root_dir,
  };
}

function mapIntegrityReport(raw: RawIntegrityReport): IntegrityReport {
  return {
    scannedFiles: raw.scanned_files,
    quarantinedFiles: raw.quarantined_files,
    quarantinedBytes: raw.quarantined_bytes,
    errors: raw.errors,
  };
}

// ---------------------------------------------------------------------------
// Hook return type
// ---------------------------------------------------------------------------

export interface UseUnifiedCacheReturn {
  /** Disk cache statistics fetched from the Tauri IPC layer. `null` while loading or on error. */
  stats: UnifiedCacheStats | null;
  /** In-memory cache statistics from the CacheCoordinator. */
  memoryStats: CacheCoordinatorStats;
  /** True while any async operation is in progress. */
  isLoading: boolean;
  /** Error message from the most recent failed operation, or `null` when healthy. */
  error: string | null;
  /**
   * Re-fetch disk cache stats from the native layer.
   * Also snapshots the current in-memory coordinator stats.
   */
  refresh(): Promise<void>;
  /**
   * Update the global disk cache budget.
   * @param bytes - Maximum disk bytes allowed (pass 0 for unlimited).
   */
  setLimit(bytes: number): Promise<void>;
  /**
   * Purge disk cache entries matching the supplied filter.
   * Omitting the filter purges all namespaces.
   */
  purge(filter?: { namespaces?: string[]; olderThanSecs?: number }): Promise<void>;
  /**
   * Run a full integrity scan over the cache directory.
   * @returns The integrity report, or `null` if running outside of a Tauri context.
   */
  verifyIntegrity(): Promise<IntegrityReport | null>;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useUnifiedCache(): UseUnifiedCacheReturn {
  const [stats, setStats] = useState<UnifiedCacheStats | null>(null);
  const [memoryStats, setMemoryStats] = useState<CacheCoordinatorStats>(() =>
    getCacheCoordinator().getStats(),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ------------------------------------------------------------------
  // refresh — fetch disk stats + snapshot memory stats
  // ------------------------------------------------------------------
  const refresh = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      // Always snapshot in-memory coordinator stats (no IPC required)
      setMemoryStats(getCacheCoordinator().getStats());

      if (isTauriRuntime()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const raw = await invoke<RawUnifiedCacheStats>("get_unified_cache_stats");
        setStats(mapStats(raw));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      console.error("[useUnifiedCache] refresh failed:", message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Auto-fetch on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  // ------------------------------------------------------------------
  // setLimit
  // ------------------------------------------------------------------
  const setLimit = useCallback(
    async (bytes: number): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        if (isTauriRuntime()) {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke<void>("set_unified_cache_limit", { limit_bytes: bytes });
        }
        // Refresh stats so the caller sees the updated budget reflected immediately
        await refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        console.error("[useUnifiedCache] setLimit failed:", message);
      } finally {
        setIsLoading(false);
      }
    },
    [refresh],
  );

  // ------------------------------------------------------------------
  // purge
  // ------------------------------------------------------------------
  const purge = useCallback(
    async (filter?: { namespaces?: string[]; olderThanSecs?: number }): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        if (isTauriRuntime()) {
          const { invoke } = await import("@tauri-apps/api/core");

          // Map camelCase TS filter → snake_case Rust PurgeFilter
          const rustFilter =
            filter != null
              ? {
                  namespaces: filter.namespaces ?? null,
                  older_than_secs: filter.olderThanSecs ?? null,
                }
              : null;

          await invoke<PurgeResult>("purge_unified_cache", { filter: rustFilter });
        }
        await refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        console.error("[useUnifiedCache] purge failed:", message);
      } finally {
        setIsLoading(false);
      }
    },
    [refresh],
  );

  // ------------------------------------------------------------------
  // verifyIntegrity
  // ------------------------------------------------------------------
  const verifyIntegrity = useCallback(async (): Promise<IntegrityReport | null> => {
    if (!isTauriRuntime()) return null;

    setIsLoading(true);
    setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const raw = await invoke<RawIntegrityReport>("verify_cache_integrity");
      return mapIntegrityReport(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      console.error("[useUnifiedCache] verifyIntegrity failed:", message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    stats,
    memoryStats,
    isLoading,
    error,
    refresh,
    setLimit,
    purge,
    verifyIntegrity,
  };
}
