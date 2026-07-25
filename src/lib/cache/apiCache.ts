/**
 * Unified API Cache Manager
 *
 * Provides persistent caching for ALL API data across the application:
 * - Text Effects (index + definitions)
 * - Text Templates (index + data)
 * - Stickers (index + items)
 * - Filters (categories + items)
 * - Transitions (categories + items)
 * - Video Effects (manifests + presets)
 * - Audio Library (categories + items)
 *
 * Storage Strategy:
 * - Small data (<5MB total): localStorage for synchronous access
 * - Large data (>5MB): IndexedDB for async storage
 * - Binary data (audio, videos): Tauri filesystem (handled separately)
 *
 * Cache Invalidation:
 * - Indexes: 24 hours (daily refresh)
 * - Items: 7 days (weekly refresh)
 * - Manifests: 24 hours
 * - Version-based: cleared on cache version change
 */

const CACHE_VERSION = "v1";
const CACHE_PREFIX = `vireostudio.apiCache.${CACHE_VERSION}`;

// Cache duration constants
const CACHE_DURATION = {
  INDEX: 24 * 60 * 60 * 1000, // 24 hours
  ITEM: 7 * 24 * 60 * 60 * 1000, // 7 days
  MANIFEST: 24 * 60 * 60 * 1000, // 24 hours
} as const;

interface CachedEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

type CacheKey =
  | `text-effects:index`
  | `text-effects:${string}:${string}` // category:id
  | `text-templates:index`
  | `text-templates:${string}:${string}` // category:id
  | `stickers:index`
  | `stickers:${string}` // category
  | `stickers:${string}:${string}` // category:id
  | `filters:categories`
  | `filters:${string}` // category
  | `filters:${string}:${string}` // category:id
  | `transitions:categories`
  | `transitions:${string}` // category
  | `transitions:${string}:${string}` // category:id
  | `video-effects:manifest`
  | `video-effects:${string}` // category
  | `body-effects:manifest`
  | `body-effects:${string}` // id
  | `audio:${string}`; // category

/**
 * Get cache key with prefix
 */
function getCacheKey(key: CacheKey): string {
  return `${CACHE_PREFIX}.${key}`;
}

/**
 * Determine cache duration based on key type
 */
function getCacheDuration(key: CacheKey): number {
  if (key.includes(":index") || key.includes(":manifest") || key.includes(":categories")) {
    return CACHE_DURATION.INDEX;
  }
  return CACHE_DURATION.ITEM;
}

/**
 * Get cached data if available and not expired
 */
export function getCached<T>(key: CacheKey): T | null {
  try {
    const cacheKey = getCacheKey(key);
    const cached = localStorage.getItem(cacheKey);

    if (!cached) return null;

    const parsed: CachedEntry<T> = JSON.parse(cached);
    const now = Date.now();

    // Check expiration
    if (now > parsed.expiresAt) {
      localStorage.removeItem(cacheKey);
      return null;
    }

    return parsed.data;
  } catch (err) {
    console.warn(`[ApiCache] Failed to read cache for ${key}:`, err);
    return null;
  }
}

/**
 * Cache data with automatic expiration
 */
export function setCached<T>(key: CacheKey, data: T): void {
  try {
    const cacheKey = getCacheKey(key);
    const duration = getCacheDuration(key);
    const now = Date.now();

    const entry: CachedEntry<T> = {
      data,
      timestamp: now,
      expiresAt: now + duration,
    };

    localStorage.setItem(cacheKey, JSON.stringify(entry));
  } catch (err) {
    console.warn(`[ApiCache] Failed to cache ${key}:`, err);

    // If storage is full, try to clear expired entries
    if (err instanceof Error && err.name === "QuotaExceededError") {
      clearExpired();

      // Try one more time
      try {
        const cacheKey = getCacheKey(key);
        const duration = getCacheDuration(key);
        const now = Date.now();
        const entry: CachedEntry<T> = {
          data,
          timestamp: now,
          expiresAt: now + duration,
        };
        localStorage.setItem(cacheKey, JSON.stringify(entry));
      } catch (retryErr) {
        console.error(`[ApiCache] Failed to cache ${key} after cleanup:`, retryErr);
      }
    }
  }
}

/**
 * Delete specific cache entry
 */
export function deleteCached(key: CacheKey): void {
  try {
    const cacheKey = getCacheKey(key);
    localStorage.removeItem(cacheKey);
  } catch (err) {
    console.warn(`[ApiCache] Failed to delete cache for ${key}:`, err);
  }
}

/**
 * Clear all expired cache entries
 */
