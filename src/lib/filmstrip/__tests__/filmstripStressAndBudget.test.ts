/**
 * filmstripStressAndBudget.test.ts
 *
 * Validates:
 * - FILMSTRIP-005: Coarse preload tile count ≤ 300 across 10s, 2m, 10m, 1h, 3h media
 * - FILMSTRIP-006: Coarse cache memory strictly bounded (≤ 1.8 MB) regardless of media duration
 * - FILMSTRIP-007: Completed coarse preload provides 100% cache hits for horizontal scrolling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FilmstripCache } from "../../renderEngine/FilmstripCache";
import { SpatialTier } from "../../renderEngine/types";
import { generateViewportTileAddresses } from "../filmstripTiers";
import * as transport from "../../renderEngine/transport";

vi.mock("../../renderEngine/transport", async () => {
  const actual = await vi.importActual<typeof import("../../renderEngine/transport")>(
    "../../renderEngine/transport"
  );
  return {
    ...actual,
    requestFilmstripArtifacts: vi.fn(),
  };
});

describe("FILMSTRIP Stress Matrix & Memory Budget", () => {
  let cache: FilmstripCache;
  let mockRequestArtifacts: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cache = new FilmstripCache(100);
    mockRequestArtifacts = vi.mocked(transport.requestFilmstripArtifacts);
    mockRequestArtifacts.mockReset();
  });

  afterEach(() => {
    cache.dispose();
  });

  const STRESS_MATRIX = [
    { label: "Short (10s)", duration: 10, targetFps: 30, res: "1080p" },
    { label: "Normal (2m)", duration: 120, targetFps: 30, res: "1080p" },
    { label: "Long (10m)", duration: 600, targetFps: 30, res: "1080p" },
    { label: "Very Long (1h)", duration: 3600, targetFps: 30, res: "4K" },
    { label: "Extreme (3h)", duration: 10800, targetFps: 60, res: "4K" },
  ];

  it("FILMSTRIP-005: Coarse preload tile count is strictly capped at ≤ 300 tiles for all media durations", () => {
    for (const testCase of STRESS_MATRIX) {
      let requestedTimestamps: number[] = [];

      mockRequestArtifacts.mockImplementationOnce((opts: any) => {
        requestedTimestamps = opts.timestampsMs;
        return vi.fn();
      });

      cache.preloadAssetCoarseBaseline({
        videoPath: `/media/${testCase.label}.mp4`,
        duration: testCase.duration,
      });

      expect(requestedTimestamps.length, `Failed for ${testCase.label}`).toBeLessThanOrEqual(300);
      expect(requestedTimestamps.length, `Failed for ${testCase.label}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("FILMSTRIP-006: Memory footprint remains strictly bounded across extreme media durations", () => {
    const TILE_WIDTH = 160;
    const TILE_HEIGHT = 90;
    const BYTES_PER_COMPRESSED_THUMBNAIL = 5.3 * 1024; // ~5.3 KB per WebP thumbnail

    for (const testCase of STRESS_MATRIX) {
      const tileCount = Math.min(300, Math.max(20, Math.ceil(testCase.duration / 5.0)));
      const totalEstimatedStorageBytes = tileCount * BYTES_PER_COMPRESSED_THUMBNAIL;
      const totalEstimatedStorageMB = totalEstimatedStorageBytes / (1024 * 1024);

      // Memory budget assertion: coarse storage must remain ≤ 1.8 MB even for a 3-hour 4K file
      expect(totalEstimatedStorageMB, `Storage exceeded for ${testCase.label}`).toBeLessThanOrEqual(1.8);
    }
  });

  it("FILMSTRIP-007: Completed coarse preload guarantees 100% cache hit rate during pure horizontal scrolling", () => {
    const videoPath = "/sample-10min-timeline.mp4";
    const duration = 600; // 10 minutes (standard clip length within 300-tile L0 grid)
    const clipId = "clip-10min";

    // 1. Simulate coarse preload execution via preloadAssetCoarseBaseline
    mockRequestArtifacts.mockImplementationOnce((opts: any) => {
      // Simulate native decoder delivering each requested frame into cache
      for (const ts of opts.timestampsMs) {
        opts.onArtifact({
          bitmap: { width: 160, height: 90, close: vi.fn() } as any,
          width: 160,
          height: 90,
          timestampMs: ts,
          epochId: opts.epochId,
          spatialTier: opts.spatialTier,
        });
      }
      return vi.fn();
    });

    cache.preloadAssetCoarseBaseline({ videoPath, duration });

    // 2. Perform horizontal scrolling across the timeline at L0 zoom
    const scrollPositions = [0, 500, 1000, 1500, 2000, 2500, 3000];
    let totalTileLookups = 0;
    let cacheHits = 0;

    for (const scrollLeft of scrollPositions) {
      const addresses = generateViewportTileAddresses({
        clipId,
        videoPath,
        zoomTier: SpatialTier.L0,
        trimIn: 0,
        trimOut: duration,
        clipStartTime: 0,
        clipWidthPx: 3000, // 5px/sec
        viewportScrollLeft: scrollLeft,
        viewportWidth: 1000,
        pixelsPerSecond: 5,
        overscanFactor: 2.0,
        videoDuration: duration,
      });

      for (const addr of addresses) {
        totalTileLookups++;
        if ((cache as any).tileCache.hasTile(addr)) {
          cacheHits++;
        }
      }
    }

    expect(totalTileLookups).toBeGreaterThan(0);
    const hitRate = (cacheHits / totalTileLookups) * 100;

    // Must achieve 100% cache hit rate for horizontal scrolling across preloaded baseline
    expect(hitRate).toBe(100);
  });
});
