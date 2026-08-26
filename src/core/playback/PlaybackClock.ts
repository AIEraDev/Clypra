import { recordAudioPoll } from "@/lib/playback/syncMetrics";

/**
 * Playback Clock - Continuous Time Signal
 *
 * This is NOT React state. This is an imperative playback engine.
 *
 * Key principles:
 * - Time is a continuous signal, not discrete state
 * - Consumers subscribe and read imperatively
 * - React components wrap this with useSyncExternalStore
 * - No setInterval/setTimeout loops; runs on requestAnimationFrame
 */

export type PlaybackState = "playing" | "paused" | "stopped";

export interface PlaybackClockState {
  /** Current time in seconds */
  time: number;
  /** Playback state */
  state: PlaybackState;
  /** Playback speed (1.0 = normal) */
  speed: number;
  /** Total duration in seconds */
  duration: number;
  /** Frame rate */
  frameRate: number;
}

export type PlaybackClockListener = (state: PlaybackClockState) => void;

/**
 * Playback Clock - Imperative time signal.
 *
 * This is the SINGLE SOURCE OF TRUTH for playback time.
 * It is NOT React state. It is a continuous signal.
 */
export class PlaybackClock {
  private _time: number = 0;
  private _state: PlaybackState = "stopped";
  private _speed: number = 1.0;
  private _duration: number = 0;
  private _frameRate: number = 30;
  private _isSeeking: boolean = false;

  // RAF loop
  private _rafId: number | null = null;
  private _audioContext: AudioContext | null = null;
  private _ownsAudioContext = false;
  /** True while native CPAL is the sole program-preview clock authority. */
  private _nativeClockAuthority = false;
  private _playStartAudioTime: number = 0;
  private _playStartClockTime: number = 0;
  private _nativeClockPosition: {
    time: number;
    receivedAtMs: number;
    speed: number;
  } | null = null;

  // Generation counter to prevent stale RAF ticks
  private _generation: number = 0;
  private _seekRevision: number = 0;

  // Stall compensation — tracks AudioContext time at the start of a synchronous
  // blocking operation (e.g. GPU shader compilation) so we can offset
  // _playStartAudioTime on resume and prevent a spurious clock jump.
  private _stallStartAudioTime: number | null = null;

  // Listeners (for UI snapshots only, not every frame)
  private _listeners = new Set<PlaybackClockListener>();
  private _lastNotifyTime: number = 0;
  private _notifyThrottleMs: number = 100; // Notify UI max 10fps

  constructor() {
    // Constructor initialization
  }

  /** Attach the shared audio clock used by the program audio engine. */
  attachAudioContext(audioContext: AudioContext): void {
    // A browser engine may be retained from an earlier session, but it must
    // never retake clock ownership while native playback is authoritative.
    if (this._nativeClockAuthority) return;
    if (this._audioContext === audioContext) return;

    const wasPlaying = this._state === "playing";
    if (wasPlaying) this.pause();

    if (this._ownsAudioContext && this._audioContext) {
      void this._audioContext.close();
    }

    this._audioContext = audioContext;
    this._ownsAudioContext = false;

    if (wasPlaying) this.play();
  }

  // ─── Getters (Imperative reads) ────────────────────────────────────────────

  /**
   * Check if seeking is in progress.
   */
  get isSeeking(): boolean {
    return this._isSeeking;
  }

  /**
   * Get current time (imperative read).
   * This is how consumers should read time - NOT via React state.
   */
  get time(): number {
    if (this._isSeeking) {
      return this._time;
    }
    // If native audio is authoritative, extrapolate from the latest bounded
    // native status sample between IPC updates. Rendering consumers still read
    // one clock signal and do not need to know which platform owns it.
    if (this._state === "playing" && this._nativeClockPosition) {
      const elapsed =
        Math.max(
          0,
          performance.now() - this._nativeClockPosition.receivedAtMs,
        ) / 1000;
      const computedTime =
        this._nativeClockPosition.time +
        elapsed * this._nativeClockPosition.speed;
      return Math.min(computedTime, this._duration);
    }

    // Native playback may not have delivered its first sample yet. Keep the
    // last bounded position instead of consulting a stale Web Audio context.
    if (this._nativeClockAuthority) {
      return this._time;
    }

    // If playing, calculate time synchronously based on audio context.
    // This ensures accurate time even if requestAnimationFrame is suspended (e.g. background tab).
    if (
      this._state === "playing" &&
      this._audioContext &&
      this._audioContext.state === "running"
    ) {
      const elapsed =
        (this._audioContext.currentTime - this._playStartAudioTime) *
        this._speed;
      const computedTime = this._playStartClockTime + elapsed;

      // Clamp to duration if we've reached the end
      if (computedTime >= this._duration) {
        return this._duration;
      }
      return computedTime;
    }
    return this._time;
  }

