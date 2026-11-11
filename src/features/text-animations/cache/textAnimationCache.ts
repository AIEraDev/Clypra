/**
 * Text Animation Cache Manager
 *
 * OS-level manifest and preset cache that stores animation definitions in
 * BaseDirectory.AppCache under "text-animations/manifests/".
 * Mirrors the mediaAnimationCache.ts pattern with SHA-256 integrity verification.
 */

import {
  BaseDirectory,
  exists,
  mkdir,
  writeFile,
  readFile,
  remove,
} from "@tauri-apps/plugin-fs";
import type { RemoteTextAnimationPreset } from "../animationCatalog";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CachedTextManifestEntry {
  id: string;
  version: string;
  contentHash: string;
  localPath: string;
  downloadedAt: number;
  sizeBytes: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_DIR = "text-animations/manifests";
const INDEX_FILE = "text-animations/index.json";

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

class TextAnimationCacheManager {
  private cacheIndex: Map<string, CachedTextManifestEntry> = new Map();
  private initialized = false;

  /** Listeners notified after initialize() completes so subscribers can
   *  re-read isCached() results (e.g., after restart hydration). */
  private hydrateListeners: Array<() => void> = [];

  /** In-memory preset map — eagerly populated during initialize() from the
   *  OS index so getManifest() is not required for every preset access. */
  readonly manifests: Map<string, RemoteTextAnimationPreset> = new Map();

  /**
   * Creates the cache directory and loads the index from disk.
   * Idempotent; gracefully handles environments where Tauri FS is unavailable.
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
        "[TextAnimationCache] Tauri FS unavailable; running in-memory only:",
        error,
      );
      this.initialized = true;
    }

    this.hydrateListeners.forEach((l) => l());
    this.hydrateListeners = [];
  }

  /**
   * Subscribe to a one-shot notification that fires after the first
   * initialize() completes.
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
      const entries: CachedTextManifestEntry[] = JSON.parse(json);

      this.cacheIndex.clear();
      for (const entry of entries) {
        this.cacheIndex.set(`${entry.id}@${entry.version}`, entry);
      }
    } catch (error) {
      console.warn(
        "[TextAnimationCache] Index corrupt or unavailable; starting fresh:",
        error,
      );
      this.cacheIndex.clear();
    }
  }

  private async hydrateManifests(): Promise<number> {
    const entries = Array.from(this.cacheIndex.values());
    let errorCount = 0;
    await Promise.all(
      entries.map(async (entry) => {
        const cacheKey = `${entry.id}@${entry.version}`;
        if (this.manifests.has(cacheKey)) return;
        try {
          const manifest = await this.readAndVerifyManifest(entry);
          if (manifest) {
            this.manifests.set(cacheKey, manifest);
          } else {
            this.cacheIndex.delete(cacheKey);
            errorCount++;
          }
        } catch {
          this.cacheIndex.delete(cacheKey);
          errorCount++;
        }
      }),
    );
    return errorCount;
  }

  private async saveIndex(): Promise<void> {
    try {
      const entries = Array.from(this.cacheIndex.values());
      const json = JSON.stringify(entries, null, 2);
      const data = new TextEncoder().encode(json);
      await writeFile(INDEX_FILE, data, { baseDir: BaseDirectory.AppCache });
    } catch (error) {
      console.warn("[TextAnimationCache] Failed to persist index:", error);
    }
  }

  private async readAndVerifyManifest(
    entry: CachedTextManifestEntry,
  ): Promise<RemoteTextAnimationPreset | null> {
    try {
      const fileExists = await exists(entry.localPath, {
        baseDir: BaseDirectory.AppCache,
      });
      if (!fileExists) return null;

      const raw = await readFile(entry.localPath, {
        baseDir: BaseDirectory.AppCache,
      });
      const json = new TextDecoder().decode(raw);
      const manifest = JSON.parse(json) as RemoteTextAnimationPreset;

      if (entry.contentHash && entry.contentHash !== "") {
        const computedHash = await sha256Hex(raw);
        if (computedHash && computedHash !== entry.contentHash) {
          console.warn(
            `[TextAnimationCache] Hash mismatch for "${entry.id}@${entry.version}"; ` +
              `expected ${entry.contentHash}, got ${computedHash}. Evicting.`,
          );
          try {
            await remove(entry.localPath, { baseDir: BaseDirectory.AppCache });
          } catch {}
          return null;
        }
      }

      return manifest;
    } catch (error) {
      console.warn(
        `[TextAnimationCache] Could not read cached manifest for "${entry.id}@${entry.version}":`,
        error,
      );
      return null;
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Returns true if an entry exists for id+version in the in-memory index.
   */
  isCached(id: string, version: string): boolean {
    return this.cacheIndex.has(`${id}@${version}`);
  }

  /**
   * If already cached, loads from disk and returns.
   * Otherwise calls fetchFn(), writes JSON to disk, updates index, and returns.
   */
  async ensureDownloaded(
    id: string,
    version: string,
    fetchFn: () => Promise<RemoteTextAnimationPreset>,
  ): Promise<RemoteTextAnimationPreset> {
    await this.initialize();

    const cacheKey = `${id}@${version}`;

    if (this.cacheIndex.has(cacheKey)) {
      const entry = this.cacheIndex.get(cacheKey)!;
      const cached = await this.readAndVerifyManifest(entry);
      if (cached) {
        this.manifests.set(cacheKey, cached);
        return cached;
      }
      this.cacheIndex.delete(cacheKey);
    }

    try {
      const manifest = await fetchFn();
      const localPath = `${CACHE_DIR}/${id}@${version}.json`;
      const json = JSON.stringify(manifest);
      const data = new TextEncoder().encode(json);

      let contentHash = "";
      try {
        await writeFile(localPath, data, { baseDir: BaseDirectory.AppCache });
        const computed = await sha256Hex(data);
        if (computed) contentHash = computed;
      } catch (fsError) {
        console.warn(
          "[TextAnimationCache] Could not write manifest to disk:",
          fsError,
        );
      }

      const entry: CachedTextManifestEntry = {
        id,
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
        `[TextAnimationCache] Failed to download manifest for "${id}@${version}":`,
        error,
      );
      throw error;
    }
  }

  async getManifest(
    id: string,
    version: string,
  ): Promise<RemoteTextAnimationPreset | null> {
    const cacheKey = `${id}@${version}`;
    const inMemory = this.manifests.get(cacheKey);
    if (inMemory) return inMemory;

    const entry = this.cacheIndex.get(cacheKey);
    if (!entry) return null;

    const manifest = await this.readAndVerifyManifest(entry);
    if (manifest) {
      this.manifests.set(cacheKey, manifest);
    } else {
      this.cacheIndex.delete(cacheKey);
      await this.saveIndex();
    }
    return manifest;
  }

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
          `[TextAnimationCache] Failed to delete file "${entry.localPath}":`,
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

export const textAnimationCacheManager = new TextAnimationCacheManager();
