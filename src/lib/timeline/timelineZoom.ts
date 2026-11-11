import { computeTemporalTierFromDensity } from "../renderEngine/tsp";
import {
  DEFAULT_SRP_CONFIG,
  SpatialTier,
  TEMPORAL_TIER_INTERVALS,
  TemporalTier,
  type SrpConfig,
} from "../renderEngine/types";

export const TIMELINE_ZOOM_STEP = 0.1;
export const TIMELINE_ZOOM_GEOMETRIC_FACTOR = 1.25;
export const TIMELINE_ZOOM_DEFAULT = 1.0;
export const TIMELINE_PPS_PER_ZOOM = 100;
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

export const TIMELINE_MAX_PX_PER_FRAME = 200;
/**
 * Safe upper bound on timeline scroll content width (in CSS px) to prevent
 * layout overflow in WebKit/WKWebView (WebKit LayoutUnit 32-bit fixed point limit is 33,554,431 px).
 */
export const MAX_SAFE_SCROLL_WIDTH_PX = 32_000_000;

export function getTimelineMaxPps(
  frameRate: number = 30,
  sequenceDuration?: number,
): number {
  const safeFps =
    Number.isFinite(frameRate) && frameRate > 0 ? Math.round(frameRate) : 30;
  const baseMax = TIMELINE_MAX_PX_PER_FRAME * safeFps;
  if (typeof sequenceDuration === "number" && sequenceDuration > 0) {
    const canvasDuration = sequenceDuration + 2;
    const durationCapped = Math.floor(
      MAX_SAFE_SCROLL_WIDTH_PX / canvasDuration,
    );
    return Math.max(TIMELINE_MIN_PPS, Math.min(baseMax, durationCapped));
  }
  return baseMax;
}

export function getTimelineZoomMax(
  frameRate: number = 30,
  sequenceDuration?: number,
): number {
  return getTimelineMaxPps(frameRate, sequenceDuration) / TIMELINE_PPS_PER_ZOOM;
}

export function getTimelineZoomMin(
  config: SrpConfig = DEFAULT_SRP_CONFIG,
): number {
  return Math.min(...Object.values(config).map((boundary) => boundary.min));
}

export const TIMELINE_ZOOM_MIN = getTimelineZoomMin(); // 0.1
export const TIMELINE_ZOOM_MAX = getTimelineZoomMax(30); // 60.0 (6,000 px/s @ 30fps)
export const TIMELINE_MIN_PPS = TIMELINE_ZOOM_MIN * TIMELINE_PPS_PER_ZOOM; // 10 px/s
export const TIMELINE_MAX_PPS = TIMELINE_ZOOM_MAX * TIMELINE_PPS_PER_ZOOM; // 6,000 px/s
const LOG_ZOOM_MIN = Math.log2(TIMELINE_ZOOM_MIN);

export function clampTimelineZoom(
  zoom: number,
  frameRate: number = 30,
  sequenceDuration?: number,
): number {
  const maxZoom = getTimelineZoomMax(frameRate, sequenceDuration);
  const val =
    typeof zoom === "number" && !isNaN(zoom) ? zoom : TIMELINE_ZOOM_DEFAULT;
  return Math.min(maxZoom, Math.max(TIMELINE_ZOOM_MIN, val));
}

export function clampTimelinePixelsPerSecond(
  pps: number,
  allowOverviewFloor = false,
  frameRate: number = 30,
  sequenceDuration?: number,
): number {
  const maxPps = getTimelineMaxPps(frameRate, sequenceDuration);
  const minPps = allowOverviewFloor
    ? TIMELINE_OVERVIEW_ZOOM_MIN * TIMELINE_PPS_PER_ZOOM
    : TIMELINE_MIN_PPS;
  const val =
    typeof pps === "number" && !isNaN(pps)
      ? pps
      : TIMELINE_ZOOM_DEFAULT * TIMELINE_PPS_PER_ZOOM;
  if (Math.abs(val - maxPps) < 0.001) return maxPps;
  if (Math.abs(val - minPps) < 1e-7) return val;
  return Math.min(maxPps, Math.max(minPps, val));
}

/**
 * Calculates discrete mouse-wheel zoom target PPS by compounding geometric notch steps.
 * Replaces the continuous 0.22 clamp with a reference-calibrated 7-notch traversal from min to max.
 */
export function calculateDiscreteWheelZoomTarget(
  basePps: number,
  notches: number,
  frameRate: number = 30,
  sequenceDuration?: number,
): number {
  const maxPps = getTimelineMaxPps(frameRate, sequenceDuration);
  const nominalMin = TIMELINE_MIN_PPS; // 10 px/s
  const notchStep = Math.pow(maxPps / nominalMin, 1 / 7);
  const factor = Math.pow(notchStep, Math.abs(notches));
  // If basePps is already below nominalMin (e.g. Fit Sequence overview density),
  // allowOverviewFloor is enabled so zooming out honors the overview density
  // and does not violate invariant by jumping inward to 10 px/s.
  const allowOverviewFloor = basePps < nominalMin;
  return clampTimelinePixelsPerSecond(
    notches > 0 ? basePps * factor : basePps / factor,
    allowOverviewFloor,
    frameRate,
    sequenceDuration,
  );
}

// Zoom is logarithmic in interaction space, while SRP boundaries remain absolute.
export function getSrpTierForZoom(
  zoom: number,
  config: SrpConfig = DEFAULT_SRP_CONFIG,
): SpatialTier {
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

export function getZoomRatio(
  zoom: number,
  frameRate: number = 30,
  sequenceDuration?: number,
): number {
  const maxZoom = getTimelineZoomMax(frameRate, sequenceDuration);
  const logZoomMax = Math.log2(maxZoom);
  const clamped = clampTimelineZoom(zoom, frameRate, sequenceDuration);
  return (Math.log2(clamped) - LOG_ZOOM_MIN) / (logZoomMax - LOG_ZOOM_MIN);
}

export function getZoomFromRatio(
  ratio: number,
  frameRate: number = 30,
  sequenceDuration?: number,
): number {
  const maxZoom = getTimelineZoomMax(frameRate, sequenceDuration);
  const logZoomMax = Math.log2(maxZoom);
  const clampedRatio = Math.min(1, Math.max(0, ratio));
  return 2 ** (LOG_ZOOM_MIN + clampedRatio * (logZoomMax - LOG_ZOOM_MIN));
}

export function snapTimelineZoomToTierAnchors(
  zoom: number,
  config: SrpConfig = DEFAULT_SRP_CONFIG,
  frameRate: number = 30,
  sequenceDuration?: number,
): number {
  const maxZoom = getTimelineZoomMax(frameRate, sequenceDuration);
  const clamped = clampTimelineZoom(zoom, frameRate, sequenceDuration);
  const anchors = Array.from(
    new Set([
      TIMELINE_ZOOM_MIN,
      maxZoom,
      ...Object.values(config).flatMap((boundary) => [
        boundary.min,
        boundary.max,
      ]),
    ]),
  ).sort((a, b) => a - b);

  return (
    anchors.find(
      (anchor) => Math.abs(clamped - anchor) <= TIMELINE_TIER_SNAP_EPSILON,
    ) ?? clamped
  );
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
  return seconds >= 1
    ? `${seconds.toFixed(seconds % 1 === 0 ? 0 : 1)}s`
    : `${Math.round(seconds * 1000)}ms`;
}
