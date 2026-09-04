/**
 * CacheCoordinator — Centralized Memory & Eviction Authority
 *
 * Coordinates all independent in-memory caches across Clypra:
 * • Audio PCM Waveforms (waveformCache)
 * • Video Frame LUTs & Filters (filterCache)
 * • Text Templates & Text Effects
 * • Render Textures & Native Raster Assets
 * • Stickers & Audio Library Previews
 *
 * Enforces a global memory budget, coordinates LRU trimming on memory pressure,
 * and tracks application-wide cache telemetry.
 */

export interface ICacheParticipant {
  /** Unique identifier for the cache domain (e.g. 'waveform-lod', 'filter-cache'). */
  name: string;
  /** Estimated memory consumption in bytes. */
  getBytesUsed(): number;
  /**
   * Trim cache until it is under `targetBytes`.
   * @returns Number of bytes freed.
   */
  trimTo(targetBytes: number): number;
  /** Clear all cached entries unconditionally. */
  clear(): void;
}

export interface CacheCoordinatorStats {
  totalBytesUsed: number;
  maxBudgetBytes: number;
  usageRatio: number;
  participants: Array<{
    name: string;
    bytesUsed: number;
  }>;
}

export class CacheCoordinator {
  private participants = new Map<string, ICacheParticipant>();
  private maxBudgetBytes: number;

  constructor(maxBudgetBytes = 512 * 1024 * 1024) { // Default 512 MB
    this.maxBudgetBytes = maxBudgetBytes;
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
   * Aggregate telemetry snapshot across all registered participants.
   */
  getStats(): CacheCoordinatorStats {
    const totalBytesUsed = this.getTotalBytesUsed();
    const participantStats = Array.from(this.participants.values()).map((p) => ({
      name: p.name,
      bytesUsed: p.getBytesUsed(),
    }));

    return {
      totalBytesUsed,
      maxBudgetBytes: this.maxBudgetBytes,
      usageRatio: this.maxBudgetBytes > 0 ? totalBytesUsed / this.maxBudgetBytes : 0,
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
