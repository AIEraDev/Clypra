import { describe, it, expect, beforeEach } from "vitest";
import { EvaluationCache, computeClipVersion } from "../cache";

describe("EvaluationCache", () => {
  let cache: EvaluationCache;

  beforeEach(() => {
    cache = new EvaluationCache(3); // Small cache for testing
  });

  it("caches and retrieves scenes", () => {
    const key = { time: 1.0, epoch: 0, clipVersion: "abc123" };
    const scene = { visualLayers: [], audioLayers: [], transitions: [], metadata: {} as any };

    // Cache miss
    expect(cache.get(key)).toBeNull();

    // Store
    cache.set(key, scene);

    // Cache hit
    expect(cache.get(key)).toBe(scene);
  });

  it("respects max size (LRU eviction)", () => {
    const scene1 = { visualLayers: [], audioLayers: [], transitions: [], metadata: {} as any };
    const scene2 = { visualLayers: [], audioLayers: [], transitions: [], metadata: {} as any };
    const scene3 = { visualLayers: [], audioLayers: [], transitions: [], metadata: {} as any };
    const scene4 = { visualLayers: [], audioLayers: [], transitions: [], metadata: {} as any };

    cache.set({ time: 1.0, epoch: 0, clipVersion: "v1" }, scene1);
    cache.set({ time: 2.0, epoch: 0, clipVersion: "v1" }, scene2);
    cache.set({ time: 3.0, epoch: 0, clipVersion: "v1" }, scene3);

    // Cache is full (3 entries)
    expect(cache.get({ time: 1.0, epoch: 0, clipVersion: "v1" })).toBe(scene1);
    expect(cache.get({ time: 2.0, epoch: 0, clipVersion: "v1" })).toBe(scene2);
    expect(cache.get({ time: 3.0, epoch: 0, clipVersion: "v1" })).toBe(scene3);

    // Add 4th entry - should evict oldest (1.0)
    cache.set({ time: 4.0, epoch: 0, clipVersion: "v1" }, scene4);

    expect(cache.get({ time: 1.0, epoch: 0, clipVersion: "v1" })).toBeNull(); // Evicted
    expect(cache.get({ time: 2.0, epoch: 0, clipVersion: "v1" })).toBe(scene2);
    expect(cache.get({ time: 3.0, epoch: 0, clipVersion: "v1" })).toBe(scene3);
    expect(cache.get({ time: 4.0, epoch: 0, clipVersion: "v1" })).toBe(scene4);
  });

  it("invalidates by epoch", () => {
    const scene1 = { visualLayers: [], audioLayers: [], transitions: [], metadata: {} as any };
    const scene2 = { visualLayers: [], audioLayers: [], transitions: [], metadata: {} as any };

    cache.set({ time: 1.0, epoch: 0, clipVersion: "v1" }, scene1);
    cache.set({ time: 2.0, epoch: 1, clipVersion: "v1" }, scene2);

    // Both cached
    expect(cache.get({ time: 1.0, epoch: 0, clipVersion: "v1" })).toBe(scene1);
    expect(cache.get({ time: 2.0, epoch: 1, clipVersion: "v1" })).toBe(scene2);

    // Invalidate epoch 0
    cache.invalidateEpoch(1);

    // Epoch 0 invalidated, epoch 1 still cached
    expect(cache.get({ time: 1.0, epoch: 0, clipVersion: "v1" })).toBeNull();
    expect(cache.get({ time: 2.0, epoch: 1, clipVersion: "v1" })).toBe(scene2);
  });

  it("tracks cache statistics", () => {
    const scene = { visualLayers: [], audioLayers: [], transitions: [], metadata: {} as any };
    const key = { time: 1.0, epoch: 0, clipVersion: "v1" };

    // Initial stats
    let stats = cache.getStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);

    // Cache miss
    cache.get(key);
    stats = cache.getStats();
    expect(stats.misses).toBe(1);

    // Cache hit
    cache.set(key, scene);
    cache.get(key);
    stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });

  it("clears all entries and resets memory", () => {
    const scene = { visualLayers: [], audioLayers: [], transitions: [], metadata: {} as any };

    cache.set({ time: 1.0, epoch: 0, clipVersion: "v1" }, scene);
    cache.set({ time: 2.0, epoch: 0, clipVersion: "v1" }, scene);

    expect(cache.getStats().size).toBe(2);
    expect(cache.getStats().memoryMB).toBeGreaterThan(0);

    cache.clear();

    expect(cache.getStats().size).toBe(0);
    expect(cache.getStats().memoryMB).toBe(0);
    expect(cache.get({ time: 1.0, epoch: 0, clipVersion: "v1" })).toBeNull();
  });

  it("evicts LRU entry (not FIFO) under count pressure", () => {
    const mkScene = () => ({ visualLayers: [], audioLayers: [], transitions: [], metadata: {} as any });

    // Insert 1, 2, 3
    cache.set({ time: 1.0, epoch: 0, clipVersion: "v1" }, mkScene());
    cache.set({ time: 2.0, epoch: 0, clipVersion: "v1" }, mkScene());
    cache.set({ time: 3.0, epoch: 0, clipVersion: "v1" }, mkScene());

    // Access entry 1 to make it most-recently-used
    cache.get({ time: 1.0, epoch: 0, clipVersion: "v1" });

    // Insert 4 — should evict entry 2 (oldest access), NOT entry 1
    cache.set({ time: 4.0, epoch: 0, clipVersion: "v1" }, mkScene());

    expect(cache.get({ time: 1.0, epoch: 0, clipVersion: "v1" })).not.toBeNull(); // kept (recently accessed)
    expect(cache.get({ time: 2.0, epoch: 0, clipVersion: "v1" })).toBeNull(); // evicted (LRU)
    expect(cache.get({ time: 3.0, epoch: 0, clipVersion: "v1" })).not.toBeNull();
    expect(cache.get({ time: 4.0, epoch: 0, clipVersion: "v1" })).not.toBeNull();
  });

  it("evicts entries when memory budget is exceeded", () => {
    // Use a tiny memory limit: 0.005 MB ≈ 5 KB
    const tinyCache = new EvaluationCache(100, 0.005);

    // Each empty scene ≈ 1 KB (base overhead only) ≈ 0.001 MB
    const smallScene = { visualLayers: [], audioLayers: [], transitions: [], metadata: {} as any };

    tinyCache.set({ time: 1.0, epoch: 0, clipVersion: "v1" }, smallScene);
    tinyCache.set({ time: 2.0, epoch: 0, clipVersion: "v1" }, smallScene);
    tinyCache.set({ time: 3.0, epoch: 0, clipVersion: "v1" }, smallScene);
    tinyCache.set({ time: 4.0, epoch: 0, clipVersion: "v1" }, smallScene);
    tinyCache.set({ time: 5.0, epoch: 0, clipVersion: "v1" }, smallScene);

    // Large scene: 50 visual layers ≈ 50 KB ≈ 0.05 MB > our 0.005 MB budget
    const bigLayers = Array.from({ length: 50 }, (_, i) => ({ id: `l${i}` }));
    const bigScene = { visualLayers: bigLayers, audioLayers: [], transitions: [], metadata: {} as any } as any;

    tinyCache.set({ time: 6.0, epoch: 0, clipVersion: "v1" }, bigScene);

    // Some earlier entries must have been evicted to make room
    const stats = tinyCache.getStats();
    expect(stats.size).toBeLessThan(6);
  });

  it("tracks memory in stats", () => {
    const scene = { visualLayers: [], audioLayers: [], transitions: [], metadata: {} as any };

    expect(cache.getStats().memoryMB).toBe(0);

    cache.set({ time: 1.0, epoch: 0, clipVersion: "v1" }, scene);
    expect(cache.getStats().memoryMB).toBeGreaterThan(0);
  });

  it("invalidateEpoch decrements memory tracking", () => {
    const scene = { visualLayers: [], audioLayers: [], transitions: [], metadata: {} as any };

    cache.set({ time: 1.0, epoch: 0, clipVersion: "v1" }, scene);
    cache.set({ time: 2.0, epoch: 1, clipVersion: "v1" }, scene);

    const memBefore = cache.getStats().memoryMB;
    cache.invalidateEpoch(1); // removes epoch 0 entry

    expect(cache.getStats().memoryMB).toBeLessThan(memBefore);
    expect(cache.getStats().size).toBe(1);
  });
});

