import { describe, it, expect } from "vitest";
import { SpscFloat32RingBuffer, getActiveRingBufferTelemetry } from "../ringBuffer";

describe("SpscFloat32RingBuffer", () => {
  it("initializes with power-of-2 capacity", () => {
    const rb = new SpscFloat32RingBuffer(10, false);
    expect(rb.capacity).toBe(16);
    expect(rb.availableRead).toBe(0);
    expect(rb.availableWrite).toBe(15); // capacity - 1
  });

  it("writes and reads single values correctly", () => {
    const rb = new SpscFloat32RingBuffer(32, false);
    const data = [1.5, 2.5, 3.5, 4.5];
    const written = rb.write(data);
    expect(written).toBe(4);
    expect(rb.availableRead).toBe(4);
    expect(rb.availableWrite).toBe(32 - 1 - 4);

    const out = new Float32Array(4);
    const read = rb.read(out);
    expect(read).toBe(4);
    expect(Array.from(out)).toEqual([1.5, 2.5, 3.5, 4.5]);
    expect(rb.availableRead).toBe(0);
  });

  it("handles multiple writes and partial reads without loss", () => {
    const rb = new SpscFloat32RingBuffer(16, false);
    rb.write([10, 20, 30]);
    rb.write([40, 50]);
    expect(rb.availableRead).toBe(5);

    const out1 = new Float32Array(2);
    rb.read(out1);
    expect(Array.from(out1)).toEqual([10, 20]);
    expect(rb.availableRead).toBe(3);

    const out2 = new Float32Array(5);
    const readCount = rb.read(out2);
    expect(readCount).toBe(3);
    expect(Array.from(out2.subarray(0, 3))).toEqual([30, 40, 50]);
    expect(rb.availableRead).toBe(0);
  });

  it("handles ring buffer wrap-around correctly across boundary", () => {
    const rb = new SpscFloat32RingBuffer(16, false); // capacity = 16
    // Write 12 items, read 10 items (advances write to 12, read to 10)
    rb.write(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    const sink = new Float32Array(10);
    rb.read(sink);

    // Buffer has 2 items left (11, 12).
    // Now write 8 more items: this will wrap around the index 16 boundary!
    const wrapData = [101, 102, 103, 104, 105, 106, 107, 108];
    const written = rb.write(wrapData);
    expect(written).toBe(8);
    expect(rb.availableRead).toBe(10);

    const finalOut = new Float32Array(10);
    const readTotal = rb.read(finalOut);
    expect(readTotal).toBe(10);
    expect(Array.from(finalOut)).toEqual([11, 12, 101, 102, 103, 104, 105, 106, 107, 108]);
  });

  it("prevents buffer overflow when writing beyond available capacity", () => {
    const rb = new SpscFloat32RingBuffer(16, false); // max storage is 15
    const large = new Float32Array(20);
    for (let i = 0; i < 20; i++) large[i] = i;

    const written = rb.write(large);
    expect(written).toBe(15);
    expect(rb.availableWrite).toBe(0);

    // Subsequent write should write 0 items
    const extra = rb.write([999]);
    expect(extra).toBe(0);
  });

  it("skips items cleanly without copying", () => {
    const rb = new SpscFloat32RingBuffer(32, false);
    rb.write([1, 2, 3, 4, 5, 6]);
    expect(rb.availableRead).toBe(6);

    const skipped = rb.skip(3);
    expect(skipped).toBe(3);
    expect(rb.availableRead).toBe(3);

    const out = new Float32Array(3);
    rb.read(out);
    expect(Array.from(out)).toEqual([4, 5, 6]);
  });

  it("clears the buffer completely", () => {
    const rb = new SpscFloat32RingBuffer(32, false);
    rb.write([1, 2, 3, 4]);
    rb.clear();
    expect(rb.availableRead).toBe(0);
    expect(rb.availableWrite).toBe(31);
  });

  it("attaches to an existing shared buffer seamlessly", () => {
    const producer = new SpscFloat32RingBuffer(32, false);
    producer.write([42, 84, 126]);

    // Consumer wraps the exact same buffer
    const consumer = new SpscFloat32RingBuffer(producer.buffer);
    expect(consumer.capacity).toBe(32);
    expect(consumer.availableRead).toBe(3);

    const out = new Float32Array(3);
    consumer.read(out);
    expect(Array.from(out)).toEqual([42, 84, 126]);
    expect(producer.availableRead).toBe(0);
  });

  it("tracks telemetry stats including pushCount, popCount, droppedOverflows, and starvedUnderflows", () => {
    const rb = new SpscFloat32RingBuffer(16, false); // capacity 16, max write 15
    // Write 20 elements -> 15 accepted, 5 dropped overflow
    const overflowData = new Float32Array(20);
    const written = rb.write(overflowData);
    expect(written).toBe(15);

    // Read 20 elements -> 15 returned, 5 starved underflow
    const underflowSink = new Float32Array(20);
    const read = rb.read(underflowSink);
    expect(read).toBe(15);

    const stats = rb.getStats();
    expect(stats.pushCount).toBe(15);
    expect(stats.popCount).toBe(15);
    expect(stats.droppedOverflows).toBe(5);
    expect(stats.starvedUnderflows).toBe(5);

    const globalTelemetry = getActiveRingBufferTelemetry();
    expect(globalTelemetry.pushCount).toBeGreaterThanOrEqual(15);

    rb.dispose();
  });
});
