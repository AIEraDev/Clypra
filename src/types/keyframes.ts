/**
 * Canonical Keyframe Primitive (§Audit consolidation)
 *
 * Defines the unified keyframe and keyframe track contracts across
 * audio volume automation, visual property animations, and transition/text parameters.
 */

export type KeyframeEasing =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "cubic-bezier"
  | "exponential"
  | "logarithmic"
  | "bezier"
  | "hold";

/**
 * Generic automation keyframe point along a time axis.
 */
export interface Keyframe<T = number> {
  id: string;
  /** Relative time inside the clip or track (in seconds) */
  time: number;
  /** Property value at this keyframe */
  value: T;
  /** Interpolation easing curve */
  easing?: KeyframeEasing;
  /** Bezier control points [x1, y1, x2, y2] for custom curve */
  controlPoints?: [number, number, number, number];
}

/**
 * Normalized keyframe track sorted monotonically by time.
 */
export interface KeyframeTrack<T = number> {
  id?: string;
  property: string;
  keyframes: Keyframe<T>[];
  defaultValue: T;
}
