import { describe, it, expect, beforeEach, vi } from "vitest";
import { filterCacheManager } from "../cache/filterCache";
import type { FilterAsset } from "../types";

describe("FilterCacheManager — In-Memory & Fallback Cache Safety", () => {
  beforeEach(async () => {
    // Clear in-memory stats
    await filterCacheManager.initialize();
  });

  it("should initialize safely in non-Tauri browser / test environment", async () => {
    await filterCacheManager.initialize();
    const stats = filterCacheManager.getCacheStats();
    expect(stats).toBeDefined();
    expect(typeof stats.count).toBe("number");
  });

  it("should report non-cached for unknown filter IDs", () => {
    expect(filterCacheManager.isCached("non-existent-filter")).toBe(false);
    expect(filterCacheManager.getCached("non-existent-filter")).toBeNull();
    expect(filterCacheManager.getCachedPath("non-existent-filter")).toBeNull();
  });

  it("should return all cached items and stats correctly", () => {
    const all = filterCacheManager.getAllCached();
    expect(Array.isArray(all)).toBe(true);
  });

  describe("downloadFilter & Security Boundaries", () => {
    it("safely blocks unsafe URLs and preserves base filter without crashing", async () => {
      const unsafeFilter: FilterAsset = {
        id: "unsafe-1",
        name: "Unsafe",
        type: "filter",
        category: "custom",
        description: "",
        thumbnail: "",
        url: "javascript:alert(1)",
      };

      const cached = await filterCacheManager.downloadFilter(unsafeFilter);
      expect(cached.id).toBe("unsafe-1");
      expect(filterCacheManager.isCached("unsafe-1")).toBe(true);
    });

    it("sanitizes remote filter payloads before caching", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers(),
          text: async () => JSON.stringify({
            name: "Sanitized Remote",
            gradingParams: { contrast: 2.0, brightness: NaN, hugeVal: 99999 },
          }),
        } as Response);

        const filterToDownload: FilterAsset = {
          id: "f-remote-1",
          name: "Original",
          type: "filter",
          category: "cinematic",
          description: "",
          thumbnail: "",
          url: "https://api.clypra.com/filters/test.json",
        };

        const cached = await filterCacheManager.downloadFilter(filterToDownload);
        expect(cached.filter.name).toBe("Sanitized Remote");
        expect(cached.filter.gradingParams?.contrast).toBe(2.0);
        expect((cached.filter.gradingParams as any)?.hugeVal).toBe(1000);
        expect((cached.filter.gradingParams as any)?.brightness).toBeUndefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
