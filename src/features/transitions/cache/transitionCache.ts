/**
 * Transition Cache Manager
 * Handles downloading and caching transition JSON definitions from the API to disk.
 *
 * Strategy: API-fetched TransitionAsset objects are persisted as JSON in the
 * Tauri AppCache directory (AppCache/transitions/). An index.json tracks all cached
 * entries. Cache entries expire after CACHE_TTL_MS (7 days) and are re-fetched
 * transparently on next use.
 */

import { BaseDirectory, exists, mkdir, writeFile, readFile, remove, readDir } from "@tauri-apps/plugin-fs";
import { join, appCacheDir } from "@tauri-apps/api/path";
import type { TransitionAsset } from "../types";

// ── Constants ────────────────────────────────────────────────────────────────

const CACHE_DIR = "transitions";
const CACHE_INDEX_FILE = "index.json";
/** 7 days in milliseconds */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CachedTransition {
  id: string;
  /** Relative path under AppCache (e.g. "transitions/fade__Cross-Dissolve.json") */
  localPath: string;
  transition: TransitionAsset;
  fileName: string;
  size: number;
  downloadedAt: number;
}

export interface TransitionDownloadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_. ]/g, "_")
    .replace(/\s+/g, "_")
    .substring(0, 100);
}

// ── Cache Manager ─────────────────────────────────────────────────────────────

class TransitionCacheManager {
  private cacheIndex: Map<string, CachedTransition> = new Map();
  private cacheDir: string | null = null;
  private initialized = false;

  // ── Initialization ──────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.initialized) return;

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
      console.error("[TransitionCache] Failed to initialize:", error);
      throw new Error("Failed to initialize transition cache");
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
        const indexArray: CachedTransition[] = JSON.parse(indexJson);

