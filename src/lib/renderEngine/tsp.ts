/**
 * Temporal Sampling Policy (TSP)
 *
 * Maps viewport density → TemporalTier + sampling grid.
 * Emits: { temporalTier, samplingGrid, frameTimestamps }
 *
 * Rules (R1):
 *   - Adaptive intervals per tier
 *   - Motion-aware: 1.5× density in high-motion regions (Phase 1: stub)
 *   - Edit-boundary forced: 0.12s precision within 0.5s of a cut
 *   - VFR normalization included in Frame_Content_Hash (handled by backend)
 */

import { TemporalTier, TEMPORAL_TIER_INTERVALS, HIGH_MOTION_DENSITY_MULTIPLIER, EDIT_BOUNDARY_SAMPLE_INTERVAL, EDIT_BOUNDARY_WINDOW, InteractionState, type CanonicalFrameTimestamp } from "./types";

// ─── TSP Result ───────────────────────────────────────────────────────────────

export interface TspResult {
  readonly temporalTier: TemporalTier;
  /** Base interval in seconds between frames at this tier. */
  readonly baseInterval: number;
  /** Interval used near edit boundaries. */
  readonly nearEditInterval: number;
  /** Ordered canonical timestamps for the requested range. */
  readonly frameTimestamps: readonly CanonicalFrameTimestamp[];
}

// ─── Edit Boundary ────────────────────────────────────────────────────────────

export interface EditBoundary {
  /** Cut point in source time (seconds). */
  readonly time: number;
}

// ─── Tier Selection ───────────────────────────────────────────────────────────

/**
 * Map viewport density (pixels per second) to a TemporalTier.
 * Mirrors SpatialTier levels so L0 spatial → L0 temporal by default (R1).
 */
export function computeTemporalTierFromDensity(viewportDensity: number): TemporalTier {
  // Pixel density thresholds derived from spec R1 interval targets
  // At L0: one thumbnail per 2–4s → thumb fills ~320–640px at 160px wide
  if (viewportDensity < 40) return TemporalTier.L0;
  if (viewportDensity < 120) return TemporalTier.L1;
  if (viewportDensity < 320) return TemporalTier.L2;
  return TemporalTier.L3;
}

// ─── Sampling Grid ────────────────────────────────────────────────────────────

/**
 * Round a timestamp to millisecond precision.
 * Prevents float accumulation drift at Ultra density (uses multiplication, not accumulation).
 */
function roundMs(t: number): CanonicalFrameTimestamp {
  return Math.round(t * 1000) / 1000;
}

/**
 * Generate globally-aligned canonical frame timestamps for a clip range.
 *
 * Alignment: floor(trimIn / interval) × interval — ensures clips from the
 * same video at the same density share cached frames.
 *
 * Edit-boundary forcing: inserts 0.12s-precision samples within 0.5s of any cut.
 *
 * @param trimIn       Source time start (seconds).
 * @param trimOut      Source time end (seconds).
 * @param tier         Temporal tier.
 * @param videoDuration Total duration of source video.
 * @param editBoundaries Known cut points in source time.
 * @param isHighMotion  Whether this region is flagged as high-motion (Phase 1: stub).
 */
export function generateSamplingGrid(trimIn: number, trimOut: number, tier: TemporalTier, videoDuration: number, editBoundaries: readonly EditBoundary[] = [], isHighMotion = false): readonly CanonicalFrameTimestamp[] {
  const [baseInterval] = TEMPORAL_TIER_INTERVALS[tier];

  // Motion-aware density (Phase 1: stub — isHighMotion always false from caller)
  const effectiveInterval = isHighMotion ? baseInterval / HIGH_MOTION_DENSITY_MULTIPLIER : baseInterval;

  const gridStart = Math.floor(trimIn / effectiveInterval) * effectiveInterval;

  const seen = new Set<number>();
  const timestamps: CanonicalFrameTimestamp[] = [];

  // Base grid
  let step = 0;
  while (true) {
    const t = roundMs(gridStart + step * effectiveInterval);
    if (t > trimOut) break;
    const clamped = roundMs(Math.min(Math.max(t, 0), videoDuration));
    if (!seen.has(clamped)) {
      seen.add(clamped);
      timestamps.push(clamped);
    }
    step++;
  }

  // Edit-boundary forced samples (R1)
  for (const boundary of editBoundaries) {
    const { time } = boundary;
    if (time < trimIn - EDIT_BOUNDARY_WINDOW || time > trimOut + EDIT_BOUNDARY_WINDOW) continue;

    const windowStart = Math.max(trimIn, time - EDIT_BOUNDARY_WINDOW);
    const windowEnd = Math.min(trimOut, time + EDIT_BOUNDARY_WINDOW);

    let bt = Math.floor(windowStart / EDIT_BOUNDARY_SAMPLE_INTERVAL) * EDIT_BOUNDARY_SAMPLE_INTERVAL;
    while (bt <= windowEnd) {
      const clamped = roundMs(Math.min(Math.max(bt, 0), videoDuration));
      if (!seen.has(clamped)) {
        seen.add(clamped);
        timestamps.push(clamped);
      }
      bt = roundMs(bt + EDIT_BOUNDARY_SAMPLE_INTERVAL);
    }
  }

  return timestamps.sort((a, b) => a - b);
}

// ─── Core TSP Function ────────────────────────────────────────────────────────

/**
 * Compute temporal tier and sampling grid for a clip range.
 *
 * @param viewportDensity  Pixels per second in the current viewport.
 * @param trimIn           Clip source time start.
 * @param trimOut          Clip source time end.
 * @param videoDuration    Total source duration.
 * @param interactionState Current ISM state (affects whether high-precision is forced).
 * @param editBoundaries   Known cut points.
 */
export function computeTemporalTier(viewportDensity: number, trimIn: number, trimOut: number, videoDuration: number, interactionState: InteractionState = InteractionState.Idle, editBoundaries: readonly EditBoundary[] = []): TspResult {
  const temporalTier = computeTemporalTierFromDensity(viewportDensity);
  const [baseInterval, nearEditInterval] = TEMPORAL_TIER_INTERVALS[temporalTier];

  // During scrubbing, use the near-edit interval for the whole clip
  const forceHighPrecision = interactionState === InteractionState.Scrubbing;
  const effectiveEditBoundaries = forceHighPrecision
    ? [{ time: (trimIn + trimOut) / 2 }] // treat entire clip as near-edit
    : editBoundaries;

  const frameTimestamps = generateSamplingGrid(trimIn, trimOut, temporalTier, videoDuration, effectiveEditBoundaries);

  return {
    temporalTier,
    baseInterval,
    nearEditInterval,
    frameTimestamps,
  };
}
