/**
 * CacheCoordinator — Centralized Memory & Eviction Authority
 *
 * Coordinates all independent in-memory, GPU, worker, and client caches across Clypra:
 * • Audio PCM Waveforms (waveformCache)
 * • Evaluated Scenes (EvaluationCache)
 * • Media Resource Bitmaps (ResourceCache)
 * • Filmstrip Zoom Tiles (FilmstripTileCache)
 * • Web Audio Buffers (AudioBufferPool)
 * • WebGL Fallback Textures (gpuTextureCache / globalGPUCache)
 * • Video Frame LUTs & Filters (filterCache)
 * • Text Templates & Text Effects
 * • Stickers & Audio Library Previews
 *
 * Enforces a global memory budget, coordinates LRU trimming on memory pressure,
 * flushes session caches on project close, and tracks application-wide cache telemetry.
 */

export type CacheTier = "memory" | "gpu" | "indexeddb" | "worker";
export type CacheLifespan = "ephemeral" | "session" | "persistent";

export interface ICacheParticipant {
  /** Unique identifier for the cache domain (e.g. 'waveform-lod', 'evaluated-scene', 'resource-cache'). */
  name: string;
  /** Storage tier level: in-memory RAM, GPU VRAM, IndexedDB disk, or Web Worker */
  tier?: CacheTier;
  /** Lifespan scope: ephemeral (per-frame), session (per-project), or persistent (cross-project) */
  lifespan?: CacheLifespan;
  /** Estimated memory consumption in bytes. */
  getBytesUsed(): number;
  /**
   * Trim cache until it is under `targetBytes`.
   * @returns Number of bytes freed.
   */
  trimTo(targetBytes: number): number;
  /** Clear all cached entries unconditionally. */
  clear(): void | Promise<void>;
  /** Optional telemetry metrics */
  getMetrics?(): { hits?: number; misses?: number; entryCount?: number };
}

export interface CacheCoordinatorStats {
  totalBytesUsed: number;
  maxBudgetBytes: number;
  usageRatio: number;
  tierBytes: Record<CacheTier, number>;
  participants: Array<{
    name: string;
    tier: CacheTier;
    lifespan: CacheLifespan;
    bytesUsed: number;
    metrics?: { hits?: number; misses?: number; entryCount?: number };
  }>;
}

/**
 * Detect a sensible default memory budget based on host RAM.
 * Clamped between 256 MB and 2048 MB.
 */
export function detectDefaultMemoryBudget(): number {
  if (typeof window !== "undefined" && typeof (navigator as any)?.deviceMemory === "number") {
    const ramGb = (navigator as any).deviceMemory;
    // Allocate ~1/8 of host RAM for preview & render cache
    return Math.min(2048 * 1024 * 1024, Math.max(256 * 1024 * 1024, ramGb * 128 * 1024 * 1024));
  }
  return 512 * 1024 * 1024; // 512 MB fallback
}

export class CacheCoordinator {
  private participants = new Map<string, ICacheParticipant>();
  private maxBudgetBytes: number;

  constructor(maxBudgetBytes?: number) {
    this.maxBudgetBytes = maxBudgetBytes ?? detectDefaultMemoryBudget();
  }

  /**
   * Register a cache participant under coordinated memory control.
   */
  register(participant: ICacheParticipant): void {
    this.participants.set(participant.name, participant);
  }

  /**
   * Unregister a cache participant.
   */
  unregister(name: string): void {
    this.participants.delete(name);
  }

  /**
   * Set global memory budget in bytes.
   */
  setMaxBudgetBytes(bytes: number): void {
    this.maxBudgetBytes = Math.max(10 * 1024 * 1024, bytes);
    this.enforceBudget();
  }

  /**
   * Get current maximum memory budget in bytes.
   */
  getMaxBudgetBytes(): number {
    return this.maxBudgetBytes;
  }

