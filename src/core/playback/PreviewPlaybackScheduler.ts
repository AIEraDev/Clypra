/**
 * Preview Playback Scheduler
 *
 * Implements policy-driven playback control for preview media elements.
 * Decides WHEN to seek, play, pause, and adjust playback rates based on:
 * - Drift thresholds
 * - Scrubbing detection
 * - Throttling limits
 * - Audio-friendly sync policies
 *
 * CRITICAL ARCHITECTURAL BOUNDARY:
 * - This component DECIDES actions (seek, play, pause, rate adjustment)
 * - PreviewMediaPool EXECUTES actions (applies to video elements)
 * - Compositor NEVER mutates video elements (reads only)
 *
 * Key Features:
 * - Drift-based seek policy (avoid seek storms)
 * - Scrubbing detection and throttled seeks
 * - Playback rate correction for gradual catch-up
 * - Audio-friendly sync (wider tolerances for primary audio track)
 * - Post-throttling recovery (window blur/focus transitions)
 * - Rate limiting (prevents excessive seeks)
 */

import type { Clip, MediaAsset, TransitionTimelineItem } from "@/types";
import { resolveClipSourceTime } from "../timeline/sourceTime";
import type { PreviewSyncState } from "../resources/PreviewMediaPool";

// ─── Types ───────────────────────────────────────────────────────────────

export type SeekReason =
  | "drift-recovery" // Automatic drift correction
  | "scrubbing" // User scrubbing timeline
  | "transport-jump" // Play/pause/seek command
  | "clip-enter" // Clip becoming active
  | "trim-change" // Trim points modified
  | "rate-change" // Playback speed changed
  | "post-throttling" // Recovery after browser throttling
  | "prewarm"; // Prewarming for upcoming clip

export interface MediaAction {
  type: "seek" | "play" | "pause" | "setRate" | "noop";
  clipId: string;
  time?: number;
  rate?: number;
  reason?: SeekReason;
}

export interface MediaElementState {
  clipId: string;
  mediaId: string;
  currentTime: number;
  paused: boolean;
  seeking: boolean;
  readyState: number;
  playbackRate: number;
  duration: number;
  lastSeekTimestamp: number;
  playPromiseInFlight: boolean;
  autoplayBlocked: boolean;
  isActive: boolean;
  isPrimaryAudible: boolean;
  /** Whether this video has been explicitly seeked at least once */
  hasBeenSeeked?: boolean;
}

interface SeekPolicyConfig {
  /** Drift tolerance for paused/stopped state (tight for frame accuracy) */
  driftTolerancePaused: number;
  /** Drift tolerance during active playback (wider to prevent seek loops) */
  driftTolerancePlaying: number;
  /** Hard seek threshold for automatic sync */
  hardSeekThreshold: number;
  /** Audio-friendly hard seek threshold (wider for primary audio) */
  hardSeekThresholdAudioFriendly: number;
  /** Minimum interval between hard seeks (ms) */
  minSeekInterval: number;
  /** Audio-friendly seek interval (longer to prevent audio glitches) */
  minSeekIntervalAudioFriendly: number;
  /** Scrubbing detection threshold (seconds) */
  scrubbingDriftThreshold: number;
  /** Minimum interval between seeks during scrubbing (ms) */
  minSeekIntervalScrubbing: number;
  /** Post-throttling detection threshold (seconds) */
  postThrottlingDriftThreshold: number;
  /** Drift range for playback rate correction */
  rateCorrectionMinDrift: number;
  rateCorrectionMaxDrift: number;
  /** Rate correction multipliers */
  rateCorrectionSpeedUp: number;
  rateCorrectionSlowDown: number;
}

// ─── Default Configuration ───────────────────────────────────────────────

const DEFAULT_SEEK_POLICY: SeekPolicyConfig = {
  driftTolerancePaused: 0.01, // 10ms for frame-stepping
  driftTolerancePlaying: 2.0, // 2s during buffering (prevents seek loops)
  hardSeekThreshold: 0.5, // 500ms triggers hard seek
  hardSeekThresholdAudioFriendly: 1.0, // 1s for audio-friendly sync
  minSeekInterval: 400, // 400ms minimum between seeks
  minSeekIntervalAudioFriendly: 1500, // 1.5s for audio tracks
  minSeekIntervalScrubbing: 150, // 150ms during scrubbing
  scrubbingDriftThreshold: 2.0, // >2s drift indicates scrubbing
  postThrottlingDriftThreshold: 5.0, // ≥5s drift indicates throttling recovery
  rateCorrectionMinDrift: 0.1, // Start rate correction at 100ms
  rateCorrectionMaxDrift: 0.3, // Stop rate correction at 300ms (use seek)
  rateCorrectionSpeedUp: 1.02, // 2% faster to catch up
  rateCorrectionSlowDown: 0.98, // 2% slower to let video catch up
};

