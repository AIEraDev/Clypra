import type { Clip, MediaAsset, Track } from "@/types";
import {
  PlaybackClock,
  type PlaybackClockState,
} from "@/core/playback/PlaybackClock";
import {
  configureNativePlayback,
  getNativeAudioDiagnostics,
  getNativeAudioStatus,
  nativePauseFromAudio,
  nativePlayFromAudio,
  nativeSeekFromAudio,
  nativeTickFromAudio,
  pauseNativeAudio,
  seekNativeAudio,
  setNativeAudioOutput,
  setNativeAudioSpeed,
  stopNativeAudio,
  updateNativeAudioClipParameters,
} from "@/lib/platform/tauri";
import { isTauriRuntime } from "@/lib/platform/tauri";
import { NATIVE_CORE_CONTRACT_VERSION } from "@/lib/platform/nativeCore";
import {
  buildNativeAudioTimeline,
  syncNativeAudioTimeline,
  type NativeAudioTimelineSnapshot,
} from "./nativeAudioTimeline";

const NATIVE_PREVIEW_AUDIO_OPTIONS = { preserveTransportPitch: true } as const;

export interface NativeAudioPreviewSource {
  projectRevision: string;
  frameRate: number;
  duration: number;
  audioTrackCount: number;
  clips: Clip[];
  tracks: Track[];
  assets: MediaAsset[];
}

export interface NativeAudioPreviewControllerOptions {
  clock: PlaybackClock;
  source: NativeAudioPreviewSource;
  onError?: (error: Error) => void;
}

/**
 * Bridges the native audio clock to the existing PlaybackClock contract.
 * In Tauri this controller is the sole program-preview audio/time authority.
 */
export class NativeAudioPreviewController {
  private readonly clock: PlaybackClock;
  private source: NativeAudioPreviewSource;
  private readonly onError?: (error: Error) => void;
  private unsubscribe: (() => void) | null = null;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private commandQueue: Promise<void> = Promise.resolve();
  private lastState: PlaybackClockState | null = null;
  private active = false;
  private disposed = false;
  private commandRevision = 0;
  private lastPollTraceAt = 0;
  private lastAudioStatusTraceAt = 0;
  private audibilityCheckHandle: ReturnType<typeof setTimeout> | null = null;
  /** Latest transport-state intent. Older queued play/pause commands are stale. */
  private transportIntentRevision = 0;
  /** Latest paused seek intent. Rapid scrubs collapse to the newest target. */
  private seekIntentRevision = 0;
  /** Timeline edits collapse to the newest candidate instead of queuing rebuilds. */
  private pendingSource: NativeAudioPreviewSource | null = null;
  private sourceUpdateScheduled = false;
  private installedSnapshot: NativeAudioTimelineSnapshot | null = null;

  constructor(options: NativeAudioPreviewControllerOptions) {
    this.clock = options.clock;
    this.source = options.source;
    this.onError = options.onError;
  }

  get isActive(): boolean {
    return this.active;
  }

  setOutput(volume: number, muted: boolean): void {
    if (!this.active || this.disposed) return;
    this.enqueue(
      () => setNativeAudioOutput(Math.max(0, Math.min(1, volume / 100)), muted),
      "set-output",
    );
  }

