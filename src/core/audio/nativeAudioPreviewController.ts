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
import {
  telemetryCollector,
  type TelemetryInteraction,
  type TelemetryInteractionName,
  type TelemetryInteractionOutcome,
} from "@/services/telemetryCollector";
import { getActiveSessionOrNull } from "@/core/runtime/ProjectSession";
import type { TransportAuthority } from "@/core/playback/TransportAuthority";

const NATIVE_PREVIEW_AUDIO_OPTIONS = { preserveTransportPitch: true } as const;

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
  private active = false;
  private disposed = false;
  private commandRevision = 0;
  /** Latest paused seek intent. Rapid scrubs collapse to the newest target. */
  private seekIntentRevision = 0;
  /** Timeline edits collapse to the newest candidate instead of queuing rebuilds. */
  private pendingSource: NativeAudioPreviewSource | null = null;
  private sourceUpdateScheduled = false;
  private installedSnapshot: NativeAudioTimelineSnapshot | null = null;
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

  constructor(options: NativeAudioPreviewControllerOptions) {
    this.clock = options.clock;
    this.source = options.source;
    this.onError = options.onError;
    this.transportAuthority = options.transportAuthority;
  }

  get isActive(): boolean {
    return this.active;
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
    if (!this.active || this.disposed) return;
    this.pendingSource = source;
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
      this.restartPolling(this.clock.state === "playing");

      await Promise.all([
        seekNativeAudio(secondsToTicks(this.clock.time)),
        setNativeAudioSpeed(this.clock.speed),
        // Output may have been selected before asynchronous graph installation
        // completed; applying the retained value prevents first-play from
        // momentarily using stale mute/volume state.
        setNativeAudioOutput(this.outputVolume, this.outputMuted),
      ]);
      if (this.disposed) return false;
      if (this.clock.state === "playing") {
        await this.beginStartupProbe();
        const playStartedAt = performance.now();
        const nativeState = await nativePlayFromAudio();
        if (this.startupProbe) this.startupProbe.playCommandUs = elapsedUs(playStartedAt);
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
    this.clock.setNativeClockAuthority(false);
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
      this.restartPolling(true);
      const interaction = this.beginInteraction("play");
      this.enqueueTransport(async () => {
        const commandStartedAt = performance.now();
        if (
          !this.isCurrentTransportEpoch(transportEpoch) ||
          this.clock.state !== "playing"
        ) {
          this.finishInteraction(interaction, commandStartedAt, "superseded");
          return;
        }
        try {
          await this.beginStartupProbe();
          const seekStartedAt = performance.now();
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
          interaction.telemetry.audioTransportUs = elapsedUs(transportStartedAt);
          if (this.startupProbe) {
            this.startupProbe.playCommandUs = interaction.telemetry.audioTransportUs;
          }
          this.adoptNativePosition(nativeState.audioPositionTicks);
          this.finishInteraction(interaction, commandStartedAt, "completed");
        } catch (error) {
          this.finishInteraction(interaction, commandStartedAt, "failed");
          throw error;
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
          interaction.telemetry.audioTransportUs = elapsedUs(transportStartedAt);
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

    const frameDuration = 1 / Math.max(1, state.frameRate);
    const isPlayingJump =
      state.state === "playing" &&
      previous?.state === "playing" &&
      previous &&
      Math.abs(state.time - previous.time) > frameDuration * 1.5;

    const isPausedSeek =
      state.state !== "playing" &&
      previous?.state !== "playing" &&
      previous &&
      Math.abs(state.time - previous.time) > frameDuration * 0.5;

    if (isPausedSeek || isPlayingJump) {
      this.seekIntentRevision += 1;
      const seekIntentRevision = this.seekIntentRevision;
      const activeScrubId = telemetryCollector.getActiveScrubSpanId();
      const currentSeek =
        getActiveSessionOrNull()?.transportAuthority?.getSeekController()?.getCurrent();
      const interactionName: TelemetryInteractionName =
        currentSeek?.source === "timeline-click-seek"
          ? "timeline-click-seek"
          : currentSeek?.source === "keyboard-seek"
            ? "keyboard-seek"
            : "seek";
      const interaction = activeScrubId ? null : this.beginInteraction(interactionName);
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
              this.finishInteraction(interaction, commandStartedAt, "superseded");
            } else if (activeScrubId) {
              telemetryCollector.recordScrubSuperseded(activeScrubId);
            }
            return;
          }
          const nativeState = await nativeSeekFromAudio(
            Math.max(0, Math.floor(targetTime * this.clock.frameRate)),
          );
          this.adoptNativePosition(nativeState.audioPositionTicks);
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
    const position = positionTicks / 1_000_000;
    this.clock.setNativeClockPosition(position, this.clock.speed);
  }

  /** Dynamic check used after awaits; TypeScript narrowing cannot model an
   * external keyboard event changing the transport while native IPC is pending. */
  private isCurrentPauseIntent(epoch: number): boolean {
    return (
      this.isCurrentTransportEpoch(epoch) &&
      this.clock.state !== "playing"
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
    console.debug("[NativeAudioController] transport interaction", {
      name: interaction.telemetry.name,
      outcome,
      queueWaitUs: interaction.telemetry.queueWaitUs,
      audioSeekUs: interaction.telemetry.audioSeekUs,
      audioTransportUs: interaction.telemetry.audioTransportUs,
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
    try {
      const nativeState =
        expectedState === "playing"
          ? await nativeTickFromAudio()
          : await getNativeAudioStatus();
      if (
        !this.active ||
        this.disposed ||
        !this.isCurrentTransportEpoch(transportEpoch) ||
        this.clock.state !== expectedState
      ) {
        return;
      }
      const positionTicks =
        "audioPositionTicks" in nativeState
          ? nativeState.audioPositionTicks
          : 0;
      const position = positionTicks / 1_000_000;
      this.clock.setNativeClockPosition(position, this.clock.speed);
      await this.resolveStartupProbe();

      // A native graph can report position 0 while it is warming up. Never
      // treat a missing/stale zero duration as an end signal; the timeline
      // duration is the only valid terminal boundary.
      const durationTicks = secondsToTicks(this.source.duration);
      if (
        this.clock.state === "playing" &&
        durationTicks > 0 &&
        positionTicks >= durationTicks
      ) {
        console.info("[NativeAudioController] Reached timeline end duration:", {
          positionTicks,
          durationTicks,
        });
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
      // Silence is expected when a project has no installed audio. A timeline
      // that declared audio tracks but installed none is a first-play failure.
      if (diagnostics.installedClips.length === 0) {
        const expectedAudio = this.source.audioTrackCount > 0;
        if (expectedAudio) {
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
    try {
      const diagnostics = await getNativeAudioDiagnostics();
      const callbackCountDelta = Math.max(0, diagnostics.status.callbackCount - probe.callbackCount);
      const nonSilentFramesDelta = Math.max(0, diagnostics.status.nonSilentFrames - probe.nonSilentFrames);
      if (nonSilentFramesDelta > 0) {
        this.finishStartupProbe("audible", diagnostics, callbackCountDelta, nonSilentFramesDelta);
      } else if (elapsedUs(probe.startedAt) >= 1_500_000) {
        this.finishStartupProbe(
          diagnostics.status.lastError ? "failed" : "silent-timeout",
          diagnostics,
          callbackCountDelta,
          nonSilentFramesDelta,
          diagnostics.status.lastError ?? "no-non-silent-native-callback-within-1500ms",
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
        firstAudibleUs: outcome === "audible" ? elapsedUs(probe.startedAt) : undefined,
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
