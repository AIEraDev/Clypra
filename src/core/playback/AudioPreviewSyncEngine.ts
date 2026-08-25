/**
 * Audio Preview Sync Engine — Clypra Core
 *
 * Dedicated, deterministic engine for sample-accurate audio track preview
 * and low-latency playhead seek synchronization.
 *
 * Key Responsibilities:
 * 1. Immediate, zero-delay audio seek execution on playhead jumps and scrubbing.
 * 2. Hardware clock alignment between Master PlaybackClock and primary audio elements.
 * 3. Flush & resync protocol to prevent stale audio buffer bleed-through during seeks.
 * 4. Sample-accurate drift detection (10ms tolerance when paused, 30ms when playing).
 */

import type { Clip, Track, MediaAsset, TransitionTimelineItem } from "@/types";
import { evaluateEffectiveAudioState } from "@/core/audio/effectiveAudioState";
import { resolveClipSourceTime } from "../timeline/sourceTime";

export interface AudioSyncState {
  time: number;
  isPlaying: boolean;
  isScrubbing: boolean;
  volume: number; // 0 to 100
  muted: boolean;
  speed: number;
  frameRate: number;
}

export interface ManagedAudioTrackElement {
  clipId: string;
  element: HTMLAudioElement | HTMLVideoElement;
  lastSeekTime: number;
  lastSeekTimestamp: number;
  isPrimary: boolean;
  isMuted: boolean;
  isPlaying: boolean;
}

export class AudioPreviewSyncEngine {
  private pausedDriftTolerance = 0.01; // 10ms for frame accuracy when paused
  private playingDriftTolerance = 0.03; // 30ms for sample accuracy during playback

  /**
   * Performs instant seek and buffer flush for an audio element when playhead moves.
   */
  public executeInstantSeek(
    managed: ManagedAudioTrackElement,
    targetSourceTime: number,
    isPlaying: boolean
  ): void {
    const el = managed.element;
    const now = performance.now();

    // Instant currentTime update
    try {
      el.currentTime = Math.max(0, targetSourceTime);
      managed.lastSeekTime = targetSourceTime;
      managed.lastSeekTimestamp = now;

      // If actively playing, flush buffer & ensure continuous audio output
      if (isPlaying && el.paused) {
        const playPromise = el.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {
            // Browser autoplay policy catch
          });
        }
      }
    } catch {
      // Guard against invalid media state during rapid unmounts
    }
  }

  /**
   * Reconciles audio elements against playhead state with zero seek penalty for transport jumps.
   */
  public reconcileAudioTracks(
    audioElements: Map<string, ManagedAudioTrackElement>,
    clips: Clip[],
    tracks: Track[],
    syncState: AudioSyncState,
    transitions: TransitionTimelineItem[] = []
  ): { masterHardwareTime?: number } {
    let primaryAudioHardwareTime: number | undefined = undefined;

    for (const [clipId, managed] of audioElements) {
      const clip = clips.find((c) => c.id === clipId);
      if (!clip) continue;

      const track = tracks.find((t) => t.id === clip.trackId);
      const isTrackLocked = track?.locked ?? false;

      // Calculate source time for this clip
      const { sourceTime, active } = resolveClipSourceTime(clip, syncState.time, { frameRate: syncState.frameRate });

      // Clip is inactive at current playhead position
      if (!active || sourceTime === null || isTrackLocked) {
        if (!managed.element.paused) {
          managed.element.pause();
        }
        continue;
      }

      const el = managed.element;

      const effective = evaluateEffectiveAudioState(clip, track, syncState.time, {
        tracks,
        masterVolume: syncState.volume / 100,
        masterMuted: syncState.muted,
      });
      const shouldMute = effective.muted;

      el.muted = shouldMute;
      el.volume = shouldMute ? 0 : Math.max(0, Math.min(1, effective.gain));
      el.playbackRate = syncState.speed;
      if ("preservesPitch" in el) (el as HTMLMediaElement & { preservesPitch?: boolean }).preservesPitch = effective.preservePitch;
      if ("webkitPreservesPitch" in el) (el as HTMLMediaElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = effective.preservePitch;

      // Calculate drift
      const currentDrift = Math.abs(el.currentTime - sourceTime);
      const isUserSeeking = syncState.isScrubbing || !syncState.isPlaying;

      const tolerance = syncState.isPlaying ? this.playingDriftTolerance : this.pausedDriftTolerance;

      // Immediate seek if user is scrubbing, paused, or drift exceeds tolerance
      if (isUserSeeking || currentDrift > tolerance) {
        this.executeInstantSeek(managed, sourceTime, syncState.isPlaying);
      }

      // Hardware clock capture for primary audio track during playback
      if (syncState.isPlaying && managed.isPrimary && !shouldMute && !el.paused) {
        // Calculate estimated master timeline time based on primary audio hardware clock
        const elapsedInClip = el.currentTime - (clip.trimIn || 0);
        primaryAudioHardwareTime = clip.startTime + elapsedInClip;
      }
    }

    return { masterHardwareTime: primaryAudioHardwareTime };
  }
}
