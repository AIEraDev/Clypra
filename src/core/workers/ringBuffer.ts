/**
 * ringBuffer.ts — Single-Producer Single-Consumer (SPSC) Lock-Free Ring Buffer
 *
 * Phase 4 of Clypra Multi-Tier Optimization: Off-Thread Vectorized Acceleration &
 * Zero-Copy Shared Memory (Tier 2).
 *
 * Design & Architecture:
 *   - Backed by a single SharedArrayBuffer (or ArrayBuffer fallback).
 *   - Lock-free synchronization via Atomics (atomic load/store for indices).
 *   - Single Producer, Single Consumer: zero mutexes or spinlocks required.
 *   - Power-of-2 capacity for bitwise mask wrapping: `(idx & mask)` instead of `%`.
 *   - Memory layout:
 *       Offset 0:  writeIndex (Int32Array[0])
 *       Offset 4:  readIndex  (Int32Array[1])
 *       Offset 8:  capacity   (Int32Array[2])
 *       Offset 12: reserved   (Int32Array[3])
 *       Offset 16: payload elements
 */

export interface RingBufferHeader {
  writeIndex: number;
  readIndex: number;
  capacity: number;
}

export const RING_HEADER_BYTES = 16;
export const RING_HEADER_INTS = RING_HEADER_BYTES / 4;

/**
 * Single-Producer Single-Consumer Lock-Free Ring Buffer for Float32 data.
 * Ideal for real-time telemetry, audio streaming, and color scope frame metrics.
 */
export class SpscFloat32RingBuffer {
  readonly buffer: SharedArrayBuffer | ArrayBuffer;
  private readonly header: Int32Array;
  private readonly data: Float32Array;
  readonly capacity: number;
  private readonly mask: number;
  readonly isShared: boolean;

  /**
   * Create a new ring buffer or connect to an existing shared buffer.
   *
   * @param capacityOrBuffer Either a power-of-2 capacity number (to create a new buffer)
   *                         or an existing SharedArrayBuffer / ArrayBuffer to wrap.
   * @param forceShared If true and creating a new buffer, attempts to use SharedArrayBuffer.
   */
  constructor(
    capacityOrBuffer: number | SharedArrayBuffer | ArrayBuffer,
    forceShared = true,
  ) {
    if (typeof capacityOrBuffer === "number") {
      const requestedCap = capacityOrBuffer;
      // Round up to next power of 2 (minimum 16)
      let cap = 16;
      while (cap < requestedCap) {
        cap <<= 1;
      }
      this.capacity = cap;
      this.mask = cap - 1;

      const totalBytes = RING_HEADER_BYTES + cap * Float32Array.BYTES_PER_ELEMENT;
      const canUseShared =
        forceShared &&
        typeof SharedArrayBuffer !== "undefined" &&
        (typeof window === "undefined" || (window as any).crossOriginIsolated);

      if (canUseShared) {
        this.buffer = new SharedArrayBuffer(totalBytes);
        this.isShared = true;
      } else {
        this.buffer = new ArrayBuffer(totalBytes);
        this.isShared = false;
      }

      this.header = new Int32Array(this.buffer, 0, RING_HEADER_INTS);
      this.data = new Float32Array(this.buffer, RING_HEADER_BYTES, cap);

      // Initialize header
      this.header[0] = 0; // writeIndex
      this.header[1] = 0; // readIndex
      this.header[2] = cap; // capacity
      this.header[3] = 0; // reserved
    } else {
      this.buffer = capacityOrBuffer;
      this.isShared =
        typeof SharedArrayBuffer !== "undefined" &&
        capacityOrBuffer instanceof SharedArrayBuffer;

      this.header = new Int32Array(this.buffer, 0, RING_HEADER_INTS);
      this.capacity = this.header[2];
      this.mask = this.capacity - 1;
      this.data = new Float32Array(this.buffer, RING_HEADER_BYTES, this.capacity);
    }
  }

  /**
   * Current number of unread elements available in the buffer.
   */
  get availableRead(): number {
    const w = this.isShared
      ? Atomics.load(this.header, 0)
      : this.header[0];
    const r = this.isShared
      ? Atomics.load(this.header, 1)
      : this.header[1];
    return (w - r) & 0x7fffffff;
  }

  /**
   * Remaining element slots available before the buffer becomes full.
   */
  get availableWrite(): number {
    return this.capacity - this.availableRead - 1;
  }

  /**
   * Write elements into the ring buffer.
   * Producer-only method.
   *
   * @param source Array or Float32Array of samples to write.
   * @returns Number of samples actually written (may be less than source.length if full).
   */
  write(source: ArrayLike<number>): number {
    const toWrite = Math.min(source.length, this.availableWrite);
    if (toWrite <= 0) return 0;

    let w = this.isShared
      ? Atomics.load(this.header, 0)
      : this.header[0];

    for (let i = 0; i < toWrite; i++) {
      this.data[w & this.mask] = source[i];
      w = (w + 1) & 0x7fffffff;
    }

    if (this.isShared) {
      Atomics.store(this.header, 0, w);
    } else {
      this.header[0] = w;
    }

    return toWrite;
  }

  /**
   * Read elements from the ring buffer into `destination`.
   * Consumer-only method.
   *
   * @param destination Target typed array to fill.
   * @returns Number of samples actually read.
   */
  read(destination: Float32Array | number[]): number {
    const toRead = Math.min(destination.length, this.availableRead);
    if (toRead <= 0) return 0;

    let r = this.isShared
      ? Atomics.load(this.header, 1)
      : this.header[1];

    for (let i = 0; i < toRead; i++) {
      destination[i] = this.data[r & this.mask];
      r = (r + 1) & 0x7fffffff;
    }

    if (this.isShared) {
      Atomics.store(this.header, 1, r);
    } else {
      this.header[1] = r;
    }

    return toRead;
  }

  /**
   * Discard up to `count` unread elements without copying them.
   */
  skip(count: number): number {
    const toSkip = Math.min(count, this.availableRead);
    if (toSkip <= 0) return 0;

    let r = this.isShared
      ? Atomics.load(this.header, 1)
      : this.header[1];

    r = (r + toSkip) & 0x7fffffff;

    if (this.isShared) {
      Atomics.store(this.header, 1, r);
    } else {
      this.header[1] = r;
    }

    return toSkip;
  }

  /**
   * Reset write and read indices to 0.
   */
  clear(): void {
    if (this.isShared) {
      Atomics.store(this.header, 0, 0);
      Atomics.store(this.header, 1, 0);
    } else {
      this.header[0] = 0;
      this.header[1] = 0;
    }
  }
}
