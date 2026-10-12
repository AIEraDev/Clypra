import { describe, it, expect, vi, beforeEach } from "vitest";
import { useStickersStore } from "../store/stickersStore";
import { stickerCacheManager } from "../cache/stickerCache";
import type { StickerItem } from "../api/stickersApi";
import { exists, readFile, writeFile, remove } from "@tauri-apps/plugin-fs";

vi.mock("@tauri-apps/plugin-fs", () => {
  const mockCache = new Map<string, string>();
  return {
    BaseDirectory: { AppCache: "AppCache" },
    exists: vi.fn().mockImplementation(async (path: string) => mockCache.has(path) || path.endsWith("index.json")),
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockImplementation(async (path: string, data: Uint8Array) => {
      mockCache.set(path, new TextDecoder().decode(data));
    }),
    readFile: vi.fn().mockImplementation(async (path: string) => {
      const content = mockCache.get(path) ?? "[]";
      return new TextEncoder().encode(content);
    }),
    remove: vi.fn().mockImplementation(async (path: string) => {
      mockCache.delete(path);
    }),
  };
});

vi.mock("@tauri-apps/api/path", () => {
  return {
    join: vi.fn((...args: string[]) => args.join("/")),
    appCacheDir: vi.fn().mockResolvedValue("/mock-cache-dir"),
  };
});

describe("Stickers Store & Cache Manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStickersStore.setState({ downloads: {} });
  });

  const mockItem = {
    id: "sticker-123",
    name: "Happy Sticker",
    thumbnailUrl: "http://example.com/sticker.png",
    lottieUrl: "http://example.com/sticker.json",
  } as StickerItem;

  describe("StickerCacheManager", () => {
    it("should initialize the index and load cache entries", async () => {
      await expect(stickerCacheManager.initialize()).resolves.not.toThrow();
    });

    it("should report cache status and save download indexes correctly", async () => {
      // Mock global fetch to return array buffer representing binary data
      const globalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode('{"v":"5.5.0"}').buffer,
      });

      const cached = await stickerCacheManager.downloadSticker(mockItem);
      expect(cached.id).toBe("sticker-123");
      expect(stickerCacheManager.isCached("sticker-123")).toBe(true);
      expect(stickerCacheManager.getCached("sticker-123")).toEqual(cached);

      // Clean up cache
      await stickerCacheManager.clearCache("sticker-123");
      expect(stickerCacheManager.isCached("sticker-123")).toBe(false);
      expect(remove).toHaveBeenCalled();

      // Restore fetch
      globalThis.fetch = globalFetch;
    });
  });

  describe("StickersStore (Zustand)", () => {
    it("should manage downloading, completed, and progress states", async () => {
      // Stub downloadSticker implementation
      const cacheResult = {
        id: "sticker-123",
        sha256: "mock-sha-123",
        localImagePath: "stickers/sticker-123.png",
        localAnimationPath: "stickers/sticker-123.json",
        downloadedAt: Date.now(),
        lastAccessedAt: Date.now(),
        sizeBytes: 1024,
      };
      
      const downloadSpy = vi.spyOn(stickerCacheManager, "downloadSticker").mockResolvedValue(cacheResult);
      vi.spyOn(stickerCacheManager, "isCached").mockReturnValue(false);
      const readLottieSpy = vi.spyOn(stickerCacheManager, "readLottieJson").mockResolvedValue({ lottie: true });

      // Run store download action
      const promise = useStickersStore.getState().startDownload(mockItem);
      
      // Store state should mark as downloading immediately
      const runningState = useStickersStore.getState().downloads["sticker-123"];
      expect(runningState.status).toBe("downloading");

      const result = await promise;
      expect(result).toEqual(cacheResult);

      const completedState = useStickersStore.getState().getDownloadState("sticker-123");
      expect(completedState).not.toBeNull();
      expect(completedState!.status).toBe("completed");
      expect(completedState!.progress).toBe(100);

      downloadSpy.mockRestore();
      readLottieSpy.mockRestore();
    });
  });

  describe("Phase 4 — Offline Starters & API Integration", () => {
    it("provides 10 bundled starter stickers with valid Lottie metadata and licenses", async () => {
      const { STARTER_STICKERS, getStarterStickers } = await import("../starterStickers");
      expect(STARTER_STICKERS.length).toBe(10);
      const starters = getStarterStickers();
      expect(starters.length).toBe(10);

      for (const starter of STARTER_STICKERS) {
        expect(starter.id).toMatch(/^starter-[a-z0-9-]+$/);
        expect(starter.lottieData).toBeDefined();
        expect(starter.lottieData.v).toBeDefined();
        expect(starter.lottieData.layers).toBeInstanceOf(Array);
        expect(starter.lottieData.layers.length).toBeGreaterThan(0);
        expect(starter.svgThumbnail).toContain("data:image/svg+xml");
        expect(starter.license).toBeDefined();
        expect(starter.license?.spdx).toBeDefined();
        expect(starter.license?.author).toBeDefined();
      }
    });

    it("falls back to starter stickers when offline or network fails", async () => {
      const { StickersApi } = await import("../api/stickersApi");
      const fallback = StickersApi.getOfflineFallback();
      expect(fallback.length).toBe(10);

      const reactionFallback = StickersApi.getOfflineFallback("reaction");
      expect(reactionFallback.length).toBeGreaterThan(0);
      expect(reactionFallback.every((s) => s.category === "reaction")).toBe(true);
    });

    it("reads bundled Lottie JSON directly from cache manager without network", async () => {
      const lottie = await stickerCacheManager.readLottieJson("bundled://starter-golden-star.json");
      expect(lottie).toBeDefined();
      expect((lottie as any).nm).toBe("Golden Star");
    });
  });
});
