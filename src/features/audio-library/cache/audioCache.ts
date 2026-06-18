/**
 * Audio Cache Manager
 * Handles downloading and caching audio files from the library API
 */

import { BaseDirectory, exists, mkdir, writeFile, readFile, remove, readDir } from "@tauri-apps/plugin-fs";
import { join, appCacheDir } from "@tauri-apps/api/path";
import type { AudioLibraryItem } from "@/features/audio-library/api/audioLibraryApi";

export interface CachedAudioFile {
  id: string;
  localPath: string;
  originalUrl: string;
  fileName: string;
  size: number;
  downloadedAt: number;
  metadata: {
    duration: number;
    format: string;
    bitrate?: number;
  };
}

export interface DownloadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

const CACHE_DIR = "audio-library";
const CACHE_INDEX_FILE = "index.json";

/**
 * Sanitize filename to be filesystem-safe
 */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_. ]/g, "_")
    .replace(/\s+/g, "_")
    .substring(0, 100);
}

/**
 * Get file extension from URL or default to mp3
 */
function getFileExtension(url: string): string {
  const match = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  return match ? match[1] : "mp3";
}

/**
 * AudioCacheManager - Singleton for managing audio file cache
 */
class AudioCacheManager {
  private cacheIndex: Map<string, CachedAudioFile> = new Map();
  private cacheDir: string | null = null;
  private initialized = false;

  /**
   * Initialize the cache directory and load index
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Get cache directory path
      const appCache = await appCacheDir();
      this.cacheDir = await join(appCache, CACHE_DIR);

      // Create cache directory if it doesn't exist
      const dirExists = await exists(this.cacheDir, { baseDir: BaseDirectory.AppCache });
      if (!dirExists) {
        await mkdir(this.cacheDir, { baseDir: BaseDirectory.AppCache, recursive: true });
      }

      // Load cache index
      await this.loadIndex();
      this.initialized = true;
    } catch (error) {
      console.error("[AudioCache] Failed to initialize:", error);
      throw new Error("Failed to initialize audio cache");
    }
  }

  /**
   * Load cache index from disk
   */
  private async loadIndex(): Promise<void> {
    if (!this.cacheDir) return;

    try {
      const indexPath = await join(this.cacheDir, CACHE_INDEX_FILE);
      const indexExists = await exists(indexPath, { baseDir: BaseDirectory.AppCache });

      if (indexExists) {
        const indexData = await readFile(indexPath, { baseDir: BaseDirectory.AppCache });
        const indexJson = new TextDecoder().decode(indexData);
        const indexArray: CachedAudioFile[] = JSON.parse(indexJson);

        this.cacheIndex.clear();
        indexArray.forEach((item) => {
          this.cacheIndex.set(item.id, item);
        });
      }
    } catch (error) {
      console.warn("[AudioCache] Failed to load index, starting fresh:", error);
      this.cacheIndex.clear();
    }
  }

  /**
   * Save cache index to disk
   */
  private async saveIndex(): Promise<void> {
    if (!this.cacheDir) return;

    try {
      const indexPath = await join(this.cacheDir, CACHE_INDEX_FILE);
      const indexArray = Array.from(this.cacheIndex.values());
      const indexJson = JSON.stringify(indexArray, null, 2);
      const indexData = new TextEncoder().encode(indexJson);

      await writeFile(indexPath, indexData, { baseDir: BaseDirectory.AppCache });
    } catch (error) {
      console.error("[AudioCache] Failed to save index:", error);
    }
  }

  /**
   * Check if audio is already cached
   */
  isCached(itemId: string): boolean {
    return this.cacheIndex.has(itemId);
  }

  /**
   * Get cached file info
   */
  getCached(itemId: string): CachedAudioFile | null {
    return this.cacheIndex.get(itemId) || null;
  }

  /**
   * Get cached file path
   */
  getCachedPath(itemId: string): string | null {
    const cached = this.cacheIndex.get(itemId);
    return cached ? cached.localPath : null;
  }

