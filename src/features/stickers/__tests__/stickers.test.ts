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
        localImagePath: "stickers/sticker-123.png",
        localAnimationPath: "stickers/sticker-123.json",
        downloadedAt: Date.now(),
      };
      
      const downloadSpy = vi.spyOn(stickerCacheManager, "downloadSticker").mockResolvedValue(cacheResult);
      vi.spyOn(stickerCacheManager, "isCached").mockReturnValue(false);
      vi.spyOn(stickerCacheManager, "readLottieJson").mockResolvedValue({ lottie: true });

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
    });
  });
});
