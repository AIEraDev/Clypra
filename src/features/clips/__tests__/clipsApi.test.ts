import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ClipsApi } from "../api/clipsApi";

function makeClipItem(id = "clip-001") {
  return {
    id,
    title: "Test Clip",
    category: "reaction",
    tags: ["reaction"],
    durationSec: 3,
    width: 1920,
    height: 1080,
    posterUrl: "https://cdn.clypra.com/poster.webp",
    previewUrl: "https://cdn.clypra.com/preview.mp4",
    fileUrl: "https://cdn.clypra.com/file.mp4",
    sha256: "a".repeat(64),
    bytes: 1_000_000,
    hasAudio: true,
    hasAlpha: false as const,
    license: { spdx: "CC0-1.0" as const, author: "Test", releaseOnFile: true as const },
    published: true,
  };
}

describe("ClipsApi", () => {
  beforeEach(() => {
    ClipsApi._clearCache();
    vi.stubGlobal("fetch", undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ClipsApi._clearCache();
  });

  describe("getClipsIndex", () => {
    it("returns clip list on 200 response", async () => {
      const clips = [makeClipItem("a"), makeClipItem("b")];
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => '"etag-1"' },
        json: async () => ({ schemaVersion: 1, clips }),
      }));
      const result = await ClipsApi.getClipsIndex();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("a");
    });

    it("returns cached data on 304 Not Modified", async () => {
      const clips = [makeClipItem("cached")];
      // First fetch — 200 to seed cache
      vi.stubGlobal("fetch", vi.fn()
        .mockResolvedValueOnce({
          ok: true, status: 200,
          headers: { get: () => '"etag-seed"' },
          json: async () => ({ clips }),
        })
        // Second fetch — 304
        .mockResolvedValueOnce({
          ok: false, status: 304,
          headers: { get: () => null },
          json: async () => { throw new Error("no body"); },
        }),
      );
      await ClipsApi.getClipsIndex();
      const result = await ClipsApi.getClipsIndex();
      expect(result[0].id).toBe("cached");
    });

    it("returns [] on network error (shows offline state, not throw)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
      const result = await ClipsApi.getClipsIndex();
      expect(result).toEqual([]);
    });

    it("returns [] on non-200 HTTP error when no cache", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false, status: 500,
        headers: { get: () => null },
      }));
      const result = await ClipsApi.getClipsIndex();
      expect(result).toEqual([]);
    });

    it("handles array response format (not wrapped)", async () => {
      const clips = [makeClipItem("arr")];
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true, status: 200,
        headers: { get: () => null },
        json: async () => clips,
      }));
      const result = await ClipsApi.getClipsIndex();
      expect(result[0].id).toBe("arr");
    });
  });

  describe("getClipsByCategory", () => {
    it("returns clips for the given category on 200", async () => {
      const clips = [makeClipItem("football-001")];
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true, status: 200,
        headers: { get: () => '"etag-football"' },
        json: async () => ({ clips }),
      }));
      const result = await ClipsApi.getClipsByCategory("football");
      expect(result).toHaveLength(1);
    });

    it("returns [] on network error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
      const result = await ClipsApi.getClipsByCategory("laughing");
      expect(result).toEqual([]);
    });
  });

  describe("getOfflineFallback", () => {
    it("always returns empty array (no bundled clips)", () => {
      expect(ClipsApi.getOfflineFallback()).toEqual([]);
    });
  });
});
