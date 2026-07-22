import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCacheManager } from "../useCacheManager";
import { CacheManager } from "@/lib/cache/cacheManager";

vi.mock("@/lib/cache/cacheManager", () => ({
  CacheManager: {
    getCacheInfo: vi.fn().mockResolvedValue({
      localStorage: 3,
      sessionStorage: 1,
      gpuCache: { textures: 4, memoryMB: "8" },
    }),
    clearAppCache: vi.fn(),
    clearWebViewCache: vi.fn(),
    clearGPUCache: vi.fn(),
    clearAllCaches: vi.fn(),
  },
}));

describe("useCacheManager hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should fetch cache info on mount", async () => {
    let resultHook: any;

    await act(async () => {
      const { result } = renderHook(() => useCacheManager());
      resultHook = result;
    });

    expect(CacheManager.getCacheInfo).toHaveBeenCalled();
    expect(resultHook.current.cacheInfo).toEqual({
      localStorage: 3,
      sessionStorage: 1,
      gpuCache: { textures: 4, memoryMB: "8" },
    });
  });

  it("should clear app cache successfully", async () => {
    vi.mocked(CacheManager.clearAppCache).mockResolvedValueOnce({ success: true });

    let resultHook: any;
    await act(async () => {
      const { result } = renderHook(() => useCacheManager());
      resultHook = result;
    });

    await act(async () => {
      await resultHook.current.clearAppCache();
    });

    expect(CacheManager.clearAppCache).toHaveBeenCalled();
    expect(resultHook.current.lastResult).toEqual({
      success: true,
      message: "应用缓存已成功清理！",
    });
  });

  it("should clear webview cache successfully", async () => {
    vi.mocked(CacheManager.clearWebViewCache).mockResolvedValueOnce({ success: true });

    let resultHook: any;
    await act(async () => {
      const { result } = renderHook(() => useCacheManager());
      resultHook = result;
    });

    await act(async () => {
      await resultHook.current.clearWebViewCache();
    });

    expect(CacheManager.clearWebViewCache).toHaveBeenCalled();
    expect(resultHook.current.lastResult).toEqual({
      success: true,
      message: "WebView 缓存已成功清理！",
    });
  });

  it("should clear GPU cache successfully", async () => {
    vi.mocked(CacheManager.clearGPUCache).mockReturnValueOnce({ success: true });

    let resultHook: any;
    await act(async () => {
      const { result } = renderHook(() => useCacheManager());
      resultHook = result;
    });

    await act(async () => {
      await resultHook.current.clearGPUCache();
    });

    expect(CacheManager.clearGPUCache).toHaveBeenCalled();
    expect(resultHook.current.lastResult).toEqual({
      success: true,
      message: "GPU 缓存已成功清理！",
    });
  });

  it("should clear all caches successfully", async () => {
    const mockStats = {
      appCacheCleared: true,
      webViewCacheCleared: true,
      gpuCacheCleared: true,
      errors: [],
    };
    vi.mocked(CacheManager.clearAllCaches).mockResolvedValueOnce(mockStats);

    let resultHook: any;
    await act(async () => {
      const { result } = renderHook(() => useCacheManager());
      resultHook = result;
    });

    await act(async () => {
      await resultHook.current.clearAllCaches({ localStorage: false });
    });

    expect(CacheManager.clearAllCaches).toHaveBeenCalledWith({ localStorage: false });
    expect(resultHook.current.lastResult).toEqual({
      success: true,
      message: "所有缓存已成功清理！",
      stats: mockStats,
    });
  });

  it("should handle failures during clear all caches", async () => {
    const mockStats = {
      appCacheCleared: false,
      webViewCacheCleared: true,
      gpuCacheCleared: true,
      errors: ["App cache lock error"],
    };
    vi.mocked(CacheManager.clearAllCaches).mockResolvedValueOnce(mockStats);

    let resultHook: any;
    await act(async () => {
      const { result } = renderHook(() => useCacheManager());
      resultHook = result;
    });

    await act(async () => {
      await resultHook.current.clearAllCaches();
    });

    expect(resultHook.current.lastResult?.success).toBe(false);
    expect(resultHook.current.lastResult?.message).toBe("缓存已清理，但发生 1 个错误");
  });

  it("should reset last result on clearResult call", async () => {
    vi.mocked(CacheManager.clearAppCache).mockResolvedValueOnce({ success: true });

    let resultHook: any;
    await act(async () => {
      const { result } = renderHook(() => useCacheManager());
      resultHook = result;
    });

    await act(async () => {
      await resultHook.current.clearAppCache();
    });

    expect(resultHook.current.lastResult).not.toBeNull();

    act(() => {
      resultHook.current.clearResult();
    });

    expect(resultHook.current.lastResult).toBeNull();
  });
});
