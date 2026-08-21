/**
 * Filmstrip Tile Cache
 *
 * Tile-addressable cache that stores thumbnails by fixed-grid tile addresses.
 * Key benefits:
 *   - Tile-level invalidation (not clip-level)
 *   - Zoom tier transitions reuse center tiles
 *   - Scales to 2hr videos (bounded by viewport, not duration)
 *   - Retains nearest-tile lookup for diagnostics/legacy callers; active
 *     filmstrip rendering uses exact addresses only
 *
 * Architecture:
 *   FilmstripTileCache → Map<tileKey, TileCacheEntry>
 *   Tile key = clipId:zoomTier:tileIndex (NOT timestamp — fixed grid!)
 */

import { SpatialTier } from "../renderEngine/types";
import type { TransportArtifact } from "../renderEngine/transport";
import { getTileKey, type FilmstripTileAddress } from "./filmstripTiers";

export interface TileCacheEntry {
  address: FilmstripTileAddress;
  artifact: TransportArtifact;
  generation: number; // For zoom tier invalidation
  lastUsed: number;
  sizeBytes: number;
}

interface TileCacheStats {
  tileCount: number;
  memoryBytes: number;
  budgetBytes: number;
  utilizationPercent: number;
}

export class FilmstripTileCache {
  private tiles = new Map<string, TileCacheEntry>();
  private memoryBudgetBytes: number;
  private currentMemoryBytes = 0;
  private generation = 0;

  private isArtifactActive?: (art: TransportArtifact) => boolean;

  constructor(memoryBudgetMB: number = 100, isArtifactActive?: (art: TransportArtifact) => boolean) {
    this.memoryBudgetBytes = memoryBudgetMB * 1024 * 1024;
    this.isArtifactActive = isArtifactActive;
  }

  private _safeClose(artifact: TransportArtifact): void {
    if (this.isArtifactActive && this.isArtifactActive(artifact)) {
      return;
    }
    try {
      artifact.bitmap.close();
    } catch (e) {}
  }

  /**
   * Store a tile. Replaces existing tile at same address.
   * Closes the old bitmap if replaced.
   */
  setTile(address: FilmstripTileAddress, artifact: TransportArtifact): void {
    const key = getTileKey(address);
    const existing = this.tiles.get(key);

    if (existing) {
      // Only replace if the new artifact is of higher or equal quality
      if (artifact.spatialTier < existing.artifact.spatialTier) {
        this._safeClose(artifact);
        return;
      }
      this._safeClose(existing.artifact);
      this.currentMemoryBytes -= existing.sizeBytes;
    }

    const sizeBytes = artifact.width * artifact.height * 4;
    // Enforce memory budget
    while (this.currentMemoryBytes + sizeBytes > this.memoryBudgetBytes && this.tiles.size > 0) {
      this._evictLRU();
    }

    this.tiles.set(key, {
      address,
      artifact,
      generation: this.generation,
      lastUsed: Date.now(),
      sizeBytes,
    });
    this.currentMemoryBytes += sizeBytes;
  }

  /**
   * Get a tile by exact address.
   */
  getTile(address: FilmstripTileAddress): TileCacheEntry | null {
    const key = getTileKey(address);
    const entry = this.tiles.get(key);
    if (!entry) return null;
    entry.lastUsed = Date.now();
    return entry;
  }
  /**
   * Find nearest tile.
   */
  findNearestTile(clipId: string, zoomTier: SpatialTier, targetTimestamp: number, toleranceSeconds: number = 0.5, videoPath?: string): TileCacheEntry | null {
    let nearest: TileCacheEntry | null = null;
    let nearestDelta = Infinity;

    for (const entry of this.tiles.values()) {
      const matchPath = videoPath || entry.address.videoPath;
      if (matchPath) {
        if (entry.address.videoPath !== matchPath) continue;
      } else {
        if (entry.address.clipId !== clipId) continue;
      }
      if (entry.address.zoomTier !== zoomTier) continue;

      const delta = Math.abs(entry.address.timestamp - targetTimestamp);
      if (delta <= toleranceSeconds && delta < nearestDelta) {
        nearest = entry;
        nearestDelta = delta;
      }
    }

    if (nearest) {
      nearest.lastUsed = Date.now();
    }
    return nearest;
  }

  /**
   * Check if a tile exists at the given address.
   */
  hasTile(address: FilmstripTileAddress): boolean {
    return this.tiles.has(getTileKey(address));
  }

  /**
   * Check if a specific artifact is currently stored in the tile cache.
   */
  isArtifactCached(artifact: TransportArtifact): boolean {
    for (const entry of this.tiles.values()) {
      if (entry.artifact === artifact) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all tile addresses for a clip at a specific zoom tier.
   */
  getTilesForClip(clipId: string, zoomTier: SpatialTier, videoPath?: string): TileCacheEntry[] {
    const results: TileCacheEntry[] = [];
    for (const entry of this.tiles.values()) {
      const matchPath = videoPath || entry.address.videoPath;
      if (matchPath) {
        if (entry.address.videoPath !== matchPath) continue;
      } else {
        if (entry.address.clipId !== clipId) continue;
      }
      if (entry.address.zoomTier === zoomTier) {
        results.push(entry);
      }
    }
    return results.sort((a, b) => a.address.tileIndex - b.address.tileIndex);
  }

  /**
   * Invalidate tiles for a clip. If zoomTier is provided, only invalidates
   * tiles at that tier (for tier transitions). Otherwise invalidates all.
   */
  invalidateClip(clipId: string, zoomTier?: SpatialTier, videoPath?: string): void {
    const toDelete: string[] = [];
    for (const [key, entry] of this.tiles) {
      const matchPath = videoPath || entry.address.videoPath;
      if (matchPath) {
        if (entry.address.videoPath !== matchPath) continue;
      } else {
        if (entry.address.clipId !== clipId) continue;
      }
      if (zoomTier !== undefined && entry.address.zoomTier !== zoomTier) continue;
      toDelete.push(key);
    }
    for (const key of toDelete) {
      const entry = this.tiles.get(key);
      if (entry) {
        this._safeClose(entry.artifact);
        this.currentMemoryBytes -= entry.sizeBytes;
        this.tiles.delete(key);
      }
    }
  }

  /**
   * Bump generation — marks all existing tiles as "stale generation".
   * New tiles will have a higher generation number. Call after major zoom change.
   */
  bumpGeneration(): void {
    this.generation++;
  }

  /**
   * Clear all tiles.
   */
  clear(): void {
    for (const entry of this.tiles.values()) {
      this._safeClose(entry.artifact);
    }
    this.tiles.clear();
    this.currentMemoryBytes = 0;
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    this.clear();
  }

  /**
   * Get cache statistics.
   */
  getStats(): TileCacheStats {
    return {
      tileCount: this.tiles.size,
      memoryBytes: this.currentMemoryBytes,
      budgetBytes: this.memoryBudgetBytes,
      utilizationPercent: (this.currentMemoryBytes / this.memoryBudgetBytes) * 100,
    };
  }

  private _evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.tiles) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.tiles.get(oldestKey)!;
      this._safeClose(entry.artifact);
      this.currentMemoryBytes -= entry.sizeBytes;
      this.tiles.delete(oldestKey);
    }
  }
}
