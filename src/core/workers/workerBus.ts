/**
 * WorkerBus — Generic Request / Response Infrastructure
 *
 * Every new Web Worker client in Clypra builds on top of this class instead
 * of copy-pasting the pending-map pattern from TemplateRasterizerWorkerClient.
 *
 * What it provides
 * ────────────────
 * • Monotonically increasing request IDs injected into outgoing messages
 * • Promise-based routing: send() returns a Promise resolved by the matching
 *   response id
 * • Transferable list support on every send()
 * • Safe dispose(): drains pending promises with a cancellation error and
 *   terminates the underlying Worker
 * • Optional auto-restart on unrecoverable worker errors (configurable)
 * • An observable `status` property for health-check UIs
 *
 * Usage
 * ─────
 * A client wraps WorkerBus and exposes domain-typed methods:
 *
 *   import { WorkerBus } from '@/core/workers/workerBus';
 *   import type { WaveformLodWorkerRequest, WaveformLodWorkerResponse }
 *     from '@/workers/types';
 *
 *   export class WaveformLodWorkerClient {
 *     private readonly bus: WorkerBus<
 *       WaveformLodWorkerRequest,
 *       WaveformLodWorkerResponse
 *     >;
 *
 *     constructor() {
 *       this.bus = new WorkerBus(
 *         () => new Worker(
 *           new URL('../../workers/waveformLod.worker.ts', import.meta.url),
 *           { type: 'module' },
 *         ),
 *         { name: 'WaveformLodWorker' },
 *       );
 *     }
 *
 *     async sliceViewport(req: Omit<WaveformSliceRequest, 'type' | 'id'>) {
 *       return this.bus.send<WaveformSliceResult>(
 *         { type: 'SLICE_VIEWPORT', ...req },
 *       );
 *     }
 *
 *     dispose() { this.bus.dispose(); }
 *   }
 *
 * Protocol contract
 * ─────────────────
 * • Every request message that expects a reply MUST have a string `id` field.
 *   WorkerBus injects the id automatically — do not include it in the payload
 *   you pass to send().
 * • The matching worker response MUST echo the same `id` field.
 * • Fire-and-forget messages (e.g. SYNC_STATE, EVICT, DISPOSE) use post()
 *   instead of send() and carry no id.
 * • The worker MUST emit { type: 'ERROR', id?, message } on unhandled errors
 *   so WorkerBus can reject the right pending promise.
 *
 * Relationship to TemplateRasterizerWorkerClient
 * ───────────────────────────────────────────────
 * TemplateRasterizerWorkerClient was written before WorkerBus existed and
 * implements its own pending map. It is NOT required to be rewritten — its
 * design is sound and it has production test coverage. WorkerBus is the
 * baseline for all new workers going forward.
 */

import type { WorkerDisposeMessage, WorkerErrorResponse } from '@/workers/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkerStatus = 'idle' | 'running' | 'error' | 'disposed';

export interface WorkerBusOptions {
  /**
   * Human-readable label used in console logs and error messages.
   * Default: 'Worker'
   */
  name?: string;
  /**
   * Automatically re-initialise the underlying Worker after an onerror event.
   * Pending promises from before the crash are still rejected.
   * Default: false
   */
  autoRestart?: boolean;
  /**
   * Maximum number of automatic restart attempts before giving up.
   * Only relevant when autoRestart is true.
   * Default: 3
   */
  maxRestarts?: number;
}

/**
 * A message that can be sent with or without expecting a reply.
 * Request / response / fire-and-forget: SYNC_STATE, EVICT, BUILD_LOD, DISPOSE, etc.
 */
export type WorkerMessage = { type: string };

// ─── WorkerBus ────────────────────────────────────────────────────────────────

export class WorkerBus<
  TRequest extends WorkerMessage = WorkerMessage,
  TResponse extends WorkerMessage = WorkerMessage,
