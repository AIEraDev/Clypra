import type { PlaybackContext, PlaybackContextType, PlaybackContextStateSnapshot } from "./PlaybackContext";
import { SeekController, type SeekIntentInput } from "./seekController";
import { recordSeekRequested } from "@/lib/playback/syncMetrics";
import type { PlaybackState } from "./PlaybackClock";

export type AuthorityContextSwitchListener = (type: PlaybackContextType | null) => void;
export type AuthorityStateListener = (state: PlaybackContextStateSnapshot) => void;
export type TransportEventKind =
  | "play"
  | "pause"
  | "stop"
  | "seek"
  | "context-switch"
  | "completed";
export interface TransportEvent {
  epoch: number;
  kind: TransportEventKind;
  contextType: PlaybackContextType | null;
  time: number;
}
export type TransportEventListener = (event: TransportEvent) => void;

/**
 * Transport Authority - Single source of truth for playback ownership.
 *
 * Ensures only one playback context (source or program) is active at a time.
 * Delegates transport commands (play, pause, seek) to the active context.
 */
export class TransportAuthority {
  private readonly seekController = new SeekController();
  private activeContext: PlaybackContext | null = null;
  private contexts = new Map<PlaybackContextType, PlaybackContext>();
  private _switchListeners = new Set<AuthorityContextSwitchListener>();
  private _stateListeners = new Set<AuthorityStateListener>();
  private _ctxUnsubscribe: (() => void) | null = null;
  private _transportEpoch = 0;
  private _lastContextState: PlaybackState | null = null;
  private _transportListeners = new Set<TransportEventListener>();
  /**
   * BUG-4 fix: Reference-counted pause latch for scrubbing.
   * Replaces the single `_wasPlayingBeforeScrub` boolean which was corrupted by
   * overlapping beginScrub/endScrub calls (e.g. rapid back-seeks or pointer events
   * arriving out of order). The clock is only resumed when depth drops back to zero.
   */
  private _scrubPauseDepth: number = 0;

  registerContext(context: PlaybackContext): void {
    if (this.contexts.has(context.type)) {
      console.warn(`[TransportAuthority] Context '${context.type}' already registered. Overwriting.`);
    }
    this.contexts.set(context.type, context);

    // Auto-activate first registered context if none active
    if (!this.activeContext) {
      this.setActiveContext(context.type);
    }
  }

  setActiveContext(type: PlaybackContextType): void {
    const next = this.contexts.get(type) ?? null;
    if (!next) {
      console.warn(`[TransportAuthority] No context registered for type: ${type}`);
      return;
    }
    if (this.activeContext === next) {
      return;
    }

    this.seekController.invalidate();

    // Detach the old context before pausing it. Its state transition belongs
    // to the context handoff, not a natural completion of the newly active
    // program, and must never emit a terminal transport event.
    if (this._ctxUnsubscribe) {
      this._ctxUnsubscribe();
      this._ctxUnsubscribe = null;
    }

    if (this.activeContext) {
      this.activeContext.pause();
    }

    this.activeContext = next;
    this._lastContextState = null;
    // Advance only after the new context becomes active, so observers get a
    // self-consistent event (new owner + new position) rather than the stale
    // context that was just detached.
    this._advanceTransportEpoch("context-switch");

    // Subscribe to new context's state changes
    this._ctxUnsubscribe = next.subscribe((snapshot) => {
      const previous = this._lastContextState;
      this._lastContextState = snapshot.state;
      // Command transitions advance the epoch before they reach the context.
      // The context subscription owns only the implicit terminal transition
      // emitted when media naturally reaches the end of a program sequence.
      if (
        previous === "playing" &&
        previous !== snapshot.state &&
        snapshot.duration > 0 &&
        snapshot.time >= snapshot.duration
      ) {
        this._advanceTransportEpoch(
          "completed",
        );
      }
      this._notifyStateListeners(snapshot);
    });

    this._notifySwitchListeners(type);
  }

  getActiveContext(): PlaybackContext | null {
    return this.activeContext;
  }

  getActiveType(): PlaybackContextType | null {
    return this.activeContext?.type ?? null;
  }

  // ─── Unified Transport Controls ────────────────────────────────────────

  play(): void {
    this._advanceTransportEpoch("play");
    this.issueTransportIntent("playback");
    this.activeContext?.play();
  }

  /** Toggle the active context from its live state without a throttled UI snapshot. */
  togglePlayback(): void {
    const context = this.activeContext;
    if (!context) return;
    if (context.getState() === "playing") {
      this._advanceTransportEpoch("pause");
      this.issueTransportIntent("seek");
      context.pause();
    } else {
      this._advanceTransportEpoch("play");
      this.issueTransportIntent("playback");
      context.play();
    }
  }

