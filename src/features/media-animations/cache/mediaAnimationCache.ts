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
import type { RemoteTextAnimationPreset } from "@/features/text-animations/animationCatalog";

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

/**
 * MediaAnimationPreset extends RemoteTextAnimationPreset with the extra
 * fields that the media animation catalog stores but the base text-animation
 * interface does not define.  Using this throughout the media animation stack
 * eliminates `(preset as any)` casts at every call site.
 */
export interface MediaAnimationPreset extends RemoteTextAnimationPreset {
  thumbnailUrl?: string;
  previewUrl?: string;
  revisionId?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_DIR = "media-animations/manifests";
const INDEX_FILE = "media-animations/index.json";

// ─── SHA-256 helper ───────────────────────────────────────────────────────────

async function sha256Hex(data: Uint8Array): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return "";
}

// ─── Cache Manager ────────────────────────────────────────────────────────────

class MediaAnimationCacheManager {
  private cacheIndex: Map<string, CachedManifestEntry> = new Map();
  private initialized = false;

  /** Listeners notified after initialize() completes so subscribers can
   *  re-read isCached() results (e.g., after restart hydration). */
  private hydrateListeners: Array<() => void> = [];

  /** In-memory manifest map — eagerly populated during initialize() from the
   *  OS index so getManifest() is not required for every preset access. */
  readonly manifests: Map<string, AnimationManifest> = new Map();

  /**
   * Creates the cache directory and loads the index from disk.
   * Idempotent; gracefully handles environments where Tauri FS is unavailable.
   * After loading the index, eagerly reads all manifests into memory so that
   * callers don't get empty tracks on app restart.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
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
      await this.hydrateManifests();
      this.initialized = true;
    } catch (error) {
      // Browser / web-preview environment — no Tauri FS available
      console.warn(
        "[MediaAnimationCache] Tauri FS unavailable; running in-memory only:",
        error,
      );
      this.initialized = true;
    }

    this.hydrateListeners.forEach((l) => l());
    this.hydrateListeners = [];
  }

  /**
   * Subscribe to a one-shot notification that fires after the first
   * initialize() completes.  Used by callers that need to refresh UI after
   * manifests are loaded from disk.
   */
  onHydrated(listener: () => void): () => void {
    if (this.initialized) {
      listener();
      return () => {};
    }
    this.hydrateListeners.push(listener);
    return () => {
      this.hydrateListeners = this.hydrateListeners.filter(
        (l) => l !== listener,
      );
    };
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

  /**
   * Eagerly load all manifests referenced by the index into the in-memory
   * `manifests` map.  This ensures that after an app restart, callers can
   * merge tracks immediately without an additional async read.
   */
  private async hydrateManifests(): Promise<void> {
    const entries = Array.from(this.cacheIndex.values());
    await Promise.all(
      entries.map(async (entry) => {
        const cacheKey = `${entry.slug}@${entry.version}`;
        if (this.manifests.has(cacheKey)) return;
        try {
          const manifest = await this.readAndVerifyManifest(entry);
          if (manifest) {
            this.manifests.set(cacheKey, manifest);
          } else {
            // File missing or hash mismatch — remove stale index entry
            this.cacheIndex.delete(cacheKey);
          }
        } catch {
          this.cacheIndex.delete(cacheKey);
        }
      }),
    );
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

  /**
   * Read a manifest file and verify its SHA-256 hash against the index entry.
   * Returns null when the file is missing or the hash does not match.
   */
  private async readAndVerifyManifest(
    entry: CachedManifestEntry,
  ): Promise<AnimationManifest | null> {
    try {
      const fileExists = await exists(entry.localPath, {
        baseDir: BaseDirectory.AppCache,
      });
      if (!fileExists) return null;

      const raw = await readFile(entry.localPath, {
        baseDir: BaseDirectory.AppCache,
      });
      const json = new TextDecoder().decode(raw);
      const manifest = JSON.parse(json) as AnimationManifest;

      // SHA-256 integrity check — mirrors stickerCache pattern
      if (entry.contentHash && entry.contentHash !== "") {
        const computedHash = await sha256Hex(raw);
        if (computedHash && computedHash !== entry.contentHash) {
          console.warn(
            `[MediaAnimationCache] Hash mismatch for "${entry.slug}@${entry.version}"; ` +
              `expected ${entry.contentHash}, got ${computedHash}. Evicting.`,
          );
          // Evict the corrupt file
          try {
            await remove(entry.localPath, { baseDir: BaseDirectory.AppCache });
          } catch {}
          return null;
        }
      }

      return manifest;
    } catch (error) {
      console.warn(
        `[MediaAnimationCache] Could not read cached manifest for "${entry.slug}@${entry.version}":`,
        error,
      );
      return null;
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
      const entry = this.cacheIndex.get(cacheKey)!;
      const cached = await this.readAndVerifyManifest(entry);
      if (cached) {
        this.manifests.set(cacheKey, cached);
        return cached;
      }
      // Index entry exists but file is missing or corrupt — fall through to re-download
      this.cacheIndex.delete(cacheKey);
    }

    try {
      const manifest = await fetchFn();

      const localPath = `media-animations/manifests/${slug}@${version}.json`;
      const json = JSON.stringify(manifest);
      const data = new TextEncoder().encode(json);

      let contentHash = manifest.contentHash ?? "";

      try {
        await writeFile(localPath, data, { baseDir: BaseDirectory.AppCache });
        // Compute hash of what was actually written so verification on next
        // read uses the same byte sequence.
        const computed = await sha256Hex(data);
        if (computed) contentHash = computed;
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
        contentHash,
        localPath,
        downloadedAt: Date.now(),
        sizeBytes: data.byteLength,
      };

      this.cacheIndex.set(cacheKey, entry);
      this.manifests.set(cacheKey, manifest);
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
   * or null if not cached or verification fails.
   */
  async getManifest(
    slug: string,
    version: string,
  ): Promise<AnimationManifest | null> {
    // Check in-memory hot tier first
    const cacheKey = `${slug}@${version}`;
    const inMemory = this.manifests.get(cacheKey);
    if (inMemory) return inMemory;

    const entry = this.cacheIndex.get(cacheKey);
    if (!entry) return null;

    const manifest = await this.readAndVerifyManifest(entry);
    if (manifest) {
      this.manifests.set(cacheKey, manifest);
    } else {
      // Evict stale index entry
      this.cacheIndex.delete(cacheKey);
      await this.saveIndex();
    }
    return manifest;
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
    this.manifests.clear();
    await this.saveIndex();
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const mediaAnimationCacheManager = new MediaAnimationCacheManager();
