/**
 * Export-related type definitions
 * These must match Rust types in src-tauri/src/commands/export.rs
 */

/**
 * Audio clip configuration for export mixing.
 * CRITICAL: Must match Rust ExportAudioClip struct with camelCase serialization
 */
export interface ExportAudioClip {
  /** Absolute local file path */
  path: string;

  /** Start time in seconds (relative to export video start) */
  startTime: number;

  /** Duration in seconds to play */
  duration: number;

  /** Trim in offset in seconds inside the source media file */
  trimIn: number;

  /** Volume multiplier (0.0 to 1.0) */
  volume: number;

  /** Fade-in duration in seconds */
  fadeIn?: number;

  /** Fade-out duration in seconds */
  fadeOut?: number;
  fadeInCurve?: "linear" | "exponential" | "logarithmic" | "s-curve";
  fadeOutCurve?: "linear" | "exponential" | "logarithmic" | "s-curve";
  pan?: number;
  eqLow?: number;
  eqMid?: number;
  eqHigh?: number;
  noiseSuppression?: number;
  /** Automation points local to the exported portion of the clip. */
  volumeKeyframes?: ExportAudioKeyframe[];
  /** Explicit source-channel handling shared with preview. */
  channelMode?: "auto" | "mono" | "stereo" | "multichannel";
  downmix?: "auto" | "mono" | "stereo";
  /** Source channel index for each output channel (e.g. [1, 0] swaps stereo). */
  channelMap?: number[];
}

export interface ExportAudioKeyframe {
  time: number;
  gain: number;
  easing?: "linear" | "exponential" | "bezier";
}

/**
 * Export progress update.
 */
export interface ExportProgress {
  /** Current frame number */
  currentFrame?: number;

  /** Total frames to export */
  totalFrames?: number;

  /** Progress percentage (0 - 100) */
  progress: number;

  /** Estimated time remaining in seconds */
  etaSeconds?: number;

  /** Current FPS (frames per second) */
  fps?: number;

  /** Status text (for mobile/cloud custom steps) */
  status?: string;
}
