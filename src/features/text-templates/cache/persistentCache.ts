import type { TemplateDefinition } from "../types";
import type { TextTemplateArtifact } from "@clypra-studio/engine";

const DB_NAME = "clypra_text_templates";
const DB_VERSION = 1;
const STORE_NAME = "entries-v1";
const CACHE_VERSION = "v1";
const MAX_ENTRIES = 100;
const MAX_MEMORY_ENTRIES = 40;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

type TemplateCacheData = TemplateDefinition | TextTemplateArtifact | TemplateDefinition[];

interface CachedTemplateEntry {
  cacheKey: string;
  data: TemplateCacheData;
  revisionId?: string;
  contentHash?: string;
  cacheVersion: string;
  timestamp: number;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

export class TextTemplatePersistentCache {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;
  private memory = new Map<string, TemplateCacheData>();
  private memoryTimestamps = new Map<string, number>();

  private async init(): Promise<void> {
    if (this.db || !hasIndexedDb()) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error ?? new Error("Failed to open template cache"));
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "cacheKey" });
          store.createIndex("timestamp", "timestamp", { unique: false });
        }
      };
    });
    return this.initPromise;
  }

  private async readPersistent(cacheKey: string): Promise<CachedTemplateEntry | null> {
    await this.init();
    if (!this.db) return null;
    return new Promise((resolve, reject) => {
      const request = this.db!.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(cacheKey);
      request.onsuccess = () => resolve((request.result as CachedTemplateEntry | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Failed to read template cache"));
    });
  }

  private async writePersistent(entry: CachedTemplateEntry): Promise<void> {
    await this.init();
    if (!this.db) return;
    await new Promise<void>((resolve, reject) => {
      const request = this.db!.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(entry);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Failed to write template cache"));
    });
  }

  private async deletePersistent(cacheKey: string): Promise<void> {
    await this.init();
    if (!this.db) return;
    await new Promise<void>((resolve, reject) => {
      const request = this.db!.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(cacheKey);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Failed to delete template cache"));
    });
  }

  private key(category: string, id: string, revisionId?: string): string {
    return `${category}:${id}:${revisionId || "latest"}`;
  }

  async get(
    category: string,
    id: string,
    revisionId?: string,
    options?: { maxAgeMs?: number },
  ): Promise<TemplateCacheData | null> {
    const cacheKey = this.key(category, id, revisionId);
    const maxAge = options?.maxAgeMs ?? (category === "__catalog__" ? 30 * 60 * 1000 : undefined);
    const now = Date.now();

    const inMemory = this.memory.get(cacheKey);
    const memTimestamp = this.memoryTimestamps.get(cacheKey);
    if (inMemory && (!maxAge || (memTimestamp && now - memTimestamp <= maxAge))) {
      return inMemory;
    }

    try {
      const entry = await this.readPersistent(cacheKey);
      if (!entry || entry.cacheVersion !== CACHE_VERSION) return null;
      if (maxAge && now - entry.timestamp > maxAge) {
        this.memory.delete(cacheKey);
        this.memoryTimestamps.delete(cacheKey);
        return null;
      }
      this.memory.set(cacheKey, entry.data);
      this.memoryTimestamps.set(cacheKey, entry.timestamp);
      return entry.data;
    } catch (error) {
      console.warn("[TextTemplateCache] IndexedDB read failed:", error);
      return null;
    }
  }

  async set(
    category: string,
    id: string,
    data: TemplateCacheData,
    revisionId?: string,
    contentHash?: string,
  ): Promise<void> {
    const cacheKey = this.key(category, id, revisionId);
    const now = Date.now();
    this.memory.set(cacheKey, data);
    this.memoryTimestamps.set(cacheKey, now);
    while (this.memory.size > MAX_MEMORY_ENTRIES) {
      const oldestKey = this.memory.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.memory.delete(oldestKey);
      this.memoryTimestamps.delete(oldestKey);
    }
    try {
      await this.writePersistent({
        cacheKey,
        data,
        revisionId,
        contentHash,
        cacheVersion: CACHE_VERSION,
        timestamp: now,
      });
      await this.prunePersistent();
    } catch (error) {
      console.warn("[TextTemplateCache] IndexedDB write failed:", error);
    }
  }

  private async prunePersistent(): Promise<void> {
    await this.init();
    if (!this.db) return;
    const entries = await new Promise<CachedTemplateEntry[]>((resolve, reject) => {
      const request = this.db!.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result as CachedTemplateEntry[]) || []);
      request.onerror = () => reject(request.error ?? new Error("Failed to inspect template cache"));
    });
    let totalBytes = entries.reduce((total, entry) => {
      try { return total + JSON.stringify(entry.data).length; } catch { return total; }
    }, 0);
    if (entries.length <= MAX_ENTRIES && totalBytes <= MAX_TOTAL_BYTES) return;
    entries.sort((a, b) => a.timestamp - b.timestamp);
    const remove: string[] = [];
    while ((entries.length - remove.length) > MAX_ENTRIES || totalBytes > MAX_TOTAL_BYTES) {
      const entry = entries[remove.length];
      if (!entry) break;
      remove.push(entry.cacheKey);
      try { totalBytes -= JSON.stringify(entry.data).length; } catch { /* keep pruning by count */ }
      this.memory.delete(entry.cacheKey);
    }
    if (!remove.length) return;
    await new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      remove.forEach((key) => store.delete(key));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Failed to prune template cache"));
    });
  }

  async delete(category: string, id: string, revisionId?: string): Promise<void> {
    const cacheKey = this.key(category, id, revisionId);
    this.memory.delete(cacheKey);
    try {
      await this.deletePersistent(cacheKey);
    } catch (error) {
      console.warn("[TextTemplateCache] IndexedDB delete failed:", error);
    }
  }

  async clear(): Promise<void> {
    this.memory.clear();
    await this.init();
    if (!this.db) return;
    await new Promise<void>((resolve, reject) => {
      const request = this.db!.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Failed to clear template cache"));
    });
  }

  async getStats(): Promise<{ memoryCount: number; indexedDBCount: number; sizeMB: number }> {
    await this.init();
    if (!this.db) return { memoryCount: this.memory.size, indexedDBCount: 0, sizeMB: 0 };
    return new Promise((resolve, reject) => {
      const request = this.db!.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onsuccess = () => {
        const entries = (request.result as CachedTemplateEntry[]) || [];
        const sizeBytes = entries.reduce((total, entry) => {
          try { return total + JSON.stringify(entry.data).length; } catch { return total; }
        }, 0);
        resolve({ memoryCount: this.memory.size, indexedDBCount: entries.length, sizeMB: sizeBytes / (1024 * 1024) });
      };
      request.onerror = () => reject(request.error ?? new Error("Failed to read template cache stats"));
    });
  }
}

export const textTemplatePersistentCache = new TextTemplatePersistentCache();
