/**
 * FilmstripTileCache tests
 *
 * Verifies tile storage, retrieval, nearest-tile lookup,
 * memory budgeting, LRU eviction, and clip invalidation.
 */

import { describe, it, expect, vi } from "vitest";
import { SpatialTier } from "../../renderEngine/types";
import { FilmstripTileCache } from "../FilmstripTileCache";
import type { FilmstripTileAddress } from "../filmstripTiers";

function makeArtifact(width: number, height: number) {
  return {
    frameId: "f-1",
    contentHash: "h-1",
    spatialTier: SpatialTier.L1,
    bitmap: { width, height, close: vi.fn() } as unknown as ImageBitmap,
    width,
    height,
    timestampMs: 1000,
    epochId: "epoch-1" as any,
    source: "fresh-decode" as const,
  };
}

function makeAddress(clipId: string, zoomTier: SpatialTier, tileIndex: number, timestamp: number): FilmstripTileAddress {
  return { clipId, zoomTier, tileIndex, timestamp };
}

describe("FilmstripTileCache", () => {
  let cache: FilmstripTileCache;

  beforeEach(() => {
    cache = new FilmstripTileCache(10); // 10MB budget
  });

  afterEach(() => {
    cache.dispose();
  });

  it("stores and retrieves tiles", () => {
    const addr = makeAddress("clip-1", SpatialTier.L1, 0, 0);
    const artifact = makeArtifact(240, 135);

    cache.setTile(addr, artifact);
    const retrieved = cache.getTile(addr);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.artifact).toBe(artifact);
    expect(retrieved!.address).toEqual(addr);
  });

  it("hasTile returns true for stored tiles", () => {
    const addr = makeAddress("clip-1", SpatialTier.L1, 0, 0);
    expect(cache.hasTile(addr)).toBe(false);

    cache.setTile(addr, makeArtifact(240, 135));
    expect(cache.hasTile(addr)).toBe(true);
  });

  it("finds nearest tile within tolerance", () => {
    cache.setTile(makeAddress("clip-1", SpatialTier.L1, 0, 0), makeArtifact(240, 135));
    cache.setTile(makeAddress("clip-1", SpatialTier.L1, 1, 5), makeArtifact(240, 135));
    cache.setTile(makeAddress("clip-1", SpatialTier.L1, 2, 10), makeArtifact(240, 135));

    const nearest = cache.findNearestTile("clip-1", SpatialTier.L1, 6, 2);
    expect(nearest).not.toBeNull();
    expect(nearest!.address.timestamp).toBe(5);
  });

  it("returns null when no tile within tolerance", () => {
    cache.setTile(makeAddress("clip-1", SpatialTier.L1, 0, 0), makeArtifact(240, 135));
    cache.setTile(makeAddress("clip-1", SpatialTier.L1, 1, 5), makeArtifact(240, 135));

    const nearest = cache.findNearestTile("clip-1", SpatialTier.L1, 100, 1);
    expect(nearest).toBeNull();
  });

  it("filters nearest by clipId", () => {
    cache.setTile(makeAddress("clip-1", SpatialTier.L1, 0, 0), makeArtifact(240, 135));
    cache.setTile(makeAddress("clip-2", SpatialTier.L1, 0, 0), makeArtifact(240, 135));

    const nearest = cache.findNearestTile("clip-2", SpatialTier.L1, 0, 1);
    expect(nearest).not.toBeNull();
    expect(nearest!.address.clipId).toBe("clip-2");
  });

  it("evicts LRU when memory budget exceeded", () => {
    // Each tile = 160 × 90 × 4 = 57,600 bytes
    // 10MB budget ≈ 182 tiles max
    const smallCache = new FilmstripTileCache(0.01); // 0.01MB = ~182 bytes (enforces eviction)

    const addr1 = makeAddress("clip-1", SpatialTier.L1, 0, 0);
    const addr2 = makeAddress("clip-1", SpatialTier.L1, 1, 5);

    smallCache.setTile(addr1, makeArtifact(100, 100)); // 40,000 bytes — should evict
    // Above should have triggered eviction, so tile might not be there
    // Let's use a larger tile to force eviction

    const bigCache = new FilmstripTileCache(0.001); // 1KB budget
    bigCache.setTile(addr1, makeArtifact(50, 50)); // 10,000 bytes — exceeds budget, evicts itself?
    // Actually setTile evicts LRU first, then adds. Since cache is empty, it adds.
    // Second add should evict first.

    bigCache.setTile(addr2, makeArtifact(50, 50));

    expect(bigCache.hasTile(addr1)).toBe(false);
    expect(bigCache.hasTile(addr2)).toBe(true);

    bigCache.dispose();
  });

  it("closes old bitmap when replacing tile at same address", () => {
    const addr = makeAddress("clip-1", SpatialTier.L1, 0, 0);
    const art1 = makeArtifact(240, 135);
    const art2 = makeArtifact(240, 135);

    cache.setTile(addr, art1);
    cache.setTile(addr, art2);

    expect(art1.bitmap.close).toHaveBeenCalled();
    expect(cache.hasTile(addr)).toBe(true);
  });

  it("invalidates all tiles for a clip", () => {
    cache.setTile(makeAddress("clip-1", SpatialTier.L1, 0, 0), makeArtifact(240, 135));
    cache.setTile(makeAddress("clip-1", SpatialTier.L2, 0, 0), makeArtifact(320, 180));
    cache.setTile(makeAddress("clip-2", SpatialTier.L1, 0, 0), makeArtifact(240, 135));

    cache.invalidateClip("clip-1");

    expect(cache.getTilesForClip("clip-1", SpatialTier.L1)).toHaveLength(0);
    expect(cache.getTilesForClip("clip-1", SpatialTier.L2)).toHaveLength(0);
    expect(cache.getTilesForClip("clip-2", SpatialTier.L1)).toHaveLength(1);
  });

  it("invalidates tiles at specific zoom tier only", () => {
    cache.setTile(makeAddress("clip-1", SpatialTier.L1, 0, 0), makeArtifact(240, 135));
    cache.setTile(makeAddress("clip-1", SpatialTier.L2, 0, 0), makeArtifact(320, 180));

    cache.invalidateClip("clip-1", SpatialTier.L1);

    expect(cache.getTilesForClip("clip-1", SpatialTier.L1)).toHaveLength(0);
    expect(cache.getTilesForClip("clip-1", SpatialTier.L2)).toHaveLength(1);
  });

  it("returns stats", () => {
    cache.setTile(makeAddress("clip-1", SpatialTier.L1, 0, 0), makeArtifact(240, 135));
    const stats = cache.getStats();

    expect(stats.tileCount).toBe(1);
    expect(stats.memoryBytes).toBe(240 * 135 * 4);
    expect(stats.budgetBytes).toBe(10 * 1024 * 1024);
    expect(stats.utilizationPercent).toBeGreaterThan(0);
  });

  it("clears all tiles and disposes bitmaps", () => {
    const art = makeArtifact(240, 135);
    cache.setTile(makeAddress("clip-1", SpatialTier.L1, 0, 0), art);

    cache.clear();

    expect(cache.getStats().tileCount).toBe(0);
    expect(art.bitmap.close).toHaveBeenCalled();
  });

  it("disposes all resources", () => {
    const art = makeArtifact(240, 135);
    cache.setTile(makeAddress("clip-1", SpatialTier.L1, 0, 0), art);

    cache.dispose();

    expect(cache.getStats().tileCount).toBe(0);
    expect(art.bitmap.close).toHaveBeenCalled();
  });
});
