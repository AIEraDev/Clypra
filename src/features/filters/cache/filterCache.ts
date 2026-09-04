/**
 * Filter Cache Manager
 * Handles downloading and caching filter JSON definitions from the API to disk
 */

import { BaseDirectory, exists, mkdir, writeFile, readFile, remove, readDir } from "@tauri-apps/plugin-fs";
import { join, appCacheDir } from "@tauri-apps/api/path";
import type { FilterAsset } from "../types";
import {
  isValidFilterUrl,
  sanitizeRemoteFilterPayload,
  MAX_FILTER_PAYLOAD_BYTES,
} from "../security/filterValidation";
import { getCacheCoordinator } from "@/core/cache/cacheCoordinator";

export interface CachedFilter {
  id: string;
  localPath: string; // Relative path under AppCache (e.g. "filters/filter-sepia.json")
  filter: FilterAsset;
  fileName: string;
  size: number;
  downloadedAt: number;
}

export interface FilterDownloadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

const CACHE_DIR = "filters";
const CACHE_INDEX_FILE = "index.json";

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_. ]/g, "_")
    .replace(/\s+/g, "_")
    .substring(0, 100);
}

class FilterCacheManager {
  private cacheIndex: Map<string, CachedFilter> = new Map();
  private cacheDir: string | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    if (!isTauri) {
      // In web or test environment, use in-memory cache without disk persistence
      this.initialized = true;
      return;
    }

