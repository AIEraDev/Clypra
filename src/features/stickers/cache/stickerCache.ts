/**
 * Sticker Cache Manager
 * Handles downloading and caching sticker files (static images, GIFs, and Lottie JSONs) from the API
 */

import { BaseDirectory, exists, mkdir, writeFile, readFile, remove } from "@tauri-apps/plugin-fs";
import { join, appCacheDir } from "@tauri-apps/api/path";
import type { StickerItem } from "@/features/stickers/api/stickersApi";

export interface CachedSticker {
  id: string;
  localImagePath: string; // Local path for static thumbnail
  localAnimationPath: string; // Local path for Lottie JSON
  lottieData?: any; // Parsed Lottie JSON data (loaded lazily)
  downloadedAt: number;
}

const CACHE_DIR = "stickers";
const CACHE_INDEX_FILE = "index.json";

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_. ]/g, "_")
    .replace(/\s+/g, "_")
    .substring(0, 100);
}

function getFileExtension(url: string, defaultExt = "png"): string {
  const match = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  return match ? match[1] : defaultExt;
}

class StickerCacheManager {
  private cacheIndex: Map<string, CachedSticker> = new Map();
  private cacheDir: string | null = null;
  private initialized = false;

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
      console.error("[StickerCache] Failed to initialize:", error);
      throw new Error("Failed to initialize sticker cache");
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
        const indexArray: CachedSticker[] = JSON.parse(indexJson);

        this.cacheIndex.clear();
        indexArray.forEach((item) => {
          this.cacheIndex.set(item.id, item);
        });
      }
    } catch (error) {
      console.warn("[StickerCache] Failed to load index, starting fresh:", error);
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
      console.error("[StickerCache] Failed to save index:", error);
    }
  }

  isCached(itemId: string): boolean {
    return this.cacheIndex.has(itemId);
  }

  getCached(itemId: string): CachedSticker | null {
    return this.cacheIndex.get(itemId) || null;
  }

  async readLottieJson(localPath: string): Promise<object> {
    await this.initialize();
    try {
      let relativePath = localPath;
      const normalizedPath = localPath.replace(/\\/g, "/");
      const cacheDirPattern = `${CACHE_DIR}/`;
      const idx = normalizedPath.indexOf(cacheDirPattern);
      if (idx !== -1) {
        relativePath = localPath.substring(idx);
      }

      const fileExists = await exists(relativePath, { baseDir: BaseDirectory.AppCache });
      if (!fileExists) {
        throw new Error(`Cached file not found: ${relativePath} (original: ${localPath})`);
      }
      const fileData = await readFile(relativePath, { baseDir: BaseDirectory.AppCache });
      const jsonText = new TextDecoder().decode(fileData);
      return JSON.parse(jsonText);
    } catch (error) {
      console.error("[StickerCache] Failed to read Lottie JSON:", error);
      throw error;
    }
  }

  private async downloadFile(url: string, relativePath: string): Promise<number> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);
    await writeFile(relativePath, data, { baseDir: BaseDirectory.AppCache });
    return data.length;
  }

  async downloadSticker(item: StickerItem, onProgress?: (percentage: number) => void): Promise<CachedSticker> {
    await this.initialize();

    if (!this.cacheDir) {
      throw new Error("Cache directory not initialized");
    }

    if (this.isCached(item.id)) {
      const cached = this.cacheIndex.get(item.id)!;
      return cached;
    }

    try {
      const sanitizedName = sanitizeFileName(item.name);

      // 1. Download static thumbnail
      onProgress?.(10);
      const imgExt = getFileExtension(item.thumbnailUrl, "png");
      const imgFileName = `${item.id}_${sanitizedName}.${imgExt}`;
      const relativeImgPath = `${CACHE_DIR}/${imgFileName}`;
      await this.downloadFile(item.thumbnailUrl, relativeImgPath);
      onProgress?.(50);

      // 2. Download Lottie JSON
      const lottieFileName = `${item.id}_${sanitizedName}.json`;
      const relativeLottiePath = `${CACHE_DIR}/${lottieFileName}`;
      await this.downloadFile(item.lottieUrl, relativeLottiePath);
      onProgress?.(100);

      const cachedEntry: CachedSticker = {
        id: item.id,
        localImagePath: relativeImgPath,
        localAnimationPath: relativeLottiePath,
        downloadedAt: Date.now(),
      };

      this.cacheIndex.set(item.id, cachedEntry);
      await this.saveIndex();

      return cachedEntry;
    } catch (error) {
      console.error("[StickerCache] Download failed:", error);
      throw new Error(`Failed to download sticker: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  async ensureDownloaded(item: StickerItem, onProgress?: (percentage: number) => void): Promise<CachedSticker> {
    await this.initialize();

    if (this.isCached(item.id)) {
      return this.cacheIndex.get(item.id)!;
    }

    return this.downloadSticker(item, onProgress);
  }

  async clearCache(itemId: string): Promise<void> {
    await this.initialize();

    const cached = this.cacheIndex.get(itemId);
    if (!cached) return;

    try {
      if (cached.localImagePath) {
        const fileExists = await exists(cached.localImagePath, { baseDir: BaseDirectory.AppCache });
        if (fileExists) {
          await remove(cached.localImagePath, { baseDir: BaseDirectory.AppCache });
        }
      }

      if (cached.localAnimationPath) {
        const fileExists = await exists(cached.localAnimationPath, { baseDir: BaseDirectory.AppCache });
        if (fileExists) {
          await remove(cached.localAnimationPath, { baseDir: BaseDirectory.AppCache });
        }
      }

      this.cacheIndex.delete(itemId);
      await this.saveIndex();
    } catch (error) {
      console.error("[StickerCache] Failed to clear cache:", error);
      throw error;
    }
  }
}

export const stickerCacheManager = new StickerCacheManager();
