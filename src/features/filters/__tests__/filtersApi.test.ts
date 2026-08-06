import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FiltersApi } from "../api/filtersApi";

describe("FiltersApi — Network & API Boundary Tests", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ─── 1. MANIFEST & CATEGORIES ────────────────────────────────────────────
  describe("getManifest & getCategories", () => {
    it("should fetch filter manifest successfully on HTTP 200 OK", async () => {
      const mockManifest = {
        categories: [{ id: "cinematic", name: "Cinematic", count: 5 }],
        totalFilters: 5,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockManifest,
      } as Response);

      const result = await FiltersApi.getManifest();
      expect(result.totalFilters).toBe(5);
      expect(result.categories.length).toBe(1);
    });

    it("should throw HTTP error when server returns 404 or 500 status", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Server Error",
      } as Response);

      await expect(FiltersApi.getManifest()).rejects.toThrow("HTTP 500: Server Error");
    });
  });

  // ─── 2. CATEGORY & ID LOOKUPS ─────────────────────────────────────────────
  describe("getByCategory & getById", () => {
    it("should fetch filters for a given category name", async () => {
      const mockFilters = [
        { id: "f1", name: "Sepia", category: "vintage", pipeline: "v1" },
      ];

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockFilters,
      } as Response);

      const filters = await FiltersApi.getByCategory("vintage");
      expect(filters.length).toBe(1);
      expect(filters[0].id).toBe("f1");
    });

    it("should fetch specific filter by ID", async () => {
      const mockFilter = { id: "f-teal", name: "Teal & Orange", category: "cinematic" };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockFilter,
      } as Response);

      const filter = await FiltersApi.getById("cinematic", "f-teal");
      expect(filter.name).toBe("Teal & Orange");
    });
  });

  // ─── 3. SEARCH & SANITIZATION ─────────────────────────────────────────────
  describe("search", () => {
    it("should encode special characters in query string safely", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response);
      globalThis.fetch = fetchSpy;

      await FiltersApi.search("teal & orange / 100%");
      expect(fetchSpy).toHaveBeenCalled();
      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      expect(calledUrl).toContain("q=teal%20%26%20orange%20%2F%20100%25");
    });
  });
});
