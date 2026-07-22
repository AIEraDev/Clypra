/**
 * React Hook for Cache Management
 *
 * Provides a convenient interface for managing application caches
 * with loading states and error handling.
 */

import { useState, useCallback, useEffect } from "react";
import { CacheManager, CacheStats } from "@/lib/cache/cacheManager";
import { t } from "@/i18n";

interface CacheInfo {
  localStorage: number;
  sessionStorage: number;
  gpuCache: any;
}

interface UseCacheManagerReturn {
  // State
  isClearing: boolean;
  cacheInfo: CacheInfo | null;
  lastResult: {
    success: boolean;
    message: string;
    stats?: CacheStats;
  } | null;

  // Actions
  clearAppCache: () => Promise<void>;
  clearWebViewCache: () => Promise<void>;
  clearGPUCache: () => void;
  clearAllCaches: (options?: Parameters<typeof CacheManager.clearAllCaches>[0]) => Promise<void>;
  refreshCacheInfo: () => Promise<void>;
  clearResult: () => void;
}

export function useCacheManager(): UseCacheManagerReturn {
  const [isClearing, setIsClearing] = useState(false);
  const [cacheInfo, setCacheInfo] = useState<CacheInfo | null>(null);
  const [lastResult, setLastResult] = useState<{
    success: boolean;
    message: string;
    stats?: CacheStats;
  } | null>(null);

  // Load cache info on mount
  useEffect(() => {
    refreshCacheInfo();
  }, []);

  const refreshCacheInfo = useCallback(async () => {
    try {
      const info = await CacheManager.getCacheInfo();
      setCacheInfo(info);
    } catch (error) {
      console.error("Failed to load cache info:", error);
    }
  }, []);

  const clearAppCache = useCallback(async () => {
    setIsClearing(true);
    setLastResult(null);

    try {
      const result = await CacheManager.clearAppCache();
      setLastResult({
        success: result.success,
        message: result.success ? t("settings.cache.appCleared") : t("settings.cache.clearFailed", { cache: t("settings.cache.name.app"), error: result.error ?? t("settings.cache.unknownError") }),
      });

      if (result.success) {
        await refreshCacheInfo();
      }
    } catch (error) {
      setLastResult({
        success: false,
        message: error instanceof Error ? error.message : t("settings.cache.unknownError"),
      });
    } finally {
      setIsClearing(false);
    }
  }, [refreshCacheInfo]);

  const clearWebViewCache = useCallback(async () => {
    setIsClearing(true);
    setLastResult(null);

    try {
      const result = await CacheManager.clearWebViewCache();
      setLastResult({
        success: result.success,
        message: result.success ? t("settings.cache.webViewCleared") : t("settings.cache.clearFailed", { cache: t("settings.cache.name.webView"), error: result.error ?? t("settings.cache.unknownError") }),
      });

      if (result.success) {
        await refreshCacheInfo();
      }
    } catch (error) {
      setLastResult({
        success: false,
        message: error instanceof Error ? error.message : t("settings.cache.unknownError"),
      });
    } finally {
      setIsClearing(false);
    }
  }, [refreshCacheInfo]);

  const clearGPUCache = useCallback(() => {
    setIsClearing(true);
    setLastResult(null);

    try {
      const result = CacheManager.clearGPUCache();
      setLastResult({
        success: result.success,
        message: result.success ? t("settings.cache.gpuCleared") : t("settings.cache.clearFailed", { cache: t("settings.cache.name.gpu"), error: result.error ?? t("settings.cache.unknownError") }),
      });

      if (result.success) {
        refreshCacheInfo();
      }
    } catch (error) {
      setLastResult({
        success: false,
        message: error instanceof Error ? error.message : t("settings.cache.unknownError"),
      });
    } finally {
      setIsClearing(false);
    }
  }, [refreshCacheInfo]);

  const clearAllCaches = useCallback(
    async (options?: Parameters<typeof CacheManager.clearAllCaches>[0]) => {
      setIsClearing(true);
      setLastResult(null);

      try {
        const stats = await CacheManager.clearAllCaches(options);
        setLastResult({
          success: stats.errors.length === 0,
          message: stats.errors.length === 0 ? t("settings.cache.allCleared") : t("settings.cache.clearedWithErrors", { count: stats.errors.length }),
          stats,
        });

        // Refresh cache info in the background (non-blocking)
        refreshCacheInfo().catch((err) => console.warn("Failed to refresh cache info:", err));
      } catch (error) {
        setLastResult({
          success: false,
          message: error instanceof Error ? error.message : t("settings.cache.unknownError"),
        });
      } finally {
        setIsClearing(false);
      }
    },
    [refreshCacheInfo],
  );

  const clearResult = useCallback(() => {
    setLastResult(null);
  }, []);

  return {
    isClearing,
    cacheInfo,
    lastResult,
    clearAppCache,
    clearWebViewCache,
    clearGPUCache,
    clearAllCaches,
    refreshCacheInfo,
    clearResult,
  };
}
