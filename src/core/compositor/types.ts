/**
 * Core compositor types for time-based frame resolution.
 * This is the foundation for CapCut-class compositing behavior.
 */

import type { Clip } from "../../types";

/**
 * Semantic role of a clip in the composition.
 * Determines how the clip participates in rendering.
 */
export type ClipRole = "primary" | "overlay" | "text" | "effect" | "background" | "audio";

/**
 * Extended clip with compositor metadata.
 * Separates concerns: role (semantic), trackIndex (editorial), zIndex (compositing).
 */
export interface CompositorClip extends Clip {
  /** Semantic type - what this clip represents */
  role: ClipRole;
  /** Editorial ordering - track position in timeline UI */
  trackIndex: number;
  /** Compositing layer - z-order for rendering */
  zIndex: number;
  /** Runtime evaluation priority (for tie-breaking) */
  evaluationPriority: number;
}

/**
 * A single layer in the render stack at a specific time.
 * Represents one clip's contribution to the final frame.
 */
export interface RenderLayer {
  clip: CompositorClip;
  /** Local time within the clip (accounting for trim) */
  localTime: number;
  /** Opacity/visibility at this time (for transitions) */
  opacity: number;
  /** Transform state at this time (for animations) */
  transform: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  };
  /** Whether this layer is in a transition */
  inTransition: boolean;
}

/**
 * Complete render stack at a specific time.
 * Ordered from bottom to top (background → foreground).
 */
export interface RenderStack {
  time: number;
  layers: RenderLayer[];
  /** Whether this time has any renderable content */
  hasContent: boolean;
}

/**
 * Time range with start and end.
 */
export interface TimeRange {
  start: number;
  end: number;
}

/**
 * Timeline validation result - diagnostic only, never blocks operations.
 */
export interface TimelineValidation {
  /** Ranges where content exists and can be rendered */
  renderableRanges: TimeRange[];
  /** Ranges with no content (gaps) */
  gapRanges: TimeRange[];
  /** Ranges with primary video content */
  primaryVideoRanges: TimeRange[];
  /** Ranges with only audio */
  audioOnlyRanges: TimeRange[];
  /** Ranges with only text/overlays */
  overlayOnlyRanges: TimeRange[];
  /** Non-blocking warnings for user awareness */
  warnings: string[];
  /** Total timeline duration */
  totalDuration: number;
}

/**
 * Evaluated clip state at a specific time.
 * Accounts for transitions, animations, speed ramps, etc.
 */
export interface EvaluatedClip {
  clip: CompositorClip;
  /** Whether clip is active at this time */
  isActive: boolean;
  /** Local time within clip (accounting for speed ramps) */
  localTime: number;
  /** Computed opacity (accounting for fades) */
  opacity: number;
  /** Computed transform (accounting for keyframes) */
  transform: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    scale: number;
  };
  /** Active effects at this time */
  effects: string[];
}
