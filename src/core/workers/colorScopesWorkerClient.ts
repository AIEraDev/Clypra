/**
 * ColorScopesWorkerClient — Main-Thread Client for ColorScopesWorker
 *
 * Provides real-time video telemetry analysis off-thread with a Latest-Only
 * dropping policy so high-frequency preview playback (60fps) never accumulates
 * a backlog of stale analysis jobs.
 */

import { WorkerBus } from "./workerBus";
import type {
  ColorScopesWorkerRequest,
  ColorScopesWorkerResponse,
  ScopeAnalyzeResult,
  ScopeKind,
} from "@/workers/types";

export class ColorScopesWorkerClient {
  private readonly bus: WorkerBus<
    ColorScopesWorkerRequest,
    ColorScopesWorkerResponse
  >;
  private inFlight = false;
  private pendingFrame: {
    frame: ImageBitmap;
    enabledScopes: ScopeKind[];
    downsampleFactor?: number;
    resolve: (res: ScopeAnalyzeResult) => void;
    reject: (err: unknown) => void;
  } | null = null;

  constructor() {
    this.bus = new WorkerBus(
      () =>
        new Worker(
          new URL("../../workers/colorScopes.worker.ts", import.meta.url),
          { type: "module" },
        ),
      { name: "ColorScopesWorker", autoRestart: true },
    );
  }

  /**
   * Analyze an ImageBitmap frame for the requested video scopes.
   * `frame` is transferred zero-copy to the worker.
   *
   * If an analysis is already in progress, this method replaces any pending
   * frame with the newest one so only the latest frame is processed (back-pressure).
   */
  async analyze(
    frame: ImageBitmap,
    enabledScopes: ScopeKind[],
    downsampleFactor: number = 2,
  ): Promise<ScopeAnalyzeResult> {
    if (this.bus.status === "error" || typeof Worker === "undefined") {
      return this.fallbackAnalyze(frame, enabledScopes, downsampleFactor);
    }

    if (this.inFlight) {
      // Close previously dropped frame to prevent memory leaks
      if (this.pendingFrame) {
        try {
          this.pendingFrame.frame.close();
        } catch {
          // ignore
        }
      }

      return new Promise<ScopeAnalyzeResult>((resolve, reject) => {
        this.pendingFrame = {
          frame,
          enabledScopes,
          downsampleFactor,
          resolve,
          reject,
        };
      });
    }

    return this.dispatchAnalyze(frame, enabledScopes, downsampleFactor);
  }

  private async dispatchAnalyze(
    frame: ImageBitmap,
    enabledScopes: ScopeKind[],
    downsampleFactor: number,
  ): Promise<ScopeAnalyzeResult> {
    this.inFlight = true;

    try {
      const result = await this.bus.send<ScopeAnalyzeResult>(
        {
          type: "ANALYZE",
          frame,
          enabledScopes,
          downsampleFactor,
        } as any,
        [frame],
      );
      return result;
    } catch {
      return this.fallbackAnalyze(frame, enabledScopes, downsampleFactor);
    } finally {
      this.inFlight = false;

      // Drain next pending frame if one arrived while in-flight
      if (this.pendingFrame) {
        const next = this.pendingFrame;
        this.pendingFrame = null;
        this.dispatchAnalyze(
          next.frame,
          next.enabledScopes,
          next.downsampleFactor ?? 2,
        )
          .then(next.resolve)
          .catch(next.reject);
      }
    }
  }

  /**
   * Dispose worker instance and cleanup pending frames.
   */
  dispose(): void {
    if (this.pendingFrame) {
      try {
        this.pendingFrame.frame.close();
      } catch {
        // ignore
      }
      this.pendingFrame = null;
    }
    this.bus.dispose();
  }

  // ─── Main-Thread Fallback (JSDOM / Non-Worker Environments) ────────────────

  private fallbackAnalyze(
    frame: ImageBitmap,
    enabledScopes: ScopeKind[],
    _downsampleFactor: number,
  ): ScopeAnalyzeResult {
    const res: ScopeAnalyzeResult = {
      type: "SCOPE_RESULT",
      id: "fallback",
      analysisMs: 0,
    };

    if (enabledScopes.includes("histogram")) {
      res.histogram = {
        r: new Uint32Array(256),
        g: new Uint32Array(256),
        b: new Uint32Array(256),
        luma: new Uint32Array(256),
      };
    }
    if (enabledScopes.includes("vectorscope")) {
      res.vectorscope = new Float32Array(0);
    }
    if (enabledScopes.includes("waveform")) {
      res.waveformLines = new Float32Array(0);
    }
    if (enabledScopes.includes("parade")) {
      res.parade = new Float32Array(0);
    }

    try {
      frame.close();
    } catch {
      // ignore
    }

    return res;
  }
}

// ─── Singleton Factory ────────────────────────────────────────────────────────

let clientInstance: ColorScopesWorkerClient | null = null;

export function getColorScopesWorkerClient(): ColorScopesWorkerClient {
  if (!clientInstance) {
    clientInstance = new ColorScopesWorkerClient();
  }
  return clientInstance;
}