  /**
   * Alias for time - returns imperative continuous hardware clock time.
   */
  get currentTime(): number {
    return this.time;
  }

  /**
   * Get playback state.
   */
  get state(): PlaybackState {
    return this._state;
  }

  /**
   * Get playback speed.
   */
  get speed(): number {
    return this._speed;
  }

  /**
   * Get duration.
   */
  get duration(): number {
    return this._duration;
  }

  /**
   * Get frame rate.
   */
  get frameRate(): number {
    return this._frameRate;
  }

  /** Whether the native audio authority has supplied a usable position sample. */
  get hasNativeClockPosition(): boolean {
    return this._nativeClockPosition !== null;
  }

  /** Whether native CPAL owns program-preview playback time. */
  get isNativeClockAuthority(): boolean {
    return this._nativeClockAuthority;
  }

  /**
   * Select the native clock as the sole program-preview time authority.
   * This does not start audio; it only prevents Web Audio clock takeover.
   */
  setNativeClockAuthority(enabled: boolean): void {
    this._nativeClockAuthority = enabled;
    if (enabled) this._stallStartAudioTime = null;
  }

  /**
   * Feed the latest position from a native hardware audio clock. The value is
   * intentionally sampled rather than queried synchronously on every render.
   */
  setNativeClockPosition(time: number, speed: number = this._speed): void {
    if (!Number.isFinite(time)) return;
    const validSpeed = Number.isFinite(speed)
      ? Math.max(0.1, Math.min(4, speed))
      : this._speed;
    const clampedTime = Math.max(0, Math.min(time, this._duration));
    // Capture the UI-side extrapolation before replacing it with the newest
    // authoritative native sample. This measures clock/poll divergence only;
    // backend video-vs-audio drift is recorded in the native presentation path.
    recordAudioPoll(clampedTime * 1000, this.time * 1000);
    const backwardTolerance = Math.max(0.05, 1 / this._frameRate);
    if (
      this._state === "playing" &&
      !this._isSeeking &&
      clampedTime < this._time - backwardTolerance
    ) {
      return;
    }
    if (this._isSeeking || Math.abs(clampedTime - this._time) > 0.5) {
    }
    this._nativeClockPosition = {
      time: clampedTime,
      receivedAtMs: performance.now(),
      speed: validSpeed,
    };
    this._time = clampedTime;
  }

  /** Stop consuming native samples and return to the local audio clock. */
  clearNativeClockPosition(): void {
    this._nativeClockPosition = null;
  }

  /**
   * Get full state snapshot (for UI).
   */
  getState(): PlaybackClockState {
    return {
      time: this.time,
      state: this._state,
      speed: this._speed,
      duration: this._duration,
      frameRate: this._frameRate,
    };
  }

  // ─── Setters (Imperative control) ──────────────────────────────────────────

  /**
   * Set duration.
   */
  setDuration(duration: number): void {
    const validDuration =
      typeof duration === "number" && !isNaN(duration) && isFinite(duration)
        ? duration
        : 0;
    this._duration = Math.max(0, validDuration);
    this._notifyListeners();
  }

  /**
   * Set frame rate.
   */
  setFrameRate(fps: number): void {
    this._frameRate = Math.max(1, fps);
    this._notifyListeners();
  }

  /**
   * Set playback speed.
   * PB-BUG-006 fix: Syncs _time from AudioContext before pausing to prevent
   * ~8ms drift caused by stale _time from the last RAF tick.
   */
  setSpeed(speed: number): void {
    const wasPlaying = this._state === "playing";

    if (wasPlaying) {
      // Sync from whichever clock is authoritative. During native takeover,
      // reading AudioContext here would rewind/advance the playhead away from
      // the CPAL hardware position.
      this._time = this.time;
      this.pause(true);
    }

    this._speed = Math.max(0.1, Math.min(4, speed));

    if (wasPlaying) {
      this.play();
    }

    this._notifyListeners();
  }

  // ─── Playback Control ──────────────────────────────────────────────────────

