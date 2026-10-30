/**
 * sliderSnap.ts — Shared snap-to-point logic for all Clypra slider primitives.
 *
 * Provides a single `applySliderSnap` function used by GradientSliderTrack,
 * SliderTrack, PropertySlider, and Slider so snap behaviour is identical and
 * tunable from one place.
 *
 * ## Snap model
 * Each snap target defines a value and a half-width threshold expressed in the
 * same units as min/max.  When the raw drag value falls within
 * [target - threshold, target + threshold] the output is locked to `target`.
 * The first matching target wins.
 *
 * ## Auto-center snap
 * When a slider has a symmetric range (min < 0 && max > 0) a snap target at 0
 * is automatically injected unless the caller opts out via `autoCenter: false`.
 */

export interface SliderSnapTarget {
  /** Value (in the same units as min/max) to snap to. */
  value: number;
  /**
   * Half-width of the snap zone in the same value units.
   * The snap fires for raw values in [value − threshold, value + threshold].
   */
  threshold: number;
}

export interface ApplySliderSnapOptions {
  /** Raw value produced by the drag/change event before snapping. */
  raw: number;
  /** Slider minimum. */
  min: number;
  /** Slider maximum. */
  max: number;
  /**
   * Explicit list of snap targets.  These are applied first; auto-center is
   * added automatically when applicable (see below).
   */
  snapTargets?: SliderSnapTarget[];
  /**
   * When true (default) a snap target at 0 is automatically added for
   * symmetric sliders (min < 0 && max > 0) if no explicit target at 0 exists.
   */
  autoCenter?: boolean;
}

/**
 * Half-width of the automatic center-snap zone expressed as a fraction of the
 * full slider range.  6 % of the range on each side gives a very noticeable
 * "pull" when sweeping through the neutral point.
 *
 * For a [-100, 100] slider this is ±12 units.
 * For a [-1.0, 1.0] slider this is ±0.12 units.
 */
const AUTO_CENTER_THRESHOLD_RATIO = 0.06;

/**
 * Apply snap logic to a raw slider value and return the (possibly snapped)
 * output value.  Returns the raw value unchanged when no snap zone is hit.
 */
export function applySliderSnap({
  raw,
  min,
  max,
  snapTargets = [],
  autoCenter = true,
}: ApplySliderSnapOptions): number {
  const targets: SliderSnapTarget[] = [...snapTargets];

  // Inject auto-center snap for symmetric sliders when no explicit 0-target exists
  if (autoCenter && min < 0 && max > 0) {
    const alreadyHasZero = targets.some((t) => t.value === 0);
    if (!alreadyHasZero) {
      const range = max - min;
      targets.unshift({
        value: 0,
        threshold: range * AUTO_CENTER_THRESHOLD_RATIO,
      });
    }
  }

  for (const target of targets) {
    if (Math.abs(raw - target.value) <= target.threshold) {
      return target.value;
    }
  }

  return raw;
}