    try {
      const appCache = await appCacheDir();
      this.cacheDir = await join(appCache, CACHE_DIR);

      const dirExists = await exists(this.cacheDir, { baseDir: BaseDirectory.AppCache });
      if (!dirExists) {
        await mkdir(this.cacheDir, { baseDir: BaseDirectory.AppCache, recursive: true });
      }

      await this.loadIndex();
      this.initialized = true;
    } catch (error) {
      console.warn("[FilterCache] Disk cache initialization failed, falling back to memory:", error);
      this.initialized = true;
    }
  }

  private async loadIndex(): Promise<void> {
    if (!this.cacheDir) return;

    try {
      const indexPath = await join(this.cacheDir, CACHE_INDEX_FILE);
      const indexExists = await exists(indexPath, { baseDir: BaseDirectory.AppCache });

      if (indexExists) {
        const indexData = await readFile(indexPath, { baseDir: BaseDirectory.AppCache });
        const indexJson = new TextDecoder().decode(indexData);
        const indexArray: CachedFilter[] = JSON.parse(indexJson);

        this.cacheIndex.clear();
        indexArray.forEach((item) => {
          this.cacheIndex.set(item.id, item);
        });
      }
    } catch (error) {
      console.warn("[FilterCache] Failed to load index, starting fresh:", error);
      this.cacheIndex.clear();
    }
  }

  private async saveIndex(): Promise<void> {
    if (!this.cacheDir) return;

    try {
      const indexPath = await join(this.cacheDir, CACHE_INDEX_FILE);
      const indexArray = Array.from(this.cacheIndex.values());
      const indexJson = JSON.stringify(indexArray, null, 2);
      const indexData = new TextEncoder().encode(indexJson);

      await writeFile(indexPath, indexData, { baseDir: BaseDirectory.AppCache });
    } catch (error) {
      console.error("[FilterCache] Failed to save index:", error);
    }
  }

  isCached(filterId: string): boolean {
    return this.cacheIndex.has(filterId);
  }

  getCached(filterId: string): CachedFilter | null {
    return this.cacheIndex.get(filterId) || null;
  }

  getCachedPath(filterId: string): string | null {
    const cached = this.cacheIndex.get(filterId);
    return cached ? cached.localPath : null;
  }

  /**
   * Download and cache a filter JSON definition
   */
  async downloadFilter(filter: FilterAsset, onProgress?: (progress: FilterDownloadProgress) => void): Promise<CachedFilter> {
    await this.initialize();

    // Return cached if already downloaded
    if (this.isCached(filter.id)) {
      return this.cacheIndex.get(filter.id)!;
    }

    try {
      const sanitizedName = sanitizeFileName(filter.name);
      const fileName = `${filter.id}_${sanitizedName}.json`;
      const relativePath = `${CACHE_DIR}/${fileName}`;

      // Fetch full detail when none of the render paths are inlined.
      // Priority: gradingParams (GPU) > effectStack (V2 MPG)
      let finalFilter = { ...filter };
      const hasRenderData = (!!finalFilter.gradingParams && Object.keys(finalFilter.gradingParams).length > 0) || (finalFilter.pipeline === "v2" && !!finalFilter.effectStack?.length);
      const needsDetail = !hasRenderData && !!finalFilter.url;

      if (needsDetail && finalFilter.url) {
        if (!isValidFilterUrl(finalFilter.url)) {
          console.warn(`[FilterCacheManager] Blocked invalid or unsafe filter URL: ${finalFilter.url}`);
        } else {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const res = await fetch(finalFilter.url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (res.ok) {
              const contentLength = res.headers.get("content-length");
              if (contentLength && parseInt(contentLength, 10) > MAX_FILTER_PAYLOAD_BYTES) {
                throw new Error(`Filter payload exceeds maximum size limit (${contentLength} bytes)`);
              }

              const text = await res.text();
              if (text.length > MAX_FILTER_PAYLOAD_BYTES) {
                throw new Error(`Filter payload exceeds maximum size limit (${text.length} bytes)`);
              }

              const remoteFilter = JSON.parse(text);
              finalFilter = sanitizeRemoteFilterPayload(remoteFilter, finalFilter);
            }
          } catch (fetchErr) {
            console.warn(`[FilterCacheManager] Error fetching filter details from remote:`, fetchErr);
          }
        }
      }

      const filterJson = JSON.stringify(finalFilter, null, 2);
      const fileData = new TextEncoder().encode(filterJson);

      // Simulate progress for consistency
      if (onProgress) {
        onProgress({
          loaded: fileData.length,
          total: fileData.length,
          percentage: 100,
        });
      }

      // Write to disk only if running in a native desktop Tauri environment
      if (this.cacheDir) {
        const appCache = await appCacheDir();
        const fullCacheDir = await join(appCache, CACHE_DIR);
        const dirExists = await exists(fullCacheDir);
        if (!dirExists) {
          await mkdir(fullCacheDir, { recursive: true });
        }
        const fullPath = await join(appCache, relativePath);
        await writeFile(fullPath, fileData);
      }

      const cachedFile: CachedFilter = {
        id: finalFilter.id,
        localPath: relativePath,
        filter: finalFilter,
        fileName,
        size: fileData.length,
        downloadedAt: Date.now(),
      };

      this.cacheIndex.set(finalFilter.id, cachedFile);
      if (this.cacheDir) {
        await this.saveIndex();
      }

      return cachedFile;
    } catch (error) {
      console.error("[FilterCacheManager] Download failed:", error);
      throw new Error(`Failed to cache filter: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Ensure a filter is cached (download if not already cached)
   */
  async ensureDownloaded(filter: FilterAsset, onProgress?: (progress: FilterDownloadProgress) => void): Promise<CachedFilter> {
    await this.initialize();

    if (this.isCached(filter.id)) {
      const cached = this.cacheIndex.get(filter.id)!;
      // Accept cached entry if any render path is present
      const hasRenderData = (!!cached.filter.gradingParams && Object.keys(cached.filter.gradingParams).length > 0) || (cached.filter.pipeline === "v2" && !!cached.filter.effectStack?.length);
      if (hasRenderData) return cached;
      console.log(`[FilterCache] Cached filter ${filter.name} has no render data. Evicting and re-downloading.`);
      this.cacheIndex.delete(filter.id);
    }

    return this.downloadFilter(filter, onProgress);
  }

  /**
   * Load a cached filter from disk
   */
  async loadCachedFilter(filterId: string): Promise<FilterAsset | null> {
    await this.initialize();

    const cached = this.cacheIndex.get(filterId);
    if (!cached) return null;

    try {
      const fileExists = await exists(cached.localPath, { baseDir: BaseDirectory.AppCache });
      if (!fileExists) {
        // File was deleted externally, remove from index
        this.cacheIndex.delete(filterId);
        await this.saveIndex();
        return null;
      }

      const data = await readFile(cached.localPath, { baseDir: BaseDirectory.AppCache });
      const jsonText = new TextDecoder().decode(data);
      const parsed = JSON.parse(jsonText);
      return sanitizeRemoteFilterPayload(parsed, cached.filter);
    } catch (error) {
      console.error("[FilterCache] Failed to load cached filter:", error);
      return null;
    }
  }

  /**
   * Clear cache for a specific filter
   */
  async clearCache(filterId: string): Promise<void> {
    await this.initialize();

    const cached = this.cacheIndex.get(filterId);
    if (!cached) return;

    try {
      const fileExists = await exists(cached.localPath, { baseDir: BaseDirectory.AppCache });
      if (fileExists) {
        await remove(cached.localPath, { baseDir: BaseDirectory.AppCache });
      }

      this.cacheIndex.delete(filterId);
      await this.saveIndex();
    } catch (error) {
      console.error("[FilterCache] Failed to clear cache:", error);
      throw error;
    }
  }

  /**
   * Clear all cached filters
   */
  async clearAllCache(): Promise<void> {
    await this.initialize();

    if (!this.cacheDir) return;

    try {
      const entries = await readDir(this.cacheDir, { baseDir: BaseDirectory.AppCache });

      for (const entry of entries) {
        if (entry.name !== CACHE_INDEX_FILE) {
          const filePath = await join(this.cacheDir, entry.name);
          await remove(filePath, { baseDir: BaseDirectory.AppCache });
        }
      }

      this.cacheIndex.clear();
      await this.saveIndex();
    } catch (error) {
      console.error("[FilterCache] Failed to clear all cache:", error);
      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { count: number; totalSize: number; items: CachedFilter[] } {
    const items = Array.from(this.cacheIndex.values());
    const totalSize = items.reduce((sum, item) => sum + item.size, 0);

    return {
      count: items.length,
      totalSize,
      items,
    };
  }

  /**
   * Get all cached filters
   */
  getAllCached(): CachedFilter[] {
    return Array.from(this.cacheIndex.values());
  }
}

export const filterCacheManager = new FilterCacheManager();

getCacheCoordinator().register({
  name: "filter-cache",
  getBytesUsed: () => filterCacheManager.getCacheStats().totalSize,
  trimTo: (targetBytes) => {
    let freed = 0;
    const items = filterCacheManager.getAllCached();
    for (const item of items) {
      if (filterCacheManager.getCacheStats().totalSize <= targetBytes) break;
      const size = item.size;
      filterCacheManager.clearCache(item.id).catch(() => {});
      freed += size;
    }
    return freed;
  },
  clear: () => {
    filterCacheManager.clearAllCache().catch(() => {});
  },
});
