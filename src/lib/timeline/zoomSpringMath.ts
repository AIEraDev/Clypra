/**
 * Pure math for the timeline zoom spring.
 *
 * Why this exists
 * - The previous spring moved a fixed 22% of the remaining gap per animation frame and declared itself
 *   settled only when |current - target| < 0.08 px/s (an absolute value). Consequences:
 *     1. Speed depended on display refresh (a 120 Hz screen settled twice as fast as 60 Hz).
 *     2. The absolute threshold is far too tight at high zoom and too loose at low zoom, so a single
 *        2.5x notch took roughly 0.6 to 0.7 s to be called "settled" although it looked done much sooner.
 * - This module animates in log space (zoom is multiplicative), uses elapsed time instead of frame count,
 *   and defines "settled" relative to the visible lane width: the ruler can then be off by < 0.5 px at the
 *   edge of the viewport.
 */

/** Time constant of the exponential approach, in ms. Tune by feel: 35 snappier, 60 softer. */
export const ZOOM_SPRING_TAU_MS = 45;

/** Largest time step the spring integrates in one tick, so a stalled frame cannot teleport the zoom. */
export const ZOOM_SPRING_MAX_DT_MS = 50;

/** Relative tolerance below which the zoom is visually settled: 0.5 px across the visible lane. */
export function zoomSettleEpsilon(laneWidthPx: number): number {
  const w = Number.isFinite(laneWidthPx) && laneWidthPx > 0 ? laneWidthPx : 1200;
  return Math.min(1e-2, Math.max(1e-5, 0.5 / w));
}

/** True when `current` is within the visual tolerance of `target`. */
export function hasZoomSettled(current: number, target: number, laneWidthPx: number): boolean {
  if (!(current > 0) || !(target > 0)) return true;
  return Math.abs(Math.log(current / target)) <= Math.log1p(zoomSettleEpsilon(laneWidthPx));
}

/**
 * Advance `current` toward `target` by `dtMs` of real time.
 * Exponential approach in log space: alpha = 1 - exp(-dt / tau); next = current * (target/current)^alpha.
 */
export function stepZoomSpring(
  current: number,
  target: number,
  dtMs: number,
  tauMs: number = ZOOM_SPRING_TAU_MS,
): number {
  if (!(current > 0) || !(target > 0) || !Number.isFinite(current) || !Number.isFinite(target)) {
    return Number.isFinite(target) && target > 0 ? target : current;
  }
  if (!(dtMs > 0)) return current;
  const dt = Math.min(dtMs, ZOOM_SPRING_MAX_DT_MS);
  const alpha = 1 - Math.exp(-dt / Math.max(1, tauMs));
  return Math.exp(Math.log(current) + alpha * (Math.log(target) - Math.log(current)));
}
