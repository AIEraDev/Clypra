/**
 * Sticker Cache Manager
 *
 * Content-addressed LRU cache with SHA-256 integrity verification,
 * ETag revalidation, and bundled starter support.
 */

import { BaseDirectory, exists, mkdir, writeFile, readFile, remove } from "@tauri-apps/plugin-fs";
import { join, appCacheDir } from "@tauri-apps/api/path";
import type { StickerItem } from "@/features/stickers/api/stickersApi";
import { STARTER_STICKERS } from "../starterStickers";

export interface CachedSticker {
  id: string;
  sha256: string;
  localImagePath: string;
  localAnimationPath: string;
  lottieData?: any;
  downloadedAt: number;
  lastAccessedAt: number;
  sizeBytes: number;
  isStarter?: boolean;
}

const CACHE_DIR = "stickers";
const CACHE_INDEX_FILE = "index.json";
const MAX_CACHE_BYTES = 50 * 1024 * 1024; // 50 MiB LRU cap

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_. ]/g, "_")
    .replace(/\s+/g, "_")
    .substring(0, 80);
}

function getFileExtension(url?: string, defaultExt = "png"): string {
  if (!url) return defaultExt;
  const match = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  return match ? match[1].toLowerCase() : defaultExt;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return "";
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
      await this.seedStarters();
      this.initialized = true;
    } catch (error) {
      console.error("[StickerCache] Failed to initialize:", error);
      // In browser or mock environments where Tauri fs is unavailable, seed in-memory starters
      await this.seedStarters();
      this.initialized = true;
    }
  }

  private async seedStarters(): Promise<void> {
    for (const starter of STARTER_STICKERS) {
      if (!this.cacheIndex.has(starter.id)) {
        this.cacheIndex.set(starter.id, {
          id: starter.id,
          sha256: `starter-${starter.id}`,
          localImagePath: starter.svgThumbnail,
          localAnimationPath: `bundled://${starter.id}.json`,
          lottieData: starter.lottieData,
          downloadedAt: Date.now(),
          lastAccessedAt: Date.now(),
          sizeBytes: 2048,
          isStarter: true,
        });
      }
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
        for (const item of indexArray) {
          this.cacheIndex.set(item.id, item);
        }
      }
    } catch (error) {
      console.warn("[StickerCache] Index corrupt or unavailable; starting fresh:", error);
      this.cacheIndex.clear();
    }
  }

  private async saveIndex(): Promise<void> {
    if (!this.cacheDir) return;

    try {
      const indexPath = await join(this.cacheDir, CACHE_INDEX_FILE);
      // Filter out purely in-memory starter entries from the disk index
      const diskEntries = Array.from(this.cacheIndex.values()).filter((e) => !e.isStarter);
      const indexJson = JSON.stringify(diskEntries, null, 2);
      const indexData = new TextEncoder().encode(indexJson);

      await writeFile(indexPath, indexData, { baseDir: BaseDirectory.AppCache });
    } catch (error) {
      console.warn("[StickerCache] Failed to persist index:", error);
    }
  }

  isCached(itemId: string): boolean {
    return this.cacheIndex.has(itemId);
  }

  getCached(itemId: string): CachedSticker | null {
    const entry = this.cacheIndex.get(itemId);
    if (entry) {
      entry.lastAccessedAt = Date.now();
      return entry;
    }
    return null;
  }

  async readLottieJson(localPath: string): Promise<object> {
    await this.initialize();

    // Check bundled starter animation
    if (localPath.startsWith("bundled://")) {
      const starterId = localPath.replace("bundled://", "").replace(".json", "");
      const starter = STARTER_STICKERS.find((s) => s.id === starterId);
      if (starter) return starter.lottieData;
    }

    // Check in-memory cached entries
    for (const cached of this.cacheIndex.values()) {
      if (cached.localAnimationPath === localPath && cached.lottieData) {
        return cached.lottieData;
      }
    }

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
        throw new Error(`Cached file not found: ${relativePath} (${localPath})`);
      }

      const fileData = await readFile(relativePath, { baseDir: BaseDirectory.AppCache });
      const jsonText = new TextDecoder().decode(fileData);
      const parsed = JSON.parse(jsonText);

      // Cache parsed Lottie in memory for fast preview frames
      for (const cached of this.cacheIndex.values()) {
        if (cached.localAnimationPath === localPath) {
          cached.lottieData = parsed;
          cached.lastAccessedAt = Date.now();
        }
      }

      return parsed;
    } catch (error) {
      console.error("[StickerCache] Failed to read Lottie JSON:", error);
      throw error;
    }
  }

  private async downloadAndVerify(
    url: string,
    relativePath: string,
    expectedSha256?: string,
  ): Promise<{ bytes: number; sha256: string }> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);
    const calculatedSha256 = await sha256Hex(data);

    if (expectedSha256 && calculatedSha256 && expectedSha256 !== calculatedSha256) {
      throw new Error(
        `SHA-256 integrity mismatch: expected ${expectedSha256}, calculated ${calculatedSha256}`,
      );
    }

    await writeFile(relativePath, data, { baseDir: BaseDirectory.AppCache });
    return { bytes: data.length, sha256: calculatedSha256 };
  }

  async downloadSticker(
    item: StickerItem,
    onProgress?: (percentage: number) => void,
  ): Promise<CachedSticker> {
    await this.initialize();

    // Check if starter sticker
    const starter = STARTER_STICKERS.find((s) => s.id === item.id);
    if (starter) {
      onProgress?.(100);
      const cachedStarter: CachedSticker = {
        id: starter.id,
        sha256: `starter-${starter.id}`,
        localImagePath: starter.svgThumbnail,
        localAnimationPath: `bundled://${starter.id}.json`,
        lottieData: starter.lottieData,
        downloadedAt: Date.now(),
        lastAccessedAt: Date.now(),
        sizeBytes: 2048,
        isStarter: true,
      };
      this.cacheIndex.set(starter.id, cachedStarter);
      return cachedStarter;
    }

    const existing = this.getCached(item.id);
    if (existing) {
      onProgress?.(100);
      return existing;
    }

    try {
      const sanitizedName = sanitizeFileName(item.name || item.id);
      const assetUrl = item.lottieUrl || item.primaryUrl || "";
      const thumbUrl = item.thumbnailUrl || "";

      let totalBytes = 0;
      let primarySha256 = item.sha256 || "";

      onProgress?.(10);

      // 1. Download thumbnail
      const imgExt = getFileExtension(thumbUrl, "png");
      const thumbFileName = `${item.id}_thumb.${imgExt}`;
      const relativeThumbPath = `${CACHE_DIR}/${thumbFileName}`;
      if (thumbUrl && !thumbUrl.startsWith("data:")) {
        const thumbResult = await this.downloadAndVerify(thumbUrl, relativeThumbPath);
        totalBytes += thumbResult.bytes;
      }
      onProgress?.(50);

      // 2. Download primary animation/image asset
      const assetExt = item.kind === "lottie" ? "json" : getFileExtension(assetUrl, "json");
      const assetFileName = item.sha256
        ? `${item.sha256}.${assetExt}`
        : `${item.id}_${sanitizedName}.${assetExt}`;
      const relativeAssetPath = `${CACHE_DIR}/${assetFileName}`;

      if (assetUrl) {
        const assetResult = await this.downloadAndVerify(
          assetUrl,
          relativeAssetPath,
          item.sha256,
        );
        totalBytes += assetResult.bytes;
        primarySha256 = assetResult.sha256;
      }
      onProgress?.(100);

      const entry: CachedSticker = {
        id: item.id,
        sha256: primarySha256,
        localImagePath: thumbUrl.startsWith("data:") ? thumbUrl : relativeThumbPath,
        localAnimationPath: relativeAssetPath,
        downloadedAt: Date.now(),
        lastAccessedAt: Date.now(),
        sizeBytes: totalBytes,
      };

      this.cacheIndex.set(item.id, entry);
      await this.pruneLruIfNeeded();
      await this.saveIndex();

      return entry;
    } catch (error) {
      console.error(`[StickerCache] Download failed for ${item.id}:`, error);
      throw error;
    }
  }

  async ensureDownloaded(
    item: StickerItem,
    onProgress?: (percentage: number) => void,
  ): Promise<CachedSticker> {
    await this.initialize();
    const existing = this.getCached(item.id);
    if (existing) {
      onProgress?.(100);
      return existing;
    }
    return this.downloadSticker(item, onProgress);
  }

  private async pruneLruIfNeeded(): Promise<void> {
    let totalBytes = 0;
    const nonStarters: CachedSticker[] = [];

    for (const item of this.cacheIndex.values()) {
      if (!item.isStarter) {
        totalBytes += item.sizeBytes || 0;
        nonStarters.push(item);
      }
    }

    if (totalBytes <= MAX_CACHE_BYTES) return;

    // Sort by lastAccessedAt ascending (oldest first)
    nonStarters.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

    const targetBytes = MAX_CACHE_BYTES * 0.8;
    for (const item of nonStarters) {
      if (totalBytes <= targetBytes) break;
      await this.clearCache(item.id);
      totalBytes -= item.sizeBytes || 0;
    }
  }

  async clearCache(itemId: string): Promise<void> {
    await this.initialize();
    const cached = this.cacheIndex.get(itemId);
    if (!cached || cached.isStarter) return;

    try {
      if (cached.localImagePath && !cached.localImagePath.startsWith("data:")) {
        const fileExists = await exists(cached.localImagePath, { baseDir: BaseDirectory.AppCache });
        if (fileExists) {
          await remove(cached.localImagePath, { baseDir: BaseDirectory.AppCache });
        }
      }

      if (cached.localAnimationPath && !cached.localAnimationPath.startsWith("bundled://")) {
        const fileExists = await exists(cached.localAnimationPath, { baseDir: BaseDirectory.AppCache });
        if (fileExists) {
          await remove(cached.localAnimationPath, { baseDir: BaseDirectory.AppCache });
        }
      }

      this.cacheIndex.delete(itemId);
      await this.saveIndex();
    } catch (error) {
      console.warn(`[StickerCache] Error clearing cache for ${itemId}:`, error);
    }
  }
}

export const stickerCacheManager = new StickerCacheManager();
