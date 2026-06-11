/**
 * Playback Clock - Continuous Time Signal
 *
 * This is NOT React state. This is an imperative playback engine.
 *
 * Key principles:
 * - Time is a continuous signal, not discrete state
 * - Consumers subscribe and read imperatively
 * - No React re-renders on every tick
 * - High-frequency updates (60fps) without React overhead
 *
 * Architecture:
 *   PlaybackClock (signal source)
 *       ↓
 *   Imperative consumers (canvas, audio, UI snapshots)
 *
 * This prevents:
 * - React render storms
 * - Effect cancellation loops
 * - Audio/video sync hammering
 */

export type PlaybackState = "playing" | "paused" | "stopped";

export interface PlaybackClockState {
  /** Current playback time (seconds) */
  time: number;

  /** Playback state */
  state: PlaybackState;

  /** Playback speed multiplier */
  speed: number;

  /** Timeline duration */
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

  // RAF loop
  private _rafId: number | null = null;
  private _audioContext: AudioContext | null = null;
  private _playStartAudioTime: number = 0;
  private _playStartClockTime: number = 0;

  // Listeners (for UI snapshots only, not every frame)
  private _listeners = new Set<PlaybackClockListener>();
  private _lastNotifyTime: number = 0;
  private _notifyThrottleMs: number = 100; // Notify UI max 10fps

  constructor() {
    // Bind methods for stable references
    this._tick = this._tick.bind(this);
  }

  // ─── Getters (Imperative reads) ────────────────────────────────────────────

  /**
   * Get current time (imperative read).
   * This is how consumers should read time - NOT via React state.
   */
  get time(): number {
    // If playing, calculate time synchronously based on audio context.
    // This ensures accurate time even if requestAnimationFrame is suspended (e.g. background tab).
    if (this._state === "playing" && this._audioContext && this._audioContext.state === "running") {
      const elapsed = (this._audioContext.currentTime - this._playStartAudioTime) * this._speed;
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
    const validDuration = typeof duration === "number" && !isNaN(duration) && isFinite(duration) ? duration : 0;
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
   */
  setSpeed(speed: number): void {
    const wasPlaying = this._state === "playing";

    if (wasPlaying) {
      this.pause();
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

    // Initialize AudioContext for high-precision timing
    if (!this._audioContext) {
      this._audioContext = new AudioContext();
    }

    if (this._audioContext.state === "suspended") {
      this._audioContext.resume();
    }

    // Record start times
    this._playStartAudioTime = this._audioContext.currentTime;
    this._playStartClockTime = this._time;

    this._state = "playing";
    this._notifyListeners();

    // Start RAF loop
    this._rafId = requestAnimationFrame(this._tick);
  }

  /**
   * Pause playback.
   */
  pause(): void {
    if (this._state !== "playing") return;

    this._state = "paused";
    this._notifyListeners();

    // Stop RAF loop
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /**
   * Stop playback (pause + reset to 0).
   */
  stop(): void {
    this.pause();
    this.seek(0);
    this._state = "stopped";
    this._notifyListeners();
  }

  /**
   * Seek to specific time.
   */
  seek(time: number): void {
    const wasPlaying = this._state === "playing";

    if (wasPlaying) {
      this.pause();
    }

    const validTime = typeof time === "number" && !isNaN(time) && isFinite(time) ? time : 0;
    this._time = Math.max(0, Math.min(validTime, this._duration));
    this._notifyListeners();

    if (wasPlaying) {
      this.play();
    }
  }

  // ─── RAF Loop (Private) ────────────────────────────────────────────────────

  /**
   * RAF tick - updates time continuously.
   * This is NOT a React render. This is a continuous signal.
   */
  private _tick(): void {
    // Safety check: if RAF was cancelled, don't continue
    if (this._rafId === null) return;

    if (this._state !== "playing") return;

    // Calculate elapsed time using AudioContext (high precision)
    const audioContext = this._audioContext!;
    const elapsed = (audioContext.currentTime - this._playStartAudioTime) * this._speed;
    const newTime = this._playStartClockTime + elapsed;

    // Update time
    if (newTime >= this._duration) {
      // Reached end
      this._time = this._duration;
      this._state = "paused";
      this._rafId = null; // Clear RAF ID when stopping
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

    // Continue loop
    this._rafId = requestAnimationFrame(this._tick);
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

    if (this._audioContext) {
      this._audioContext.close();
      this._audioContext = null;
    }
  }
}

/**
 * Global playback clock instance.
 */
let globalClock: PlaybackClock | null = null;

/**
 * Get or create global playback clock.
 */
export function getPlaybackClock(): PlaybackClock {
  if (!globalClock) {
    globalClock = new PlaybackClock();
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