// ─── Scheduler Implementation ────────────────────────────────────────────

export class PreviewPlaybackScheduler {
  private config: SeekPolicyConfig;

  constructor(config?: Partial<SeekPolicyConfig>) {
    this.config = { ...DEFAULT_SEEK_POLICY, ...config };
  }

  /**
   * Main reconciliation method called per RAF.
   *
   * Analyzes current state and returns actions to execute.
   *
   * @param syncState - Timeline playback state
   * @param mediaStates - Current state of all media elements
   * @param clips - Timeline clips
   * @param assets - Media assets
   * @param activeVideoClipCount - Number of active video clips
   * @returns Array of actions to execute
   */
  reconcile(syncState: PreviewSyncState, mediaStates: Map<string, MediaElementState>, clips: Clip[], assets: MediaAsset[], activeVideoClipCount: number, transitions: TransitionTimelineItem[] = []): MediaAction[] {
    const actions: MediaAction[] = [];
    const now = performance.now();

    for (const [clipId, state] of mediaStates) {
      // Find clip definition
      const clip = clips.find((c) => c.id === clipId);
      if (!clip) continue;

      // Calculate target time for this clip (transition-aware)
      const targetTime = this.calculateTargetTime(clip, syncState, transitions);

      if (targetTime === null) {
        // Clip not active - handle prewarm or pause
        const prewarmTime = this.calculatePrewarmTime(clip, syncState);
        if (prewarmTime !== null && state.readyState >= 1) {
          const drift = Math.abs(state.currentTime - prewarmTime);
          if (drift > this.config.driftTolerancePaused) {
            actions.push({
              type: "seek",
              clipId,
              time: prewarmTime,
              reason: "prewarm",
            });
          }
        }

        // Ensure paused
        if (!state.paused) {
          actions.push({ type: "pause", clipId });
        }
        continue;
      }

      // Clip is active - determine sync actions
      if (syncState.state === "playing") {
        actions.push(...this.reconcilePlayingClip(clipId, state, targetTime, syncState, now, activeVideoClipCount));
      } else {
        actions.push(...this.reconcilePausedClip(clipId, state, targetTime, syncState, now));
      }
    }

    return actions;
  }

  /**
   * Reconcile a clip during active playback.
   */
  private reconcilePlayingClip(clipId: string, state: MediaElementState, targetTime: number, syncState: PreviewSyncState, now: number, activeVideoClipCount: number): MediaAction[] {
    const actions: MediaAction[] = [];

    if (!state.paused) {
      // Already playing - check sync
      if (state.seeking) {
        return actions; // Wait for seek to complete
      }

      const drift = Math.abs(state.currentTime - targetTime);

      // Detect abnormal situations
      const isPostThrottling = drift >= this.config.postThrottlingDriftThreshold;
      const isScrubbing = drift > this.config.scrubbingDriftThreshold && drift < this.config.postThrottlingDriftThreshold;

      if (isPostThrottling) {
        // Very large drift - likely browser throttling during window blur
        // Force immediate resync and allow rapid subsequent seeks
        actions.push({
          type: "seek",
          clipId,
          time: targetTime,
          reason: "post-throttling",
        });
        return actions;
      }

      if (isScrubbing) {
        // User scrubbing - immediate seek without rate limiting (except for scrubbing throttle)
        if (now - state.lastSeekTimestamp > this.config.minSeekIntervalScrubbing) {
          actions.push({
            type: "seek",
            clipId,
            time: targetTime,
            reason: "scrubbing",
          });
        }
        return actions;
      }

      // Automatic sync - use audio-friendly policy if needed
      const useAudioFriendlySync = state.isPrimaryAudible || activeVideoClipCount > 1;
      const hardSeekThreshold = useAudioFriendlySync ? this.config.hardSeekThresholdAudioFriendly : this.config.hardSeekThreshold;
      const minSeekInterval = useAudioFriendlySync ? this.config.minSeekIntervalAudioFriendly : this.config.minSeekInterval;

      if (drift > hardSeekThreshold && now - state.lastSeekTimestamp > minSeekInterval) {
        // Hard seek required
        actions.push({
          type: "seek",
          clipId,
          time: targetTime,
          reason: "drift-recovery",
        });
      } else if (!state.isPrimaryAudible && drift >= this.config.rateCorrectionMinDrift && drift <= this.config.rateCorrectionMaxDrift) {
        // Soft correction via playback rate (non-audio tracks only)
        const targetRate = state.currentTime < targetTime ? syncState.speed * this.config.rateCorrectionSpeedUp : syncState.speed * this.config.rateCorrectionSlowDown;

        if (Math.abs(state.playbackRate - targetRate) > 0.01) {
          actions.push({
            type: "setRate",
            clipId,
            rate: targetRate,
            reason: "drift-recovery",
          });
        }
      } else if (Math.abs(state.playbackRate - syncState.speed) > 0.01) {
        // Restore normal speed when in sync
        actions.push({
          type: "setRate",
          clipId,
          rate: syncState.speed,
        });
      }
    } else {
      // Element is paused but should be playing
      // Request play (PreviewMediaPool will handle guards and promise)
      actions.push({ type: "play", clipId });
    }

    return actions;
  }