  /**
   * Start playback.
   */
  play(): void {
    if (this._state === "playing") {
      return;
    }

    // Treat Play at the terminal playhead position as a restart. Without this,
    // the next RAF tick immediately reaches duration again and playback appears
    // to do nothing after a completed timeline.
    if (this._duration > 0 && this._time >= this._duration) {
      this._time = 0;
      this._isSeeking = false;
    }

    if (this._nativeClockAuthority) {
      this._nativeClockPosition = {
        time: this._time,
        receivedAtMs: performance.now(),
        speed: this._speed,
      };
    } else {
      // Initialize AudioContext for high-precision browser timing.
      if (!this._audioContext) {
        this._audioContext = new AudioContext();
        this._ownsAudioContext = true;
      }

      if (this._audioContext.state === "suspended") {
        void this._audioContext.resume();
      }

      // Record start times for the browser clock.
      this._playStartAudioTime = this._audioContext.currentTime;
      this._playStartClockTime = this._time;
    }

    this._state = "playing";
    this._notifyListeners();

    // Increment generation to invalidate stale RAF ticks
    this._generation++;
    const currentGeneration = this._generation;

    // Start RAF loop with generation check
    this._rafId = requestAnimationFrame(() =>
      this._tickWithGeneration(currentGeneration),
    );
  }

