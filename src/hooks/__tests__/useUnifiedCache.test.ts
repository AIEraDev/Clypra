import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUnifiedCache } from "../useUnifiedCache";
import { getCacheCoordinator } from "@/core/cache/cacheCoordinator";

// Mock Tauri platform detection & invoke
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

vi.mock("@/lib/platform/tauri", () => ({
  isTauriRuntime: vi.fn().mockReturnValue(true),
}));

describe("useUnifiedCache hook", () => {
  const mockRawStats = {
    total_bytes: 104857600, // 100 MB
    limit_bytes: 5368709120, // 5 GB
    namespace_bytes: { thumbnails: 52428800, audio: 52428800 },
    namespace_counts: { thumbnails: 12, audio: 4 },
    hit_count: 85,
    miss_count: 15,
    hit_rate_pct: 85.0,
    eviction_count: 2,
    root_dir: "/path/to/clypra_cache",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_unified_cache_stats") return Promise.resolve(mockRawStats);
      if (cmd === "set_unified_cache_limit") return Promise.resolve();
      if (cmd === "purge_unified_cache") {
        return Promise.resolve({
          purged_files: 5,
          purged_bytes: 52428800,
          remaining_bytes: 52428800,
        });
      }
      if (cmd === "verify_cache_integrity") {
        return Promise.resolve({
          scanned_files: 16,
          quarantined_files: 0,
          quarantined_bytes: 0,
          errors: [],
        });
      }
      return Promise.resolve();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches disk cache stats and snapshots coordinator memory stats on mount", async () => {
    let hookResult: any;
    await act(async () => {
      const { result } = renderHook(() => useUnifiedCache());
      hookResult = result;
    });

    expect(mockInvoke).toHaveBeenCalledWith("get_unified_cache_stats");
    expect(hookResult.current.stats).toEqual({
      totalBytes: 104857600,
      limitBytes: 5368709120,
      namespaceBytes: { thumbnails: 52428800, audio: 52428800 },
      namespaceCounts: { thumbnails: 12, audio: 4 },
      hitCount: 85,
      missCount: 15,
      hitRatePct: 85.0,
      evictionCount: 2,
      rootDir: "/path/to/clypra_cache",
    });
    expect(hookResult.current.memoryStats).toBeDefined();
    expect(hookResult.current.error).toBeNull();
  });

  it("updates disk cache budget via setLimit", async () => {
    let hookResult: any;
    await act(async () => {
      const { result } = renderHook(() => useUnifiedCache());
      hookResult = result;
    });

    await act(async () => {
      await hookResult.current.setLimit(10737418240); // 10 GB
    });

    expect(mockInvoke).toHaveBeenCalledWith("set_unified_cache_limit", {
      limit_bytes: 10737418240,
    });
    // refresh called after setLimit
    expect(mockInvoke).toHaveBeenCalledTimes(3); // mount get + set + refresh get
  });

  it("purges targeted namespaces with mapped Rust filter", async () => {
    let hookResult: any;
    await act(async () => {
      const { result } = renderHook(() => useUnifiedCache());
      hookResult = result;
    });

    await act(async () => {
      await hookResult.current.purge({ namespaces: ["thumbnails"], olderThanSecs: 3600 });
    });

    expect(mockInvoke).toHaveBeenCalledWith("purge_unified_cache", {
      filter: {
        namespaces: ["thumbnails"],
        older_than_secs: 3600,
      },
    });
  });

  it("runs integrity verification and formats report", async () => {
    let hookResult: any;
    await act(async () => {
      const { result } = renderHook(() => useUnifiedCache());
      hookResult = result;
    });

    let report: any;
    await act(async () => {
      report = await hookResult.current.verifyIntegrity();
    });

    expect(mockInvoke).toHaveBeenCalledWith("verify_cache_integrity");
    expect(report).toEqual({
      scannedFiles: 16,
      quarantinedFiles: 0,
      quarantinedBytes: 0,
      errors: [],
    });
  });

  it("captures IPC error cleanly without crashing", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("IPC transport failure"));

    let hookResult: any;
    await act(async () => {
      const { result } = renderHook(() => useUnifiedCache());
      hookResult = result;
    });

    expect(hookResult.current.error).toBe("IPC transport failure");
    expect(hookResult.current.stats).toBeNull();
  });
});
