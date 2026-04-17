/**
 * FrameCache - LRU cache for rendered frames to optimize scrubbing performance
 */

import type { FrameCacheEntry } from "../types/core";
import type { Clip, Track } from "../../timeline/types/core";

export class FrameCache {
  private cache: Map<number, FrameCacheEntry> = new Map();
  private maxSize: number;
  private stateHash: string = "";

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  /**
   * Get a cached frame for the given timeline time
   * Returns null if not found or state has changed
   */
  get(timelineTime: number): FrameCacheEntry | null {
    const key = this.timeToKey(timelineTime);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    if (entry.stateHash !== this.stateHash) {
      this.cache.delete(key);
      return null;
    }

    // Update last accessed time for LRU
    entry.lastAccessed = Date.now();

    return entry;
  }

  /**
   * Store a rendered frame in the cache
   * Evicts LRU entry if cache is at capacity
   */
  set(timelineTime: number, bitmap: ImageBitmap): void {
    const key = this.timeToKey(timelineTime);

    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    const entry: FrameCacheEntry = {
      bitmap,
      timestamp: timelineTime,
      lastAccessed: Date.now(),
      stateHash: this.stateHash,
    };

    this.cache.set(key, entry);
  }

  /**
   * Update the state hash based on current clips and tracks
   * Used to invalidate cache when timeline state changes
   */
  updateStateHash(clips: Map<string, Clip>, tracks: Map<string, Track>): void {
    // Generate hash from clips and tracks state
    const clipsArray = Array.from(clips.values());
    const tracksArray = Array.from(tracks.values());

    const stateString = JSON.stringify({
      clips: clipsArray.map((c) => ({
        id: c.id,
        startTime: c.startTime,
        duration: c.duration,
        trackId: c.trackId,
        sourceStart: c.sourceStart,
        sourceEnd: c.sourceEnd,
      })),
      tracks: tracksArray.map((t) => ({
        id: t.id,
        order: t.order,
        visible: t.visible,
      })),
    });

    this.stateHash = this.simpleHash(stateString);
  }

  /**
   * Clear all cached frames and release ImageBitmap resources
   */
  invalidate(): void {
    for (const entry of this.cache.values()) {
      entry.bitmap.close();
    }
    this.cache.clear();
  }

  /**
   * Evict the least recently used frame from the cache
   */
  private evictLRU(): void {
    let oldestKey: number | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey !== null) {
      const entry = this.cache.get(oldestKey);
      if (entry) {
      }
      this.cache.delete(oldestKey);
    }
  }

  /**
   * Convert timeline time to cache key
   * Rounds to milliseconds for consistent key generation
   */
  private timeToKey(time: number): number {
    // Round to 3 decimal places (milliseconds) for key consistency
    return Math.round(time * 1000);
  }

  /**
   * Generate a simple hash from a string
   * Used for state invalidation detection
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Cleanup all resources
   */
  dispose(): void {
    for (const entry of this.cache.values()) {
      entry.bitmap.close();
    }
    this.cache.clear();
  }

  /**
   * Get current cache size (for testing)
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Get entry for timeline time (for testing)
   */
  getEntry(timelineTime: number): FrameCacheEntry | undefined {
    const key = this.timeToKey(timelineTime);
    return this.cache.get(key);
  }

  /**
   * Get current state hash (for testing)
   */
  getStateHash(): string {
    return this.stateHash;
  }
}
