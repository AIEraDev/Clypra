/**
 * Media Animation Cache Manager
 *
 * OS-level manifest cache that stores animation JSON files in
 * BaseDirectory.AppCache under "media-animations/manifests/".
 * Mirrors the stickerCache.ts pattern.
 */

import {
  BaseDirectory,
  exists,
  mkdir,
  writeFile,
  readFile,
  remove,
} from "@tauri-apps/plugin-fs";
import { join, appCacheDir } from "@tauri-apps/api/path";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CachedManifestEntry {
  slug: string;
  version: string;
  contentHash: string;
  localPath: string;
  downloadedAt: number;
  sizeBytes: number;
}

export interface AnimationManifest {
  slug: string;
  version: string;
  contentHash: string;
  tracks: Array<{
    property: string;
    keyframes: Array<{ progress: number; value: number; easing: string }>;
  }>;
  durationFrames: number;
  frameRateNum: number;
  frameRateDen: number;
  compositionRules: Record<string, string>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_DIR = "media-animations/manifests";
const INDEX_FILE = "media-animations/index.json";

// ─── Cache Manager ────────────────────────────────────────────────────────────

class MediaAnimationCacheManager {
  private cacheIndex: Map<string, CachedManifestEntry> = new Map();
  private cacheDir: string | null = null;
  private initialized = false;

  /**
   * Creates the cache directory and loads the index from disk.
   * Idempotent; gracefully handles environments where Tauri FS is unavailable.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const appCache = await appCacheDir();
      this.cacheDir = await join(appCache, CACHE_DIR);

      const dirExists = await exists(CACHE_DIR, {
        baseDir: BaseDirectory.AppCache,
      });
      if (!dirExists) {
        await mkdir(CACHE_DIR, {
          baseDir: BaseDirectory.AppCache,
          recursive: true,
        });
      }

      await this.loadIndex();
      this.initialized = true;
    } catch (error) {
      // Browser / web-preview environment — no Tauri FS available
      console.warn(
        "[MediaAnimationCache] Tauri FS unavailable; running in-memory only:",
        error,
      );
      this.initialized = true;
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async loadIndex(): Promise<void> {
    try {
      const indexExists = await exists(INDEX_FILE, {
        baseDir: BaseDirectory.AppCache,
      });
      if (!indexExists) return;

      const raw = await readFile(INDEX_FILE, {
        baseDir: BaseDirectory.AppCache,
      });
      const json = new TextDecoder().decode(raw);
      const entries: CachedManifestEntry[] = JSON.parse(json);

      this.cacheIndex.clear();
      for (const entry of entries) {
        this.cacheIndex.set(`${entry.slug}@${entry.version}`, entry);
      }
    } catch (error) {
      console.warn(
        "[MediaAnimationCache] Index corrupt or unavailable; starting fresh:",
        error,
      );
      this.cacheIndex.clear();
    }
  }

  private async saveIndex(): Promise<void> {
    try {
      const entries = Array.from(this.cacheIndex.values());
      const json = JSON.stringify(entries, null, 2);
      const data = new TextEncoder().encode(json);
      await writeFile(INDEX_FILE, data, { baseDir: BaseDirectory.AppCache });
    } catch (error) {
      console.warn("[MediaAnimationCache] Failed to persist index:", error);
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Returns true if an entry exists for slug+version in the in-memory index.
   */
  isCached(slug: string, version: string): boolean {
    return this.cacheIndex.has(`${slug}@${version}`);
  }

  /**
   * If already cached, loads from disk and returns.
   * Otherwise calls fetchFn(), writes JSON to disk, updates index, and returns.
   */
  async ensureDownloaded(
    slug: string,
    version: string,
    fetchFn: () => Promise<AnimationManifest>,
  ): Promise<AnimationManifest> {
    await this.initialize();

    const cacheKey = `${slug}@${version}`;

    if (this.cacheIndex.has(cacheKey)) {
      const cached = await this.getManifest(slug, version);
      if (cached) return cached;
      // Index entry exists but file is missing — fall through to re-download
    }

    try {
      const manifest = await fetchFn();

      const localPath = `media-animations/manifests/${slug}@${version}.json`;
      const json = JSON.stringify(manifest);
      const data = new TextEncoder().encode(json);

      try {
        await writeFile(localPath, data, { baseDir: BaseDirectory.AppCache });
      } catch (fsError) {
        // Tauri FS not available in browser — keep in-memory only
        console.warn(
          "[MediaAnimationCache] Could not write manifest to disk:",
          fsError,
        );
      }

      const entry: CachedManifestEntry = {
        slug,
        version,
        contentHash: manifest.contentHash ?? "",
        localPath,
        downloadedAt: Date.now(),
        sizeBytes: data.byteLength,
      };

      this.cacheIndex.set(cacheKey, entry);
      await this.saveIndex();

      return manifest;
    } catch (error) {
      console.error(
        `[MediaAnimationCache] Failed to download manifest for "${slug}@${version}":`,
        error,
      );
      throw error;
    }
  }

  /**
   * Reads the cached JSON file for the entry and returns the parsed manifest,
   * or null if not cached.
   */
  async getManifest(
    slug: string,
    version: string,
  ): Promise<AnimationManifest | null> {
    const entry = this.cacheIndex.get(`${slug}@${version}`);
    if (!entry) return null;

    try {
      const raw = await readFile(entry.localPath, {
        baseDir: BaseDirectory.AppCache,
      });
      const json = new TextDecoder().decode(raw);
      return JSON.parse(json) as AnimationManifest;
    } catch (error) {
      console.warn(
        `[MediaAnimationCache] Could not read cached manifest for "${slug}@${version}":`,
        error,
      );
      return null;
    }
  }

  /**
   * Removes all entries from the index and deletes all manifest files.
   * Resets the in-memory index and saves the empty index.
   */
  async clearCache(): Promise<void> {
    await this.initialize();

    for (const entry of this.cacheIndex.values()) {
      try {
        const fileExists = await exists(entry.localPath, {
          baseDir: BaseDirectory.AppCache,
        });
        if (fileExists) {
          await remove(entry.localPath, { baseDir: BaseDirectory.AppCache });
        }
      } catch (error) {
        console.warn(
          `[MediaAnimationCache] Failed to delete file "${entry.localPath}":`,
          error,
        );
      }
    }

    this.cacheIndex.clear();
    await this.saveIndex();
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const mediaAnimationCacheManager = new MediaAnimationCacheManager();
