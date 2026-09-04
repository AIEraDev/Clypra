import type { PlaybackState } from "@/core/playback/PlaybackClock";
import { previewQualificationController } from "@/core/playback/previewPerformanceContract";

export type PreviewInteractionKind =
  | "scrub"
  | "transform"
  | "clip-move"
  | "clip-trim"
  | "split"
  | "audio-envelope"
  | "property-edit"
  | "selection";

export type PreviewInteractionCancelReason =
  | "conflict"
  | "pointer-cancel"
  | "transport"
  | "undo-redo"
  | "project-reset"
  | "qualification"
  | "disposed";

export interface PreviewGeneration {
  /** Monotonic coordinator generation. */
  revision: number;
  /** Monotonic interaction id for diagnostics and stale-frame rejection. */
  interactionId: number;
}

export interface PreviewInteractionToken {
  readonly kind: PreviewInteractionKind;
  readonly interactionId: number;
  readonly generation: number;
}

export interface PreviewTransportBridge {
  getState: () => PlaybackState;
  pause: () => void;
  play: () => void;
}

export interface PreviewInteractionOptions {
  /** Selection is allowed to begin while paused only. */
  pauseOnBegin?: boolean;
}

export interface PreviewInteractionSnapshot {
  generation: PreviewGeneration;
  active: PreviewInteractionToken | null;
  resumedPlayback: boolean;
}

type CoordinatorListener = (snapshot: PreviewInteractionSnapshot) => void;

/**
 * Coordinates all user interactions which can change what the Program Preview
 * shows. It is deliberately renderer-agnostic: the Native Rust render session
 * and the WebView scheduler consume the generation, while this class owns only
 * interaction exclusivity and transport boundaries.
 */
export class PreviewInteractionCoordinator {
  private transport: PreviewTransportBridge | null = null;
  private active: {
    token: PreviewInteractionToken;
    resumedPlayback: boolean;
  } | null = null;
  private revision = 0;
  private interactionId = 0;
  private disposed = false;
  private listeners = new Set<CoordinatorListener>();

  registerTransport(bridge: PreviewTransportBridge): () => void {
    if (this.disposed) return () => undefined;
    this.transport = bridge;
    return () => {
      if (this.transport === bridge) this.transport = null;
    };
  }

  getGeneration(): PreviewGeneration {
    return { revision: this.revision, interactionId: this.interactionId };
  }

  getSnapshot(): PreviewInteractionSnapshot {
    return {
      generation: this.getGeneration(),
      active: this.active?.token ?? null,
      resumedPlayback: this.active?.resumedPlayback ?? false,
    };
  }

  subscribe(listener: CoordinatorListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  /** Begin one exclusive interaction and pause playback at the boundary. */
  begin(
    kind: PreviewInteractionKind,
    options: PreviewInteractionOptions = {},
  ): PreviewInteractionToken {
    if (this.disposed) throw new Error("PreviewInteractionCoordinator is disposed");
    previewQualificationController.cancel();

    // A conflicting gesture must not resume playback between cancellation and
    // the next begin call. The replacement interaction owns the pause boundary.
    const inheritedResume = this.active?.resumedPlayback ?? false;
    if (this.active) this.finishActive("conflict", false);

    const shouldPause = options.pauseOnBegin ?? kind !== "selection";
    const wasPlaying = this.transport?.getState() === "playing";
    if (shouldPause && wasPlaying) this.transport?.pause();

    const token: PreviewInteractionToken = {
      kind,
      interactionId: ++this.interactionId,
      generation: ++this.revision,
    };
    this.active = {
      token,
      resumedPlayback: shouldPause && (wasPlaying || inheritedResume),
    };
    this.emit();
    return token;
  }

  isCurrent(token: PreviewInteractionToken): boolean {
    return Boolean(
      !this.disposed &&
        this.active?.token.interactionId === token.interactionId &&
        this.active.token.generation === token.generation,
    );
  }

  /** Advance the generation without beginning an interaction. */
  invalidate(): PreviewGeneration {
    this.revision += 1;
    this.emit();
    return this.getGeneration();
  }

  commit(token: PreviewInteractionToken, resume = true): boolean {
    if (!this.isCurrent(token)) return false;
    this.finishActive("pointer-cancel", resume);
    return true;
  }

  cancel(
    token: PreviewInteractionToken,
    reason: PreviewInteractionCancelReason = "pointer-cancel",
    resume = reason !== "project-reset" && reason !== "qualification",
  ): boolean {
    if (!this.isCurrent(token)) return false;
    this.finishActive(reason, resume);
    return true;
  }

  /** Cancel the active gesture before a global command such as undo/redo. */
  cancelActive(
    reason: PreviewInteractionCancelReason,
    resume = false,
  ): void {
    if (this.active) this.finishActive(reason, resume);
    else this.invalidate();
  }

  /** Transport is a state boundary; obsolete render work must not survive it. */
  notifyTransportBoundary(): void {
    previewQualificationController.cancel();
    this.cancelActive("transport", false);
  }

  /**
   * Pause for a modal or other blocking editor surface.
   *
   * This is intentionally different from an interaction begin: opening a
   * modal must cancel any active gesture and invalidate render work, but it
   * must not remember a resume intent. The user can explicitly press Play
   * after closing the modal.
   */
  requestPause(): void {
    this.notifyTransportBoundary();
    if (this.transport?.getState() === "playing") {
      this.transport.pause();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancelActive("disposed", false);
    this.disposed = true;
    this.transport = null;
    this.listeners.clear();
  }

  private finishActive(
    _reason: PreviewInteractionCancelReason,
    resume: boolean,
  ): void {
    const wasPlaying = this.active?.resumedPlayback ?? false;
    this.active = null;
    this.revision += 1;
    if (resume && wasPlaying) this.transport?.play();
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

let globalCoordinator: PreviewInteractionCoordinator | null = null;

export function getPreviewInteractionCoordinator(): PreviewInteractionCoordinator {
  if (!globalCoordinator) globalCoordinator = new PreviewInteractionCoordinator();
  return globalCoordinator;
}

export function resetPreviewInteractionCoordinator(): void {
  globalCoordinator?.dispose();
  globalCoordinator = null;
}
