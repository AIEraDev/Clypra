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
 * This is deliberately opt-in until the native surface is also authoritative.
 */
export class NativeAudioPreviewController {
  private readonly clock: PlaybackClock;
  private readonly source: NativeAudioPreviewSource;
  private readonly onError?: (error: Error) => void;
  private unsubscribe: (() => void) | null = null;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private commandQueue: Promise<void> = Promise.resolve();
  private lastState: PlaybackClockState | null = null;
  private active = false;
  private disposed = false;

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
    this.enqueue(() => setNativeAudioOutput(Math.max(0, Math.min(1, volume / 100)), muted));
  }

  async initialize(): Promise<boolean> {
    if (this.disposed || !isTauriRuntime()) return false;

    try {
      await syncNativeAudioTimeline(
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

      this.active = true;
      this.lastState = this.clock.getState();
      this.unsubscribe = this.clock.subscribe((state) => this.handleClockState(state));
      this.pollHandle = setInterval(() => {
        void this.pollNativeClock();
      }, 33);

      await seekNativeAudio(secondsToTicks(this.clock.time));
      await setNativeAudioSpeed(this.clock.speed);
      await setNativeAudioOutput(1, false);
      if (this.clock.state === "playing") {
        const nativeState = await nativePlayFromAudio();
        this.adoptNativePosition(nativeState.audioPositionTicks);
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
    if (isTauriRuntime()) {
      try {
        await stopNativeAudio();
      } catch (error) {
        this.reportError(error);
      }
    }
  }

  private handleClockState(state: PlaybackClockState): void {
    if (!this.active || this.disposed) return;
    const previous = this.lastState;
    this.lastState = state;

    if (state.speed !== previous?.speed) {
      this.enqueue(() => setNativeAudioSpeed(state.speed));
    }
    if (state.state === "playing" && previous?.state !== "playing") {
      this.enqueue(async () => {
        await seekNativeAudio(secondsToTicks(state.time));
        const nativeState = await nativePlayFromAudio();
        this.adoptNativePosition(nativeState.audioPositionTicks);
      });
    } else if (state.state !== "playing" && previous?.state === "playing") {
      this.enqueue(async () => {
        const nativeState = await nativePauseFromAudio();
        this.adoptNativePosition(nativeState.audioPositionTicks);
      });
    }

    const frameDuration = 1 / Math.max(1, state.frameRate);
    if (state.state !== "playing" && previous && Math.abs(state.time - previous.time) > frameDuration * 0.5) {
      this.enqueue(async () => {
        await seekNativeAudio(secondsToTicks(state.time));
        const nativeState = await nativeSeekFromAudio(Math.max(0, Math.floor(state.time * state.frameRate)));
        this.adoptNativePosition(nativeState.audioPositionTicks);
      });
    }
  }

  private adoptNativePosition(positionTicks: number): void {
    if (!Number.isFinite(positionTicks)) return;
    this.clock.setNativeClockPosition(positionTicks / 1_000_000, this.clock.speed);
  }

  private async pollNativeClock(): Promise<void> {
    if (!this.active || this.disposed) return;
    try {
      const nativeState = this.clock.state === "playing" ? await nativeTickFromAudio() : await getNativeAudioStatus();
      const positionTicks = "audioPositionTicks" in nativeState ? nativeState.audioPositionTicks : 0;
      this.clock.setNativeClockPosition(positionTicks / 1_000_000, this.clock.speed);
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

  private enqueue(operation: () => Promise<void>): void {
    this.commandQueue = this.commandQueue.then(operation).catch((error) => this.reportError(error));
  }

  private reportError(error: unknown): void {
    this.onError?.(error instanceof Error ? error : new Error(String(error)));
  }
}

function secondsToTicks(seconds: number): number {
  return Math.max(0, Math.round(seconds * 1_000_000));
}
