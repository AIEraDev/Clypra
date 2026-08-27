import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMediaImport } from "@/hooks/useMediaImport";
import { useProjectStore } from "@/store/projectStore";
import { platform } from "@/core/platform";
import { toast } from "@/lib/toast";

vi.mock("@/core/platform", () => ({
  platform: {
    openFileDialog: vi.fn(),
    getMediaMetadata: vi.fn(),
    extractPosterFrame: vi.fn(async () => "data:image/jpeg;base64,mock"),
    convertFileSrc: vi.fn((path) => `asset://${path}`),
  },
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/lib/platform/tauri", () => ({
  isTauriRuntime: () => false,
  probeMediaStreams: vi.fn(),
}));

describe("Finding 3.1: Corrupt & Unsupported Media Import Robustness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({ mediaAssets: [] });
  });

  it("handles corrupt media files gracefully without crashing or creating bad assets", async () => {
    // Simulate user selecting one valid file and one corrupt file
    (platform.openFileDialog as any).mockResolvedValueOnce([
      { name: "valid.mp4", path: "/media/valid.mp4", size: 10_000_000 },
      { name: "corrupt.mp4", path: "/media/corrupt.mp4", size: 128 },
    ]);

    // getMediaMetadata succeeds for valid file, throws for corrupt file
    (platform.getMediaMetadata as any).mockImplementation(async (path: string) => {
      if (path.includes("corrupt")) {
        throw new Error("FFmpeg error: moov atom not found, file truncated or corrupt");
      }
      return {
        duration: 12.5,
        width: 1920,
        height: 1080,
        size: 10_000_000,
      };
    });

    const { result } = renderHook(() => useMediaImport());

    await act(async () => {
      await result.current.importMedia();
    });

    // Valid asset was added to project store
    const assets = useProjectStore.getState().mediaAssets;
    expect(assets).toHaveLength(1);
    expect(assets[0].name).toBe("valid.mp4");
    expect(assets[0].duration).toBe(12.5);

    // Corrupt asset was NOT added
    expect(assets.find((a) => a.name === "corrupt.mp4")).toBeUndefined();

    // Warning notification was surfaced to user indicating 1 failed file
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining("1 file(s) failed to import. 1 succeeded.")
    );
  });

  it("notifies user when all selected files are corrupt or unsupported", async () => {
    (platform.openFileDialog as any).mockResolvedValueOnce([
      { name: "damaged_a.mov", path: "/media/damaged_a.mov", size: 0 },
      { name: "damaged_b.mkv", path: "/media/damaged_b.mkv", size: 50 },
    ]);

    (platform.getMediaMetadata as any).mockRejectedValue(
      new Error("Decoder error: unsupported or unknown codec")
    );

    const { result } = renderHook(() => useMediaImport());

    await act(async () => {
      await result.current.importMedia();
    });

    expect(useProjectStore.getState().mediaAssets).toHaveLength(0);
    expect(toast.warning).toHaveBeenCalledWith("2 file(s) failed to import.");
  });

  it("handles file picker dialog failure cleanly", async () => {
    (platform.openFileDialog as any).mockRejectedValueOnce(new Error("Native file dialog canceled by OS"));

    const { result } = renderHook(() => useMediaImport());

    await act(async () => {
      await result.current.importMedia();
    });

    expect(toast.error).toHaveBeenCalledWith("Failed to open file picker");
    expect(result.current.isLoading).toBe(false);
  });
});
