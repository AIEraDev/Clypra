import { SpatialTier, SPATIAL_TIER_DIMS } from "../renderEngine/types";

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
