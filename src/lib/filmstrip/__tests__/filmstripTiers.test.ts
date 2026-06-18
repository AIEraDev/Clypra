/**
 * filmstripTiers tests
 *
 * Verifies fixed-grid tile address generation and nearest-tile lookup.
 */

import { describe, it, expect } from "vitest";
import { SpatialTier, TEMPORAL_TIER_INTERVALS, TemporalTier } from "../../renderEngine/types";
import { FILMSTRIP_DENSITY_TIERS, generateViewportTileAddresses, findNearestTileAddress, getTileKey } from "../filmstripTiers";

describe("FILMSTRIP_DENSITY_TIERS", () => {
  it("has fixed intervals per spatial tier", () => {
    expect(FILMSTRIP_DENSITY_TIERS[SpatialTier.L0].thumbnailIntervalSeconds).toBe(TEMPORAL_TIER_INTERVALS[TemporalTier.L0][0]);
    expect(FILMSTRIP_DENSITY_TIERS[SpatialTier.L1].thumbnailIntervalSeconds).toBe(TEMPORAL_TIER_INTERVALS[TemporalTier.L1][0]);
    expect(FILMSTRIP_DENSITY_TIERS[SpatialTier.L2].thumbnailIntervalSeconds).toBe(TEMPORAL_TIER_INTERVALS[TemporalTier.L2][0]);
    expect(FILMSTRIP_DENSITY_TIERS[SpatialTier.L3].thumbnailIntervalSeconds).toBe(TEMPORAL_TIER_INTERVALS[TemporalTier.L3][0]);
  });
});

describe("generateViewportTileAddresses", () => {
  it("returns empty when clip is outside viewport", () => {
    const addresses = generateViewportTileAddresses({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      zoomTier: SpatialTier.L1,
      trimIn: 0,
      trimOut: 60,
      clipStartTime: 0,
      clipWidthPx: 3000, // 60s × 50 px/s
      viewportScrollLeft: 4000,
      viewportWidth: 1920,
      pixelsPerSecond: 50,
      overscanFactor: 2.0,
    });
    expect(addresses).toHaveLength(0);
  });

  it("generates fixed-grid addresses for visible portion", () => {
    const addresses = generateViewportTileAddresses({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      zoomTier: SpatialTier.L1, // 1s interval
      trimIn: 0,
      trimOut: 60,
      clipStartTime: 0,
      clipWidthPx: 3000,
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 50,
      overscanFactor: 1.0, // No overscan for predictability
    });

    // Visible range: 0s to 1920/50 = 38.4s → tiles at 1s intervals.
    expect(addresses.length).toBeGreaterThan(0);
    expect(addresses[0].clipId).toBe("clip-1");
    expect(addresses[0].zoomTier).toBe(SpatialTier.L1);

    // Check fixed intervals
    for (let i = 1; i < addresses.length; i++) {
      const delta = addresses[i].timestamp - addresses[i - 1].timestamp;
      expect(delta).toBe(1.0);
    }
  });

  it("uses overscan to include offscreen tiles", () => {
    const noOverscan = generateViewportTileAddresses({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      zoomTier: SpatialTier.L1,
      trimIn: 0,
      trimOut: 60,
      clipStartTime: 0,
      clipWidthPx: 3000,
      viewportScrollLeft: 0,
      viewportWidth: 1000,
      pixelsPerSecond: 50,
      overscanFactor: 1.0,
    });

    const withOverscan = generateViewportTileAddresses({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      zoomTier: SpatialTier.L1,
      trimIn: 0,
      trimOut: 60,
      clipStartTime: 0,
      clipWidthPx: 3000,
      viewportScrollLeft: 0,
      viewportWidth: 1000,
      pixelsPerSecond: 50,
      overscanFactor: 2.0,
    });

    expect(withOverscan.length).toBeGreaterThan(noOverscan.length);
  });

  it("clamps to trim range", () => {
    const addresses = generateViewportTileAddresses({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      zoomTier: SpatialTier.L1,
      trimIn: 10,
      trimOut: 20,
      clipStartTime: 0,
      clipWidthPx: 3000,
      viewportScrollLeft: 0,
      viewportWidth: 5000, // Wider than clip
      pixelsPerSecond: 50,
      overscanFactor: 1.0,
    });

    for (const addr of addresses) {
      expect(addr.timestamp).toBeGreaterThanOrEqual(10);
      expect(addr.timestamp).toBeLessThan(20);
    }
  });

  it("generates consistent addresses across zoom tiers", () => {
    // Same clip at different zoom tiers should have consistent grid alignment
    const l1 = generateViewportTileAddresses({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      zoomTier: SpatialTier.L1,
      trimIn: 0,
      trimOut: 60,
      clipStartTime: 0,
      clipWidthPx: 3000,
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 50,
      overscanFactor: 1.0,
    });

    const l2 = generateViewportTileAddresses({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      zoomTier: SpatialTier.L2,
      trimIn: 0,
      trimOut: 60,
      clipStartTime: 0,
      clipWidthPx: 3000,
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 50,
      overscanFactor: 1.0,
    });

    // L2 has finer grid (500ms) so more tiles
    expect(l2.length).toBeGreaterThan(l1.length);

    // But tiles at L1 timestamps should also exist in L2 (subset)
    const l1Timestamps = new Set(l1.map((a) => a.timestamp));
    const l2Timestamps = new Set(l2.map((a) => a.timestamp));
    for (const t of l1Timestamps) {
      expect(l2Timestamps).toContain(t);
    }
  });

  it("clamps timestamps to video duration when provided", () => {
    // Test short video (3 seconds) with the overview tier.
    const addresses = generateViewportTileAddresses({
      clipId: "clip-1",
      videoPath: "/short.mp4",
      zoomTier: SpatialTier.L0, // 2s interval
      trimIn: 0,
      trimOut: 60, // Trim allows up to 60s
      clipStartTime: 0,
      clipWidthPx: 3000,
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 50,
      overscanFactor: 1.0,
      videoDuration: 3.0, // But actual video is only 3s
    });

    // Should not request frames beyond 3 seconds
    for (const addr of addresses) {
      expect(addr.timestamp).toBeLessThanOrEqual(3.0);
    }

    // Should have at least one tile at timestamp 0
    expect(addresses.length).toBeGreaterThan(0);
    expect(addresses[0].timestamp).toBe(0);
  });

  it("respects video duration even when trimOut is larger", () => {
    const addresses = generateViewportTileAddresses({
      clipId: "clip-1",
      videoPath: "/medium.mp4",
      zoomTier: SpatialTier.L1, // 1s interval
      trimIn: 0,
      trimOut: 100, // Trim says 100s
      clipStartTime: 0,
      clipWidthPx: 5000,
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 50,
      overscanFactor: 1.0,
      videoDuration: 15.0, // But video is only 15s
    });

    // All timestamps should be <= 15s
    for (const addr of addresses) {
      expect(addr.timestamp).toBeLessThanOrEqual(15.0);
    }

    // Should have tiles in the 0s to 15s range at the L1 cadence.
    const timestamps = addresses.map((a) => a.timestamp);
    expect(timestamps).toContain(0);
    expect(timestamps.some((t) => t > 15.0)).toBe(false);
  });
});

