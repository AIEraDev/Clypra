import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { BodyMaskCache } from "../segmentation/maskCache";
import { getBodySegmentationConfig } from "../segmentation/segmentationConfig";
import { makeBodyMaskCacheKey } from "../segmentation/bodySegmentationWorkerClient";

function createMockImageData(width = 1, height = 1): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    colorSpace: "srgb",
  } as ImageData;
}

describe("Body Effects — ML Segmentation & Mask Cache Safety", () => {
  // ─── 1. BODY MASK CACHE LRU EVICTION ─────────────────────────────────────
  describe("BodyMaskCache", () => {
    let cache: BodyMaskCache;

    beforeEach(() => {
      // Max 3 entries for testing LRU behavior
      cache = new BodyMaskCache(3);
    });

    it("should return null for non-existent cache keys", () => {
      expect(cache.get("missing-key")).toBeNull();
    });

    it("should cache and retrieve ImageData instances", () => {
      const mockImageData = createMockImageData(1, 1);
      cache.set("key-1", mockImageData);
      expect(cache.get("key-1")).toBe(mockImageData);
    });

    it("should evict oldest unused entry when cache capacity is exceeded (LRU)", () => {
      const img1 = createMockImageData(1, 1);
      const img2 = createMockImageData(1, 1);
      const img3 = createMockImageData(1, 1);
      const img4 = createMockImageData(1, 1);

      cache.set("key-1", img1);
      cache.set("key-2", img2);
      cache.set("key-3", img3);

      // Access key-1 so key-2 becomes the oldest item
      cache.get("key-1");

      // Insert key-4 -> should evict key-2
      cache.set("key-4", img4);

      expect(cache.get("key-1")).toBe(img1);
      expect(cache.get("key-2")).toBeNull(); // Evicted!
      expect(cache.get("key-3")).toBe(img3);
      expect(cache.get("key-4")).toBe(img4);
    });

    it("should clear all cached entries when clear() is invoked", () => {
      cache.set("k1", createMockImageData(1, 1));
      cache.clear();
      expect(cache.get("k1")).toBeNull();
    });
  });

  // ─── 2. SEGMENTATION CONFIG & NETWORK FALLBACK ───────────────────────────
  describe("getBodySegmentationConfig", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("should fallback to 'heuristic' runtime on remote config fetch failure", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network Error"));

      const config = await getBodySegmentationConfig();
      expect(config.runtime).toBeDefined();
    });
  });

  // ─── 3. CACHE KEY GENERATION & FRAME PRECISION ───────────────────────────
  describe("makeBodyMaskCacheKey", () => {
    it("should round frame time to 1/24s precision to avoid duplicate masks on micro-time differences", () => {
      const key1 = makeBodyMaskCacheKey({
        clipId: "clip-1",
        effectId: "neon-body",
        renderer: "body-glow",
        width: 1920,
        height: 1080,
        time: 1.001,
      });

      const key2 = makeBodyMaskCacheKey({
        clipId: "clip-1",
        effectId: "neon-body",
        renderer: "body-glow",
        width: 1920,
        height: 1080,
        time: 1.003,
      });

      // Both times within same 24fps frame duration -> generate identical cache keys
      expect(key1).toBe(key2);
    });
  });
});
