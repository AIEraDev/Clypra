/**
 * Filmstrip Density Tiers
 *
 * FIXED interval grid for thumbnail generation.
 * Professional NLE behavior: zoom transitions reuse existing tiles
 * because timestamps are on a fixed grid, not dynamically calculated.
 *
 * Benefits over dynamic spacing:
 *   - Zoom transitions reuse existing tiles (no regeneration storms)
 *   - Predictable memory usage
 *   - Tile-level invalidation (not clip-level)
 *   - Scales to 2hr videos (bounded by viewport, not duration)
 */

import { SpatialTier, TEMPORAL_TIER_INTERVALS, TemporalTier } from "../renderEngine/types";

export interface FilmstripDensityTier {
  /** Thumbnail interval in seconds */
  readonly thumbnailIntervalSeconds: number;
}

/**
 * Fixed density tiers. Each spatial tier has a fixed thumbnail interval.
 * The interval determines how many thumbnails exist per second of video.
 */
export const FILMSTRIP_DENSITY_TIERS: Record<SpatialTier, FilmstripDensityTier> = {
  [SpatialTier.L0]: {
    thumbnailIntervalSeconds: TEMPORAL_TIER_INTERVALS[TemporalTier.L0][0],
  },
  [SpatialTier.L1]: {
    thumbnailIntervalSeconds: TEMPORAL_TIER_INTERVALS[TemporalTier.L1][0],
  },
  [SpatialTier.L2]: {
    thumbnailIntervalSeconds: TEMPORAL_TIER_INTERVALS[TemporalTier.L2][0],
  },
  [SpatialTier.L3]: {
    thumbnailIntervalSeconds: TEMPORAL_TIER_INTERVALS[TemporalTier.L3][0],
  },
};

/**
 * Tile address uniquely identifies a filmstrip tile.
 * Used for tile-level caching and invalidation.
 */
export interface FilmstripTileAddress {
  clipId: string;
  videoPath?: string; // Optional for compatibility; defaults to clipId in keying
  zoomTier: SpatialTier;
  tileIndex: number;
  /** The exact timestamp this tile represents (seconds) */
  timestamp: number;
}

/**
 * Generate tile addresses for a visible viewport using FIXED intervals.
 *
 * Unlike the old dynamic system, this uses a fixed grid per zoom tier,
 * so zooming in/out only adds/removes edge tiles — center tiles are reused.
 */
export function generateViewportTileAddresses(options: {
  clipId: string;
  videoPath: string;
  zoomTier: SpatialTier;
  trimIn: number;
  trimOut: number;
  clipStartTime: number;
  clipWidthPx: number;
  viewportScrollLeft: number;
  viewportWidth: number;
  pixelsPerSecond: number;
  overscanFactor: number;
  /** Optional: actual video duration to prevent requesting frames beyond video end */
  videoDuration?: number;
}): FilmstripTileAddress[] {
  const { clipId, videoPath, zoomTier, trimIn, trimOut, clipStartTime, clipWidthPx, viewportScrollLeft, viewportWidth, pixelsPerSecond, overscanFactor, videoDuration } = options;

  const interval = FILMSTRIP_DENSITY_TIERS[zoomTier].thumbnailIntervalSeconds;

  // Calculate visible time range
  const viewportStartPx = viewportScrollLeft;
  const viewportEndPx = viewportScrollLeft + viewportWidth;

  // Expand with overscan
  const overscanPx = (viewportWidth * (overscanFactor - 1)) / 2;
  const expandedStartPx = Math.max(0, viewportStartPx - overscanPx);
  const expandedEndPx = viewportEndPx + overscanPx;

  // Clip bounds in timeline space
  const clipStartPx = clipStartTime * pixelsPerSecond;
  const clipEndPx = clipStartPx + clipWidthPx;

  // Check if clip is visible
  if (clipEndPx < expandedStartPx || clipStartPx > expandedEndPx) {
    return []; // Clip not in viewport
  }

  // Calculate visible portion of clip
  const visibleClipStartPx = Math.max(clipStartPx, expandedStartPx);
  const visibleClipEndPx = Math.min(clipEndPx, expandedEndPx);

  // Convert to clip-local time
  const visibleStartTime = (visibleClipStartPx - clipStartPx) / pixelsPerSecond + trimIn;
  const visibleEndTime = (visibleClipEndPx - clipStartPx) / pixelsPerSecond + trimIn;

  // Clamp to trim range (and video duration if provided)
  const effectiveEnd = videoDuration !== undefined ? Math.min(trimOut, videoDuration) : trimOut;
  const start = Math.max(trimIn, Math.min(visibleStartTime, effectiveEnd));
  const end = Math.max(trimIn, Math.min(visibleEndTime, effectiveEnd));

  if (end <= start) return [];

  // Generate tile addresses on FIXED grid
  const addresses: FilmstripTileAddress[] = [];
  let tileIndex = 0;

  // Align to grid: round start DOWN to nearest interval boundary
  const gridStart = Math.floor(start / interval) * interval;

  for (let t = gridStart; t < end; t += interval) {
    // Clamp timestamp to effective range (respecting video duration)
    const timestamp = Math.min(Math.max(t, trimIn), effectiveEnd);
    if (timestamp < start) continue; // Skip tiles before visible region
    if (timestamp >= end) break;

    addresses.push({
      clipId,
      videoPath,
      zoomTier,
      tileIndex: tileIndex++,
      timestamp,
    });
  }

  return addresses;
}

/**
 * Get the tile key for a given address. Used for Map-based cache lookups.
 */
export function getTileKey(address: FilmstripTileAddress): string {
  if (address.videoPath) {
    return `${address.videoPath}:${address.zoomTier}:${address.timestamp.toFixed(3)}`;
  }
  return `${address.clipId}:${address.zoomTier}:${address.tileIndex}`;
}

/**
 * Find the nearest cached tile address within a time tolerance.
 * Used for "aggressive cheating" — showing a slightly wrong tile is better
 * than showing nothing during scroll.
 */
export function findNearestTileAddress(targetTimestamp: number, addresses: FilmstripTileAddress[], toleranceSeconds: number = 0.5): FilmstripTileAddress | null {
  let nearest: FilmstripTileAddress | null = null;
  let nearestDelta = Infinity;

  for (const addr of addresses) {
    const delta = Math.abs(addr.timestamp - targetTimestamp);
    if (delta <= toleranceSeconds && delta < nearestDelta) {
      nearest = addr;
      nearestDelta = delta;
    }
  }

  return nearest;
}
