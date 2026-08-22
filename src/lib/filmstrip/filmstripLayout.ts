import { SpatialTier, SPATIAL_TIER_DIMS } from "../renderEngine/types";
import { FILMSTRIP_DENSITY_TIERS, type FilmstripTileAddress } from "./filmstripTiers";

/**
 * Professional timeline filmstrips keep a stable visual tile cadence in screen
 * pixels. Zoom changes the represented source-time span and decode tier, not
 * the width of each visible thumbnail slot.
 *
 * Set to 50px to match CapCut's compact filmstrip design with high frame density.
 */
export const DEFAULT_FILMSTRIP_TILE_WIDTH_PX = 50;
export const MAX_FILMSTRIP_SLOT_SAMPLES = 240;

export const FILMSTRIP_TILE_WIDTH_BY_TIER: Record<SpatialTier, number> = {
  [SpatialTier.L0]: DEFAULT_FILMSTRIP_TILE_WIDTH_PX,
  [SpatialTier.L1]: DEFAULT_FILMSTRIP_TILE_WIDTH_PX,
  [SpatialTier.L2]: DEFAULT_FILMSTRIP_TILE_WIDTH_PX,
  [SpatialTier.L3]: DEFAULT_FILMSTRIP_TILE_WIDTH_PX,
};

export function getFrameAspectRatio(width?: number, height?: number): number | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || !width || !height) {
    return null;
  }

  return width / height;
}

export function getFilmstripTileWidthForTier(spatialTier: SpatialTier | null | undefined): number {
  if (spatialTier === null || spatialTier === undefined) return DEFAULT_FILMSTRIP_TILE_WIDTH_PX;
  return FILMSTRIP_TILE_WIDTH_BY_TIER[spatialTier] ?? DEFAULT_FILMSTRIP_TILE_WIDTH_PX;
}

export function getReadableFilmstripTier(baseTier: SpatialTier, tileWidthPx: number, stripHeightPx: number, dpr: number): SpatialTier {
  const requiredWidth = tileWidthPx * dpr;
  const requiredHeight = stripHeightPx * dpr;
  const tiers = [SpatialTier.L0, SpatialTier.L1, SpatialTier.L2, SpatialTier.L3];
  const readableTier =
    tiers.find((tier) => {
      const [width, height] = SPATIAL_TIER_DIMS[tier];
      return width >= requiredWidth && height >= requiredHeight;
    }) ?? SpatialTier.L3;

  return Math.max(baseTier, readableTier) as SpatialTier;
}

export function computeFilmstripTileCount(clipWidthPx: number, tileWidthPx: number): number {
  if (!Number.isFinite(clipWidthPx) || clipWidthPx <= 0) return 1;
  if (!Number.isFinite(tileWidthPx) || tileWidthPx <= 0) return 1;
  return Math.max(1, Math.ceil(clipWidthPx / tileWidthPx));
}

export interface FilmstripRenderWindow {
  /** Offset inside the full clip where the bounded surface is positioned. */
  leftPx: number;
  /** Width of the bounded surface in CSS pixels. */
  widthPx: number;
  /** Source time represented by the left edge of the surface. */
  trimIn: number;
  /** Source time represented by the right edge of the surface. */
  trimOut: number;
  /** Whether the clip intersects the current timeline viewport. */
  isVisible: boolean;
}

export interface FilmstripTileSlot {
  address: FilmstripTileAddress;
  /** Left edge in CSS pixels within the bounded render window. */
  leftPx: number;
  /** Temporal coverage width in CSS pixels for this exact sampled frame. */
  widthPx: number;
}

/**
 * Convert exact source-time tile addresses into deterministic fixed-width
 * visual slots. The timestamp is used only for the address match; position is
 * carried by the ordered slot metadata so renderers never infer or substitute
 * a nearest frame. The final slot is clipped by the surface bounds.
 */
