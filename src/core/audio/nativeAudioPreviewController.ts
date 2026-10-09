import type { Clip, MediaAsset, Track } from "@/types";
import {
  PlaybackClock,
  type PlaybackClockState,
} from "@/core/playback/PlaybackClock";
import {
  configureNativePlayback,
  getNativeAudioStatus,
  getNativeAudioDiagnostics,
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
import { getActiveAudioClips } from "@/core/timeline/audioClips";
import {
  telemetryCollector,
  type TelemetryInteraction,
  type TelemetryInteractionName,
  type TelemetryInteractionOutcome,
} from "@/services/telemetryCollector";
import { getActiveSessionOrNull } from "@/core/runtime/ProjectSession";
import { appLifecycleCoordinator } from "@/core/runtime/AppLifecycleCoordinator";
import type { TransportAuthority } from "@/core/playback/TransportAuthority";
import { tracePlayback } from "@/core/playback/playbackTrace";

const NATIVE_PREVIEW_AUDIO_OPTIONS = { preserveTransportPitch: true } as const;

/**
 * Explicit lifecycle state for the audio renderer.
 *
 * Distinct from PlaybackSessionState — the audio renderer may be in any of
 * these states while the PlaybackTimeline is "playing". The renderer is an
 * independent consumer of the timeline; it must never gate video playback.
 *
 *   detached   → not yet asked to participate (controller not initialized)
 *   resolving  → waiting for asset paths to hydrate (paths are still "")
 *   loading    → paths resolved, CPAL graph being built / clips installing
 *   ready      → buffered and ready to output; CPAL stream open
 *   playing    → outputting audio and sending clock positions to PlaybackClock
 *   error      → failed; video continues unaffected
 */
export type AudioRendererState =
  | "detached"
  | "resolving"
  | "loading"
  | "ready"
  | "playing"
  | "error";

/**
 * Explicit state for audio asset source resolution.
 *
 * Distinct from AudioRendererState — source resolution is about whether we
 * know WHERE the audio data is. Renderer state is about whether we are
 * PLAYING it.
 *
 *   unknown    → no audio tracks on timeline (project may be truly silent)
 *   resolving  → audio clips exist but asset.path is "" (asset not yet probed)
 *   resolved   → all audible clips have a non-empty path
 *   invalid    → path resolved but file is missing/unreadable
 */
export type AudioSourceState = "unknown" | "resolving" | "resolved" | "invalid";

interface TimedInteraction {
  startedAt: number;
  telemetry: TelemetryInteraction;
}

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
  /** Session-owned epoch source. Native completions from an old epoch are ignored. */
  transportAuthority?: TransportAuthority;
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
  private readonly transportAuthority?: TransportAuthority;
  private unsubscribe: (() => void) | null = null;
  private unlistenLifecycle: (() => void) | null = null;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  /**
   * Transport has a dedicated short-command lane. Play/pause/seek must never
   * wait behind a media decode or atomic graph replacement initiated by a
   * timeline edit.
   */
  private transportQueue: Promise<void> = Promise.resolve();
  /** Latest-value lane for expensive timeline/clip graph synchronization. */
  private sourceSyncQueue: Promise<void> = Promise.resolve();
  private lastState: PlaybackClockState | null = null;
  private lastClockNotificationTime = performance.now();
  private active = false;
  private disposed = false;
  private commandRevision = 0;
  /** Latest paused seek intent. Rapid scrubs collapse to the newest target. */
  private seekIntentRevision = 0;
  /** Last explicit PlaybackClock seek already sent to the native audio graph. */
  private lastHandledClockSeekRevision = 0;
  /** Timeline edits collapse to the newest candidate instead of queuing rebuilds. */
  private pendingSource: NativeAudioPreviewSource | null = null;
  private sourceUpdateScheduled = false;
  private installedSnapshot: NativeAudioTimelineSnapshot | null = null;
  /** Epoch of a play/restart transport transition currently in flight. */
  private pendingPlayEpoch: number | null = null;
  private outputVolume = 1;
  private outputMuted = false;
  private initializationUs = 0;
  /** A single bounded probe for the first audible callback after Play. */
  private startupProbe: {
    startedAt: number;
    callbackCount: number;
    nonSilentFrames: number;
    installedClipCount: number;
    playCommandUs?: number;
  } | null = null;
  /**
   * Guards against an infinite restart loop after a silent-timeout.
   * On Windows Intel iGPU drivers the CPAL stream sometimes initialises before
   * the D3D12 audio device is fully enumerated, producing only silent callbacks.
   * We attempt one automatic restart (500 ms delay) before surfacing the error.
   */
  private silentTimeoutRetried = false;
  /**
   * Explicit audio renderer lifecycle state. Transitions independently of the
   * PlaybackTimeline — the renderer is a consumer, not an authority.
   * Read via audioRendererState getter for telemetry / UI indicators.
   */
  private _rendererState: AudioRendererState = "detached";
  /**
   * Audio asset source resolution state. Distinguishes "we don't know where
   * the audio is yet" (resolving) from "there is genuinely no audio" (unknown).
   * This is the key distinction that eliminates false audio-unavailable signals.
   */
  private _sourceState: AudioSourceState = "unknown";

  constructor(options: NativeAudioPreviewControllerOptions) {
    this.clock = options.clock;
    this.source = options.source;
    this.onError = options.onError;
    this.transportAuthority = options.transportAuthority;
    // Do not replay a seek that happened before this controller became the
    // native transport owner; initialisation performs its own exact seek.
    this.lastHandledClockSeekRevision = this.clock.seekRevision;
  }

  get isActive(): boolean {
    return this.active;
  }

  /**
   * Current audio renderer lifecycle state.
   * Transitions independently of the PlaybackTimeline. Use for telemetry
   * and UI indicators (e.g. "Audio: Loading..." while video plays).
   */
  get audioRendererState(): AudioRendererState {
    return this._rendererState;
  }

  /**
   * Current audio asset source resolution state.
   * "resolving" means paths haven't hydrated yet — NOT the same as "no audio".
   */
  get audioSourceState(): AudioSourceState {
    return this._sourceState;
  }

  setOutput(volume: number, muted: boolean): void {
    this.outputVolume = Math.max(0, Math.min(1, volume / 100));
    this.outputMuted = muted;
    if (!this.active || this.disposed) return;
    this.enqueueTransport(
      () => setNativeAudioOutput(this.outputVolume, this.outputMuted),
      "set-output",
    );
  }

  /**
   * AU-2 fix: Update the timeline audio graph dynamically without tearing down
   * the active CPAL playback stream or clock authority.
   */
  updateSource(source: NativeAudioPreviewSource): void {
    this.source = source;
    this.pendingSource = source;
    if (!this.active || this.disposed) return;
    if (this.sourceUpdateScheduled) return;
    this.sourceUpdateScheduled = true;
    this.enqueueSourceSync(async () => {
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
            // Determine source state before installing — distinguish "no paths yet"
            // from "genuinely no audio clips". This is the architectural fix for
            // false audio-unavailable signals: resolving ≠ unavailable.
            const allClipsHavePaths = nextSource.clips
              .filter((c) => {
                const clipMediaId = c.mediaId || (c as any).assetId;
                const asset = nextSource.assets.find(
                  (a) => a.id === clipMediaId,
                );
                return asset !== undefined;
              })
              .every((c) => {
                const clipMediaId = c.mediaId || (c as any).assetId;
                const asset = nextSource.assets.find(
                  (a) => a.id === clipMediaId,
                );
                return Boolean(asset?.path);
              });

            const wasResolving = this._rendererState === "resolving";
            this._rendererState = "loading";
            const timeline = await syncNativeAudioTimeline(
              nextSource.clips,
              nextSource.tracks,
              nextSource.assets,
              0,
              nextSource.duration,
              NATIVE_PREVIEW_AUDIO_OPTIONS,
            );
            this.installedSnapshot = timeline.snapshot;

            if (timeline.snapshot.clips.length === 0) {
              if (!allClipsHavePaths && nextSource.clips.length > 0) {
                // Paths haven't resolved yet — not the same as "no audio".
                // Video keeps playing via wall-clock; audio will join when
                // updateSource() fires again with resolved paths.
                this._sourceState = "resolving";
                this._rendererState = "resolving";
                // No longer call markNativeAudioUnavailable — PlaybackClock.time
                // now advances via wall-clock independently of audio state.
              } else {
                // Genuinely no audio clips (silent project or all removed).
                this._sourceState = "unknown";
                this._rendererState = "detached";
              }
            } else {
              this._sourceState = "resolved";
              this._rendererState = "ready";
              this.clock.clearNativeAudioUnavailable(); // keep compat for Bug 8/9 tests

              // Bug 9 fix (preserved): if the clock was playing while audio was
              // resolving, join the timeline at the current position immediately
              // so there is no seek-back to the beginning.
              if (
                wasResolving &&
                this.clock.state === "playing" &&
                this.active &&
                !this.disposed
              ) {
                // Bug 12 note: Capturing clock.time BEFORE enqueuing is correct here —
                // the transport queue may have delay, so we want to join at the position
                // that was current when the audio became ready, not at some later time.
                const currentTime = this.clock.time;
                this.enqueueTransport(async () => {
                  if (
                    !this.active ||
                    this.disposed ||
                    this.clock.state !== "playing"
                  )
                    return;
                  await seekNativeAudio(secondsToTicks(currentTime));
                  if (
                    !this.active ||
                    this.disposed ||
                    this.clock.state !== "playing"
                  )
                    return;
                  const nativeState = await nativePlayFromAudio();
                  this.adoptNativePosition(nativeState.audioPositionTicks);
                  this._rendererState = "playing";
                }, "seek-then-play");
              }
            }
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
    });
  }

  async initialize(): Promise<boolean> {
    if (this.disposed || !isTauriRuntime()) return false;
    // Claim the clock before the first awaited native load so an early Play
    // action cannot create a temporary Web Audio clock during initialization.
    this.clock.setNativeClockAuthority(true);
    const initializationStartedAt = performance.now();

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
      // If no audio clips exist on this project, CPAL will run silently and
      // never supply a native clock position. Signal this to the clock so
      // nativeAudioClockReady (which gates the video playback demand path)
      // becomes true immediately rather than waiting for an event that will
      // never arrive. The video path will use the JS wall-clock frame time
      // carried in each NativePlaybackDemand, which is correct for silent
      // projects. Clear the flag when clips are present so normal AV-sync
      // gating applies.
      if (timeline.snapshot.clips.length === 0) {
        this.clock.markNativeAudioUnavailable();
        this._sourceState =
          this.source.clips.length > 0 ? "resolving" : "unknown";
        this._rendererState =
          this.source.clips.length > 0 ? "resolving" : "detached";
      } else {
        this.clock.clearNativeAudioUnavailable();
        this._sourceState = "resolved";
        this._rendererState = "ready";
      }
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

      this.initializationUs = elapsedUs(initializationStartedAt);

      this.active = true;
      this.lastState = this.clock.getState();
      this.unsubscribe = this.clock.subscribe((state) =>
        this.handleClockState(state),
      );
      this.unlistenLifecycle = appLifecycleCoordinator.onForegroundWakeup(
        () => {
          if (!this.active || this.disposed) return;
          if (this.clock.state === "playing") {
            void this.resyncFromHardwareAudio();
            this.restartPolling(true);
          }
        },
      );
      this.restartPolling(this.clock.state === "playing");

      await Promise.all([
        setNativeAudioSpeed(this.clock.speed),
        // Output may have been selected before asynchronous graph installation
        // completed; applying the retained value prevents first-play from
        // momentarily using stale mute/volume state.
        setNativeAudioOutput(this.outputVolume, this.outputMuted),
      ]);
      if (this.disposed) return false;
      if (this.clock.state === "playing") {
        await this.beginStartupProbe();
        // Bug 12 fix: Read the LIVE clock position (includes wall-clock extrapolation
        // since play() was called) immediately before starting CPAL. The old code read
        // this.clock.time once at the start of initialize() when the clock was paused,
        // then seeked to that stale value after ~555ms of async initialization. By that
        // time, the video had advanced 16-18 frames, creating permanent A/V drift.
        const livePosition = this.clock.time;
        await seekNativeAudio(secondsToTicks(livePosition));
        const playStartedAt = performance.now();
        const nativeState = await nativePlayFromAudio();
        if (this.startupProbe)
          this.startupProbe.playCommandUs = elapsedUs(playStartedAt);
        this.adoptNativePosition(nativeState.audioPositionTicks);
      } else {
        // Paused path: use the static paused position
        await seekNativeAudio(secondsToTicks(this.clock.time));
        await pauseNativeAudio();
      }
      await this.pollNativeClock();

      // Drain any source update that arrived while initialize() was in flight:
      if (this.pendingSource) {
        const pending = this.pendingSource;
        this.updateSource(pending);
      } else if (
        this.source &&
        (!this.installedSnapshot ||
          !hasSameClipLayout(
            this.installedSnapshot,
            buildNativeAudioTimeline(
              this.source.clips,
              this.source.tracks,
              this.source.assets,
              0,
              this.source.duration,
              NATIVE_PREVIEW_AUDIO_OPTIONS,
            ),
          ))
      ) {
        this.updateSource(this.source);
      }

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
    this.unlistenLifecycle?.();
    this.unlistenLifecycle = null;
    if (this.pollHandle) clearInterval(this.pollHandle);
    this.pollHandle = null;
    this.clock.clearNativeClockPosition();
    this.clock.setNativeClockAuthority(false);
    this.pendingPlayEpoch = null;
    const pendingTransport = this.transportQueue;
    const pendingSourceSync = this.sourceSyncQueue;
    this.transportQueue = Promise.resolve();
    this.sourceSyncQueue = Promise.resolve();
    await Promise.all([pendingTransport, pendingSourceSync]);
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
      this.enqueueTransport(
        () => setNativeAudioSpeed(state.speed),
        "set-speed",
      );
    }
    const transportEpoch = this.currentTransportEpoch();

    if (state.state === "playing" && previous?.state !== "playing") {
      this.pendingPlayEpoch = transportEpoch;
      this.restartPolling(true);
      const interaction = this.beginInteraction("play");
      this.enqueueTransport(async () => {
        const commandStartedAt = performance.now();
        if (
          !this.isCurrentTransportEpoch(transportEpoch) ||
          this.clock.state !== "playing"
        ) {
          if (this.pendingPlayEpoch === transportEpoch) {
            this.pendingPlayEpoch = null;
          }
          this.finishInteraction(interaction, commandStartedAt, "superseded");
          return;
        }
        try {
          await this.beginStartupProbe();
          const seekStartedAt = performance.now();
          // Bug 12 note: Reading clock.time INSIDE the async callback is correct —
          // the transport queue may have delay, so we want the live extrapolated
          // position at execution time, not at enqueue time.
          await seekNativeAudio(secondsToTicks(this.clock.time));
          interaction.telemetry.audioSeekUs = elapsedUs(seekStartedAt);
          if (
            !this.isCurrentTransportEpoch(transportEpoch) ||
            this.clock.state !== "playing"
          ) {
            this.finishInteraction(interaction, commandStartedAt, "superseded");
            return;
          }
          const transportStartedAt = performance.now();
          const nativeState = await nativePlayFromAudio();
          interaction.telemetry.audioTransportUs =
            elapsedUs(transportStartedAt);
          if (this.startupProbe) {
            this.startupProbe.playCommandUs =
              interaction.telemetry.audioTransportUs;
          }
          this.adoptNativePosition(nativeState.audioPositionTicks);
          this.finishInteraction(interaction, commandStartedAt, "completed");
        } catch (error) {
          this.finishInteraction(interaction, commandStartedAt, "failed");
          throw error;
        } finally {
          if (this.pendingPlayEpoch === transportEpoch) {
            this.pendingPlayEpoch = null;
          }
        }
      }, "seek-then-play");
    } else if (state.state !== "playing" && previous?.state === "playing") {
      this.restartPolling(false);
      const interaction = this.beginInteraction("pause");
      this.enqueueTransport(async () => {
        const commandStartedAt = performance.now();
        if (
          !this.isCurrentTransportEpoch(transportEpoch) ||
          this.clock.state === "playing"
        ) {
          this.finishInteraction(interaction, commandStartedAt, "superseded");
          return;
        }
        try {
          const targetTime = this.clock.time;
          const targetTicks = secondsToTicks(targetTime);
          const transportStartedAt = performance.now();
          await nativePauseFromAudio().catch(() => undefined);
          await pauseNativeAudio();
          interaction.telemetry.audioTransportUs =
            elapsedUs(transportStartedAt);
          // Space may have restarted playback while the native pause was in
          // flight. Never let this old end-of-timeline command seek the new
          // playback run back to its former terminal position.
          if (!this.isCurrentPauseIntent(transportEpoch)) {
            this.finishInteraction(interaction, commandStartedAt, "superseded");
            return;
          }
          const seekStartedAt = performance.now();
          await seekNativeAudio(targetTicks);
          await nativeSeekFromAudio(
            Math.max(0, Math.floor(targetTime * this.clock.frameRate)),
          );
          interaction.telemetry.audioSeekUs = elapsedUs(seekStartedAt);
          if (!this.isCurrentPauseIntent(transportEpoch)) {
            this.finishInteraction(interaction, commandStartedAt, "superseded");
            return;
          }
          this.adoptNativePosition(targetTicks);
          this.finishInteraction(interaction, commandStartedAt, "completed");
        } catch (error) {
          this.finishInteraction(interaction, commandStartedAt, "failed");
          throw error;
        }
      }, "pause");
    }

    const now = performance.now();
    const elapsedWallSec = Math.max(
      0,
      (now - this.lastClockNotificationTime) / 1000,
    );
    this.lastClockNotificationTime = now;

    const frameDuration = 1 / Math.max(1, state.frameRate);
    const expectedAdvance = elapsedWallSec * (state.speed ?? 1);
    const advanceDelta = Math.abs(
      state.time - (previous?.time ?? state.time) - expectedAdvance,
    );
    const hasNewClockSeek =
      this.clock.seekRevision !== this.lastHandledClockSeekRevision;
    const isPlayingJump =
      state.state === "playing" &&
      previous?.state === "playing" &&
      previous &&
      (this.clock.isSeeking || hasNewClockSeek || advanceDelta > 0.4);

    const isPausedSeek =
      state.state !== "playing" &&
      previous?.state !== "playing" &&
      previous &&
      Math.abs(state.time - previous.time) > frameDuration * 0.5;

    if (isPausedSeek || isPlayingJump) {
      // `isSeeking` is level-triggered until a visual frame settles. Native
      // audio transport is edge-triggered: it must receive exactly one seek
      // per explicit clock revision, otherwise every RAF notification seeks
      // CPAL back to the same position and freezes the program playhead.
      if (isPlayingJump && !hasNewClockSeek && !(advanceDelta > 0.4)) {
        return;
      }
      this.lastHandledClockSeekRevision = this.clock.seekRevision;
      this.seekIntentRevision += 1;
      const seekIntentRevision = this.seekIntentRevision;
      const activeScrubId = telemetryCollector.getActiveScrubSpanId();
      const currentSeek = getActiveSessionOrNull()
        ?.transportAuthority?.getSeekController()
        ?.getCurrent();
      const interactionName: TelemetryInteractionName =
        currentSeek?.source === "timeline-click-seek"
          ? "timeline-click-seek"
          : currentSeek?.source === "keyboard-seek"
            ? "keyboard-seek"
            : "seek";
      const interaction = activeScrubId
        ? null
        : this.beginInteraction(interactionName);
      this.enqueueTransport(async () => {
        const commandStartedAt = performance.now();
        const stateBeforeSeek = this.clock.state;
        if (
          this.seekIntentRevision !== seekIntentRevision ||
          (!isPlayingJump && stateBeforeSeek === "playing")
        ) {
          if (interaction) {
            this.finishInteraction(interaction, commandStartedAt, "superseded");
          } else if (activeScrubId) {
            telemetryCollector.recordScrubSuperseded(activeScrubId);
          }
          return;
        }
        try {
          // Collapse rapid scrub updates and use the latest playhead.
          const targetTime = this.clock.time;
          const seekStartedAt = performance.now();
          await seekNativeAudio(secondsToTicks(targetTime));
          const audioSeekUs = elapsedUs(seekStartedAt);
          if (activeScrubId) {
            telemetryCollector.recordScrubAudioSeek(activeScrubId, audioSeekUs);
          }
          const stateAfterSeek = this.clock.state;
          if (
            this.seekIntentRevision !== seekIntentRevision ||
            (!isPlayingJump && stateAfterSeek === "playing")
          ) {
            if (interaction) {
              interaction.telemetry.audioSeekUs = audioSeekUs;
              this.finishInteraction(
                interaction,
                commandStartedAt,
                "superseded",
              );
            } else if (activeScrubId) {
              telemetryCollector.recordScrubSuperseded(activeScrubId);
            }
            return;
          }
          const nativeState = await nativeSeekFromAudio(
            Math.max(0, Math.floor(targetTime * this.clock.frameRate)),
          );
          this.adoptNativePosition(nativeState.audioPositionTicks);
          // Native audio accepted the transport seek. Presentation may still
          // await a decoded frame, but that must not keep the time authority
          // frozen or cause another audio seek on the next RAF notification.
          this.clock.completeSeek();
          if (interaction) {
            interaction.telemetry.audioSeekUs = audioSeekUs;
            interaction.telemetry.inputToAudioUs = Math.max(
              0,
              Math.round((seekStartedAt - interaction.startedAt) * 1_000),
            );
            this.finishInteraction(interaction, commandStartedAt, "completed");
          }
        } catch (error) {
          if (interaction) {
            this.finishInteraction(interaction, commandStartedAt, "failed");
          }
          throw error;
        }
      }, "seek");
    }
  }

  private adoptNativePosition(positionTicks: number): void {
    if (!Number.isFinite(positionTicks)) return;
    const durationTicks = secondsToTicks(this.source.duration);
    if (
      this.clock.time < 0.5 &&
      this.source.duration > 1.0 &&
      durationTicks > 0 &&
      positionTicks >= durationTicks - 100_000
    ) {
      return;
    }
    const position = positionTicks / 1_000_000;
    this.clock.setNativeClockPosition(position, this.clock.speed);
  }

  /**
   * Urgent out-of-band hardware audio clock query and hard-resync.
   * Invoked upon foreground wakeup or window re-focus to eliminate any
   * time extrapolation drift accumulated while the webview was backgrounded.
   */
  async resyncFromHardwareAudio(): Promise<void> {
    if (!this.active || this.disposed) return;
    try {
      const nativeState = await nativeTickFromAudio();
      const positionTicks =
        "audioPositionTicks" in nativeState
          ? nativeState.audioPositionTicks
          : 0;
      const durationTicks = secondsToTicks(this.source.duration);
      const isStaleTerminalSample =
        this.clock.time < 0.5 &&
        this.source.duration > 1.0 &&
        durationTicks > 0 &&
        positionTicks >= durationTicks - 100_000;

      if (!isStaleTerminalSample) {
        const position = positionTicks / 1_000_000;
        this.clock.resyncNativeClockPosition(position, this.clock.speed);
      }
    } catch (error) {
      console.warn(
        "[NativeAudioController] resyncFromHardwareAudio failed:",
        error,
      );
    }
  }

  /** Dynamic check used after awaits; TypeScript narrowing cannot model an
   * external keyboard event changing the transport while native IPC is pending. */
  private isCurrentPauseIntent(epoch: number): boolean {
    return (
      this.isCurrentTransportEpoch(epoch) && this.clock.state !== "playing"
    );
  }

  private currentTransportEpoch(): number {
    return this.transportAuthority?.getTransportEpoch() ?? 0;
  }

  private isCurrentTransportEpoch(epoch: number): boolean {
    return this.transportAuthority?.isCurrentTransportEpoch(epoch) ?? true;
  }

  private beginInteraction(name: TelemetryInteractionName): TimedInteraction {
    return {
      startedAt: performance.now(),
      telemetry: {
        id: `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        outcome: "completed",
      },
    };
  }

  private finishInteraction(
    interaction: TimedInteraction,
    commandStartedAt: number,
    outcome: TelemetryInteractionOutcome,
  ): void {
    const totalTimeUs = elapsedUs(interaction.startedAt);
    interaction.telemetry.queueWaitUs = Math.max(
      0,
      Math.round((commandStartedAt - interaction.startedAt) * 1_000),
    );
    interaction.telemetry.outcome = outcome;
    telemetryCollector.recordPreviewInteraction({
      interaction: interaction.telemetry,
      totalTimeUs,
    });
  }

  private async pollNativeClock(): Promise<void> {
    if (!this.active || this.disposed) return;
    // A status request can resolve after the user starts a new transport run.
    // Its position belongs to the previous run (often exactly `duration`) and
    // must not stop or overwrite the restart.
    const transportEpoch = this.currentTransportEpoch();
    const expectedState = this.clock.state;
    // If a play/restart transport run is still in-flight on the native side,
    // do not poll or adopt stale positions from the previous run (which may
    // still be at durationTicks) to prevent immediate spurious completion.
    if (this.pendingPlayEpoch !== null) {
      return;
    }
    try {
      const nativeState =
        expectedState === "playing"
          ? await nativeTickFromAudio()
          : await getNativeAudioStatus();
      if (
        !this.active ||
        this.disposed ||
        !this.isCurrentTransportEpoch(transportEpoch) ||
        this.clock.state !== expectedState ||
        this.pendingPlayEpoch !== null
      ) {
        return;
      }
      const positionTicks =
        "audioPositionTicks" in nativeState
          ? nativeState.audioPositionTicks
          : 0;
      const durationTicks = secondsToTicks(this.source.duration);
      const isStaleTerminalSample =
        this.clock.time < 0.5 &&
        this.source.duration > 1.0 &&
        durationTicks > 0 &&
        positionTicks >= durationTicks - 100_000;

      if (!isStaleTerminalSample) {
        const position = positionTicks / 1_000_000;
        const pollRttMs =
          "pollRttMs" in nativeState
            ? (nativeState as any).pollRttMs
            : undefined;
        const sampledAtNs =
          "sampledAtNs" in nativeState
            ? (nativeState as any).sampledAtNs
            : undefined;
        this.clock.setNativeClockPosition(
          position,
          this.clock.speed,
          pollRttMs,
          sampledAtNs,
        );
      }
      await this.resolveStartupProbe();

      // A native graph can report position 0 while it is warming up. Never
      // treat a missing/stale zero duration as an end signal; the timeline
      // duration is the only valid terminal boundary.
      if (
        !isStaleTerminalSample &&
        this.clock.state === "playing" &&
        durationTicks > 0 &&
        positionTicks >= durationTicks
      ) {
        this.clock.complete();
      }
    } catch (error) {
      this.reportError(error);
    }
  }

  private async beginStartupProbe(): Promise<void> {
    // A second Play before the first resolves replaces the old probe: only
    // the current transport intent should be judged for first-use reliability.
    if (this.startupProbe) this.finishStartupProbe("superseded");
    try {
      const diagnostics = await getNativeAudioDiagnostics();
      this.startupProbe = {
        startedAt: performance.now(),
        callbackCount: diagnostics.status.callbackCount,
        nonSilentFrames: diagnostics.status.nonSilentFrames,
        installedClipCount: diagnostics.installedClips.length,
      };
      // Silence is expected when a project has no installed audio.
      const hasAudibleClips =
        getActiveAudioClips(
          this.source.clips,
          this.source.tracks,
          this.source.assets,
          0,
          this.source.duration,
        ).length > 0;
      if (diagnostics.installedClips.length === 0) {
        if (hasAudibleClips) {
          this.finishStartupProbe(
            "failed",
            diagnostics,
            0,
            0,
            "no-native-audio-clips-installed",
          );
        } else {
          this.startupProbe = null;
        }
      }
    } catch {
      // Diagnostics must never prevent transport from starting on an older
      // native build; normal status polling still detects runtime failures.
    }
  }

  private async resolveStartupProbe(): Promise<void> {
    const probe = this.startupProbe;
    if (!probe) return;
    const hasAudibleClips =
      getActiveAudioClips(
        this.source.clips,
        this.source.tracks,
        this.source.assets,
        0,
        this.source.duration,
      ).length > 0;
    if (!hasAudibleClips || probe.installedClipCount === 0) {
      this.startupProbe = null;
      return;
    }
    try {
      const diagnostics = await getNativeAudioDiagnostics();
      const callbackCountDelta = Math.max(
        0,
        diagnostics.status.callbackCount - probe.callbackCount,
      );
      const nonSilentFramesDelta = Math.max(
        0,
        diagnostics.status.nonSilentFrames - probe.nonSilentFrames,
      );
      if (nonSilentFramesDelta > 0) {
        // The first non-silent callback—not the play IPC completion—is the
        // trustworthy start of a CPAL transport. Reset any UI extrapolation
        // from the prior stream to this hardware-clock sample.
        this.clock.resyncNativeClockPosition(
          diagnostics.status.audioPositionTicks / 1_000_000,
          this.clock.speed,
        );
        this.finishStartupProbe(
          "audible",
          diagnostics,
          callbackCountDelta,
          nonSilentFramesDelta,
        );
      } else if (elapsedUs(probe.startedAt) >= 1_500_000) {
        // On Windows Intel iGPU (D3D12) the CPAL stream can initialise before
        // the audio device finishes D3D12 enumeration, resulting in 155+
        // silent callbacks with no output. A single automatic restart of the
        // native audio stream (stop → 500 ms → play) recovers from this.
        // We only attempt this once to prevent an infinite silent loop.
        if (
          !diagnostics.status.lastError &&
          !this.silentTimeoutRetried &&
          this.active &&
          !this.disposed
        ) {
          this.silentTimeoutRetried = true;
          try {
            await stopNativeAudio();
            await new Promise<void>((resolve) => setTimeout(resolve, 500));
            if (!this.active || this.disposed) return;
            // Re-apply output settings and restart from current clock position.
            await setNativeAudioOutput(this.outputVolume, this.outputMuted);
            await seekNativeAudio(secondsToTicks(this.clock.time));
            const nativeState = await nativePlayFromAudio();
            // Reset the probe window so the restarted stream gets a full 1.5 s.
            probe.startedAt = performance.now();
            probe.callbackCount = 0;
            probe.nonSilentFrames = 0;
            if (this.startupProbe) this.startupProbe.playCommandUs = undefined;
            this.adoptNativePosition(nativeState.audioPositionTicks);
          } catch (restartError) {
            console.warn(
              "[NativeAudioController] CPAL restart failed:",
              restartError,
            );
            this.finishStartupProbe(
              "failed",
              diagnostics,
              callbackCountDelta,
              nonSilentFramesDelta,
              `silent-timeout-restart-failed: ${String(restartError)}`,
            );
          }
          return;
        }
        this.finishStartupProbe(
          diagnostics.status.lastError ? "failed" : "silent-timeout",
          diagnostics,
          callbackCountDelta,
          nonSilentFramesDelta,
          diagnostics.status.lastError ??
            "no-non-silent-native-callback-within-1500ms",
        );
      }
    } catch (error) {
      this.finishStartupProbe("failed", undefined, 0, 0, String(error));
    }
  }

  private finishStartupProbe(
    outcome: "audible" | "silent-timeout" | "failed" | "superseded",
    diagnostics?: Awaited<ReturnType<typeof getNativeAudioDiagnostics>>,
    callbackCountDelta = 0,
    nonSilentFramesDelta = 0,
    failureReason?: string,
  ): void {
    const probe = this.startupProbe;
    if (!probe) return;
    this.startupProbe = null;
    telemetryCollector.recordAudioStartup({
      sessionId: getActiveSessionOrNull()?.sessionId ?? "audio-runtime",
      metrics: {
        outcome,
        initializationUs: this.initializationUs,
        playCommandUs: probe.playCommandUs,
        firstAudibleUs:
          outcome === "audible" ? elapsedUs(probe.startedAt) : undefined,
        installedClipCount: probe.installedClipCount,
        activeClipCount: diagnostics?.activeClipIds.length ?? 0,
        callbackCountDelta,
        nonSilentFramesDelta,
        failureReason,
      },
    });
  }

  private enqueueTransport(
    operation: () => Promise<void>,
    label = "unknown",
  ): void {
    const commandRevision = ++this.commandRevision;
    this.transportQueue = this.transportQueue
      .then(async () => {
        if (this.disposed || !this.active) return;
        await operation();
      })
      .catch((error) => {
        this.reportError(error);
      });
  }

  private enqueueSourceSync(operation: () => Promise<void>): void {
    this.sourceSyncQueue = this.sourceSyncQueue
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

function elapsedUs(startedAt: number): number {
  return Math.max(0, Math.round((performance.now() - startedAt) * 1_000));
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
