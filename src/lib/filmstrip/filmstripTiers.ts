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
import { timeToPixel, pixelToTime } from "../timeline/timelineViewport";
import type { RenderEpochId } from "../renderEngine/types";
import type { TransportArtifact } from "../renderEngine/transport";


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
  /** Visual effect graph version (e.g. Color grade/LUT/Filter) */
  effectGraphVersion?: number;
}

/**
 * Canonical unified tile key across TypeScript and Rust.
 * Format: videoPath:spatialTier:timestampMs:effectGraphVersion
 */
export function getCanonicalTileKey(options: {
  videoPath: string;
  timestampMs: number;
  spatialTier: SpatialTier;
  effectGraphVersion?: number;
}): string {
  const version = options.effectGraphVersion ?? 1;
  return `${options.videoPath}:${options.spatialTier}:${Math.round(options.timestampMs)}:v${version}`;
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

  // Clip bounds in timeline space — use timeToPixel for rounded pixel-grid consistency.
  const clipStartPx = timeToPixel(clipStartTime, pixelsPerSecond);
  const clipEndPx = clipStartPx + clipWidthPx;

  // Check if clip is visible
  if (clipEndPx < expandedStartPx || clipStartPx > expandedEndPx) {
    return []; // Clip not in viewport
  }

  // Calculate visible portion of clip
  const visibleClipStartPx = Math.max(clipStartPx, expandedStartPx);
  const visibleClipEndPx = Math.min(clipEndPx, expandedEndPx);

  // Convert to clip-local time — use pixelToTime for canonical inverse.
  const visibleStartTime = pixelToTime(visibleClipStartPx - clipStartPx, pixelsPerSecond) + trimIn;
  const visibleEndTime = pixelToTime(visibleClipEndPx - clipStartPx, pixelsPerSecond) + trimIn;


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
    // Clamp timestamp to effective range (respecting video duration) and round to prevent float precision drift
    const rawTimestamp = Math.min(Math.max(t, trimIn), effectiveEnd);
    const timestamp = Math.round(rawTimestamp * 10000) / 10000;
    if (timestamp >= end && t > gridStart) break;

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
 *
 * Use integer milliseconds for timestamp to avoid floating-point rounding
 * issues that cause cache key mismatches. toFixed(3) can produce different strings for
 * mathematically equal values due to IEEE 754 rounding.
 */
export function getTileKey(address: FilmstripTileAddress): string {
  const versionSuffix = address.effectGraphVersion !== undefined ? `:v${address.effectGraphVersion}` : "";
  if (address.videoPath) {
    // Convert to integer milliseconds to avoid floating-point precision issues
    const timestampMs = Math.round(address.timestamp * 1000);
    return `${address.videoPath}:${address.zoomTier}:${timestampMs}${versionSuffix}`;
  }
  return `${address.clipId}:${address.zoomTier}:${address.tileIndex}${versionSuffix}`;
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

/**
 * A filmstrip can be committed only when every requested address has an
 * artifact from the active epoch and spatial tier. Partial sets are kept in
 * cache but must not be rendered into a new layout.
 */
export function hasExactFilmstripArtifacts(
  artifacts: readonly TransportArtifact[],
  addresses: readonly FilmstripTileAddress[],
  epochId: RenderEpochId,
  spatialTier: SpatialTier,
): boolean {
  if (addresses.length === 0) return false;

  const matching = new Set(
    artifacts
      .filter(
        (artifact) =>
          artifact.epochId === epochId &&
          artifact.spatialTier === spatialTier &&
          !!artifact.bitmap &&
          artifact.bitmap.width > 0 &&
          artifact.bitmap.height > 0,
      )
      .map((artifact) => Math.round(artifact.timestampMs)),
  );

  return addresses.every((address) => matching.has(Math.round(address.timestamp * 1000)));
}
