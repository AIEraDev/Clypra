/**
 * filmstripEffectInvalidation.test.ts
 *
 * Layer 2: Cache Invalidation & Visual Versioning
 *
 * Validates:
 * - Effect graph version bumps (color grade, filter, LUT) invalidate stale cached atlases
 * - Multiple clips sharing the same source video at the same timestamp deduplicate to 1 decode
 * - Changing effect graph version bypasses old version without visual ghosting
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { FilmstripTileCache } from "../FilmstripTileCache";
import { SpatialTier } from "../../renderEngine/types";
import { getTileKey, getCanonicalTileKey } from "../filmstripTiers";

describe("Layer 2: Cache Invalidation & Effect Graph Versioning", () => {
  let tileCache: FilmstripTileCache;

  beforeEach(() => {
    tileCache = new FilmstripTileCache(50);
  });

  it("canonical tile keys differ when effectGraphVersion is updated", () => {
    const videoPath = "source-graded.mp4";
    const timestampMs = 5000;
    const tier = SpatialTier.L1;

    const keyV1 = getCanonicalTileKey({
      videoPath,
      timestampMs,
      spatialTier: tier,
      effectGraphVersion: 1,
    });

    const keyV2 = getCanonicalTileKey({
      videoPath,
      timestampMs,
      spatialTier: tier,
      effectGraphVersion: 2,
    });

    expect(keyV1).not.toBe(keyV2);
    expect(keyV1).toContain(":v1");
    expect(keyV2).toContain(":v2");
  });

  it("rejects stale effectGraphVersion cached tiles and enforces re-fetch on effect change", () => {
    const videoPath = "grading_clip.mp4";
    const clipId = "clip-grade-1";

    const v1Bitmap = { width: 240, height: 135, close: vi.fn() } as any;

    // Cache a tile with effectGraphVersion = 1
    tileCache.setTile(
      {
        clipId,
        videoPath,
        zoomTier: SpatialTier.L1,
        tileIndex: 0,
        timestamp: 0,
        effectGraphVersion: 1,
      },
      {
        frameId: "f-v1-0",
        contentHash: "hash-v1-0",
        spatialTier: SpatialTier.L1,
        bitmap: v1Bitmap,
        width: 240,
        height: 135,
        timestampMs: 0,
        epochId: "epoch-v1" as any,
      }
    );

    // Query with effectGraphVersion = 1 -> hit
    const hitV1 = tileCache.getTile({
      clipId,
      videoPath,
      zoomTier: SpatialTier.L1,
      tileIndex: 0,
      timestamp: 0,
      effectGraphVersion: 1,
    });
    expect(hitV1).not.toBeNull();
    expect(hitV1?.artifact.bitmap).toBe(v1Bitmap);

    // Query with effectGraphVersion = 2 (user applied color grade) -> miss!
    const missV2 = tileCache.getTile({
      clipId,
      videoPath,
      zoomTier: SpatialTier.L1,
      tileIndex: 0,
      timestamp: 0,
      effectGraphVersion: 2,
    });
    expect(missV2).toBeNull();
  });

  it("4 clips referencing the same source video at the same timestamp share 1 cached tile", () => {
    const videoPath = "b_roll.mp4";
    const timestamp = 10.0;
    const contentHash = "b_roll_10s_hash";
    const sharedBitmap = { width: 160, height: 90, close: vi.fn() } as any;

    // Clip 1 sets the tile
    tileCache.setTile(
      {
        clipId: "track-1-clip",
        videoPath,
        zoomTier: SpatialTier.L0,
        tileIndex: 2,
        timestamp,
      },
      {
        frameId: "f-broll-10",
        contentHash,
        spatialTier: SpatialTier.L0,
        bitmap: sharedBitmap,
        width: 160,
        height: 90,
        timestampMs: 10000,
        epochId: "epoch-1" as any,
      }
    );

    // Clips 2, 3, 4 look up via contentHash
    const clip2Match = tileCache.getTileByContentHash(contentHash);
    const clip3Match = tileCache.getTileByContentHash(contentHash);
    const clip4Match = tileCache.getTileByContentHash(contentHash);

    expect(clip2Match?.artifact.bitmap).toBe(sharedBitmap);
    expect(clip3Match?.artifact.bitmap).toBe(sharedBitmap);
    expect(clip4Match?.artifact.bitmap).toBe(sharedBitmap);
  });
});
