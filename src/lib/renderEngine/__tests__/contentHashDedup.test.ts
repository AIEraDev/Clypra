/**
 * contentHashDedup.test.ts
 *
 * Validates:
 * - Cross-clip tile sharing via contentHash secondary index in FilmstripTileCache
 * - When multiple clips share the same source media at the same timestamp,
 *   the cached tile is retrieved instantly without re-decoding.
 */

import { describe, it, expect, vi } from "vitest";
import { FilmstripTileCache } from "../../filmstrip/FilmstripTileCache";
import { SpatialTier } from "../types";

describe("Content-Hash Cross-Clip Deduplication", () => {
  it("shares cached tiles between two different clips referencing the same contentHash", () => {
    const tileCache = new FilmstripTileCache(50);
    const contentHash = "hash-shared-source-ts1000";
    const sharedBitmap = { width: 160, height: 90, close: vi.fn() } as any;

    // Clip A sets tile with contentHash
    tileCache.setTile(
      {
        clipId: "clip-track-1",
        videoPath: "shared_source.mp4",
        zoomTier: SpatialTier.L0,
        tileIndex: 0,
        timestamp: 1.0,
      },
      {
        frameId: "frame-1",
        contentHash,
        spatialTier: SpatialTier.L0,
        bitmap: sharedBitmap,
        width: 160,
        height: 90,
        timestampMs: 1000,
        epochId: "epoch-1" as any,
      }
    );

    // Clip B looks up by contentHash
    const match = tileCache.getTileByContentHash(contentHash);

    expect(match).not.toBeNull();
    expect(match?.artifact.bitmap).toBe(sharedBitmap);
    expect(match?.artifact.contentHash).toBe(contentHash);
  });

  it("removes contentHash index entry when tile is invalidated or replaced", () => {
    const tileCache = new FilmstripTileCache(50);
    const contentHash = "hash-to-remove";
    const bitmap = { width: 160, height: 90, close: vi.fn() } as any;

    tileCache.setTile(
      {
        clipId: "clip-to-delete",
        videoPath: "source.mp4",
        zoomTier: SpatialTier.L0,
        tileIndex: 0,
        timestamp: 2.0,
      },
      {
        frameId: "frame-2",
        contentHash,
        spatialTier: SpatialTier.L0,
        bitmap,
        width: 160,
        height: 90,
        timestampMs: 2000,
        epochId: "epoch-1" as any,
      }
    );

    expect(tileCache.getTileByContentHash(contentHash)).not.toBeNull();

    // Invalidate clip
    tileCache.invalidateClip("clip-to-delete");

    // Content hash index should now be clean
    expect(tileCache.getTileByContentHash(contentHash)).toBeNull();
    expect(bitmap.close).toHaveBeenCalled();
  });
});