export function getFilmstripTileSlots(options: {
  addresses: readonly FilmstripTileAddress[];
  clipWidthPx: number;
  trimIn: number;
  trimOut: number;
  tileWidthPx: number;
  pixelsPerSecond?: number;
  renderWindowLeftPx?: number;
  clipTrimIn?: number;
}): FilmstripTileSlot[] {
  const { addresses, clipWidthPx, trimIn, trimOut, tileWidthPx, pixelsPerSecond, renderWindowLeftPx = 0, clipTrimIn } = options;
  const start = Math.min(trimIn, trimOut);
  const end = Math.max(trimIn, trimOut);
  if (!Number.isFinite(clipWidthPx) || clipWidthPx <= 0 || end - start <= 0 || !Number.isFinite(tileWidthPx) || tileWidthPx <= 0) {
    return [];
  }

  const baseTrimIn = clipTrimIn !== undefined ? clipTrimIn : start;
  const pps = pixelsPerSecond !== undefined && pixelsPerSecond > 0 ? pixelsPerSecond : (clipWidthPx / (end - start));

  // Include any tile whose coverage interval [t, t + interval] overlaps [start, end]
  const sorted = [...addresses]
    .filter((address) => {
      const interval = FILMSTRIP_DENSITY_TIERS[address.zoomTier]?.thumbnailIntervalSeconds ?? 1.0;
      const tileEnd = address.timestamp + interval;
      return address.timestamp <= end && tileEnd >= start;
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  return sorted.map((address) => {
    const clipLeftPx = (address.timestamp - baseTrimIn) * pps;
    const canvasLeftPx = clipLeftPx - renderWindowLeftPx;

    return {
      address,
      leftPx: canvasLeftPx,
      widthPx: tileWidthPx,
    };
  });
}

/**
 * Compute a bounded render surface for a filmstrip.
 *
 * The clip itself may be tens of thousands of CSS pixels wide at deep zoom.
 * A canvas of that width is not portable: its device-pixel backing store can
 * exceed Safari/WebGL limits even though the DOM element remains valid. Keep
 * the surface local to the viewport (plus the same 1x overscan used by tile
 * requests) and position it inside the full-width clip instead.
 */
export function getFilmstripRenderWindow(options: {
  clipStartTime: number;
  clipWidthPx: number;
  trimIn: number;
  trimOut: number;
  viewportScrollLeft: number;
  viewportWidth: number;
  pixelsPerSecond: number;
}): FilmstripRenderWindow {
  const safeClipWidth = Number.isFinite(options.clipWidthPx) && options.clipWidthPx > 0 ? options.clipWidthPx : 1;
  const safePps = Number.isFinite(options.pixelsPerSecond) && options.pixelsPerSecond > 0 ? options.pixelsPerSecond : 1;
  const safeScrollLeft = Number.isFinite(options.viewportScrollLeft) ? Math.max(0, options.viewportScrollLeft) : 0;
  const safeViewportWidth = Number.isFinite(options.viewportWidth) && options.viewportWidth > 0 ? options.viewportWidth : 1;
  const clipStartPx = (Number.isFinite(options.clipStartTime) ? options.clipStartTime : 0) * safePps;
  const viewportEndPx = safeScrollLeft + safeViewportWidth;
  const overscanPx = safeViewportWidth * 0.5;

  const rawStartPx = safeScrollLeft - clipStartPx - overscanPx;
  const rawEndPx = viewportEndPx - clipStartPx + overscanPx;
  const leftPx = Math.max(0, Math.min(safeClipWidth, rawStartPx));
  const rightPx = Math.max(leftPx, Math.min(safeClipWidth, rawEndPx));
  const isVisible = rightPx > leftPx;
  const widthPx = isVisible ? Math.max(1, rightPx - leftPx) : 1;

  if (!isVisible) {
    return {
      leftPx,
      widthPx,
      trimIn: options.trimIn,
      trimOut: options.trimIn,
      isVisible: false,
    };
  }

  return {
    leftPx,
    widthPx,
    trimIn: Math.max(options.trimIn, options.trimIn + leftPx / safePps),
    trimOut: Math.min(options.trimOut, options.trimIn + rightPx / safePps),
    isVisible: true,
  };
}

export function generateFilmstripSlotTimestamps(options: { trimIn: number; trimOut: number; duration: number; clipWidthPx: number; tileWidthPx: number }): number[] {
  const { duration, clipWidthPx, tileWidthPx } = options;
  const start = Math.min(Math.max(options.trimIn, 0), duration);
  const end = Math.min(Math.max(options.trimOut, start), duration);
  const span = end - start;
  if (!Number.isFinite(span) || span <= 0) return [];

  const tileCount = computeFilmstripTileCount(clipWidthPx, tileWidthPx);
  const sampleCount = Math.min(tileCount, MAX_FILMSTRIP_SLOT_SAMPLES);
  const timestamps: number[] = [];

  for (let i = 0; i < sampleCount; i++) {
    const ratio = (i + 0.5) / sampleCount;
    const timestamp = Math.round((start + span * ratio) * 1000) / 1000;
    timestamps.push(Math.min(Math.max(timestamp, 0), duration));
  }

  return Array.from(new Set(timestamps)).sort((a, b) => a - b);
}
