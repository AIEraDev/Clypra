/**
 * Smart Overlay Cache Manager
 * Handles saving and loading custom smart overlay definitions from disk/cache storage
 */

import { BaseDirectory, exists, mkdir, writeFile, readFile, remove } from "@tauri-apps/plugin-fs";
import { join, appCacheDir } from "@tauri-apps/api/path";
import type { SmartOverlayClip, SmartOverlayPreset } from "@/types/smartOverlay";

export interface CachedSmartOverlay {
  id: string;
  name: string;
  category: string;
  localPath: string; // Relative path under AppCache (e.g. "smart-overlays/overlay-123.json")
  clipData: SmartOverlayClip;
  fileName: string;
  size: number;
  downloadedAt: number;
  isCustom?: boolean;
}

const CACHE_DIR = "smart-overlays";
const CACHE_INDEX_FILE = "index.json";

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_. ]/g, "_")
    .replace(/\s+/g, "_")
    .substring(0, 100);
}

class SmartOverlayCacheManager {
  private cacheIndex: Map<string, CachedSmartOverlay> = new Map();
  private cacheDir: string | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    if (!isTauri) {
      // In web or test environment, fallback to memory / CacheStorage
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
    } catch (err) {
      console.warn("[SmartOverlayCacheManager] Disk cache init warning, falling back to memory:", err);
      this.initialized = true;
    }
  }

  private async loadIndex(): Promise<void> {
    try {
      const indexPath = await join(CACHE_DIR, CACHE_INDEX_FILE);
      const indexExists = await exists(indexPath, { baseDir: BaseDirectory.AppCache });
      if (!indexExists) return;

      const content = await readFile(indexPath, { baseDir: BaseDirectory.AppCache });
      const text = new TextDecoder().decode(content);
      const items: CachedSmartOverlay[] = JSON.parse(text);

      this.cacheIndex.clear();
      for (const item of items) {
        this.cacheIndex.set(item.id, item);
      }
    } catch (err) {
      console.error("[SmartOverlayCacheManager] Failed to load index:", err);
    }
  }

  private async saveIndex(): Promise<void> {
    const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    if (!isTauri) return;

    try {
      const indexPath = await join(CACHE_DIR, CACHE_INDEX_FILE);
      const items = Array.from(this.cacheIndex.values());
      const jsonStr = JSON.stringify(items, null, 2);
      const bytes = new TextEncoder().encode(jsonStr);

      await writeFile(indexPath, bytes, { baseDir: BaseDirectory.AppCache });
    } catch (err) {
      console.error("[SmartOverlayCacheManager] Failed to save index:", err);
    }
  }

  public isCached(id: string): boolean {
    return this.cacheIndex.has(id);
  }

  public getCached(id: string): CachedSmartOverlay | null {
    return this.cacheIndex.get(id) || null;
  }

  public getAllCached(): CachedSmartOverlay[] {
    return Array.from(this.cacheIndex.values());
  }

  public async saveOverlay(name: string, clipData: SmartOverlayClip): Promise<CachedSmartOverlay> {
    await this.initialize();

    const fileName = `${sanitizeFileName(clipData.id)}.json`;
    const relativePath = await join(CACHE_DIR, fileName);

    const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    const jsonStr = JSON.stringify(clipData, null, 2);

    if (isTauri) {
      try {
        const bytes = new TextEncoder().encode(jsonStr);
        await writeFile(relativePath, bytes, { baseDir: BaseDirectory.AppCache });
      } catch (err) {
        console.error("[SmartOverlayCacheManager] Disk save error:", err);
      }
    }

    const cached: CachedSmartOverlay = {
      id: clipData.id,
      name,
      category: clipData.overlayType,
      localPath: relativePath,
      clipData,
      fileName,
      size: jsonStr.length,
      downloadedAt: Date.now(),
      isCustom: true,
    };

    this.cacheIndex.set(clipData.id, cached);
    await this.saveIndex();

    return cached;
  }

  public async clearCache(id: string): Promise<void> {
    const cached = this.cacheIndex.get(id);
    if (!cached) return;

    const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    if (isTauri && cached.localPath) {
      try {
        await remove(cached.localPath, { baseDir: BaseDirectory.AppCache });
      } catch (err) {
        console.warn("[SmartOverlayCacheManager] Failed to delete cache file:", err);
      }
    }

    this.cacheIndex.delete(id);
    await this.saveIndex();
  }
}

export const smartOverlayCacheManager = new SmartOverlayCacheManager();
