import type { Clip, MediaAsset, Track } from "@/types";
import { PlaybackClock, type PlaybackClockState } from "@/core/playback/PlaybackClock";
import {
  configureNativePlayback,
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
} from "@/lib/platform/tauri";
import { isTauriRuntime } from "@/lib/platform/tauri";
import { syncNativeAudioTimeline } from "./nativeAudioTimeline";
import { tracePlayback } from "@/core/playback/playbackTrace";

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
  /** Latest transport-state intent. Older queued play/pause commands are stale. */
  private transportIntentRevision = 0;
  /** Latest paused seek intent. Rapid scrubs collapse to the newest target. */
  private seekIntentRevision = 0;

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
    this.enqueue(() => setNativeAudioOutput(Math.max(0, Math.min(1, volume / 100)), muted), "set-output");
  }

  /**
   * AU-2 fix: Update the timeline audio graph dynamically without tearing down
   * the active CPAL playback stream or clock authority.
   */
  updateSource(source: NativeAudioPreviewSource): void {
    this.source = source;
    if (!this.active || this.disposed) return;
    this.enqueue(async () => {
      await syncNativeAudioTimeline(
        this.source.clips,
        this.source.tracks,
        this.source.assets,
        0,
        this.source.duration,
      );
      await configureNativePlayback({
        contractVersion: 1,
        projectRevision: this.source.projectRevision,
        frameRate: Math.max(1, Math.round(this.source.frameRate)),
        durationFrames: Math.max(1, Math.ceil(this.source.duration * this.source.frameRate)),
        audioTrackCount: Math.max(0, Math.round(this.source.audioTrackCount)),
      });
    });
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
      );
      if (this.disposed) return false;
      await configureNativePlayback({
        contractVersion: 1,
        projectRevision: this.source.projectRevision,
        frameRate: Math.max(1, Math.round(this.source.frameRate)),
        durationFrames: Math.max(1, Math.ceil(this.source.duration * this.source.frameRate)),
        audioTrackCount: Math.max(0, Math.round(this.source.audioTrackCount)),
      });
      if (this.disposed) return false;

      const audioStatus = await getNativeAudioStatus();
      tracePlayback("native.audio-ready", {
        running: audioStatus.running,
        playing: audioStatus.playing,
        available: audioStatus.available,
        deviceName: audioStatus.deviceName,
        sampleRate: audioStatus.sampleRate,
        channels: audioStatus.channels,
        clipCount: timeline.installed.length,
        audioTrackCount: this.source.audioTrackCount,
        muted: audioStatus.muted,
        volume: audioStatus.volume,
        callbackCount: audioStatus.callbackCount,
        renderedFrames: audioStatus.renderedFrames,
        nonSilentFrames: audioStatus.nonSilentFrames,
        lastError: audioStatus.lastError,
      });

      this.active = true;
      this.lastState = this.clock.getState();
      this.unsubscribe = this.clock.subscribe((state) => this.handleClockState(state));
      this.restartPolling(this.clock.state === "playing");

      await seekNativeAudio(secondsToTicks(this.clock.time));
      await setNativeAudioSpeed(this.clock.speed);
      await setNativeAudioOutput(1, false);
      if (this.clock.state === "playing") {
        const nativeState = await nativePlayFromAudio();
        this.adoptNativePosition(nativeState.audioPositionTicks);
        await this.traceNativeAudioStatus("play");
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

    tracePlayback("native.clock-state", {
      state: state.state,
      previousState: previous?.state ?? null,
      time: state.time,
      previousTime: previous?.time ?? null,
      duration: state.duration,
      isSeeking: this.clock.isSeeking,
    });

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
        if (this.transportIntentRevision !== transportIntentRevision || this.clock.state !== "playing") {
          tracePlayback("native.command-skipped", {
            label: "seek-then-play",
            reason: "stale-play-intent",
            transportIntentRevision,
            latestTransportIntentRevision: this.transportIntentRevision,
            state: this.clock.state,
          });
          return;
        }
        // Read at execution time. The value captured by the clock event may be
        // stale if timeline sync or another native command was ahead of us.
        const targetTime = this.clock.time;
        await seekNativeAudio(secondsToTicks(targetTime));
        if (this.transportIntentRevision !== transportIntentRevision || this.clock.state !== "playing") {
          tracePlayback("native.command-skipped", {
            label: "play-after-seek",
            reason: "transport-changed-during-seek",
            transportIntentRevision,
            latestTransportIntentRevision: this.transportIntentRevision,
            state: this.clock.state,
          });
          return;
        }
        const nativeState = await nativePlayFromAudio();
        this.adoptNativePosition(nativeState.audioPositionTicks);
        await this.traceNativeAudioStatus("play");
      }, "seek-then-play");
    } else if (state.state !== "playing" && previous?.state === "playing") {
      this.restartPolling(false);
      this.enqueue(async () => {
        if (this.transportIntentRevision !== transportIntentRevision || this.clock.state === "playing") {
          tracePlayback("native.command-skipped", {
            label: "pause",
            reason: "stale-pause-intent",
            transportIntentRevision,
            latestTransportIntentRevision: this.transportIntentRevision,
            state: this.clock.state,
          });
          return;
        }
        const nativeState = await nativePauseFromAudio();
        this.adoptNativePosition(nativeState.audioPositionTicks);
        await this.traceNativeAudioStatus("pause");
      }, "pause");
    }

    const frameDuration = 1 / Math.max(1, state.frameRate);
    if (state.state !== "playing" && previous && Math.abs(state.time - previous.time) > frameDuration * 0.5) {
      this.seekIntentRevision += 1;
      const seekIntentRevision = this.seekIntentRevision;
      this.enqueue(async () => {
        const stateBeforeSeek = this.clock.state;
        if (this.seekIntentRevision !== seekIntentRevision || stateBeforeSeek === "playing") {
          tracePlayback("native.command-skipped", {
            label: "seek",
            reason: stateBeforeSeek === "playing" ? "playback-resumed" : "superseded-seek",
            seekIntentRevision,
            latestSeekIntentRevision: this.seekIntentRevision,
            state: this.clock.state,
          });
          return;
        }
        // Collapse rapid scrub updates and use the latest paused playhead.
        const targetTime = this.clock.time;
        await seekNativeAudio(secondsToTicks(targetTime));
        const stateAfterSeek = this.clock.state;
        if (this.seekIntentRevision !== seekIntentRevision || stateAfterSeek === "playing") {
          tracePlayback("native.command-skipped", {
            label: "seek-after-native-seek",
            reason: stateAfterSeek === "playing" ? "playback-resumed" : "superseded-seek",
            seekIntentRevision,
            latestSeekIntentRevision: this.seekIntentRevision,
            state: this.clock.state,
          });
          return;
        }
        const nativeState = await nativeSeekFromAudio(Math.max(0, Math.floor(targetTime * this.clock.frameRate)));
        this.adoptNativePosition(nativeState.audioPositionTicks);
        await this.traceNativeAudioStatus("seek");
      }, "seek");
    }
  }

  private adoptNativePosition(positionTicks: number): void {
    if (!Number.isFinite(positionTicks)) return;
    tracePlayback("native.command-position", {
      position: positionTicks / 1_000_000,
      clockTimeBefore: this.clock.time,
      isSeeking: this.clock.isSeeking,
      state: this.clock.state,
    });
    this.clock.setNativeClockPosition(positionTicks / 1_000_000, this.clock.speed);
  }

  private async pollNativeClock(): Promise<void> {
    if (!this.active || this.disposed) return;
    try {
      const nativeState = this.clock.state === "playing" ? await nativeTickFromAudio() : await getNativeAudioStatus();
      const positionTicks = "audioPositionTicks" in nativeState ? nativeState.audioPositionTicks : 0;
      const position = positionTicks / 1_000_000;
      const now = performance.now();
      if (now - this.lastAudioStatusTraceAt >= 500) {
        this.lastAudioStatusTraceAt = now;
        await this.traceNativeAudioStatus("poll");
      }
      if (
        this.clock.isSeeking ||
        position === 0 && this.clock.time > 0 ||
        now - this.lastPollTraceAt >= 1000 && Math.abs(position - this.clock.time) > 0.25
      ) {
        this.lastPollTraceAt = now;
        tracePlayback("native.poll-position", {
          nativeTime: position,
          clockTimeBefore: this.clock.time,
          isSeeking: this.clock.isSeeking,
          state: this.clock.state,
          duration: this.clock.duration,
        });
      }
      this.clock.setNativeClockPosition(position, this.clock.speed);
      // A native graph can report position 0 while it is warming up. Never
      // treat a missing/stale zero duration as an end signal; the timeline
      // duration is the only valid terminal boundary.
      const durationTicks = secondsToTicks(this.source.duration);
      if (this.clock.state === "playing" && durationTicks > 0 && positionTicks >= durationTicks) {
        this.clock.pause();
      }
    } catch (error) {
      this.reportError(error);
    }
  }

  private async traceNativeAudioStatus(operation: string): Promise<void> {
    try {
      const status = await getNativeAudioStatus();
      tracePlayback("native.audio-status", {
        operation,
        running: status.running,
        playing: status.playing,
        available: status.available,
        audioTime: status.audioPositionTicks / 1_000_000,
        callbackCount: status.callbackCount,
        renderedFrames: status.renderedFrames,
        nonSilentFrames: status.nonSilentFrames,
        deviceName: status.deviceName,
        muted: status.muted,
        volume: status.volume,
        lastError: status.lastError,
      });
    } catch (error) {
      tracePlayback("native.audio-status-error", {
        operation,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private enqueue(operation: () => Promise<void>, label = "unknown"): void {
    const commandRevision = ++this.commandRevision;
    tracePlayback("native.command-queued", {
      commandRevision,
      label,
      clockTime: this.clock.time,
      isSeeking: this.clock.isSeeking,
      state: this.clock.state,
    });
    this.commandQueue = this.commandQueue
      .then(async () => {
        if (this.disposed || !this.active) return;
        tracePlayback("native.command-start", { commandRevision, label });
        await operation();
        tracePlayback("native.command-complete", {
          commandRevision,
          label,
          clockTime: this.clock.time,
          isSeeking: this.clock.isSeeking,
          state: this.clock.state,
        });
      })
      .catch((error) => {
        tracePlayback("native.command-error", {
          commandRevision,
          label,
          error: error instanceof Error ? error.message : String(error),
        });
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