  /**
   * Reconcile a clip during paused state.
   */
  private reconcilePausedClip(clipId: string, state: MediaElementState, targetTime: number, syncState: PreviewSyncState, now: number): MediaAction[] {
    const actions: MediaAction[] = [];

    // Check if seek is needed
    const drift = Math.abs(state.currentTime - targetTime);

    // CRITICAL: Force initial seek even if drift is small to ensure frame decode
    // Browsers won't decode frames until a seek operation occurs
    const needsInitialSeek = !state.hasBeenSeeked && state.readyState >= 1 && state.isActive;

    if (drift > this.config.driftTolerancePaused || needsInitialSeek) {
      const isWaitingToPlay = syncState.state === "playing" && state.readyState < 3;

      if (isWaitingToPlay) {
        // During active playback, if element is paused (buffering),
        // only allow major seeks to prevent infinite seek loops
        if (drift > this.config.driftTolerancePlaying && state.readyState >= 1) {
          actions.push({
            type: "seek",
            clipId,
            time: targetTime,
            reason: "drift-recovery",
          });
        }
      } else {
        // App is paused/stopped - normal frame seeking
        if (state.readyState >= 1) {
          actions.push({
            type: "seek",
            clipId,
            time: targetTime,
            reason: needsInitialSeek ? "clip-enter" : "transport-jump",
          });
        }
      }
    }
    // Ensure paused if not playing
    if (syncState.state !== "playing" && !state.paused) {
      actions.push({ type: "pause", clipId });
    }

    return actions;
  }

  /**
   * Calculate target source time for a clip at current playhead position.
   */
  private calculateTargetTime(clip: Clip, syncState: PreviewSyncState, transitions: TransitionTimelineItem[] = []): number | null {
    const clipLocalTime = syncState.time - clip.startTime;

    // Frame-rate-aware boundary tolerance
    const BOUNDARY_TOLERANCE = 1.5 / syncState.frameRate;

    const isInTransition = transitions.some((t) => {
      const start = t.placement.startTime;
      const duration = t.placement.duration;
      const isActive = syncState.time >= start && syncState.time < start + duration;
      return isActive && (t.fromItemId === clip.id || t.toItemId === clip.id);
    });

    if (!isInTransition) {
      if (clipLocalTime < -BOUNDARY_TOLERANCE || clipLocalTime > clip.duration + BOUNDARY_TOLERANCE) {
        return null; // Clip not active
      }
    }

    // Calculate source time using resolveClipSourceTime utility to match evaluators
    const { sourceTime } = resolveClipSourceTime(clip, syncState.time, {
      clampToRange: true,
      frameRate: syncState.frameRate,
    });

    return sourceTime;
  }

  /**
   * Calculate prewarm time for upcoming clip.
   */
  private calculatePrewarmTime(clip: Clip, syncState: PreviewSyncState): number | null {
    if (syncState.time >= clip.startTime) {
      return null; // Clip already active or past
    }

    return Math.max(0, clip.trimIn || 0);
  }

  /**
   * Handle transport command (play/pause/seek from UI).
   */
  handleTransportCommand(command: "play" | "pause" | "seek", mediaStates: Map<string, MediaElementState>, seekTime?: number): MediaAction[] {
    const actions: MediaAction[] = [];

    for (const [clipId, state] of mediaStates) {
      switch (command) {
        case "play":
          if (state.paused && state.isActive) {
            actions.push({ type: "play", clipId });
          }
          break;

        case "pause":
          if (!state.paused) {
            actions.push({ type: "pause", clipId });
          }
          break;

        case "seek":
          if (seekTime !== undefined && state.isActive && state.readyState >= 1) {
            actions.push({
              type: "seek",
              clipId,
              time: seekTime,
              reason: "transport-jump",
            });
          }
          break;
      }
    }

    return actions;
  }

  /**
   * Update configuration at runtime.
   */
  updateConfig(config: Partial<SeekPolicyConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration.
   */
  getConfig(): Readonly<SeekPolicyConfig> {
    return { ...this.config };
  }
}