  /**
   * Total memory used across all registered participants in bytes.
   */
  getTotalBytesUsed(): number {
    let total = 0;
    for (const p of this.participants.values()) {
      total += p.getBytesUsed();
    }
    return total;
  }

  /**
   * Aggregate telemetry snapshot across all registered participants with tier breakdown.
   */
  getStats(): CacheCoordinatorStats {
    const totalBytesUsed = this.getTotalBytesUsed();
    const tierBytes: Record<CacheTier, number> = {
      memory: 0,
      gpu: 0,
      indexeddb: 0,
      worker: 0,
    };

    const participantStats = Array.from(this.participants.values()).map((p) => {
      const bytes = p.getBytesUsed();
      const tier: CacheTier = p.tier ?? "memory";
      const lifespan: CacheLifespan = p.lifespan ?? "session";
      tierBytes[tier] = (tierBytes[tier] || 0) + bytes;

      return {
        name: p.name,
        tier,
        lifespan,
        bytesUsed: bytes,
        metrics: p.getMetrics?.(),
      };
    });

    return {
      totalBytesUsed,
      maxBudgetBytes: this.maxBudgetBytes,
      usageRatio: this.maxBudgetBytes > 0 ? totalBytesUsed / this.maxBudgetBytes : 0,
      tierBytes,
      participants: participantStats,
    };
  }

  /**
   * Notify coordinator of incoming memory allocation and trim if necessary.
   */
  ensureCapacity(additionalBytes: number): boolean {
    const projected = this.getTotalBytesUsed() + additionalBytes;
    if (projected > this.maxBudgetBytes) {
      const neededFree = projected - this.maxBudgetBytes;
      this.trimBy(neededFree);
    }
    return this.getTotalBytesUsed() + additionalBytes <= this.maxBudgetBytes;
  }

  /**
   * Enforce memory budget across all participants by trimming proportionally.
   */
  enforceBudget(): void {
    const current = this.getTotalBytesUsed();
    if (current > this.maxBudgetBytes) {
      this.trimBy(current - this.maxBudgetBytes);
    }
  }

  /**
   * Trim across all participants by at least `targetBytesToFree`.
   * Trims highest memory consumers first.
   */
  trimBy(targetBytesToFree: number): number {
    let freed = 0;
    const sorted = Array.from(this.participants.values()).sort(
      (a, b) => b.getBytesUsed() - a.getBytesUsed(),
    );

    for (const p of sorted) {
      if (freed >= targetBytesToFree) break;
      const current = p.getBytesUsed();
      const target = Math.max(0, current - (targetBytesToFree - freed));
      freed += p.trimTo(target);
    }

    return freed;
  }

  /**
   * Respond to system or OS memory pressure levels.
   */
  handleMemoryPressure(level: "moderate" | "critical"): void {
    if (level === "critical") {
      this.clearAll();
    } else {
      // Moderate pressure: trim all caches to 50% of current size
      for (const p of this.participants.values()) {
        const half = Math.floor(p.getBytesUsed() / 2);
        p.trimTo(half);
      }
    }
  }

  /**
   * Clear all session-scoped and ephemeral caches (called on project close or switch).
   * Leaves persistent asset caches (e.g. downloaded LUTs or sound library) intact.
   */
  async resetSessionCaches(): Promise<void> {
    for (const p of this.participants.values()) {
      const lifespan = p.lifespan ?? "session";
      if (lifespan === "session" || lifespan === "ephemeral") {
        await p.clear();
      }
    }
  }

  /**
   * Clear all registered caches unconditionally.
   */
  clearAll(): void {
    for (const p of this.participants.values()) {
      p.clear();
    }
  }
}

// ─── Singleton Factory ────────────────────────────────────────────────────────

let coordinatorInstance: CacheCoordinator | null = null;

export function getCacheCoordinator(): CacheCoordinator {
  if (!coordinatorInstance) {
    coordinatorInstance = new CacheCoordinator();
  }
  return coordinatorInstance;
}
