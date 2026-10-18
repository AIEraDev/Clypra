/**
 * Latest-only coordinator for filmstrip viewport demand.
 *
 * It deliberately owns no bitmaps, cache entries, render epochs, or IPC. The
 * RenderEngine owns the current epoch and resolves it only when this controller
 * dispatches a settled demand. During an interaction it may publish the last
 * projection, but it never turns presentation churn into native decode work.
 */

export interface FilmstripDemand {
  clipId: string;
  videoPath: string;
  trimIn: number;
  trimOut: number;
  duration: number;
  clipStartTime: number;
  clipWidthPx: number;
  viewportScrollLeft: number;
  viewportWidth: number;
  pixelsPerSecond: number;
  playheadTime?: number;
  requestCause?: "viewport" | "zoom";
}

interface FilmstripDemandControllerOptions {
  isInteractionActive: () => boolean;
  publishRetained: (demand: FilmstripDemand) => void;
  dispatch: (demand: FilmstripDemand) => void;
  settleDelayMs?: number;
}

/**
 * Coalesces each clip to its latest viewport signature while zooming or
 * scrolling. It uses a bounded one-timer-per-clip design, so rapid input
 * cannot accumulate obsolete decode demand.
 */
import { filmstripTelemetry } from "../filmstrip/filmstripTelemetry";

export class FilmstripDemandController {
  private readonly pending = new Map<
    string,
    { demand: FilmstripDemand; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly lastDispatchedSignature = new Map<string, string>();
  private readonly settleDelayMs: number;

  constructor(private readonly options: FilmstripDemandControllerOptions) {
    this.settleDelayMs = options.settleDelayMs ?? 80;
  }

  submit(demand: FilmstripDemand): void {
    if (!this.options.isInteractionActive()) {
      this.cancelPending(demand.clipId);
      this.dispatchIfChanged(demand);
      return;
    }

    const latestDemand: FilmstripDemand = { ...demand, requestCause: "zoom" };
    filmstripTelemetry.recordDemandOutcome("retained");
    this.options.publishRetained(latestDemand);
    this.defer(latestDemand);
  }

  cancel(clipId: string): void {
    this.cancelPending(clipId);
    this.lastDispatchedSignature.delete(clipId);
  }

  /**
   * Lets the cache report that P0 preview work interrupted its batch. The
   * controller never retries by itself; it simply permits the next external
   * settled viewport submission to resume the missing tiles.
   */
  forgetDispatchedDemand(clipId: string): void {
    this.lastDispatchedSignature.delete(clipId);
  }

  private cancelPending(clipId: string): void {
    const pending = this.pending.get(clipId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(clipId);
  }

  dispose(): void {
    for (const clipId of this.pending.keys()) this.cancel(clipId);
  }

  private defer(demand: FilmstripDemand): void {
    this.cancelPending(demand.clipId);
    const timer = setTimeout(() => {
      const pending = this.pending.get(demand.clipId);
      if (!pending) return;
      this.pending.delete(demand.clipId);
      if (this.options.isInteractionActive()) {
        this.defer(pending.demand);
        return;
      }
      this.dispatchIfChanged(pending.demand);
    }, this.settleDelayMs);
    this.pending.set(demand.clipId, { demand, timer });
  }

  private dispatchIfChanged(demand: FilmstripDemand): void {
    const signature = [
      demand.videoPath,
      demand.trimIn,
      demand.trimOut,
      demand.clipStartTime,
      demand.clipWidthPx,
      demand.viewportScrollLeft,
      demand.viewportWidth,
      demand.pixelsPerSecond,
    ].join("|");
    if (this.lastDispatchedSignature.get(demand.clipId) === signature) {
      filmstripTelemetry.recordDemandOutcome("duplicate-suppressed");
      return;
    }
    this.lastDispatchedSignature.set(demand.clipId, signature);
    filmstripTelemetry.recordDemandOutcome("dispatched");
    this.options.dispatch(demand);
  }
}
