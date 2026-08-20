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
}

export interface NativePreviewFrameSchedulerOptions {
  load: (request: NativeFrameRequest) => Promise<NativePreviewFrame>;
  maxCacheEntries?: number;
  maxInFlight?: number;
}

type CacheEntry = NativePreviewFrame & {
  requestKey: string;
  frameIndex: number;
  lastUsed: number;
};

type PrefetchEntry = NativePreviewRequestSource & {
  priority: number;
  sequence: number;
};

/**
 * Coordinates exact visible-frame requests with low-priority neighboring work.
 * In-flight native calls cannot be cancelled portably, so stale callers are
 * rejected by the owner while completed frames remain safe cache entries.
 */
export class NativePreviewFrameScheduler {
  private readonly load: NativePreviewFrameSchedulerOptions["load"];
  private readonly maxCacheEntries: number;
  private readonly maxInFlight: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<NativePreviewFrame>>();
  private queued: PrefetchEntry[] = [];
  private sequence = 0;
  private disposed = false;

  constructor(options: NativePreviewFrameSchedulerOptions) {
    this.load = options.load;
    this.maxCacheEntries = Math.max(1, Math.floor(options.maxCacheEntries ?? 12));
    this.maxInFlight = Math.max(1, Math.floor(options.maxInFlight ?? 2));
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
   * Visible work starts immediately and shares an existing request when one
   * already exists. This is intentionally allowed to use one slot beyond the
   * prefetch limit so seek latency is never controlled by lookahead work.
   */
  requestVisible(source: NativePreviewRequestSource): Promise<NativePreviewFrame> {
    if (this.disposed) return Promise.reject(new Error("Native preview scheduler disposed"));

    const cached = this.getCached(source.requestKey);
    if (cached) return Promise.resolve(cached);

    const existing = this.inFlight.get(source.requestKey);
    if (existing) return existing;

    this.queued = this.queued.filter((entry) => entry.requestKey !== source.requestKey);
    return this.start(source);
  }

  /**
   * Queue a small neighborhood around the visible frame. New visible targets
   * call setVisibleGeneration(), which drops old queued work before adding the
   * next neighborhood; already-running calls remain harmless and cacheable.
   */
  prefetch(sources: readonly NativePreviewRequestSource[]): void {
    if (this.disposed) return;

    for (const source of sources) {
      if (this.cache.has(source.requestKey) || this.inFlight.has(source.requestKey)) continue;
      if (this.queued.some((entry) => entry.requestKey === source.requestKey)) continue;
      this.queued.push({
        ...source,
        priority: source.priority ?? 0,
        sequence: ++this.sequence,
      });
    }

    this.pumpPrefetch();
  }

  /** Invalidate queued lookahead work after a seek/project/timeline change. */
  setVisibleGeneration(): void {
    this.queued = [];
  }

  clear(): void {
    this.cache.clear();
    this.queued = [];
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
  }

  private start(source: NativePreviewRequestSource): Promise<NativePreviewFrame> {
    const promise = this.load(source.request)
      .then((frame) => {
        if (!this.disposed) this.store(source, frame);
        return frame;
      })
      .finally(() => {
        this.inFlight.delete(source.requestKey);
        this.pumpPrefetch();
      });

    this.inFlight.set(source.requestKey, promise);
    return promise;
  }

  private pumpPrefetch(): void {
    if (this.disposed) return;

    this.queued.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
    while (this.inFlight.size < this.maxInFlight && this.queued.length > 0) {
      const source = this.queued.shift();
      if (!source || this.cache.has(source.requestKey) || this.inFlight.has(source.requestKey)) continue;
      void this.start(source).catch(() => undefined);
    }
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