describe("findNearestTileAddress", () => {
  it("finds nearest tile within tolerance", () => {
    const addresses = [
      { clipId: "c1", zoomTier: SpatialTier.L1, tileIndex: 0, timestamp: 0 },
      { clipId: "c1", zoomTier: SpatialTier.L1, tileIndex: 1, timestamp: 5 },
      { clipId: "c1", zoomTier: SpatialTier.L1, tileIndex: 2, timestamp: 10 },
    ];

    const nearest = findNearestTileAddress(6.2, addresses, 2.0);
    expect(nearest).not.toBeNull();
    expect(nearest!.timestamp).toBe(5);
  });

  it("returns null when no tile within tolerance", () => {
    const addresses = [
      { clipId: "c1", zoomTier: SpatialTier.L1, tileIndex: 0, timestamp: 0 },
      { clipId: "c1", zoomTier: SpatialTier.L1, tileIndex: 1, timestamp: 5 },
    ];

    const nearest = findNearestTileAddress(20, addresses, 1.0);
    expect(nearest).toBeNull();
  });
});

describe("getTileKey", () => {
  it("produces unique keys per address", () => {
    const a1 = { clipId: "c1", zoomTier: SpatialTier.L1, tileIndex: 0, timestamp: 0 };
    const a2 = { clipId: "c1", zoomTier: SpatialTier.L1, tileIndex: 1, timestamp: 5 };
    const a3 = { clipId: "c2", zoomTier: SpatialTier.L1, tileIndex: 0, timestamp: 0 };

    expect(getTileKey(a1)).toBe("c1:1:0");
    expect(getTileKey(a2)).toBe("c1:1:1");
    expect(getTileKey(a3)).toBe("c2:1:0");
    expect(getTileKey(a1)).not.toBe(getTileKey(a2));
  });
});