  /**
   * AU-2 fix: Update the timeline audio graph dynamically without tearing down
   * the active CPAL playback stream or clock authority.
   */
  updateSource(source: NativeAudioPreviewSource): void {
    this.source = source;
    if (!this.active || this.disposed) return;
    this.pendingSource = source;
    if (this.sourceUpdateScheduled) return;
    this.sourceUpdateScheduled = true;
    this.enqueue(async () => {
      try {
        while (this.pendingSource && !this.disposed) {
          const nextSource = this.pendingSource;
          this.pendingSource = null;
          const nextSnapshot = buildNativeAudioTimeline(
            nextSource.clips,
            nextSource.tracks,
            nextSource.assets,
            0,
            nextSource.duration,
            NATIVE_PREVIEW_AUDIO_OPTIONS,
          );

          if (
            !this.installedSnapshot ||
            !hasSameClipLayout(this.installedSnapshot, nextSnapshot)
          ) {
            const timeline = await syncNativeAudioTimeline(
              nextSource.clips,
              nextSource.tracks,
              nextSource.assets,
              0,
              nextSource.duration,
              NATIVE_PREVIEW_AUDIO_OPTIONS,
            );
            this.installedSnapshot = timeline.snapshot;
          } else if (
            !hasSameClipParameters(this.installedSnapshot, nextSnapshot)
          ) {
            await Promise.all(
              nextSnapshot.clips.map((clip) =>
                updateNativeAudioClipParameters({
                  clipId: clip.clipId,
                  gain: clip.gain,
                  pan: clip.pan,
                  fadeInTicks: clip.fadeInTicks,
                  fadeOutTicks: clip.fadeOutTicks,
                  fadeInCurve: clip.fadeInCurve,
                  fadeOutCurve: clip.fadeOutCurve,
                  volumeKeyframes: clip.volumeKeyframes,
                }),
              ),
            );
            this.installedSnapshot = nextSnapshot;
          }

          await configureNativePlayback({
            contractVersion: NATIVE_CORE_CONTRACT_VERSION,
            projectRevision: nextSource.projectRevision,
            frameRate: Math.max(1, Math.round(nextSource.frameRate)),
            durationFrames: Math.max(
              1,
              Math.ceil(nextSource.duration * nextSource.frameRate),
            ),
            audioTrackCount: Math.max(
              0,
              Math.round(nextSource.audioTrackCount),
            ),
          });
        }
      } finally {
        this.sourceUpdateScheduled = false;
      }
    }, "sync-native-audio");
  }

  async initialize(): Promise<boolean> {
    if (this.disposed || !isTauriRuntime()) return false;
    // Claim the clock before the first awaited native load so an early Play
    // action cannot create a temporary Web Audio clock during initialization.
    this.clock.setNativeClockAuthority(true);

    try {
      const timeline = await syncNativeAudioTimeline(
        this.source.clips,
        this.source.tracks,
        this.source.assets,
        0,
        this.source.duration,
        NATIVE_PREVIEW_AUDIO_OPTIONS,
      );
      this.installedSnapshot = timeline.snapshot;
      if (this.disposed) return false;
      await configureNativePlayback({
        contractVersion: NATIVE_CORE_CONTRACT_VERSION,
        projectRevision: this.source.projectRevision,
        frameRate: Math.max(1, Math.round(this.source.frameRate)),
        durationFrames: Math.max(
          1,
          Math.ceil(this.source.duration * this.source.frameRate),
        ),
        audioTrackCount: Math.max(0, Math.round(this.source.audioTrackCount)),
      });
      if (this.disposed) return false;

      await getNativeAudioStatus();

      this.active = true;
      this.lastState = this.clock.getState();
      this.unsubscribe = this.clock.subscribe((state) =>
        this.handleClockState(state),
      );
      this.restartPolling(this.clock.state === "playing");

      await seekNativeAudio(secondsToTicks(this.clock.time));
      await setNativeAudioSpeed(this.clock.speed);
      await setNativeAudioOutput(1, false);
      if (this.clock.state === "playing") {
        const nativeState = await nativePlayFromAudio();
        this.adoptNativePosition(nativeState.audioPositionTicks);
        await this.traceNativeAudioStatus("play");
        this.scheduleAudibilityCheck();
      } else {
        await pauseNativeAudio();
      }
      await this.pollNativeClock();
      return true;
    } catch (error) {
      this.reportError(error);
      await this.dispose();
      return false;
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.pollHandle) clearInterval(this.pollHandle);
    this.pollHandle = null;
    if (this.audibilityCheckHandle) clearTimeout(this.audibilityCheckHandle);
    this.audibilityCheckHandle = null;
    this.clock.clearNativeClockPosition();
    this.clock.setNativeClockAuthority(false);
    const pendingCommands = this.commandQueue;
    this.commandQueue = Promise.resolve();
    await pendingCommands;
    if (isTauriRuntime()) {
      try {
        await stopNativeAudio();
      } catch (error) {
        this.reportError(error);
      }
    }
  }

  /**
   * AU-6 fix: Adaptive polling — 33ms (~30fps) during playback for responsive playhead updates;
   * 250ms (4Hz) while paused to reduce idle Tauri IPC overhead by ~87%.
   */
  private restartPolling(isPlaying: boolean): void {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    if (this.disposed || !this.active || !isPlaying) return;
    const intervalMs = isPlaying ? 33 : 250;
    this.pollHandle = setInterval(() => {
      void this.pollNativeClock();
    }, intervalMs);
  }

