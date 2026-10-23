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
  | "easeOutCubic"
  | "easeInCubic"
  | "easeInOutCubic"
  | "easeInQuad"
  | "easeOutQuad"
  | "easeInExpo"
  | "easeOutExpo"
  | "easeOutBack"
  | "easeInBack"
  | "easeInOutBack"
  | "easeOutBounce"
  | "bounce"
  | "spring"
  | "springSnappy"
  | "springBouncy"
  | "springGentle"
  | "speedHero"
  | "speedBullet"
  | "speedMontage"
  | "cubic-bezier"
  | "exponential"
  | "logarithmic"
  | "bezier"
  | "hold";

/**
 * Spring dynamic configuration parameters.
 */
export interface KeyframeSpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
  initialVelocity?: number;
}

/**
 * Responsive time anchor modes:
 * - "start": Relative to clip in-point / start (In)
 * - "end": Relative backwards from clip out-point / end (Out)
 * - "absolute": Unscaled timeline timestamp
 */
export type KeyframeTimeAnchor = "start" | "end" | "absolute";

/**
 * Generic automation keyframe point along a time axis.
 */
export interface Keyframe<T = number> {
  id: string;
  /** Relative time inside the clip or track (in seconds) */
  time: number;
  /** Responsive time anchor ("start" | "end" | "absolute") */
  anchor?: KeyframeTimeAnchor;
  /** Property value at this keyframe */
  value: T;
  /** Interpolation easing curve */
  easing?: KeyframeEasing;
  /** Bezier control points [x1, y1, x2, y2] for custom curve */
  controlPoints?: [number, number, number, number];
  /** Optional custom spring dynamics configuration */
  spring?: KeyframeSpringConfig;
  /**
   * Spatial tangent handles for 2D trajectories (e.g. position paths).
   * Delta [dx, dy] in canvas coordinates relative to the keyframe position.
   */
  spatialIn?: { x: number; y: number };
  spatialOut?: { x: number; y: number };
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