  /**
   * Download audio file to cache
   */
  async downloadAudio(item: AudioLibraryItem, onProgress?: (progress: DownloadProgress) => void): Promise<CachedAudioFile> {
    await this.initialize();

    if (!this.cacheDir) {
      throw new Error("Cache directory not initialized");
    }

    // Check if already cached
    if (this.isCached(item.id)) {
      const cached = this.cacheIndex.get(item.id)!;
      return cached;
    }

    try {
      // Generate filename
      const ext = getFileExtension(item.audioUrl);
      const sanitizedName = sanitizeFileName(item.name);
      const fileName = `${item.id}_${sanitizedName}.${ext}`;

      // Use relative path for storage (just CACHE_DIR/filename)
      const relativePath = `${CACHE_DIR}/${fileName}`;

      // Download file with progress tracking (no auth needed for public R2)
      const response = await fetch(item.audioUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentLength = response.headers.get("content-length");
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      let loaded = 0;

      // Read response as stream
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Failed to get response reader");
      }

      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        chunks.push(value);
        loaded += value.length;

        if (onProgress && total > 0) {
          onProgress({
            loaded,
            total,
            percentage: Math.round((loaded / total) * 100),
          });
        }
      }

      // Combine chunks
      const fileData = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        fileData.set(chunk, offset);
        offset += chunk.length;
      }

      // Write to disk using relative path from AppCache base
      await writeFile(relativePath, fileData, { baseDir: BaseDirectory.AppCache });

      // Create cache entry with relative path
      const cachedFile: CachedAudioFile = {
        id: item.id,
        localPath: relativePath, // Store relative path, not absolute
        originalUrl: item.audioUrl,
        fileName,
        size: loaded,
        downloadedAt: Date.now(),
        metadata: {
          duration: item.duration,
          format: ext,
          bitrate: undefined,
        },
      };

      // Update index
      this.cacheIndex.set(item.id, cachedFile);
      await this.saveIndex();

      return cachedFile;
    } catch (error) {
      console.error("[AudioCache] Download failed:", error);
      throw new Error(`Failed to download audio: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Ensure audio is downloaded (convenience method)
   */
  async ensureDownloaded(item: AudioLibraryItem, onProgress?: (progress: DownloadProgress) => void): Promise<CachedAudioFile> {
    await this.initialize();

    if (this.isCached(item.id)) {
      return this.cacheIndex.get(item.id)!;
    }

    return this.downloadAudio(item, onProgress);
  }

  /**
   * Clear specific cached file
   */
  async clearCache(itemId: string): Promise<void> {
    await this.initialize();

    const cached = this.cacheIndex.get(itemId);
    if (!cached) return;

    try {
      // Delete file
      const fileExists = await exists(cached.localPath, { baseDir: BaseDirectory.AppCache });
      if (fileExists) {
        await remove(cached.localPath, { baseDir: BaseDirectory.AppCache });
      }

      // Remove from index
      this.cacheIndex.delete(itemId);
      await this.saveIndex();
    } catch (error) {
      console.error("[AudioCache] Failed to clear cache:", error);
      throw error;
    }
  }

  /**
   * Clear all cached audio files
   */
  async clearAllCache(): Promise<void> {
    try {
      await this.initialize();
    } catch (initError) {
      console.error("[AudioCache] Initialization failed during clearAllCache:", initError);
      // If we can't initialize, just clear the in-memory index
      this.cacheIndex.clear();
      return;
    }

    if (!this.cacheDir) {
      console.warn("[AudioCache] No cache directory, clearing in-memory index only");
      this.cacheIndex.clear();
      return;
    }

    try {
      // Read all files in cache directory
      const entries = await readDir(this.cacheDir, { baseDir: BaseDirectory.AppCache });

      // Delete all files except index
      const deletePromises = entries
        .filter((entry) => entry.name !== CACHE_INDEX_FILE)
        .map(async (entry) => {
          try {
            const filePath = await join(this.cacheDir!, entry.name);
            await remove(filePath, { baseDir: BaseDirectory.AppCache });
          } catch (err) {
            console.warn(`[AudioCache] Failed to delete ${entry.name}:`, err);
            // Continue with other files
          }
        });

      await Promise.all(deletePromises);

      // Clear index
      this.cacheIndex.clear();
      await this.saveIndex();

      console.log("[AudioCache] All cache cleared successfully");
    } catch (error) {
      console.error("[AudioCache] Failed to clear all cache:", error);

      // Fallback: at least clear the in-memory index
      this.cacheIndex.clear();

      // Try to save empty index
      try {
        await this.saveIndex();
      } catch (saveError) {
        console.warn("[AudioCache] Failed to save empty index:", saveError);
      }

      throw new Error(`Failed to clear audio cache: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { count: number; totalSize: number; items: CachedAudioFile[] } {
    const items = Array.from(this.cacheIndex.values());
    const totalSize = items.reduce((sum, item) => sum + item.size, 0);

    return {
      count: items.length,
      totalSize,
      items,
    };
  }

  /**
   * Get all cached items
   */
  getAllCached(): CachedAudioFile[] {
    return Array.from(this.cacheIndex.values());
  }
}

// Singleton instance
export const audioCacheManager = new AudioCacheManager();
