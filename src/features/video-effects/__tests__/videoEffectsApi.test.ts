import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VideoEffectsApi } from "../api/videoEffectsApi";

describe("VideoEffectsApi — Network & Cache Management Tests", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    VideoEffectsApi.clearLocalCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ─── 1. MANIFEST & RENDERER EFFECTS ──────────────────────────────────────
  describe("getVideoEffectsManifest & getRendererEffects", () => {
    it("should fetch video effects manifest on HTTP 200 OK", async () => {
      const mockManifest = { effects: [{ id: "v-glitch", name: "Glitch" }] };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockManifest,
      } as Response);

      const manifest = await VideoEffectsApi.getVideoEffectsManifest();
      expect(manifest.effects.length).toBe(1);
    });

    it("should fetch renderer effects list", async () => {
      const mockEffects = [{ id: "eff-1", name: "VHS Distortion" }];

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockEffects,
      } as Response);

      const effects = await VideoEffectsApi.getRendererEffects();
      expect(effects.length).toBe(1);
      expect(effects[0].name).toBe("VHS Distortion");
    });
  });

  // ─── 2. SEARCH & CACHE MANAGEMENT ─────────────────────────────────────────
  describe("searchRendererEffects & clearLocalCache", () => {
    it("should encode query string in searchRendererEffects", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response);
      globalThis.fetch = fetchSpy;

      await VideoEffectsApi.searchRendererEffects("cyber glitch");
      expect(fetchSpy).toHaveBeenCalled();
      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      expect(calledUrl).toContain("q=cyber%20glitch");
    });

    it("should reset in-memory cache stats when clearLocalCache is called", () => {
      VideoEffectsApi.clearLocalCache();
      const stats = VideoEffectsApi.getCacheStats();

      expect(stats.manifestCached).toBe(false);
      expect(stats.categoriesCached).toBe(0);
      expect(stats.blobsCached).toBe(0);
      expect(stats.totalBlobSizeMB).toBe(0);
    });
  });
});