> {
  private worker: Worker | null = null;
  private readonly factory: () => Worker;
  private readonly name: string;
  private readonly autoRestart: boolean;
  private readonly maxRestarts: number;
  private restartCount = 0;

  /**
   * Pending request map: id → { resolve, reject }.
   * Populated by send(), drained by handleMessage() and dispose().
   */
  private readonly pending = new Map<
    string,
    {
      resolve: (response: TResponse) => void;
      reject: (err: Error) => void;
    }
  >();

  private _status: WorkerStatus = 'idle';
  private _disposed = false;
  private static _nextId = 0;

  constructor(factory: () => Worker, options: WorkerBusOptions = {}) {
    this.factory = factory;
    this.name = options.name ?? 'Worker';
    this.autoRestart = options.autoRestart ?? false;
    this.maxRestarts = options.maxRestarts ?? 3;

    this.initWorker();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  get status(): WorkerStatus {
    return this._status;
  }

  get isAvailable(): boolean {
    return !this._disposed && this.worker !== null && this._status !== 'error';
  }

  /**
   * Send a request and await the matching response.
   *
   * WorkerBus injects a unique `id` into the outgoing message and resolves
   * the returned Promise when a response with the same `id` arrives.
   *
   * @param payload     Message payload WITHOUT an `id` field.
   * @param transferables Transferable objects (e.g. ArrayBuffer, ImageBitmap).
   *
   * @throws WorkerBusDisposedError if dispose() has been called.
   * @throws WorkerBusUnavailableError if the worker failed to initialise.
   * @throws Error if the worker emits a matching ERROR response.
   */
  send<TResult extends TResponse>(
    payload: Omit<TRequest, 'id'>,
    transferables: Transferable[] = [],
  ): Promise<TResult> {
    if (this._disposed) {
      return Promise.reject(
        new WorkerBusDisposedError(this.name),
      );
    }
    if (!this.worker) {
      return Promise.reject(
        new WorkerBusUnavailableError(this.name),
      );
    }

    const id = String(++WorkerBus._nextId);
    const message = { ...payload, id };

    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (r: TResponse) => void,
        reject,
      });
      try {
        this.worker!.postMessage(message, transferables);
        this._status = 'running';
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Post a fire-and-forget message with no reply expected.
   * Used for SYNC_STATE, EVICT, BUILD_LOD, etc.
   *
   * @param payload     Message payload (no `id` required).
   * @param transferables Transferable objects.
   */
  post(
    payload: TRequest | Omit<TRequest, 'id'>,
    transferables: Transferable[] = [],
  ): void {
    if (this._disposed || !this.worker) return;
    try {
      this.worker.postMessage(payload, transferables);
    } catch (err) {
      console.warn(`[WorkerBus:${this.name}] post() failed:`, err);
    }
  }

  /**
   * Dispose the bus: reject all pending promises, send DISPOSE to the worker,
   * and terminate it. After calling dispose() the instance is permanently dead.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._status = 'disposed';

    // Drain pending promises
    for (const [, { reject }] of this.pending) {
      reject(new WorkerBusDisposedError(this.name));
    }
    this.pending.clear();

    if (this.worker) {
      // Give the worker a chance to clean up (release GPU handles, close files)
      try {
        const disposeMsg: WorkerDisposeMessage = { type: 'DISPOSE' };
        this.worker.postMessage(disposeMsg);
      } catch {
        // Worker may already be dead — terminate regardless
      }
      this.worker.terminate();
      this.worker = null;
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private initWorker(): void {
    if (this._disposed) return;

    try {
      const worker = this.factory();
      worker.onmessage = this.handleMessage.bind(this);
      worker.onerror = this.handleError.bind(this);
      this.worker = worker;
      this._status = 'idle';
    } catch (err) {
      console.warn(`[WorkerBus:${this.name}] Failed to initialise worker:`, err);
      this.worker = null;
      this._status = 'error';
    }
  }

  private handleMessage(event: MessageEvent): void {
    const msg = event.data as TResponse & { id?: string } & Partial<WorkerErrorResponse>;

    // ERROR response — may or may not have an id
    if (msg.type === 'ERROR') {
      const errorMsg = msg as WorkerErrorResponse;
      const errText = errorMsg.message ?? 'Unknown worker error';

      if (errorMsg.id) {
        // Reject the specific pending request
        const callbacks = this.pending.get(errorMsg.id);
        if (callbacks) {
          this.pending.delete(errorMsg.id);
          callbacks.reject(new Error(`[WorkerBus:${this.name}] ${errText}`));
        }
      } else {
        // Broadcast: reject ALL pending requests
        console.error(`[WorkerBus:${this.name}] Broadcast worker error: ${errText}`);
        for (const [, { reject }] of this.pending) {
          reject(new Error(`[WorkerBus:${this.name}] ${errText}`));
        }
        this.pending.clear();
      }
      // Update status — worker may still be running
      if (this.pending.size === 0) this._status = 'idle';
      return;
    }

    // Normal response with id
    const id = msg.id;
    if (id === undefined) {
      // Unsolicited message (e.g. LOD_READY, INITIALIZED) — no pending entry
      // Callers can subscribe to these via onUnsolicited if needed (future).
      return;
    }

    const callbacks = this.pending.get(id);
    if (!callbacks) {
      // Stale response after a restart or dispose — discard silently
      return;
    }

    this.pending.delete(id);
    if (this.pending.size === 0) this._status = 'idle';
    callbacks.resolve(msg as TResponse);
  }

  private handleError(event: ErrorEvent): void {
    console.error(
      `[WorkerBus:${this.name}] Worker onerror: ${event.message}`,
      event,
    );
    this._status = 'error';

    // Reject all pending promises
    for (const [, { reject }] of this.pending) {
      reject(new Error(`[WorkerBus:${this.name}] Worker crashed: ${event.message}`));
    }
    this.pending.clear();

    this.worker = null;

    // Attempt auto-restart if configured
    if (this.autoRestart && !this._disposed && this.restartCount < this.maxRestarts) {
      this.restartCount++;
      console.warn(
        `[WorkerBus:${this.name}] Auto-restarting (attempt ${this.restartCount}/${this.maxRestarts})`,
      );
      this.initWorker();
    }
  }
}

// ─── Error types ─────────────────────────────────────────────────────────────

export class WorkerBusDisposedError extends Error {
  constructor(workerName: string) {
    super(`[WorkerBus:${workerName}] Cannot use bus after dispose() has been called`);
    this.name = 'WorkerBusDisposedError';
  }
}

export class WorkerBusUnavailableError extends Error {
  constructor(workerName: string) {
    super(
      `[WorkerBus:${workerName}] Worker is unavailable. ` +
      `OffscreenCanvas or Worker may not be supported in this environment, ` +
      `or the worker failed to initialise.`,
    );
    this.name = 'WorkerBusUnavailableError';
  }
}

// ─── LatestOnlyQueue ──────────────────────────────────────────────────────────

/**
 * Flow-control wrapper for workers that feed the RAF playback loop.
 *
 * Enforces the "latest-wins" policy: if a new request arrives while a
 * previous one is still in-flight, the previous Promise is superseded.
 * The caller always receives the result for the most recently submitted
 * request.
 *
 * Pattern:
 *   const queue = new LatestOnlyQueue(bus, 'ANALYZE');
 *   // On every RAF tick:
 *   const result = await queue.submit(payload, transferables);
 *
 * This is an alternative to LatestTextPreparationScheduler for cases where
 * the caller wants to await the result inline rather than register a callback.
 */
export class LatestOnlyQueue<
  TRequest extends WorkerMessage = WorkerMessage,
  TResponse extends WorkerMessage = WorkerMessage,
> {
  private latestId = 0;
  private readonly bus: WorkerBus<TRequest, TResponse>;

  constructor(bus: WorkerBus<TRequest, TResponse>) {
    this.bus = bus;
  }

  /**
   * Submit a new request. If a previous request has not resolved yet, its
   * Promise is abandoned (no rejection — the caller simply never receives it).
   *
   * @returns A Promise for the submitted request's response, or null if the
   *          result is superseded by a later call before it resolves.
   */
  async submit<TResult extends TResponse>(
    payload: Omit<TRequest, 'id'>,
    transferables: Transferable[] = [],
  ): Promise<TResult | null> {
    const myId = ++this.latestId;
    const result = await this.bus.send<TResult>(payload, transferables);
    // If a newer request arrived while we were waiting, discard this result
    if (myId !== this.latestId) return null;
    return result;
  }
}

// ─── Shared Domain Worker Bus Registry ────────────────────────────────────────

const domainBuses = new Map<string, WorkerBus<any, any>>();

/**
 * Get or initialize a shared WorkerBus for a persistent domain isolate.
 * Multiple domain clients (e.g. keyframeEval, timelineSnap, projectWorker)
 * share the same underlying Web Worker thread instead of spawning separate isolates.
 */
export function getSharedDomainWorkerBus<
  TRequest extends WorkerMessage = WorkerMessage,
  TResponse extends WorkerMessage = WorkerMessage,
>(
  domainKey: string,
  factory: () => Worker,
  options?: WorkerBusOptions,
): WorkerBus<TRequest, TResponse> {
  let bus = domainBuses.get(domainKey);
  if (!bus || bus.status === "error" || !bus.isAvailable) {
    bus = new WorkerBus<TRequest, TResponse>(factory, options);
    domainBuses.set(domainKey, bus);
  }
  return bus as WorkerBus<TRequest, TResponse>;
}

/** Reset all shared domain worker buses (for testing / runtime teardown). */
export function resetSharedDomainWorkerBuses(): void {
  for (const bus of domainBuses.values()) {
    bus.dispose();
  }
  domainBuses.clear();
}