  private handleClockState(state: PlaybackClockState): void {
    if (!this.active || this.disposed) return;
    const previous = this.lastState;
    this.lastState = state;

    if (state.speed !== previous?.speed) {
      this.enqueue(() => setNativeAudioSpeed(state.speed), "set-speed");
    }
    const stateChanged = state.state !== previous?.state;
    if (stateChanged) {
      this.transportIntentRevision += 1;
    }
    const transportIntentRevision = this.transportIntentRevision;

    if (state.state === "playing" && previous?.state !== "playing") {
      this.restartPolling(true);
      this.enqueue(async () => {
        if (
          this.transportIntentRevision !== transportIntentRevision ||
          this.clock.state !== "playing"
        ) {
          return;
        }
        const targetTime = this.clock.time;
        const targetTicks = secondsToTicks(targetTime);
        await seekNativeAudio(targetTicks);
        if (
          this.transportIntentRevision !== transportIntentRevision ||
          this.clock.state !== "playing"
        ) {
          return;
        }
        const nativeState = await nativePlayFromAudio();

        this.adoptNativePosition(nativeState.audioPositionTicks);
        this.scheduleAudibilityCheck();
      }, "seek-then-play");
    } else if (state.state !== "playing" && previous?.state === "playing") {
      this.restartPolling(false);
      if (this.audibilityCheckHandle) clearTimeout(this.audibilityCheckHandle);
      this.audibilityCheckHandle = null;
      this.enqueue(async () => {
        if (
          this.transportIntentRevision !== transportIntentRevision ||
          this.clock.state === "playing"
        ) {
          return;
        }
        const targetTime = this.clock.time;
        const targetTicks = secondsToTicks(targetTime);
        await pauseNativeAudio();
        await seekNativeAudio(targetTicks);
        await nativeSeekFromAudio(
          Math.max(0, Math.floor(targetTime * this.clock.frameRate)),
        );
        this.adoptNativePosition(targetTicks);
      }, "pause");
    }

    const frameDuration = 1 / Math.max(1, state.frameRate);
    if (
      state.state !== "playing" &&
      previous?.state !== "playing" &&
      previous &&
      Math.abs(state.time - previous.time) > frameDuration * 0.5
    ) {
      this.seekIntentRevision += 1;
      const seekIntentRevision = this.seekIntentRevision;
      this.enqueue(async () => {
        const stateBeforeSeek = this.clock.state;
        if (
          this.seekIntentRevision !== seekIntentRevision ||
          stateBeforeSeek === "playing"
        ) {
          return;
        }
        // Collapse rapid scrub updates and use the latest paused playhead.
        const targetTime = this.clock.time;
        await seekNativeAudio(secondsToTicks(targetTime));
        const stateAfterSeek = this.clock.state;
        if (
          this.seekIntentRevision !== seekIntentRevision ||
          stateAfterSeek === "playing"
        ) {
          return;
        }
        const nativeState = await nativeSeekFromAudio(
          Math.max(0, Math.floor(targetTime * this.clock.frameRate)),
        );
        this.adoptNativePosition(nativeState.audioPositionTicks);
        await this.traceNativeAudioStatus("seek");
      }, "seek");
    }
  }

  private adoptNativePosition(positionTicks: number): void {
    if (!Number.isFinite(positionTicks)) return;
    const position = positionTicks / 1_000_000;
    this.clock.setNativeClockPosition(position, this.clock.speed);
  }

  private async pollNativeClock(): Promise<void> {
    if (!this.active || this.disposed) return;
    try {
      const nativeState =
        this.clock.state === "playing"
          ? await nativeTickFromAudio()
          : await getNativeAudioStatus();
      const positionTicks =
        "audioPositionTicks" in nativeState
          ? nativeState.audioPositionTicks
          : 0;
      const position = positionTicks / 1_000_000;
      this.clock.setNativeClockPosition(position, this.clock.speed);
      // A native graph can report position 0 while it is warming up. Never
      // treat a missing/stale zero duration as an end signal; the timeline
      // duration is the only valid terminal boundary.
      const durationTicks = secondsToTicks(this.source.duration);
      if (
        this.clock.state === "playing" &&
        durationTicks > 0 &&
        positionTicks >= durationTicks
      ) {
        this.clock.pause();
      }
    } catch (error) {
      this.reportError(error);
    }
  }

