import { describe, it, expect, beforeEach, vi } from "vitest";
import { AudioBufferPool } from "../AudioBufferPool";

describe("AudioBufferPool", () => {
  let pool: AudioBufferPool;

  const createMockAudioBuffer = (duration: number, length: number = 44100, channels: number = 2): AudioBuffer => {
    return {
      duration,
      length,
      numberOfChannels: channels,
      sampleRate: 44100,
      getChannelData: vi.fn().mockReturnValue(new Float32Array(length)),
      copyFromChannel: vi.fn(),
      copyToChannel: vi.fn(),
    } as unknown as AudioBuffer;
  };

  beforeEach(() => {
    pool = new AudioBufferPool(1024 * 1024); // 1 MB budget
  });

  it("calculates AudioBuffer byte size correctly", () => {
    const buffer = createMockAudioBuffer(1.0, 44100, 2);
    // 44100 samples * 2 channels * 4 bytes/sample = 352,800 bytes
    const size = AudioBufferPool.calculateByteSize(buffer);
    expect(size).toBe(352800);
  });

  it("stores, retrieves, and checks presence of buffers", () => {
    const buffer = createMockAudioBuffer(1.0);
    pool.set("clip-1", buffer);

    expect(pool.has("clip-1")).toBe(true);
    expect(pool.get("clip-1")).toBe(buffer);
    expect(pool.has("clip-2")).toBe(false);
    expect(pool.get("clip-2")).toBeUndefined();
  });

  it("reports cache hits and misses per telemetry window", () => {
    const buffer = createMockAudioBuffer(1.0);
    pool.set("clip-1", buffer);
    pool.get("clip-1");
    pool.get("missing");

    expect(pool.getStats()).toMatchObject({ hits: 1, misses: 1 });
    expect(pool.takeTelemetryStats()).toMatchObject({ hits: 1, misses: 1 });
    expect(pool.getStats()).toMatchObject({ hits: 0, misses: 0 });
    expect(pool.has("clip-1")).toBe(true);
  });

  it("tracks memory stats accurately", () => {
    const buffer1 = createMockAudioBuffer(1.0, 1000, 2); // 8000 bytes
    const buffer2 = createMockAudioBuffer(1.0, 2000, 2); // 16000 bytes

    pool.set("clip-1", buffer1);
    pool.set("clip-2", buffer2);

    const stats = pool.getStats();
    expect(stats.count).toBe(2);
    expect(stats.usedBytes).toBe(24000);
    expect(stats.maxBytes).toBe(1024 * 1024);
  });

  it("evicts oldest entries when memory budget is exceeded (LRU)", () => {
    // Set small budget: 20,000 bytes
    pool.setMaxMemoryBytes(20000);

    const buffer1 = createMockAudioBuffer(1.0, 1000, 2); // 8000 bytes
    const buffer2 = createMockAudioBuffer(1.0, 1000, 2); // 8000 bytes
    const buffer3 = createMockAudioBuffer(1.0, 1000, 2); // 8000 bytes

    pool.set("clip-1", buffer1);
    pool.set("clip-2", buffer2);

    // Access clip-1 to make clip-2 the LRU
    pool.get("clip-1");

    // Adding buffer3 exceeds 20000 bytes (8000 * 3 = 24000 > 20000)
    pool.set("clip-3", buffer3);

    expect(pool.has("clip-3")).toBe(true);
    expect(pool.has("clip-1")).toBe(true);
    expect(pool.has("clip-2")).toBe(false); // Evicted as LRU
  });

  it("deduplicates in-flight fetch & decode calls", async () => {
    const mockBuffer = createMockAudioBuffer(1.0);
    const mockCtx = {
      decodeAudioData: vi.fn().mockResolvedValue(mockBuffer),
    } as unknown as AudioContext;
    pool.setAudioContext(mockCtx);

    const fakeArrayBuffer = new ArrayBuffer(1024);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeArrayBuffer),
    } as unknown as Response);

    // Call load twice concurrently
    const [b1, b2] = await Promise.all([
      pool.load("key-1", "http://example.com/audio.mp3"),
      pool.load("key-1", "http://example.com/audio.mp3"),
    ]);

    expect(b1).toBe(mockBuffer);
    expect(b2).toBe(mockBuffer);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(mockCtx.decodeAudioData).toHaveBeenCalledTimes(1);
  });

  it("deletes and clears buffers cleanly", () => {
    const buffer = createMockAudioBuffer(1.0, 1000, 2);
    pool.set("clip-1", buffer);
    expect(pool.has("clip-1")).toBe(true);

    expect(pool.delete("clip-1")).toBe(true);
    expect(pool.has("clip-1")).toBe(false);
    expect(pool.getStats().usedBytes).toBe(0);

    pool.set("clip-2", buffer);
    pool.clear();
    expect(pool.getStats().count).toBe(0);
    expect(pool.getStats().usedBytes).toBe(0);
  });
});
