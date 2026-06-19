/**
 * Cache Manager for Tauri v2 Application
 *
 * Provides utilities to clear various types of cache:
 * - App cache (Tauri BaseDirectory.AppCache)
 * - WebView cache (Windows EBWebView)
 * - HTTP cache (Cache API / Disk Cache for network requests)
 * - Local data cache
 * - GPU texture cache
 * - Application state cache
 */

import { remove, BaseDirectory, exists } from "@tauri-apps/plugin-fs";
import { globalGPUCache } from "./globalGPUCache";

export interface CacheStats {
  appCacheCleared: boolean;
  webViewCacheCleared: boolean;
  gpuCacheCleared: boolean;
  errors: string[];
}

const isTauri = () => typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

const clearBrowserStorage = (storage: Storage) => {
  if (typeof Storage !== "undefined" && Storage.prototype.clear) {
    try {
      Storage.prototype.clear.call(storage);
      return;
    } catch {
      // Fall back for nonstandard test/runtime storage shims.
    }
  }
  storage.clear();
};

export class CacheManager {
  /**
   * Clear the entire Tauri app cache directory
   * This removes all cached files stored in BaseDirectory.AppCache
   */
  static async clearAppCache(): Promise<{ success: boolean; error?: string }> {
    if (!isTauri()) {
      return { success: true };
    }

    try {
      // Check if cache directory exists
      const cacheExists = await exists("", { baseDir: BaseDirectory.AppCache });

      if (!cacheExists) {
        return { success: true };
      }

      // Remove the entire app cache directory recursively
      await remove("", { baseDir: BaseDirectory.AppCache, recursive: true });
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("❌ Failed to clear app cache:", errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Clear WebView engine cache (Windows only)
   * This targets the EBWebView folder where WebView2/Edge stores cache
   *
   * Note: Some WebView processes may lock these files while the app is running.
   * A full restart may be required for complete deletion.
   */
  static async clearWebViewCache(): Promise<{ success: boolean; error?: string }> {
    if (!isTauri()) {
      return { success: true };
    }

    try {
      // Check if WebView cache exists
      const webViewExists = await exists("EBWebView", { baseDir: BaseDirectory.AppLocalData });

      if (!webViewExists) {
        return { success: true };
      }

      // Remove WebView cache directory
      await remove("EBWebView", { baseDir: BaseDirectory.AppLocalData, recursive: true });
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("❌ Failed to clear WebView cache:", errorMsg);

      // WebView cache might be locked by running processes
      if (errorMsg.includes("locked") || errorMsg.includes("in use")) {
        console.warn("⚠️ WebView cache is locked. Please restart the application for full cache clearing.");
      }

      return { success: false, error: errorMsg };
    }
  }

  /**
   * Clear GPU texture cache
   * This clears the in-memory GPU texture cache used for video rendering
   */
  static clearGPUCache(): { success: boolean; error?: string } {
    try {
      if (globalGPUCache.isInitialized()) {
        const stats = globalGPUCache.getStats();

        // Dispose of GPU cache
        globalGPUCache.dispose();
        return { success: true };
      } else {
        return { success: true };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("❌ Failed to clear GPU cache:", errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Clear browser localStorage
   * This clears all localStorage data including settings and preferences
   */
  static clearLocalStorage(): { success: boolean; error?: string } {
    try {
      const itemCount = localStorage.length;
      clearBrowserStorage(localStorage);
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("❌ Failed to clear localStorage:", errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Clear browser sessionStorage
   */
  static clearSessionStorage(): { success: boolean; error?: string } {
    try {
      const itemCount = sessionStorage.length;
      clearBrowserStorage(sessionStorage);
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("❌ Failed to clear sessionStorage:", errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Clear IndexedDB databases
   * This removes all IndexedDB databases used by the application
   */
  static async clearIndexedDB(): Promise<{ success: boolean; error?: string }> {
    try {
      const databases = await indexedDB.databases();
      const deletePromises = databases.map((db) => {
        if (db.name) {
          return new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase(db.name!);
            request.onsuccess = () => {
              resolve();
            };
            request.onerror = () => reject(request.error);
          });
        }
        return Promise.resolve();
      });

      await Promise.all(deletePromises);
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("❌ Failed to clear IndexedDB:", errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Clear HTTP Cache (Cache API)
   * This clears the browser's HTTP disk cache used for network requests
   * This is the cache shown in DevTools as "Disk Cache"
   */
  static async clearHTTPCache(): Promise<{ success: boolean; error?: string }> {
    try {
      if (!("caches" in window)) {
        return { success: true };
      }

      const cacheNames = await caches.keys();
      const deletePromises = cacheNames.map((cacheName) => {
        return caches.delete(cacheName).then(() => {});
      });

      await Promise.all(deletePromises);
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("❌ Failed to clear HTTP cache:", errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Clear all caches (comprehensive cleanup)
   * This performs a full cache clear including:
   * - App cache
   * - WebView cache
   * - GPU cache
   * - HTTP cache (Cache API / Disk Cache)
   * - localStorage
   * - sessionStorage
   * - IndexedDB
   *
   * @param options - Configure which caches to clear
   */
  static async clearAllCaches(
    options: {
      appCache?: boolean;
      webViewCache?: boolean;
      gpuCache?: boolean;
      httpCache?: boolean;
      localStorage?: boolean;
      sessionStorage?: boolean;
      indexedDB?: boolean;
    } = {},
  ): Promise<CacheStats> {
    const { appCache = true, webViewCache = true, gpuCache = true, httpCache = true, localStorage: clearLS = true, sessionStorage: clearSS = true, indexedDB = true } = options;

    const stats: CacheStats = {
      appCacheCleared: false,
      webViewCacheCleared: false,
      gpuCacheCleared: false,
      errors: [],
    };

    // Run all async operations in parallel for better performance
    const operations = [];

    // Clear app cache
    if (appCache) {
      operations.push(
        this.clearAppCache().then((result) => {
          stats.appCacheCleared = result.success;
          if (result.error) stats.errors.push(`App cache: ${result.error}`);
        }),
      );
    }

    // Clear WebView cache (Windows)
    if (webViewCache) {
      operations.push(
        this.clearWebViewCache().then((result) => {
          stats.webViewCacheCleared = result.success;
          if (result.error) stats.errors.push(`WebView cache: ${result.error}`);
        }),
      );
    }

    // Clear HTTP cache (Cache API / Disk Cache)
    if (httpCache) {
      operations.push(
        this.clearHTTPCache().then((result) => {
          if (result.error) stats.errors.push(`HTTP cache: ${result.error}`);
        }),
      );
    }

    // Clear IndexedDB
    if (indexedDB) {
      operations.push(
        this.clearIndexedDB().then((result) => {
          if (result.error) stats.errors.push(`IndexedDB: ${result.error}`);
        }),
      );
    }

    // Wait for all async operations to complete
    await Promise.all(operations);

    // Clear GPU cache (synchronous)
    if (gpuCache) {
      const result = this.clearGPUCache();
      stats.gpuCacheCleared = result.success;
      if (result.error) stats.errors.push(`GPU cache: ${result.error}`);
    }

    // Clear localStorage (synchronous)
    if (clearLS) {
      const result = this.clearLocalStorage();
      if (result.error) stats.errors.push(`localStorage: ${result.error}`);
    }

    // Clear sessionStorage (synchronous)
    if (clearSS) {
      const result = this.clearSessionStorage();
      if (result.error) stats.errors.push(`sessionStorage: ${result.error}`);
    }

    return stats;
  }

  /**
   * Get cache size estimates (where available)
   * Note: Actual disk cache sizes require Tauri backend implementation
   */
  static async getCacheInfo(): Promise<{
    localStorage: number;
    sessionStorage: number;
    gpuCache: any;
  }> {
    return {
      localStorage: localStorage.length,
      sessionStorage: sessionStorage.length,
      gpuCache: globalGPUCache.isInitialized() ? globalGPUCache.getStats() : null,
    };
  }
}

// Export convenience functions
export const clearAppCache = () => CacheManager.clearAppCache();
export const clearWebViewCache = () => CacheManager.clearWebViewCache();
export const clearGPUCache = () => CacheManager.clearGPUCache();
export const clearHTTPCache = () => CacheManager.clearHTTPCache();
export const clearAllCaches = (options?: Parameters<typeof CacheManager.clearAllCaches>[0]) => CacheManager.clearAllCaches(options);
export const getCacheInfo = () => CacheManager.getCacheInfo();
