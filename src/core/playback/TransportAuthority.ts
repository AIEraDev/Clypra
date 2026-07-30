import type { PlaybackContext, PlaybackContextType, PlaybackContextStateSnapshot } from "./PlaybackContext";

export type AuthorityContextSwitchListener = (type: PlaybackContextType | null) => void;
export type AuthorityStateListener = (state: PlaybackContextStateSnapshot) => void;

/**
 * Transport Authority - Single source of truth for playback ownership.
 *
 * Ensures only one playback context (source or program) is active at a time.
 * Delegates transport commands (play, pause, seek) to the active context.
 */
export class TransportAuthority {
  private activeContext: PlaybackContext | null = null;
  private contexts = new Map<PlaybackContextType, PlaybackContext>();
  private _switchListeners = new Set<AuthorityContextSwitchListener>();
  private _stateListeners = new Set<AuthorityStateListener>();
  private _ctxUnsubscribe: (() => void) | null = null;

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

    // Pause previous context before switching
    if (this.activeContext && this.activeContext !== next) {
      this.activeContext.pause();
    }

    // Unsubscribe from previous context state
    if (this._ctxUnsubscribe) {
      this._ctxUnsubscribe();
      this._ctxUnsubscribe = null;
    }

    this.activeContext = next;

    // Subscribe to new context's state changes
    this._ctxUnsubscribe = next.subscribe((snapshot) => {
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
    this.activeContext?.play();
  }

  /** Toggle the active context from its live state without a throttled UI snapshot. */
  togglePlayback(): void {
    const context = this.activeContext;
    if (!context) return;
    if (context.getState() === "playing") {
      context.pause();
    } else {
      context.play();
    }
  }

  pause(): void {
    this.activeContext?.pause();
  }

  stop(): void {
    this.activeContext?.stop();
  }

  seek(time: number): void {
    this.activeContext?.seek(time);
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

  // ─── Subscriptions ─────────────────────────────────────────────────────

  subscribeToContextSwitch(listener: AuthorityContextSwitchListener): () => void {
    this._switchListeners.add(listener);
    return () => this._switchListeners.delete(listener);
  }

  subscribeToState(listener: AuthorityStateListener): () => void {
    this._stateListeners.add(listener);
    return () => this._stateListeners.delete(listener);
  }

  private _notifySwitchListeners(type: PlaybackContextType | null): void {
    this._switchListeners.forEach((l) => l(type));
  }

  private _notifyStateListeners(state: PlaybackContextStateSnapshot): void {
    this._stateListeners.forEach((l) => l(state));
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────

  dispose(): void {
    if (this._ctxUnsubscribe) {
      this._ctxUnsubscribe();
      this._ctxUnsubscribe = null;
    }
    this._switchListeners.clear();
    this._stateListeners.clear();
    this.contexts.forEach((ctx) => ctx.dispose());
    this.contexts.clear();
    this.activeContext = null;
  }
}
