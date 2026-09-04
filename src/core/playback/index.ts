/**
 * Playback Module
 *
 * Imperative playback engine (NOT React state).
 *
 * Architecture:
 *   TransportAuthority (single source of truth for playback ownership)
 *       ↓
 *   ProgramPlaybackContext ── wraps PlaybackClock (timeline playback)
 *   SourcePlaybackContext  ── wraps HTMLMediaElement (source preview)
 */

export { PlaybackClock, getPlaybackClock, resetPlaybackClock } from "./PlaybackClock";
export type { PlaybackState, PlaybackClockState, PlaybackClockListener } from "./PlaybackClock";

export type { PlaybackContext, PlaybackContextType, PlaybackContextStateSnapshot, PlaybackContextListener } from "./PlaybackContext";
export { TransportAuthority } from "./TransportAuthority";
export type { AuthorityContextSwitchListener, AuthorityStateListener } from "./TransportAuthority";
export { ProgramPlaybackContext } from "./ProgramPlaybackContext";
export { SourcePlaybackContext } from "./SourcePlaybackContext";
export * from "./frameSkipping";
export {
  SeekController,
  qualityForScrubVelocity,
} from "./seekController";
export type {
  SeekIntent,
  SeekIntentInput,
  SeekIntentListener,
  SeekMode,
  SeekQuality,
} from "./seekController";
export {
  previewQualificationController,
  startPreviewQualificationFromDiagnostics,
  PREVIEW_PERFORMANCE_BUDGETS,
} from "./previewPerformanceContract";
export type {
  PreviewPerformancePath,
  PreviewPerformanceSampleKind,
  PreviewPerformanceScenario,
  PreviewQualificationCallbacks,
  PreviewQualificationState,
} from "./previewPerformanceContract";
