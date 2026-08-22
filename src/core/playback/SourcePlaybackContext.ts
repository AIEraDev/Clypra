import type { PlaybackContext, PlaybackContextStateSnapshot, PlaybackContextListener, PlaybackContextType } from "./PlaybackContext";
import type { PlaybackState } from "./PlaybackClock";

/**
 * Source Playback Context - Independent playback for source (media) preview.
 *
 * Wraps an HTMLMediaElement (video or audio) to provide a unified
 * PlaybackContext interface. This is the "source monitor" context in NLE terminology.
 */
export class SourcePlaybackContext implements PlaybackContext {
  readonly type: PlaybackContextType = "source";

  private _mediaElement: HTMLMediaElement | null = null;
  private _listeners = new Set<PlaybackContextListener>();
  private _cleanupMediaListeners: (() => void) | null = null;
  private _speed: number = 1;
  private _outPointRafId: number | null = null;
  private _inPoint: number | null = null;
  private _outPoint: number | null = null;

  /**
   * Bind (or unbind) an HTMLMediaElement to this context.
   * Call with `null` to unbind.
   */
  setMediaElement(element: HTMLMediaElement | null): void {
    // Unbinding is a lifecycle boundary. Pause the old element before
    // dropping the reference so source audio cannot continue after leaving
    // the project/session or switching source assets.
    if (!element && this._mediaElement) {
      this._mediaElement.pause?.();
    }

    // Clean up old listeners
    if (this._cleanupMediaListeners) {
      this._cleanupMediaListeners();
      this._cleanupMediaListeners = null;
    }

    this._mediaElement = element;

    if (!element) {
      this._notifyListeners();
      return;
    }

    // Sync speed
    element.playbackRate = this._speed;

    const onTimeUpdate = () => this._notifyListeners();
    const onLoadedMetadata = () => this._notifyListeners();
    const onLoadedData = () => this._notifyListeners();
    const onCanPlay = () => this._notifyListeners();
    const onDurationChange = () => this._notifyListeners();
    const onEnded = () => this._notifyListeners();
    const onPlay = () => this._notifyListeners();
    const onPause = () => this._notifyListeners();

    element.addEventListener("timeupdate", onTimeUpdate);
    element.addEventListener("loadedmetadata", onLoadedMetadata);
    element.addEventListener("loadeddata", onLoadedData);
    element.addEventListener("canplay", onCanPlay);
    element.addEventListener("durationchange", onDurationChange);
    element.addEventListener("ended", onEnded);
    element.addEventListener("play", onPlay);
    element.addEventListener("pause", onPause);

    this._cleanupMediaListeners = () => {
      element.removeEventListener("timeupdate", onTimeUpdate);
      element.removeEventListener("loadedmetadata", onLoadedMetadata);
      element.removeEventListener("loadeddata", onLoadedData);
      element.removeEventListener("canplay", onCanPlay);
      element.removeEventListener("durationchange", onDurationChange);
      element.removeEventListener("ended", onEnded);
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
    };

    this._notifyListeners();
  }

  // ─── Transport Control ─────────────────────────────────────────────────

  play(): void {
    if (!this._mediaElement) return;

    if (this._outPoint !== null && this.getTime() >= this._outPoint) {
      // SP-5 fix: If playhead is at or past outPoint, wrap to inPoint (or 0 if no inPoint is set)
      // so pressing Play restarts playback across the active region.
      this.seek(this._inPoint !== null ? this._inPoint : 0);
    }

    this._mediaElement.play().catch((err) => {
      // A source can be replaced or unbound while play() is resolving. The
      // browser reports that normal lifecycle cancellation as AbortError;
      // it is not a playback failure and should not pollute the console.
      if ((err as { name?: string } | null)?.name === "AbortError") return;
      console.warn("[SourcePlaybackContext] Play failed:", err);
    });
    this._startOutPointCheck();
  }

  pause(): void {
    if (!this._mediaElement) return;
    this._mediaElement.pause();
    this._stopOutPointCheck();
  }

  stop(): void {
    this.pause();
    this.seek(0);
    this._notifyListeners();
  }

  seek(time: number): void {
    if (!this._mediaElement) return;
    const dur = this._mediaElement.duration || 0;
    this._mediaElement.currentTime = Math.max(0, Math.min(time, dur));
    this._notifyListeners();
  }

  setSpeed(speed: number): void {
    this._speed = Math.max(0.1, Math.min(4, speed));
    if (this._mediaElement) {
      this._mediaElement.playbackRate = this._speed;
    }
    this._notifyListeners();
  }

  // ─── State Queries ───────────────────────────────────────────────────────

  getTime(): number {
    const time = this._mediaElement?.currentTime ?? 0;
    return Number.isFinite(time) && time >= 0 ? time : 0;
  }

  getDuration(): number {
    const duration = this._mediaElement?.duration ?? 0;
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  }

  /**
   * PB-BUG-003 fix: Check element.ended before element.paused.
   * When media ends naturally, element.paused is true AND element.ended is true.
   * Reporting "stopped" instead of "paused" is the correct NLE behavior.
   */
  getState(): PlaybackState {
    if (!this._mediaElement) return "stopped";
    if (this._mediaElement.ended) return "stopped";
    return this._mediaElement.paused ? "paused" : "playing";
  }

  getSpeed(): number {
    return this._speed;
  }

  getSnapshot(): PlaybackContextStateSnapshot {
    return {
      time: this.getTime(),
      state: this.getState(),
      duration: this.getDuration(),
      speed: this.getSpeed(),
    };
  }

  // ─── In / Out Points ───────────────────────────────────────────────────

  setInPoint(time: number | null): void {
    this._inPoint = time;
  }

  setOutPoint(time: number | null): void {
    this._outPoint = time;
  }

  getInPoint(): number | null {
    return this._inPoint;
  }

  getOutPoint(): number | null {
    return this._outPoint;
  }

  clearMarks(): void {
    this._inPoint = null;
    this._outPoint = null;
  }

  playMarkedRegion(): void {
    if (this._inPoint === null || this._outPoint === null) return;
    this.seek(this._inPoint);
    this.play();
  }

  // ─── Subscription ────────────────────────────────────────────────────────

  subscribe(listener: PlaybackContextListener): () => void {
    this._listeners.add(listener);
    listener(this.getSnapshot());
    return () => this._listeners.delete(listener);
  }

  private _notifyListeners(): void {
    const snapshot = this.getSnapshot();
    this._listeners.forEach((l) => l(snapshot));
  }

  // ─── Out-point guard ───────────────────────────────────────────────────

  /**
   * PB-BUG-004 fix: Use RAF-based out-point guard instead of setInterval(50ms).
   * RAF is automatically throttled when tab is backgrounded, preventing
   * overshoot caused by timer drift in background tabs.
   */
  private _startOutPointCheck(): void {
    this._stopOutPointCheck();
    if (this._outPoint === null) return;

    const checkLoop = () => {
      if (this._outPointRafId === null) return; // stopped
      if (this.getTime() >= this._outPoint!) {
        this.pause();
        return;
      }
      this._outPointRafId = requestAnimationFrame(checkLoop);
    };
    this._outPointRafId = requestAnimationFrame(checkLoop);
  }

  private _stopOutPointCheck(): void {
    if (this._outPointRafId !== null) {
      cancelAnimationFrame(this._outPointRafId);
      this._outPointRafId = null;
    }
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────

  dispose(): void {
    this._stopOutPointCheck();
    if (this._cleanupMediaListeners) {
      this._cleanupMediaListeners();
      this._cleanupMediaListeners = null;
    }
    this._mediaElement = null;
    this._listeners.clear();
  }
}