describe("computeClipVersion", () => {
  it("generates consistent hash for same clips", () => {
    const clips = [
      { id: "c1", trackId: "t1", startTime: 0, duration: 10 },
      { id: "c2", trackId: "t1", startTime: 10, duration: 5 },
    ];

    const hash1 = computeClipVersion(clips);
    const hash2 = computeClipVersion(clips);

    expect(hash1).toBe(hash2);
  });

  it("generates different hash when clips change", () => {
    const clips1 = [
      { id: "c1", trackId: "t1", startTime: 0, duration: 10 },
      { id: "c2", trackId: "t1", startTime: 10, duration: 5 },
    ];

    const clips2 = [
      { id: "c1", trackId: "t1", startTime: 0, duration: 10 },
      { id: "c2", trackId: "t1", startTime: 10, duration: 6 }, // Different duration
    ];

    const hash1 = computeClipVersion(clips1);
    const hash2 = computeClipVersion(clips2);

    expect(hash1).not.toBe(hash2);
  });

  it("generates different hash when clip order changes", () => {
    const clips1 = [
      { id: "c1", trackId: "t1", startTime: 0, duration: 10 },
      { id: "c2", trackId: "t1", startTime: 10, duration: 5 },
    ];

    const clips2 = [
      { id: "c2", trackId: "t1", startTime: 10, duration: 5 },
      { id: "c1", trackId: "t1", startTime: 0, duration: 10 },
    ];

    const hash1 = computeClipVersion(clips1);
    const hash2 = computeClipVersion(clips2);

    // Should be same because we sort before hashing
    expect(hash1).toBe(hash2);
  });

  it("is deterministic for clips with same startTime on different tracks", () => {
    // Regression: unstable sort caused cache misses when equal-startTime clips
    // swapped order between calls
    const clips1 = [
      { id: "c1", trackId: "t1", startTime: 0, duration: 5 },
      { id: "c2", trackId: "t2", startTime: 0, duration: 5 },
      { id: "c3", trackId: "t3", startTime: 0, duration: 5 },
    ];

    const clips2 = [
      { id: "c3", trackId: "t3", startTime: 0, duration: 5 },
      { id: "c1", trackId: "t1", startTime: 0, duration: 5 },
      { id: "c2", trackId: "t2", startTime: 0, duration: 5 },
    ];

    expect(computeClipVersion(clips1)).toBe(computeClipVersion(clips2));
  });

  it("does not mutate the input array", () => {
    const clips = [
      { id: "c2", trackId: "t1", startTime: 10, duration: 5 },
      { id: "c1", trackId: "t1", startTime: 0, duration: 10 },
    ];
    const original = [...clips];

    computeClipVersion(clips);

    expect(clips).toEqual(original);
  });

  it("generates different hash when clips added/removed", () => {
    const clips1 = [{ id: "c1", trackId: "t1", startTime: 0, duration: 10 }];

    const clips2 = [
      { id: "c1", trackId: "t1", startTime: 0, duration: 10 },
      { id: "c2", trackId: "t1", startTime: 10, duration: 5 },
    ];

    const hash1 = computeClipVersion(clips1);
    const hash2 = computeClipVersion(clips2);

    expect(hash1).not.toBe(hash2);
  });

  it("generates different hash when render-affecting clip fields change", () => {
    const base = [{ id: "c1", trackId: "t1", mediaId: "m1", startTime: 0, duration: 10, trimIn: 0, trimOut: 10, x: 0, y: 0, width: 100, height: 100, opacity: 1, rotation: 0 }];
    const changedTrim = [{ ...base[0], trimIn: 2, trimOut: 12 }];
    const changedStyle = [{ ...base[0], text: "Hello", styleId: "neon" }];
    const changedTextColor = [{ ...base[0], text: "Hello", color: "#ff0000" }];
    const changedTextBackground = [{ ...base[0], text: "Hello", background: { color: "#000000", padding: 24, borderRadius: 4 } }];

    expect(computeClipVersion(base)).not.toBe(computeClipVersion(changedTrim));
    expect(computeClipVersion(base)).not.toBe(computeClipVersion(changedStyle));
    expect(computeClipVersion(changedStyle)).not.toBe(computeClipVersion(changedTextColor));
    expect(computeClipVersion(changedStyle)).not.toBe(computeClipVersion(changedTextBackground));
  });

  it("generates different hash when transition settings change", () => {
    const clips = [{ id: "c1", trackId: "t1", startTime: 0, duration: 10 }];
    const fade = [{ id: "tr1", type: "fade", fromItemId: "c1", toItemId: "c2", alignment: "center", easing: "linear", placement: { trackId: "t1", startTime: 4.5, duration: 1 }, effects: { version: 0 } }];
    const dissolve = [{ ...fade[0], type: "dissolve" }];

    expect(computeClipVersion(clips, fade)).not.toBe(computeClipVersion(clips, dissolve));
  });
});