  pause(): void {
    this._advanceTransportEpoch("pause");
    this.issueTransportIntent("seek");
    this.activeContext?.pause();
  }

  stop(): void {
    this._advanceTransportEpoch("stop");
    this.issueTransportIntent("seek");
    this.activeContext?.stop();
  }

  seek(time: number, intent: Omit<SeekIntentInput, "time"> = { mode: "seek" }): void {
    this._advanceTransportEpoch("seek");
    recordSeekRequested();
    const isPlaying = this.getState() === "playing";
    this.seekController.request({
      time,
      ...intent,
      mode: isPlaying ? "playback" : (intent.mode ?? "seek"),
      ...(isPlaying && intent.allowKeyframeApprox === undefined ? { allowKeyframeApprox: true } : {}),
    });
    this.activeContext?.seek(time);
  }

  beginScrub(time: number, source: string = "playhead"): void {
    const isPlaying = this.getState() === "playing";
    if (isPlaying) {
      // Only pause and increment depth when we were actually playing.
      // This keeps the depth counter truthful: one increment per actual pause.
      this.pause();
      this._scrubPauseDepth++;
    }
    this.seekController.beginScrub({ time, source });
    this.activeContext?.seek(time);
  }

  updateScrub(time: number, velocityPxPerSecond?: number): void {
    this.seekController.updateScrub({ time, velocityPxPerSecond });
    this.activeContext?.seek(time);
  }

  endScrub(time: number): void {
    this.seekController.endScrub({ time });
    this.activeContext?.seek(time);
    if (this._scrubPauseDepth > 0) {
      this._scrubPauseDepth--;
      if (this._scrubPauseDepth === 0) {
        // All nested scrub gestures have ended — resume playback.
        this.play();
      }
    }
  }

  getSeekController(): SeekController {
    return this.seekController;
  }

  setSpeed(speed: number): void {
    this.activeContext?.setSpeed(speed);
  }

  getTime(): number {
    return this.activeContext?.getTime() ?? 0;
  }

  getDuration(): number {
    return this.activeContext?.getDuration() ?? 0;
  }

  getState() {
    return this.activeContext?.getState() ?? "stopped";
  }

  getSnapshot(): PlaybackContextStateSnapshot {
    return (
      this.activeContext?.getSnapshot() ?? {
        time: 0,
        state: "stopped" as const,
        duration: 0,
        speed: 1,
      }
    );
  }

  /** Monotonic session transport revision. Async native work must capture and
   * validate this before it writes time, state, or pixels back to the UI. */
  getTransportEpoch(): number {
    return this._transportEpoch;
  }

  isCurrentTransportEpoch(epoch: number): boolean {
    return epoch === this._transportEpoch;
  }

  // ─── Subscriptions ─────────────────────────────────────────────────────

  subscribeToContextSwitch(listener: AuthorityContextSwitchListener): () => void {
    this._switchListeners.add(listener);
    return () => this._switchListeners.delete(listener);
  }

  subscribeToState(listener: AuthorityStateListener): () => void {
    this._stateListeners.add(listener);
    return () => this._stateListeners.delete(listener);
  }

  subscribeToTransportEvents(listener: TransportEventListener): () => void {
    this._transportListeners.add(listener);
    return () => this._transportListeners.delete(listener);
  }

  private _notifySwitchListeners(type: PlaybackContextType | null): void {
    this._switchListeners.forEach((l) => l(type));
  }

  private _notifyStateListeners(state: PlaybackContextStateSnapshot): void {
    this._stateListeners.forEach((l) => l(state));
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────

  dispose(): void {
    this.seekController.dispose();
    if (this._ctxUnsubscribe) {
      this._ctxUnsubscribe();
      this._ctxUnsubscribe = null;
    }
    this._switchListeners.clear();
    this._stateListeners.clear();
    this._transportListeners.clear();
    this._scrubPauseDepth = 0;
    this.contexts.forEach((ctx) => ctx.dispose());
    this.contexts.clear();
    this.activeContext = null;
  }

  private issueTransportIntent(mode: "playback" | "seek"): void {
    const context = this.activeContext;
    if (!context) {
      this.seekController.invalidate();
      return;
    }
    this.seekController.request({ time: context.getTime(), mode });
  }

  private _advanceTransportEpoch(kind: TransportEventKind): void {
    this._transportEpoch += 1;
    this._transportListeners.forEach((listener) =>
      listener({
        epoch: this._transportEpoch,
        kind,
        contextType: this.getActiveType(),
        time: this.getTime(),
      }),
    );
  }
}