  private async traceNativeAudioStatus(operation: string): Promise<void> {
    try {
      const status = await getNativeAudioStatus();
    } catch (error) {}
  }

  /**
   * Capture a small, derived diagnostic sample after the native callback has
   * had time to run. The result names the owning boundary of silence while the
   * native engine remains the only production playback path.
   */
  private scheduleAudibilityCheck(): void {
    if (this.audibilityCheckHandle) clearTimeout(this.audibilityCheckHandle);
    this.audibilityCheckHandle = setTimeout(() => {
      this.audibilityCheckHandle = null;
      void this.traceNativeAudibility();
    }, 750);
  }

  private async traceNativeAudibility(): Promise<void> {
    if (this.disposed || !this.active || this.clock.state !== "playing") return;
    try {
      const diagnostics = await getNativeAudioDiagnostics();
      const { status } = diagnostics;
      const boundary =
        diagnostics.installedClips.length === 0
          ? "clip-discovery-or-install"
          : diagnostics.activeClipIds.length === 0
            ? "timeline-activation-or-source-range"
            : diagnostics.mixerPeak <= 0.000001
              ? "decode-or-mixer-gain-envelope"
              : status.callbackCount === 0
                ? "device-callback"
                : status.nonSilentFrames === 0
                  ? "callback-mixer-handoff"
                  : "device-output-or-system-routing";
      const evidence = {
        boundary,
        installedClipCount: diagnostics.installedClips.length,
        activeClipIds: diagnostics.activeClipIds,
        mixerPeak: diagnostics.mixerPeak,
        clips: diagnostics.clipDiagnostics,
        running: status.running,
        playing: status.playing,
        callbackCount: status.callbackCount,
        renderedFrames: status.renderedFrames,
        nonSilentFrames: status.nonSilentFrames,
        deviceName: status.deviceName,
        muted: status.muted,
        volume: status.volume,
        lastError: status.lastError,
      };
      // Native silence evidence must be visible even when optional playback
      // debug filtering is off. This runs once per Play and never in the
      // audio callback, so it cannot affect real-time performance.
      console.info("[native-audio] audibility", evidence);
    } catch (error) {}
  }

  private enqueue(operation: () => Promise<void>, label = "unknown"): void {
    const commandRevision = ++this.commandRevision;
    this.commandQueue = this.commandQueue
      .then(async () => {
        if (this.disposed || !this.active) return;
        await operation();
      })
      .catch((error) => {
        this.reportError(error);
      });
  }

  private reportError(error: unknown): void {
    this.onError?.(error instanceof Error ? error : new Error(String(error)));
  }
}

function secondsToTicks(seconds: number): number {
  return Math.max(0, Math.round(seconds * 1_000_000));
}

function hasSameClipLayout(
  previous: NativeAudioTimelineSnapshot,
  next: NativeAudioTimelineSnapshot,
): boolean {
  if (previous.clips.length !== next.clips.length) return false;
  return previous.clips.every((clip, index) => {
    const candidate = next.clips[index];
    return (
      clip.clipId === candidate.clipId &&
      clip.path === candidate.path &&
      clip.timelineStartTicks === candidate.timelineStartTicks &&
      clip.sourceStartTicks === candidate.sourceStartTicks &&
      clip.durationTicks === candidate.durationTicks &&
      clip.channelMode === candidate.channelMode &&
      clip.downmix === candidate.downmix &&
      JSON.stringify(clip.channelMap ?? null) ===
        JSON.stringify(candidate.channelMap ?? null) &&
      clip.preservePitch === candidate.preservePitch
    );
  });
}

function hasSameClipParameters(
  previous: NativeAudioTimelineSnapshot,
  next: NativeAudioTimelineSnapshot,
): boolean {
  return previous.clips.every((clip, index) => {
    const candidate = next.clips[index];
    return (
      clip.gain === candidate.gain &&
      clip.pan === candidate.pan &&
      clip.fadeInTicks === candidate.fadeInTicks &&
      clip.fadeOutTicks === candidate.fadeOutTicks &&
      clip.fadeInCurve === candidate.fadeInCurve &&
      clip.fadeOutCurve === candidate.fadeOutCurve &&
      JSON.stringify(clip.volumeKeyframes) ===
        JSON.stringify(candidate.volumeKeyframes)
    );
  });
}
