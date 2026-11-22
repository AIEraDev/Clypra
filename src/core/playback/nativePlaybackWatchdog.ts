export interface NativePlaybackWatchdogIncident {
  marker: "native-playback-watchdog";
  reason: "playing-without-native-presentation-progress";
  elapsedMs: number;
  playheadFrame: number;
  lastPresentedFrame: number | null;
}

export interface NativePlaybackWatchdogOptions {
  stallThresholdMs?: number;
  incidentCooldownMs?: number;
}

const DEFAULT_STALL_THRESHOLD_MS = 1_000;
const DEFAULT_INCIDENT_COOLDOWN_MS = 5_000;

/**
 * Observes frontend playback liveness without changing playback policy.
 * Presentation progress is recorded only from native presentation outcomes;
 * clock movement alone must never clear a native-video stall.
 */
export class NativePlaybackWatchdog {
  private readonly stallThresholdMs: number;
  private readonly incidentCooldownMs: number;
  private playbackEpoch = 0;
  private lastPresentationAtMs: number | null = null;
  private lastPresentedFrame: number | null = null;
  private lastIncidentAtMs: number | null = null;

  constructor(options: NativePlaybackWatchdogOptions = {}) {
    this.stallThresholdMs =
      options.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS;
    this.incidentCooldownMs =
      options.incidentCooldownMs ?? DEFAULT_INCIDENT_COOLDOWN_MS;
  }

  beginPlayback(nowMs: number): void {
    this.playbackEpoch += 1;
    this.lastPresentationAtMs = nowMs;
    this.lastPresentedFrame = null;
    this.lastIncidentAtMs = null;
  }

  endPlayback(): void {
    this.playbackEpoch += 1;
    this.lastPresentationAtMs = null;
    this.lastPresentedFrame = null;
    this.lastIncidentAtMs = null;
  }

  recordPresentation(frameIndex: number, nowMs: number): void {
    if (this.lastPresentationAtMs === null) {
      this.beginPlayback(nowMs);
    }
    this.lastPresentedFrame = frameIndex;
    this.lastPresentationAtMs = nowMs;
  }

  check(isPlaying: boolean, nowMs: number, playheadFrame: number): NativePlaybackWatchdogIncident | null {
    if (!isPlaying || this.lastPresentationAtMs === null) {
      return null;
    }

    const elapsedMs = nowMs - this.lastPresentationAtMs;
    if (elapsedMs < this.stallThresholdMs) {
      return null;
    }
    if (
      this.lastIncidentAtMs !== null &&
      nowMs - this.lastIncidentAtMs < this.incidentCooldownMs
    ) {
      return null;
    }

    this.lastIncidentAtMs = nowMs;
    return {
      marker: "native-playback-watchdog",
      reason: "playing-without-native-presentation-progress",
      elapsedMs,
      playheadFrame,
      lastPresentedFrame: this.lastPresentedFrame,
    };
  }

  get epoch(): number {
    return this.playbackEpoch;
  }
}