        this.cacheIndex.clear();
        indexArray.forEach((item) => {
          this.cacheIndex.set(item.id, item);
        });
      }
    } catch (error) {
      console.warn("[TransitionCache] Failed to load index, starting fresh:", error);
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
      console.error("[TransitionCache] Failed to save index:", error);
    }
  }

  // ── Public Read API ─────────────────────────────────────────────────────────

  isCached(transitionId: string): boolean {
    return this.cacheIndex.has(transitionId);
  }

  getCached(transitionId: string): CachedTransition | null {
    return this.cacheIndex.get(transitionId) || null;
  }

  getCachedPath(transitionId: string): string | null {
    const cached = this.cacheIndex.get(transitionId);
    return cached ? cached.localPath : null;
  }

  /** Returns true if the cached entry is still within the TTL window. */
  private isFresh(cached: CachedTransition): boolean {
    return Date.now() - cached.downloadedAt < CACHE_TTL_MS;
  }

  // ── Download ────────────────────────────────────────────────────────────────

  /**
   * Download and cache a transition definition JSON.
   * If already cached (and fresh), returns the cached entry immediately.
   */
  async downloadTransition(
    transition: TransitionAsset,
    onProgress?: (progress: TransitionDownloadProgress) => void,
  ): Promise<CachedTransition> {
    await this.initialize();

    if (!this.cacheDir) {
      throw new Error("Cache directory not initialized");
    }

    // Return fresh cached entry without hitting the network
    if (this.isCached(transition.id)) {
      const cached = this.cacheIndex.get(transition.id)!;
      if (this.isFresh(cached)) {
        return cached;
      }
      // Stale — evict and re-download
      console.log(`[TransitionCache] Entry for "${transition.name}" is stale (>7d). Re-downloading.`);
      this.cacheIndex.delete(transition.id);
    }

    try {
      const appCache = await appCacheDir();
      const fullCacheDir = await join(appCache, CACHE_DIR);

      const dirExists = await exists(fullCacheDir);
      if (!dirExists) {
        await mkdir(fullCacheDir, { recursive: true });
      }

      const sanitizedName = sanitizeFileName(transition.name);
      const fileName = `${transition.id}_${sanitizedName}.json`;
      const relativePath = `${CACHE_DIR}/${fileName}`;
      const fullPath = await join(appCache, relativePath);

      const transitionJson = JSON.stringify(transition, null, 2);
      const fileData = new TextEncoder().encode(transitionJson);

      // Simulate progress for UI consistency
      if (onProgress) {
        onProgress({
          loaded: fileData.length,
          total: fileData.length,
          percentage: 100,
        });
      }

      await writeFile(fullPath, fileData);

      const cachedFile: CachedTransition = {
        id: transition.id,
        localPath: relativePath,
        transition,
        fileName,
        size: fileData.length,
        downloadedAt: Date.now(),
      };

      this.cacheIndex.set(transition.id, cachedFile);
      await this.saveIndex();

      console.log(`[TransitionCache] Cached transition: ${transition.name} → ${relativePath}`);
      return cachedFile;
    } catch (error) {
      console.error("[TransitionCache] Download failed:", error);
      throw new Error(
        `Failed to cache transition: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Ensure a transition is cached (download if not already cached or if stale).
   */
  async ensureDownloaded(
    transition: TransitionAsset,
    onProgress?: (progress: TransitionDownloadProgress) => void,
  ): Promise<CachedTransition> {
    await this.initialize();

    if (this.isCached(transition.id)) {
      const cached = this.cacheIndex.get(transition.id)!;
      if (this.isFresh(cached)) {
        return cached;
      }
      // Stale — evict
      this.cacheIndex.delete(transition.id);
    }

    return this.downloadTransition(transition, onProgress);
  }

  // ── Load from Disk ──────────────────────────────────────────────────────────

  /**
   * Load a cached transition definition from disk.
   * Returns null if the entry doesn't exist or the file has been deleted.
   */
  async loadCachedTransition(transitionId: string): Promise<TransitionAsset | null> {
    await this.initialize();

    const cached = this.cacheIndex.get(transitionId);
    if (!cached) return null;

    try {
      const fileExists = await exists(cached.localPath, { baseDir: BaseDirectory.AppCache });
      if (!fileExists) {
        // File deleted externally — remove stale index entry
        this.cacheIndex.delete(transitionId);
        await this.saveIndex();
        return null;
      }

      const data = await readFile(cached.localPath, { baseDir: BaseDirectory.AppCache });
      const jsonText = new TextDecoder().decode(data);
      return JSON.parse(jsonText) as TransitionAsset;
    } catch (error) {
      console.error("[TransitionCache] Failed to load cached transition:", error);
      return null;
    }
  }

  // ── Cache Management ────────────────────────────────────────────────────────

  /** Clear the cached file for a single transition. */
  async clearCache(transitionId: string): Promise<void> {
    await this.initialize();

    const cached = this.cacheIndex.get(transitionId);
    if (!cached) return;

    try {
      const fileExists = await exists(cached.localPath, { baseDir: BaseDirectory.AppCache });
      if (fileExists) {
        await remove(cached.localPath, { baseDir: BaseDirectory.AppCache });
      }

      this.cacheIndex.delete(transitionId);
      await this.saveIndex();
    } catch (error) {
      console.error("[TransitionCache] Failed to clear cache:", error);
      throw error;
    }
  }

  /** Clear all cached transitions. */
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
      console.error("[TransitionCache] Failed to clear all cache:", error);
      throw error;
    }
  }

  /** Evict all entries older than the TTL. Returns number of entries evicted. */
  async evictStale(): Promise<number> {
    await this.initialize();

    const staleIds: string[] = [];
    for (const [id, cached] of this.cacheIndex.entries()) {
      if (!this.isFresh(cached)) {
        staleIds.push(id);
      }
    }

    for (const id of staleIds) {
      await this.clearCache(id).catch((err) =>
        console.warn(`[TransitionCache] Failed to evict stale entry ${id}:`, err),
      );
    }

    return staleIds.length;
  }

  /** Get cache statistics. */
  getCacheStats(): { count: number; totalSize: number; staleCount: number; items: CachedTransition[] } {
    const items = Array.from(this.cacheIndex.values());
    const totalSize = items.reduce((sum, item) => sum + item.size, 0);
    const staleCount = items.filter((item) => !this.isFresh(item)).length;

    return { count: items.length, totalSize, staleCount, items };
  }

  /** Get all cached transitions. */
  getAllCached(): CachedTransition[] {
    return Array.from(this.cacheIndex.values());
  }
}

export const transitionCacheManager = new TransitionCacheManager();