  /**
   * Pause playback.
   */
  pause(skipTimeSync: boolean = false): void {
    if (this._state !== "playing") {
      this._isSeeking = false;
      return;
    }

    // Sync precise live time from the authoritative clock before pausing.
    // `this.time` uses the sampled native audio position when native playback
    // is active and falls back to AudioContext otherwise.
    if (!skipTimeSync) {
      this._time = Math.max(0, Math.min(this.time, this._duration));
    }

    // Snap playhead to nearest frame boundary of the project's frame rate
    const frameRate = this._frameRate;
    this._time = Math.round(this._time * frameRate) / frameRate;

    this._state = "paused";
    this._isSeeking = false;
    this._nativeClockPosition = null; // Clear native clock sample so no stale pre-pause timestamps survive
    this._notifyListeners();

    // Stop RAF loop
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /**
   * Stop playback (pause + reset to 0).
   * PB-BUG-002 fix: Batches all state changes into a single notification
   * instead of firing 3 separate notifications (pause, seek, stopped).
   */
  stop(): void {
    // Stop RAF loop directly (don't call pause() which would notify)
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    // Batch all state changes atomically
    this._state = "stopped";
    this._time = 0;
    this._isSeeking = false;
    this._nativeClockPosition = null;

    // Single notification for all changes
    this._notifyListeners();
  }

  /**
   * Seek to specific time.
   */
  seek(time: number): void {
    const seekRevision = ++this._seekRevision;
    const wasPlaying = this._state === "playing";

    if (wasPlaying) {
      this.pause();
    }

    const validTime =
      typeof time === "number" && !isNaN(time) && isFinite(time) ? time : 0;
    const rawTime = Math.max(0, Math.min(validTime, this._duration));

    // Snap seek time to nearest frame boundary of the project's frame rate
    const frameRate = this._frameRate;
    this._time = Math.round(rawTime * frameRate) / frameRate;

    this._isSeeking = true;

    this._notifyListeners();

    if (wasPlaying) {
      this.play();
    }
  }

  /**
   * Complete the seeking state and align playback start times.
   */
  completeSeek(): void {
    if (!this._isSeeking) return;

    this._isSeeking = false;
    if (
      this._state === "playing" &&
      this._audioContext &&
      !this._nativeClockAuthority
    ) {
      this._playStartAudioTime = this._audioContext.currentTime;
      this._playStartClockTime = this._time;
    }
    this._notifyListeners();
  }

  // ─── RAF Loop (Private) ────────────────────────────────────────────────────

  /**
   * RAF tick wrapper with generation check.
   * Prevents stale RAF ticks from executing after seek/pause/play cycle.
   */
  private _tickWithGeneration(generation: number): void {
    // Ignore this tick if generation doesn't match
    // This happens when seek() does pause→play cycle and old RAF tick executes
    if (generation !== this._generation) {
      return; // Stale tick, ignore
    }

    this._tick(generation);
  }

  /**
   * RAF tick - updates time continuously.
   * This is NOT a React render. This is a continuous signal.
   */
  private _tick(generation: number): void {
    // Safety check: if RAF was cancelled, don't continue
    if (this._rafId === null) return;

    if (this._state !== "playing") return;

    if (this._isSeeking) {
      // While seeking, do not advance time, just notify listeners and keep RAF loop alive
      const now = Date.now();
      if (now - this._lastNotifyTime > this._notifyThrottleMs) {
        this._notifyListeners();
        this._lastNotifyTime = now;
      }
      this._rafId = requestAnimationFrame(() =>
        this._tickWithGeneration(generation),
      );
      return;
    }

    // Native samples drive the clock during Tauri program playback. Browser
    // preview uses AudioContext as its local high-precision time source.
    let newTime: number;
    if (this._nativeClockAuthority || this._nativeClockPosition) {
      newTime = this.time;
    } else if (this._audioContext) {
      const elapsed =
        (this._audioContext.currentTime - this._playStartAudioTime) *
        this._speed;
      newTime = this._playStartClockTime + elapsed;
    } else {
      // Keep the handoff safe before native delivers its first sample.
      newTime = this._time;
    }

    // Update time
    if (newTime >= this._duration) {
      // Reached end
      this._time = this._duration;
      this._state = "paused";
      this._rafId = null; // Clear RAF ID when stopping
      // Bug 8 fix: clear the native clock position so late-arriving IPC samples
      // from the native audio controller cannot move the scrubber past duration
      // after end-of-timeline auto-pause. `stop()` already clears this; `pause()`
      // from end-of-timeline was the only path that did not.
      this._nativeClockPosition = null;
      this._notifyListeners();
      return;
    }

    this._time = newTime;

    // Throttled UI notification (max 10fps, not 60fps)
    const now = Date.now();
    if (now - this._lastNotifyTime > this._notifyThrottleMs) {
      this._notifyListeners();
      this._lastNotifyTime = now;
    }

    // Continue loop with generation check
    this._rafId = requestAnimationFrame(() =>
      this._tickWithGeneration(generation),
    );
  }

  // ─── Stall Compensation ────────────────────────────────────────────────────

  /**
   * Record the AudioContext time just before a synchronous blocking operation
   * (e.g. GPU shader compilation via mountTransition).
   *
   * Must be paired with compensateStall() after the operation completes.
   * Safe to call when not playing — becomes a no-op.
   */
  recordStallStart(): void {
    if (this._state !== "playing" || !this._audioContext) return;
    this._stallStartAudioTime = this._audioContext.currentTime;
  }

  /**
   * Compensate for the wall-clock time consumed by a synchronous blocking
   * operation started with recordStallStart().
   *
   * Adjusts _playStartAudioTime forward by the duration of the stall so the
   * clock does not jump ahead, preventing the post-stall drift-recovery seek.
   *
   * Safe to call even if recordStallStart() was never called — becomes a no-op.
   */
  compensateStall(): void {
    if (this._stallStartAudioTime === null || !this._audioContext) {
      this._stallStartAudioTime = null;
      return;
    }
    const stallDuration =
      this._audioContext.currentTime - this._stallStartAudioTime;
    if (stallDuration > 0 && this._state === "playing") {
      this._playStartAudioTime += stallDuration;
    }
    this._stallStartAudioTime = null;
  }

  // ─── Subscription (For UI snapshots only) ──────────────────────────────────

  /**
   * Subscribe to state changes.
   * NOTE: This is for UI updates only (throttled to 10fps).
   * Render loops should read `clock.time` imperatively, not via subscription.
   */
  subscribe(listener: PlaybackClockListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * Notify listeners (throttled).
   */
  private _notifyListeners(): void {
    const state = this.getState();
    this._listeners.forEach((listener) => listener(state));
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  /**
   * Dispose clock (cleanup).
   * CRITICAL: Always cancel RAF, regardless of state.
   */
  dispose(): void {
    // ✅ ALWAYS cancel RAF, regardless of state
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    this._state = "stopped";
    this._time = 0;
    this._listeners.clear();
    this._nativeClockPosition = null;
    this._nativeClockAuthority = false;

    if (this._audioContext && this._ownsAudioContext) {
      this._audioContext.close();
    }
    this._audioContext = null;
    this._ownsAudioContext = false;
  }
}

/**
 * Global playback clock instance.
 */
let globalClock: PlaybackClock | null = null;

/**
 * Get or create global playback clock.
 */
export function getPlaybackClock(audioContext?: AudioContext): PlaybackClock {
  if (!globalClock) {
    globalClock = new PlaybackClock();
  }
  if (audioContext) {
    globalClock.attachAudioContext(audioContext);
  }
  return globalClock;
}

/**
 * Reset global playback clock (for testing).
 */
export function resetPlaybackClock(): void {
  if (globalClock) {
    globalClock.dispose();
  }
  globalClock = null;
}
