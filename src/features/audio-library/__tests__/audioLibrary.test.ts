import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAudioLibraryStore } from "../store/audioLibraryStore";
import { audioCacheManager } from "../cache/audioCache";
import type { AudioLibraryItem } from "../api/audioLibraryApi";
import { exists, remove, readDir } from "@tauri-apps/plugin-fs";

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
    readDir: vi.fn().mockImplementation(async () => [
      { name: "index.json", isDirectory: false, isFile: true },
      { name: "audio-file.mp3", isDirectory: false, isFile: true },
    ]),
  };
});

vi.mock("@tauri-apps/api/path", () => {
  return {
    join: vi.fn((...args: string[]) => args.join("/")),
    appCacheDir: vi.fn().mockResolvedValue("/mock-cache-dir"),
  };
});

describe("Audio Library Store & Cache Manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAudioLibraryStore.setState({ downloads: {} });
  });

  const mockItem = {
    id: "audio-123",
    name: "Epic Beat",
    audioUrl: "http://example.com/beat.mp3",
    duration: 3.5,
    category: "beats",
  } as AudioLibraryItem;

  describe("AudioCacheManager", () => {
    it("should initialize the cache and list loaded items", async () => {
      await expect(audioCacheManager.initialize()).resolves.not.toThrow();
      expect(audioCacheManager.getAllCached().length).toBe(0);
    });

    it("should manage downloading, caching, and statistic tracking correctly", async () => {
      const globalFetch = globalThis.fetch;
      
      // Mock stream reader for progress events
      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: vi.fn().mockReturnValue("3"),
        },
        body: {
          getReader: () => mockReader,
        },
      });

      const cached = await audioCacheManager.downloadAudio(mockItem);
      expect(cached.id).toBe("audio-123");
      expect(audioCacheManager.isCached("audio-123")).toBe(true);

      const stats = audioCacheManager.getCacheStats();
      expect(stats.count).toBe(1);
      expect(stats.totalSize).toBe(3);

      await audioCacheManager.clearCache("audio-123");
      expect(audioCacheManager.isCached("audio-123")).toBe(false);

      globalThis.fetch = globalFetch;
    });
  });

  describe("AudioLibraryStore (Zustand)", () => {
    it("should manage loading, completion states, and local paths statefully", async () => {
      const cacheResult = {
        id: "audio-123",
        localPath: "audio-library/audio-123.mp3",
        originalUrl: "http://example.com/beat.mp3",
        fileName: "beat.mp3",
        size: 1000,
        downloadedAt: Date.now(),
        metadata: { duration: 3.5, format: "mp3" },
      };

      const downloadSpy = vi.spyOn(audioCacheManager, "downloadAudio").mockResolvedValue(cacheResult);
      vi.spyOn(audioCacheManager, "getAllCached").mockReturnValue([cacheResult]);

      // Initialize cache should load completed entries
      await useAudioLibraryStore.getState().initializeCache();
      expect(useAudioLibraryStore.getState().isDownloaded("audio-123")).toBe(true);
      expect(useAudioLibraryStore.getState().getLocalPath("audio-123")).toBe("audio-library/audio-123.mp3");

      downloadSpy.mockRestore();
    });
  });
});
