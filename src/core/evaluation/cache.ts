/**
 * Evaluation Cache - LRU Cache for EvaluatedScene
 *
 * Caches evaluated scenes to avoid re-evaluation.
 * Invalidates on epoch changes.
 *
 * Cache Key: time + epoch + clipVersion
 * Cache Strategy: LRU (Least Recently Used)
 */

import type { EvaluatedScene } from "./types";

/**
 * Cache key for evaluated scenes.
 */
interface CacheKey {
  /** Timeline time (rounded to frame precision) */
  time: number;

  /** Timeline epoch (invalidates on timeline changes) */
  epoch: number;

  /** Clip version (hash of clip IDs and properties) */
  clipVersion: string;
}

/**
 * Cache entry with metadata.
 */
interface CacheEntry {
  key: CacheKey;
  scene: EvaluatedScene;
  /** Estimated memory footprint in MB */
  memoryMB: number;
  timestamp: number;
  hits: number;
}

/**
 * LRU Cache for evaluated scenes.
 */
export class EvaluationCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private maxMemoryMB: number;
  private currentMemoryMB = 0;
  private hits = 0;
  private misses = 0;

  constructor(maxSize: number = 100, maxMemoryMB: number = 64) {
    this.maxSize = maxSize;
    this.maxMemoryMB = maxMemoryMB;
  }

  /**
   * Get cached scene if available.
   */
  get(key: CacheKey): EvaluatedScene | null {
    const cacheKey = this.serializeKey(key);
    const entry = this.cache.get(cacheKey);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Update access time and hit count
    entry.timestamp = Date.now();
    entry.hits++;
    this.hits++;

    // Move to end (most recently used)
    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, entry);

    return entry.scene;
  }

  /**
   * Store scene in cache.
   */
  set(key: CacheKey, scene: EvaluatedScene): void {
    const cacheKey = this.serializeKey(key);
    const memoryMB = this.estimateSceneMemory(scene);

    // If updating an existing entry, subtract its old memory first
    const existing = this.cache.get(cacheKey);
    if (existing) {
      this.currentMemoryMB -= existing.memoryMB;
      this.cache.delete(cacheKey);
    }

    // Evict LRU entries until within memory budget
    while (this.currentMemoryMB + memoryMB > this.maxMemoryMB && this.cache.size > 0) {
      this.evictLRU();
    }

    // Evict LRU entries until within count budget
    while (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    // Add new entry
    this.cache.set(cacheKey, {
      key,
      scene,
      memoryMB,
      timestamp: Date.now(),
      hits: 0,
    });
    this.currentMemoryMB += memoryMB;
  }

  /**
   * Invalidate all entries for a specific epoch.
   */
  invalidateEpoch(epoch: number): void {
    const toDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (entry.key.epoch !== epoch) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      const entry = this.cache.get(key);
      if (entry) {
        this.currentMemoryMB -= entry.memoryMB;
      }
      this.cache.delete(key);
    }
  }

  /**
   * Clear entire cache.
   */
  clear(): void {
    this.cache.clear();
    this.currentMemoryMB = 0;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics.
   */
  getStats() {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? (this.hits / total) * 100 : 0;

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      memoryMB: Math.round(this.currentMemoryMB * 1e6) / 1e6,
      maxMemoryMB: this.maxMemoryMB,
      hits: this.hits,
      misses: this.misses,
      hitRate: hitRate.toFixed(2) + "%",
    };
  }

  /**
   * Estimate memory footprint of a scene in MB.
   * ~1 KB per visual layer, ~0.5 KB per audio layer, + base overhead.
   */
  private estimateSceneMemory(scene: EvaluatedScene): number {
    const visualBytes = scene.visualLayers.length * 1024;
    const audioBytes = scene.audioLayers.length * 512;
    const transitionBytes = scene.transitions.length * 256;
    const baseOverhead = 1024; // metadata + object overhead
    return (visualBytes + audioBytes + transitionBytes + baseOverhead) / (1024 * 1024);
  }

  /**
   * Evict the least recently used entry.
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.cache.get(oldestKey);
      if (entry) {
        this.currentMemoryMB -= entry.memoryMB;
      }
      this.cache.delete(oldestKey);
    }
  }

  private serializeKey(key: CacheKey): string {
    // Round time to 3 decimal places (millisecond precision)
    const roundedTime = Math.round(key.time * 1000) / 1000;
    return `${roundedTime}:${key.epoch}:${key.clipVersion}`;
  }
}

/**
 * Global evaluation cache instance.
 */
let globalCache: EvaluationCache | null = null;

/**
 * Get or create global evaluation cache.
 */
export function getEvaluationCache(): EvaluationCache {
  if (!globalCache) {
    globalCache = new EvaluationCache(100);
  }
  return globalCache;
}

/**
 * Reset global cache (for testing).
 */
export function resetEvaluationCache(): void {
  globalCache = null;
}

/**
 * Compute clip version hash.
 * This is a simple hash of clip IDs and key properties.
 * Changes when clips are added/removed/modified.
 */
export function computeClipVersion(clips: Array<Record<string, any>>, transitions: Array<Record<string, any>> = []): string {
  // Stable sort with deterministic tie-breaker, then hash
  const clipSignature = clips
    .slice()
    .sort((a, b) => {
      if (a.startTime !== b.startTime) return a.startTime - b.startTime;
      if (a.trackId !== b.trackId) return a.trackId.localeCompare(b.trackId);
      return a.id.localeCompare(b.id);
    })
    .map((c) =>
      [
        c.id,
        "text" in c ? "text" : c.mediaId ? "media" : "unknown",
        c.trackId,
        c.mediaId ?? "",
        Number(c.startTime ?? 0).toFixed(3),
        Number(c.duration ?? 0).toFixed(3),
        Number(c.trimIn ?? 0).toFixed(3),
        Number(c.trimOut ?? 0).toFixed(3),
        Number(c.x ?? 0).toFixed(3),
        Number(c.y ?? 0).toFixed(3),
        Number(c.width ?? 0).toFixed(3),
        Number(c.height ?? 0).toFixed(3),
        Number(c.opacity ?? 1).toFixed(3),
        Number(c.rotation ?? 0).toFixed(3),
        c.text ?? "",
        c.styleId ?? "",
        c.templateId ?? "",
        c.styleDefinition?.id ?? "",
        c.fontFamily ?? "",
        c.fontSize ?? "",
        c.fontWeight ?? "",
        c.fontStyle ?? "",
        c.color ?? "",
        c.letterSpacing ?? "",
        c.lineHeight ?? "",
        c.align ?? "",
        c.valign ?? "",
        JSON.stringify(c.stroke ?? null),
        JSON.stringify(c.shadow ?? null),
        JSON.stringify(c.background ?? null),
        JSON.stringify(c.customization ?? null),
        c.effectStackVersion ?? "",
      ].join(":"),
    )
    .join("|");

  const transitionSignature = transitions
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((t) => [t.id, t.type, t.fromItemId, t.toItemId, t.alignment, t.easing, t.placement?.trackId, Number(t.placement?.startTime ?? 0).toFixed(3), Number(t.placement?.duration ?? 0).toFixed(3), t.effects?.version ?? 0].join(":"))
    .join("|");

  const signature = `${clipSignature}::transitions::${transitionSignature}`;

  // Use a simple hash function
  return hashString(signature);
}

/**
 * Simple string hash function (FNV-1a).
 */
function hashString(str: string): string {
  let hash = 2166136261; // FNV offset basis

  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619); // FNV prime
  }

  // Convert to hex string
  return (hash >>> 0).toString(16).padStart(8, "0");
}
