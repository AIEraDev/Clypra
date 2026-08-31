/**
 * Audio Buffer Pool — Clypra Core
 *
 * In-memory LRU cache for pre-decoded PCM AudioBuffer instances.
 * Guarantees zero IPC serialization and zero disk I/O bottlenecks during active playback.
 *
 * Responsibilities:
 * 1. Asynchronously fetch & decode audio files into uncompressed AudioBuffer instances.
 * 2. Deduplicate in-flight decode promises across simultaneous timeline clips.
 * 3. Enforce strict memory budgeting with LRU eviction to prevent unbounded RAM usage.
 * 4. Provide instant synchronous buffer retrieval for sample-accurate voice allocation.
 */

export interface AudioBufferPoolStats {
  usedBytes: number;
  maxBytes: number;
  count: number;
  hits: number;
  misses: number;
  inFlight: number;
}

interface CacheEntry {
  key: string;
  buffer: AudioBuffer;
  byteSize: number;
  lastUsedAt: number;
}

export class AudioBufferPool {
  private cache = new Map<string, CacheEntry>();
  private inFlightLoads = new Map<string, Promise<AudioBuffer>>();
  private totalByteSize = 0;
  private maxMemoryBytes: number;
  private audioContext: AudioContext | null = null;
  private hits = 0;
  private misses = 0;

  constructor(maxMemoryBytes: number = 256 * 1024 * 1024, audioContext?: AudioContext) {
    this.maxMemoryBytes = maxMemoryBytes;
    if (audioContext) {
      this.audioContext = audioContext;
    }
  }

  public setAudioContext(context: AudioContext): void {
    this.audioContext = context;
  }

  private getContext(): AudioContext {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx();
    }
    return this.audioContext;
  }

  /**
   * Estimate the raw byte size of an AudioBuffer (Float32 = 4 bytes per sample per channel).
   */
  public static calculateByteSize(buffer: AudioBuffer): number {
    return buffer.length * buffer.numberOfChannels * 4;
  }

  /**
   * Synchronously retrieve a cached AudioBuffer if available.
   * Updates the LRU timestamp.
   */
  public get(key: string): AudioBuffer | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    entry.lastUsedAt = performance.now();
    return entry.buffer;
  }

  public has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Store a decoded AudioBuffer directly in the cache.
   */
  public set(key: string, buffer: AudioBuffer): void {
    if (this.cache.has(key)) {
      this.delete(key);
    }

    const byteSize = AudioBufferPool.calculateByteSize(buffer);
    this.ensureMemoryBudget(byteSize);

    this.cache.set(key, {
      key,
      buffer,
      byteSize,
      lastUsedAt: performance.now(),
    });
    this.totalByteSize += byteSize;
  }

  /**
   * Fetch and decode an audio resource, with in-flight deduplication.
   */
  public async load(key: string, source: string | ArrayBuffer): Promise<AudioBuffer> {
    const cached = this.get(key);
    if (cached) return cached;

    const inFlight = this.inFlightLoads.get(key);
    if (inFlight) return inFlight;

    const loadPromise = (async () => {
      try {
        let arrayBuffer: ArrayBuffer;

        if (typeof source === "string") {
          const response = await fetch(source);
          if (!response.ok) {
            throw new Error(`Failed to fetch audio source (${response.status} ${response.statusText}): ${source}`);
          }
          arrayBuffer = await response.arrayBuffer();
        } else {
          arrayBuffer = source;
        }

        const ctx = this.getContext();
        // Web Audio decodeAudioData creates a detached buffer copy
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

        this.set(key, audioBuffer);
        return audioBuffer;
      } finally {
        this.inFlightLoads.delete(key);
      }
    })();

    this.inFlightLoads.set(key, loadPromise);
    return loadPromise;
  }

  /**
   * Evicts least-recently-used entries until enough space is available.
   */
  private ensureMemoryBudget(requiredBytes: number): void {
    if (requiredBytes > this.maxMemoryBytes) {
      // Single buffer larger than total budget — clear everything to make maximum room
      this.clear();
      return;
    }

    while (this.totalByteSize + requiredBytes > this.maxMemoryBytes && this.cache.size > 0) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [key, entry] of this.cache.entries()) {
        if (entry.lastUsedAt < oldestTime) {
          oldestTime = entry.lastUsedAt;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this.delete(oldestKey);
      } else {
        break;
      }
    }
  }

  public delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    this.totalByteSize -= entry.byteSize;
    return this.cache.delete(key);
  }

  public clear(): void {
    this.cache.clear();
    this.inFlightLoads.clear();
    this.totalByteSize = 0;
    this.hits = 0;
    this.misses = 0;
  }

  public getStats(): AudioBufferPoolStats {
    return {
      usedBytes: this.totalByteSize,
      maxBytes: this.maxMemoryBytes,
      count: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      inFlight: this.inFlightLoads.size,
    };
  }

  /** Consume only interval counters; cache contents and memory usage remain. */
  public takeTelemetryStats(): Pick<AudioBufferPoolStats, "hits" | "misses" | "inFlight"> {
    const stats = { hits: this.hits, misses: this.misses, inFlight: this.inFlightLoads.size };
    this.hits = 0;
    this.misses = 0;
    return stats;
  }

  public setMaxMemoryBytes(maxBytes: number): void {
    this.maxMemoryBytes = Math.max(1, maxBytes);
    this.ensureMemoryBudget(0);
  }
}
