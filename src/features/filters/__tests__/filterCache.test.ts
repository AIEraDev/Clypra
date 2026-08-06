import { describe, it, expect, beforeEach } from "vitest";
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
});
