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
 * Generate tile addresses for a visible viewport using a PIXEL-GRID model.
 *
 * Each tile occupies exactly `tileWidthPx` screen pixels. The tile count is
 * driven by the clip's pixel width — not by a fixed temporal interval. This
 * is the same model used by CapCut, Premiere Pro, and DaVinci Resolve:
 *
 *   - Zooming in → clip is wider → more tiles, each showing a narrower time slice
 *   - Zooming out → clip is narrower → fewer tiles, each covering more time
 *   - Tile width on screen NEVER changes
 *   - No gaps (ceil ensures full coverage), no stretching (all tiles identical width)
 *
 * `tileIndex` is the pixel-grid index: tile i starts at `i × tileWidthPx` clip-local pixels.
 * `getFilmstripTileSlots` uses `address.tileIndex × tileWidthPx - renderWindowLeftPx` for
 * the canvas-local left position, so every tile lands exactly where it should.
 *
 * The `zoomTier` (SpatialTier) controls the decode RESOLUTION only (L0=160px, L3=480px).
 * It no longer drives tile density.
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
  /** Fixed tile width in CSS pixels — default 50. Must match tileWidthPx used by the renderer. */
  tileWidthPx?: number;
}): FilmstripTileAddress[] {
  const {
    clipId, videoPath, zoomTier,
    trimIn, trimOut,
    clipStartTime, clipWidthPx,
    viewportScrollLeft, viewportWidth,
    pixelsPerSecond, overscanFactor,
    videoDuration,
    tileWidthPx = 50,
  } = options;

  // ── Viewport visibility check ─────────────────────────────────────────────

  const clipStartPx = timeToPixel(clipStartTime, pixelsPerSecond);
  const clipEndPx = clipStartPx + clipWidthPx;

  const overscanPx = (viewportWidth * (overscanFactor - 1)) / 2;
  const expandedStartPx = Math.max(0, viewportScrollLeft - overscanPx);
  const expandedEndPx = viewportScrollLeft + viewportWidth + overscanPx;

  if (clipEndPx < expandedStartPx || clipStartPx > expandedEndPx) {
    return []; // clip not in viewport
  }

  // ── Clip-local pixel range of the visible (+ overscan) region ────────────

  // Pixels relative to clip left edge
  const visClipStartPx = Math.max(0, expandedStartPx - clipStartPx);
  const visClipEndPx   = Math.min(clipWidthPx, expandedEndPx - clipStartPx);

  if (visClipEndPx <= visClipStartPx) return [];

  // Effective time boundary (respects video duration)
  const effectiveEnd = videoDuration !== undefined ? Math.min(trimOut, videoDuration) : trimOut;

  // ── Pixel-grid tile indices for the visible region ───────────────────────

  // First tile whose left edge is at or before visClipStartPx
  const firstTileIndex = Math.floor(visClipStartPx / tileWidthPx);
  // Last tile whose left edge is before visClipEndPx
  const lastTileIndex  = Math.ceil(visClipEndPx / tileWidthPx) - 1;

  const addresses: FilmstripTileAddress[] = [];

  for (let i = firstTileIndex; i <= lastTileIndex; i++) {
    // Pixel position of this tile's left edge (clip-local)
    const tileLeftPx = i * tileWidthPx;

    // Derive timestamp from pixel position: left edge of tile → time
    const rawTimestamp = trimIn + pixelToTime(tileLeftPx, pixelsPerSecond);

    // Clamp to [trimIn, effectiveEnd] and round to avoid float drift
    const clampedTimestamp = Math.min(Math.max(rawTimestamp, trimIn), effectiveEnd);
    const timestamp = Math.round(clampedTimestamp * 10000) / 10000;

    // Skip tiles that are entirely beyond the effective time range
    if (rawTimestamp > effectiveEnd) break;

    addresses.push({
      clipId,
      videoPath,
      zoomTier,
      tileIndex: i,   // pixel-grid index — used by getFilmstripTileSlots for positioning
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
