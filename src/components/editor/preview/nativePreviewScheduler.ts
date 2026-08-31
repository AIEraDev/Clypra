import type { NativeFrameRequest } from "@/lib/platform/nativeCore";

export interface NativePreviewFrame {
  rgba: ArrayBuffer;
  width: number;
  height: number;
}

export interface NativePreviewRequestSource {
  requestKey: string;
  frameIndex: number;
  request: NativeFrameRequest;
  priority?: number;
  generation?: number;
}

export interface NativePreviewFrameSchedulerOptions {
  load: (request: NativeFrameRequest, signal?: AbortSignal) => Promise<NativePreviewFrame>;
  maxCacheEntries?: number;
  maxInFlight?: number;
}

type CacheEntry = NativePreviewFrame & {
  requestKey: string;
  frameIndex: number;
  lastUsed: number;
};

type InFlightEntry = {
  promise: Promise<NativePreviewFrame>;
  controller: AbortController;
  source: NativePreviewRequestSource;
  visible: boolean;
};

type PendingEntry = NativePreviewRequestSource & {
  priority: number;
  sequence: number;
  visible: boolean;
  promise?: Promise<NativePreviewFrame>;
  resolve?: (frame: NativePreviewFrame) => void;
  reject?: (error: unknown) => void;
};

/**
 * Coordinates exact visible-frame requests with low-priority neighboring work.
 * In-flight native calls cannot be cancelled portably, so stale callers are
 * rejected by the owner while completed frames remain safe cache entries.
 */
export class NativePreviewFrameScheduler {
  private readonly load: NativePreviewFrameSchedulerOptions["load"];
  private readonly maxCacheEntries: number;
  private readonly cache = new Map<string, CacheEntry>();
  private inFlight: InFlightEntry | null = null;
  private pending: PendingEntry | null = null;
  private sequence = 0;
  private disposed = false;
  private visibleGeneration = 0;
  private visibleKey: string | null = null;

  constructor(options: NativePreviewFrameSchedulerOptions) {
    this.load = options.load;
    this.maxCacheEntries = Math.max(1, Math.floor(options.maxCacheEntries ?? 12));
  }

  getCached(requestKey: string): NativePreviewFrame | null {
    const entry = this.cache.get(requestKey);
    if (!entry) return null;
    entry.lastUsed = ++this.sequence;
    return {
      rgba: entry.rgba,
      width: entry.width,
      height: entry.height,
    };
  }

  /**
   * Visible work always wins. There is one active load and one replaceable
   * pending load; a newer visible request rejects the obsolete pending work.
   */
  requestVisible(source: NativePreviewRequestSource): Promise<NativePreviewFrame> {
    if (this.disposed) return Promise.reject(new Error("Native preview scheduler disposed"));

    const cached = this.getCached(source.requestKey);
    if (cached) return Promise.resolve(cached);

    if (this.inFlight?.source.requestKey === source.requestKey) return this.inFlight.promise;
    if (this.pending?.requestKey === source.requestKey && this.pending.promise) return this.pending.promise;

    const generation = source.generation ?? this.visibleGeneration + 1;
    if (generation > this.visibleGeneration) {
      this.setVisibleGeneration(generation);
    }

    // A newer visible request supersedes both active and pending work. The
    // AbortSignal lets native callers stop at packet boundaries while the
    // generation check protects runtimes that cannot abort an IPC call.
    this.cancelVisibleWork();
    this.replacePending(null);
    this.visibleKey = source.requestKey;
    let resolve!: (frame: NativePreviewFrame) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<NativePreviewFrame>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.pending = {
      ...source,
      priority: Number.MIN_SAFE_INTEGER,
      sequence: ++this.sequence,
      visible: true,
      promise,
      resolve,
      reject,
    };
    this.pump();
    return promise;
  }

  /**
   * Queue a small neighborhood around the visible frame. New visible targets
   * call setVisibleGeneration(), which drops old queued work before adding the
   * next neighborhood; already-running calls remain harmless and cacheable.
   */
  prefetch(sources: readonly NativePreviewRequestSource[]): void {
    if (this.disposed) return;

    if (this.pending?.visible || this.inFlight?.visible) return;
    const source = sources
      .filter((entry) => !this.cache.has(entry.requestKey))
      .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0))[0];
    if (!source || this.pending) return;
    this.pending = {
      ...source,
      priority: source.priority ?? 0,
      sequence: ++this.sequence,
      visible: false,
    };
    this.pump();
  }

  /** Invalidate queued lookahead work after a seek/project/timeline change. */
  setVisibleGeneration(generation = this.visibleGeneration + 1): void {
    if (generation < this.visibleGeneration) return;
    this.visibleGeneration = generation;
    this.replacePending(null);
    this.cancelVisibleWork();
  }

  isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.visibleGeneration;
  }

  clear(): void {
    this.cache.clear();
    this.replacePending(null);
  }

  dispose(): void {
    this.disposed = true;
    this.cancelVisibleWork();
    this.inFlight?.controller.abort();
    this.replacePending(new Error("Native preview scheduler disposed"));
    this.clear();
  }

  private start(entry: PendingEntry): void {
    const controller = new AbortController();
    const generation = entry.generation ?? this.visibleGeneration;
    const promise = this.load(entry.request, controller.signal)
      .then((frame) => {
        if (!this.disposed && (!entry.visible || this.isCurrent(generation))) this.store(entry, frame);
        entry.resolve?.(frame);
        return frame;
      })
      .catch((error) => {
        entry.reject?.(error);
        throw error;
      })
      .finally(() => {
        if (this.inFlight?.source.requestKey === entry.requestKey) this.inFlight = null;
        if (entry.visible && this.visibleKey === entry.requestKey) this.visibleKey = null;
        this.pump();
      });
    this.inFlight = { promise, controller, source: entry, visible: entry.visible };
    if (!entry.visible) void promise.catch(() => undefined);
  }

  private pump(): void {
    if (this.disposed) return;
    if (this.inFlight || !this.pending) return;
    const entry = this.pending;
    this.pending = null;
    if (this.cache.has(entry.requestKey)) {
      entry.resolve?.(this.getCached(entry.requestKey)!);
      return;
    }
    this.start(entry);
  }

  private cancelVisibleWork(): void {
    if (this.visibleKey && this.inFlight?.source.requestKey === this.visibleKey) {
      this.inFlight.controller.abort();
    }
    this.visibleKey = null;
  }

  private replacePending(error: unknown): void {
    if (!this.pending) return;
    this.pending.reject?.(error || new DOMException("Native preview request superseded", "AbortError"));
    this.pending = null;
  }

  private store(source: NativePreviewRequestSource, frame: NativePreviewFrame): void {
    this.cache.set(source.requestKey, {
      ...frame,
      requestKey: source.requestKey,
      frameIndex: source.frameIndex,
      lastUsed: ++this.sequence,
    });

    while (this.cache.size > this.maxCacheEntries) {
      const leastRecentlyUsed = [...this.cache.values()].reduce((oldest, entry) =>
        entry.lastUsed < oldest.lastUsed ? entry : oldest,
      );
      this.cache.delete(leastRecentlyUsed.requestKey);
    }
  }
}
