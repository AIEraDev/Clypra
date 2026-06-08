/**
 * Persistent Text Effect Cache
 *
 * Professional implementation using IndexedDB for persistent storage
 * with memory cache fallback for performance.
 *
 * Benefits:
 * - Effects survive app restarts
 * - No network fetch during export
 * - Fast memory-first lookup
 * - Automatic cache invalidation
 */

import type { EffectFullDefinition } from "../types/types";

const DB_NAME = "clypra_text_effects";
const DB_VERSION = 1;
const STORE_NAME = "definitions";
const CACHE_VERSION = "v1"; // Increment to invalidate all cached effects

interface CachedEffect {
  id: string;
  definition: EffectFullDefinition;
  cacheVersion: string;
  timestamp: number;
}

class TextEffectPersistentCache {
  private memoryCache: Map<string, EffectFullDefinition> = new Map();
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize IndexedDB connection
   */
  private async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(new Error("Failed to open IndexedDB"));

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("timestamp", "timestamp", { unique: false });
          store.createIndex("cacheVersion", "cacheVersion", { unique: false });
        }
      };
    });

    return this.initPromise;
  }

  /**
   * Get effect definition (memory → IndexedDB → null)
   */
  async get(id: string): Promise<EffectFullDefinition | null> {
    // 1. Check memory cache first (instant)
    if (this.memoryCache.has(id)) {
      return this.memoryCache.get(id)!;
    }

    // 2. Check IndexedDB (persistent)
    try {
      await this.init();
      if (!this.db) return null;

      const cached = await this.getFromIndexedDB(id);
      if (cached && cached.cacheVersion === CACHE_VERSION) {
        // Warm memory cache
        this.memoryCache.set(id, cached.definition);
        return cached.definition;
      }

      // Cache version mismatch or not found
      if (cached && cached.cacheVersion !== CACHE_VERSION) {
        // Remove outdated cache entry
        await this.delete(id);
      }

      return null;
    } catch (error) {
      console.warn("[TextEffectCache] IndexedDB read failed:", error);
      return null;
    }
  }

  /**
   * Set effect definition (memory + IndexedDB)
   */
  async set(id: string, definition: EffectFullDefinition): Promise<void> {
    // 1. Store in memory cache (synchronous)
    this.memoryCache.set(id, definition);

    // 2. Store in IndexedDB (asynchronous, fire-and-forget)
    try {
      await this.init();
      if (!this.db) return;

      await this.setInIndexedDB(id, definition);
    } catch (error) {
      console.warn("[TextEffectCache] IndexedDB write failed:", error);
      // Continue - memory cache is still populated
    }
  }

  /**
   * Delete effect from cache
   */
  async delete(id: string): Promise<void> {
    this.memoryCache.delete(id);

    try {
      await this.init();
      if (!this.db) return;

      const transaction = this.db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.delete(id);

      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (error) {
      console.warn("[TextEffectCache] IndexedDB delete failed:", error);
    }
  }

  /**
   * Clear all cached effects
   */
  async clear(): Promise<void> {
    this.memoryCache.clear();

    try {
      await this.init();
      if (!this.db) return;

      const transaction = this.db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.clear();

      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (error) {
      console.warn("[TextEffectCache] IndexedDB clear failed:", error);
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ memoryCount: number; diskCount: number; totalSizeMB: number }> {
    const memoryCount = this.memoryCache.size;

    try {
      await this.init();
      if (!this.db) return { memoryCount, diskCount: 0, totalSizeMB: 0 };

      const transaction = this.db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const countRequest = store.count();

      const diskCount = await new Promise<number>((resolve, reject) => {
        countRequest.onsuccess = () => resolve(countRequest.result);
        countRequest.onerror = () => reject(countRequest.error);
      });

      // Estimate size (rough approximation)
      const totalSizeMB = (diskCount * 10) / 1024; // ~10KB per effect definition

      return { memoryCount, diskCount, totalSizeMB };
    } catch (error) {
      console.warn("[TextEffectCache] Failed to get stats:", error);
      return { memoryCount, diskCount: 0, totalSizeMB: 0 };
    }
  }

  /**
   * Preload all cached effects into memory
   */
  async preloadToMemory(): Promise<number> {
    try {
      await this.init();
      if (!this.db) return 0;

      const transaction = this.db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      const allCached = await new Promise<CachedEffect[]>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      let loaded = 0;
      for (const cached of allCached) {
        if (cached.cacheVersion === CACHE_VERSION) {
          this.memoryCache.set(cached.id, cached.definition);
          loaded++;
        } else {
          // Remove outdated entries
          await this.delete(cached.id);
        }
      }

      return loaded;
    } catch (error) {
      console.warn("[TextEffectCache] Preload failed:", error);
      return 0;
    }
  }

  // ─── Private Helpers ────────────────────────────────────────────

  private async getFromIndexedDB(id: string): Promise<CachedEffect | null> {
    if (!this.db) return null;

    const transaction = this.db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  private async setInIndexedDB(id: string, definition: EffectFullDefinition): Promise<void> {
    if (!this.db) return;

    const cached: CachedEffect = {
      id,
      definition,
      cacheVersion: CACHE_VERSION,
      timestamp: Date.now(),
    };

    const transaction = this.db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.put(cached);

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

// Singleton instance
let cacheInstance: TextEffectPersistentCache | null = null;

export function getTextEffectCache(): TextEffectPersistentCache {
  if (!cacheInstance) {
    cacheInstance = new TextEffectPersistentCache();
  }
  return cacheInstance;
}

// Export for testing
export { TextEffectPersistentCache };
