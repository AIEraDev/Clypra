import { computeTemporalTierFromDensity } from "../renderEngine/tsp";
import { DEFAULT_SRP_CONFIG, SpatialTier, TEMPORAL_TIER_INTERVALS, TemporalTier, type SrpConfig } from "../renderEngine/types";

export const TIMELINE_ZOOM_STEP = 0.1;
export const TIMELINE_ZOOM_DEFAULT = DEFAULT_SRP_CONFIG[SpatialTier.L1].min;
export const BASE_TIMELINE_DENSITY_PPS = 100;
export const TIMELINE_PPS_PER_ZOOM = BASE_TIMELINE_DENSITY_PPS;
export const TIMELINE_TIER_SNAP_EPSILON = 0.04;
/** Timeline-only floor for fitting long sequences below the render tier range. */
export const TIMELINE_OVERVIEW_ZOOM_MIN = 0.000001;

export const TIMELINE_TIER_LABELS: Record<SpatialTier, string> = {
  [SpatialTier.L0]: "Overview",
  [SpatialTier.L1]: "Standard",
  [SpatialTier.L2]: "Detail",
  [SpatialTier.L3]: "Frame",
};

export const TIMELINE_TEMPORAL_LABELS: Record<TemporalTier, string> = {
  [TemporalTier.L0]: "Sparse cadence",
  [TemporalTier.L1]: "Readable cadence",
  [TemporalTier.L2]: "Edit cadence",
  [TemporalTier.L3]: "Frame cadence",
};

export function getTimelineZoomMin(config: SrpConfig = DEFAULT_SRP_CONFIG): number {
  return Math.min(TIMELINE_OVERVIEW_ZOOM_MIN, ...Object.values(config).map((boundary) => boundary.min));
}

export function getTimelineZoomMax(config: SrpConfig = DEFAULT_SRP_CONFIG): number {
  return Math.max(...Object.values(config).map((boundary) => boundary.max));
}

export const TIMELINE_ZOOM_MIN = getTimelineZoomMin();
export const TIMELINE_ZOOM_MAX = getTimelineZoomMax();
export const TIMELINE_MIN_PPS = TIMELINE_ZOOM_MIN * TIMELINE_PPS_PER_ZOOM;
export const TIMELINE_MAX_PPS = TIMELINE_ZOOM_MAX * TIMELINE_PPS_PER_ZOOM;
const LOG_ZOOM_MIN = Math.log2(TIMELINE_ZOOM_MIN);
const LOG_ZOOM_MAX = Math.log2(TIMELINE_ZOOM_MAX);

export function clampTimelineZoom(zoom: number): number {
  const val = typeof zoom === "number" && !isNaN(zoom) ? zoom : TIMELINE_ZOOM_DEFAULT;
  return Math.min(TIMELINE_ZOOM_MAX, Math.max(TIMELINE_ZOOM_MIN, val));
}

export function clampTimelinePixelsPerSecond(pps: number): number {
  const val = typeof pps === "number" && !isNaN(pps) ? pps : TIMELINE_ZOOM_DEFAULT * TIMELINE_PPS_PER_ZOOM;
  return Math.min(TIMELINE_MAX_PPS, Math.max(TIMELINE_MIN_PPS, val));
}

// Zoom is logarithmic in interaction space, while SRP boundaries remain absolute.
export function getSrpTierForZoom(zoom: number, config: SrpConfig = DEFAULT_SRP_CONFIG): SpatialTier {
  const tiers = Object.keys(config)
    .map(Number)
    .sort((a, b) => a - b) as SpatialTier[];

  for (const tier of tiers) {
    const boundary = config[tier];
    if (zoom >= boundary.min && zoom < boundary.max) {
      return tier;
    }
  }

  return zoom < config[tiers[0]].min ? tiers[0] : tiers[tiers.length - 1];
}

export function getZoomRatio(zoom: number): number {
  const clamped = clampTimelineZoom(zoom);
  return (Math.log2(clamped) - LOG_ZOOM_MIN) / (LOG_ZOOM_MAX - LOG_ZOOM_MIN);
}

export function getZoomFromRatio(ratio: number): number {
  const clampedRatio = Math.min(1, Math.max(0, ratio));
  return 2 ** (LOG_ZOOM_MIN + clampedRatio * (LOG_ZOOM_MAX - LOG_ZOOM_MIN));
}

export function snapTimelineZoomToTierAnchors(zoom: number, config: SrpConfig = DEFAULT_SRP_CONFIG): number {
  const clamped = clampTimelineZoom(zoom);
  const anchors = Array.from(new Set([TIMELINE_ZOOM_MIN, TIMELINE_ZOOM_MAX, ...Object.values(config).flatMap((boundary) => [boundary.min, boundary.max])])).sort((a, b) => a - b);

  return anchors.find((anchor) => Math.abs(clamped - anchor) <= TIMELINE_TIER_SNAP_EPSILON) ?? clamped;
}

export function getTimelineTemporalDetail(pixelsPerSecond: number): {
  temporalTier: TemporalTier;
  label: string;
  baseInterval: number;
} {
  const temporalTier = computeTemporalTierFromDensity(pixelsPerSecond);
  return {
    temporalTier,
    label: TIMELINE_TEMPORAL_LABELS[temporalTier],
    baseInterval: TEMPORAL_TIER_INTERVALS[temporalTier][0],
  };
}

export function formatCadenceSeconds(seconds: number): string {
  return seconds >= 1 ? `${seconds.toFixed(seconds % 1 === 0 ? 0 : 1)}s` : `${Math.round(seconds * 1000)}ms`;
}