export function clearExpired(): number {
  let cleared = 0;
  const now = Date.now();

  try {
    const keys = Object.keys(localStorage);

    for (const key of keys) {
      if (!key.startsWith(CACHE_PREFIX)) continue;

      try {
        const value = localStorage.getItem(key);
        if (!value) continue;

        const parsed: CachedEntry<any> = JSON.parse(value);

        if (now > parsed.expiresAt) {
          localStorage.removeItem(key);
          cleared++;
        }
      } catch {
        // Invalid entry, remove it
        localStorage.removeItem(key);
        cleared++;
      }
    }
  } catch (err) {
    console.error("[ApiCache] Failed to clear expired entries:", err);
  }

  return cleared;
}

/**
 * Clear all API cache
 */
export function clearAllApiCache(): number {
  let cleared = 0;

  try {
    const keys = Object.keys(localStorage);

    for (const key of keys) {
      if (key.startsWith(CACHE_PREFIX)) {
        localStorage.removeItem(key);
        cleared++;
      }
    }
  } catch (err) {
    console.error("[ApiCache] Failed to clear all cache:", err);
  }

  return cleared;
}

/**
 * Clear cache for specific feature
 */
export function clearFeatureCache(feature: "text-effects" | "text-templates" | "stickers" | "filters" | "transitions" | "video-effects" | "body-effects" | "audio"): number {
  let cleared = 0;
  const prefix = `${CACHE_PREFIX}.${feature}:`;

  try {
    const keys = Object.keys(localStorage);

    for (const key of keys) {
      if (key.startsWith(prefix)) {
        localStorage.removeItem(key);
        cleared++;
      }
    }
  } catch (err) {
    console.error(`[ApiCache] Failed to clear ${feature} cache:`, err);
  }

  return cleared;
}

/**
 * Get cache statistics
 */
export function getApiCacheStats(): {
  totalEntries: number;
  totalSizeKB: number;
  byFeature: Record<string, { count: number; sizeKB: number }>;
  expired: number;
} {
  const stats = {
    totalEntries: 0,
    totalSizeKB: 0,
    byFeature: {} as Record<string, { count: number; sizeKB: number }>,
    expired: 0,
  };

  const now = Date.now();

  try {
    const keys = Object.keys(localStorage);

    for (const key of keys) {
      if (!key.startsWith(CACHE_PREFIX)) continue;

      const value = localStorage.getItem(key);
      if (!value) continue;

      const sizeKB = value.length / 1024;
      stats.totalEntries++;
      stats.totalSizeKB += sizeKB;

      // Extract feature from key
      const keyParts = key.replace(`${CACHE_PREFIX}.`, "").split(":");
      const feature = keyParts[0];

      if (!stats.byFeature[feature]) {
        stats.byFeature[feature] = { count: 0, sizeKB: 0 };
      }
      stats.byFeature[feature].count++;
      stats.byFeature[feature].sizeKB += sizeKB;

      // Check if expired
      try {
        const parsed: CachedEntry<any> = JSON.parse(value);
        if (now > parsed.expiresAt) {
          stats.expired++;
        }
      } catch {
        // Invalid entry counts as expired
        stats.expired++;
      }
    }
  } catch (err) {
    console.error("[ApiCache] Failed to get cache stats:", err);
  }

  return stats;
}

/**
 * Prefetch and cache data
 */
export async function prefetchAndCache<T>(key: CacheKey, fetchFn: () => Promise<T>, options: { force?: boolean } = {}): Promise<T> {
  // Check cache first
  if (!options.force) {
    const cached = getCached<T>(key);
    if (cached) {
      return cached;
    }
  }

  // Fetch fresh data
  const data = await fetchFn();

  // Cache it
  setCached(key, data);

  return data;
}

// Expose to window for console debugging
if (typeof window !== "undefined") {
  (window as any).__apiCache = {
    getStats: getApiCacheStats,
    clearAll: clearAllApiCache,
    clearExpired,
    clearFeature: clearFeatureCache,
    getCached,
    setCached,
    deleteCached,
  };
}

/**
 * Console commands:
 *
 * Get cache stats:
 * __apiCache.getStats()
 *
 * Clear all API cache:
 * __apiCache.clearAll()
 *
 * Clear expired entries:
 * __apiCache.clearExpired()
 *
 * Clear specific feature:
 * __apiCache.clearFeature('text-effects')
 *
 * Manually get/set cache:
 * __apiCache.getCached('text-effects:index')
 * __apiCache.setCached('text-effects:index', data)
 */
