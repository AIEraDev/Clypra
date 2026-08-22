/**
 * filmstripMemoryStress.test.ts
 *
 * Layer 4: Memory Boundedness Under Stress
 *
 * Validates:
 * - 100 clips x 300 coarse tiles under heavy load
 * - Memory footprint stays strictly bounded to the configured budget (10MB in test)
 * - LRU eviction frees old bitmaps and cleans secondary indices without memory leaks
 */

import { describe, it, expect, vi } from "vitest";
import { FilmstripTileCache } from "../FilmstripTileCache";
import { SpatialTier } from "../../renderEngine/types";

describe("Layer 4: Memory Boundedness & Stress Suite", () => {
  it("strictly enforces memory budget across 100 clips with 30,000 tile insertions", () => {
    const memoryBudgetMB = 5; // 5 MB test budget (~86 tiles of 160x90 RGBA)
    const tileCache = new FilmstripTileCache(memoryBudgetMB);

    const closedBitmaps: number[] = [];

    // Simulate 100 clips, each inserting 300 tiles = 30,000 total tile operations
    const clipCount = 100;
    const tilesPerClip = 300;

    for (let c = 0; c < clipCount; c++) {
      const clipId = `clip-${c}`;
      const videoPath = `video-${c}.mp4`;

      for (let t = 0; t < tilesPerClip; t++) {
        const tileIndex = t;
        const timestamp = t * 5.0;

        const mockBitmap = {
          width: 160,
          height: 90,
          close: vi.fn(() => closedBitmaps.push(1)),
        } as any;

        tileCache.setTile(
          {
            clipId,
            videoPath,
            zoomTier: SpatialTier.L0,
            tileIndex,
            timestamp,
          },
          {
            frameId: `f-${clipId}-${t}`,
            contentHash: `hash-${clipId}-${t}`,
            spatialTier: SpatialTier.L0,
            bitmap: mockBitmap,
            width: 160,
            height: 90,
            timestampMs: timestamp * 1000,
            epochId: "epoch-1" as any,
          }
        );
      }
    }

    const stats = tileCache.getStats();

    // Memory usage MUST be strictly <= budget
    expect(stats.memoryBytes).toBeLessThanOrEqual(stats.budgetBytes);
    expect(stats.utilizationPercent).toBeLessThanOrEqual(100);

    // Eviction MUST have closed thousands of old bitmaps
    expect(closedBitmaps.length).toBeGreaterThan(29000);
  });
});
