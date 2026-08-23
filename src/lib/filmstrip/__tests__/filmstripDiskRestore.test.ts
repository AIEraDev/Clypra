/**
 * filmstripDiskRestore.test.ts
 *
 * Validates:
 * - Session restoration from disk/tier cache without triggering new decodes
 * - Partial cache hit handling: warm tiles restore instantly, only cold tiles decode
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { FilmstripCache } from "../../renderEngine/FilmstripCache";
import * as transport from "../../renderEngine/transport";
import { SpatialTier } from "../../renderEngine/types";

vi.mock("../../renderEngine/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../renderEngine/transport")>();
  return {
    ...actual,
    requestFilmstripArtifacts: vi.fn(),
    checkCoarseBaselineCache: vi.fn(),
    isValidArtifact: (art: any) => !!art?.bitmap && art.bitmap.width > 0,
  };
});

describe("Filmstrip Disk / Tier Cache Restoration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores coarse baseline instantly from disk cache when warm (0 new decodes)", async () => {
    const cache = new FilmstripCache(50);
    const videoPath = "test-video-restore.mp4";
    const duration = 60; // 12 tiles at 5s interval

    // Mock checkCoarseBaselineCache to simulate 100% cache hits from disk
    vi.mocked(transport.checkCoarseBaselineCache).mockImplementation((opts: any) => {
      // Return synthetic artifacts for all requested timestamps
      for (const ts of opts.timestampsMs) {
        opts.onArtifact({
          frameId: `frame-${ts}`,
          contentHash: `hash-${ts}`,
          spatialTier: SpatialTier.L0,
          bitmap: { width: 160, height: 90, close: vi.fn() } as any,
          width: 160,
          height: 90,
          timestampMs: ts,
          epochId: "epoch-preload",
          source: "disk_cache",
        });
      }
      opts.onComplete?.();
      return () => {};
    });

    // Trigger preload (which calls restore first)
    cache.preloadAssetCoarseBaseline({ videoPath, duration });

    // Verify checkCoarseBaselineCache was invoked
    expect(transport.checkCoarseBaselineCache).toHaveBeenCalledTimes(1);

    // Verify requestFilmstripArtifacts was NOT called because all 13 tiles were restored from disk!
    expect(transport.requestFilmstripArtifacts).not.toHaveBeenCalled();

    // Verify stats show tiles in cache
    const stats = (cache as any).tileCache.getStats();
    expect(stats.tileCount).toBe(13); // 0s, 5s, ..., 60s
  });

  it("handles partial disk cache hits by decoding only remaining missing tiles", async () => {
    const cache = new FilmstripCache(50);
    const videoPath = "test-video-partial.mp4";
    const duration = 30; // 7 tiles: 0, 5, 10, 15, 20, 25, 30

    // Mock checkCoarseBaselineCache to return only 3 warm tiles (0s, 5s, 10s)
    vi.mocked(transport.checkCoarseBaselineCache).mockImplementation((opts: any) => {
      const warmTimestamps = [0, 5000, 10000];
      for (const ts of warmTimestamps) {
        opts.onArtifact({
          frameId: `frame-${ts}`,
          contentHash: `hash-${ts}`,
          spatialTier: SpatialTier.L0,
          bitmap: { width: 160, height: 90, close: vi.fn() } as any,
          width: 160,
          height: 90,
          timestampMs: ts,
          epochId: "epoch-preload",
          source: "disk_cache",
        });
      }
      opts.onComplete?.();
      return () => {};
    });

    cache.preloadAssetCoarseBaseline({ videoPath, duration });

    expect(transport.checkCoarseBaselineCache).toHaveBeenCalledTimes(1);

    // Verify requestFilmstripArtifacts was called ONLY for the 4 missing tiles: 15s, 20s, 25s, 30s
    expect(transport.requestFilmstripArtifacts).toHaveBeenCalledTimes(1);
    const decodeOpts = vi.mocked(transport.requestFilmstripArtifacts).mock.calls[0][0];
    expect(decodeOpts.timestampsMs).toEqual([15000, 20000, 25000, 30000]);
  });
});
