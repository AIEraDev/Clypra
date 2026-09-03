import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CacheSettings } from "../CacheSettings";
import { useCacheManager } from "@/hooks/useCacheManager";

vi.mock("@/hooks/useCacheManager", () => ({
  useCacheManager: vi.fn(),
}));

describe("CacheSettings component", () => {
  const mockClearAllCaches = vi.fn();
  const mockClearAppCache = vi.fn();
  const mockClearWebViewCache = vi.fn();
  const mockClearGPUCache = vi.fn();

  const defaultMockValues = {
    isClearing: false,
    cacheInfo: {
      localStorage: 10,
      sessionStorage: 5,
      gpuCache: { textureCount: 20, memoryMB: "45" },
    },
    lastResult: null,
    clearAllCaches: mockClearAllCaches,
    clearAppCache: mockClearAppCache,
    clearWebViewCache: mockClearWebViewCache,
    clearGPUCache: mockClearGPUCache,
    refreshCacheInfo: vi.fn(),
    clearResult: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCacheManager).mockReturnValue(defaultMockValues);
  });

  it("renders cache title, description, and status correctly", () => {
    render(<CacheSettings />);

    expect(screen.getByText("Cache Management")).toBeInTheDocument();
    expect(screen.getByText("localStorage")).toBeInTheDocument();
    expect(screen.getByText(/10\s*items/)).toBeInTheDocument();
    expect(screen.getByText("sessionStorage")).toBeInTheDocument();
    expect(screen.getByText(/5\s*items/)).toBeInTheDocument();
    expect(screen.getByText("GPU Textures")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("GPU Memory")).toBeInTheDocument();
    expect(screen.getByText(/45\s*MB/)).toBeInTheDocument();
  });

  it("calls clearAllCaches with localStorage: false on Clear All click", () => {
    render(<CacheSettings />);

    const clearAllButton = screen.getByRole("button", { name: /Clear All Caches/i });
    fireEvent.click(clearAllButton);

    expect(mockClearAllCaches).toHaveBeenCalledWith({ localStorage: false });
  });

  it("calls clearAppCache on App Cache button click", () => {
    render(<CacheSettings />);

    const appCacheButton = screen.getByRole("button", { name: /^App Cache$/i });
    fireEvent.click(appCacheButton);

    expect(mockClearAppCache).toHaveBeenCalled();
  });

  it("calls clearWebViewCache on WebView button click", () => {
    render(<CacheSettings />);

    const webViewButton = screen.getByRole("button", { name: /^WebView$/i });
    fireEvent.click(webViewButton);

    expect(mockClearWebViewCache).toHaveBeenCalled();
  });

  it("calls clearGPUCache on GPU Cache button click", () => {
    render(<CacheSettings />);

    const gpuCacheButton = screen.getByRole("button", { name: /^GPU Cache$/i });
    fireEvent.click(gpuCacheButton);

    expect(mockClearGPUCache).toHaveBeenCalled();
  });

  it("displays success message correctly when lastResult is success", () => {
    vi.mocked(useCacheManager).mockReturnValue({
      ...defaultMockValues,
      lastResult: {
        success: true,
        message: "Caches cleared successfully!",
      },
    });

    render(<CacheSettings />);

    expect(screen.getByText("Caches cleared successfully!")).toBeInTheDocument();
  });

  it("displays error message and stats errors when lastResult fails", () => {
    vi.mocked(useCacheManager).mockReturnValue({
      ...defaultMockValues,
      lastResult: {
        success: false,
        message: "Clear failed!",
        stats: {
          appCacheCleared: false,
          webViewCacheCleared: false,
          gpuCacheCleared: false,
          errors: ["WebView is locked by another process"],
        },
      },
    });

    render(<CacheSettings />);

    expect(screen.getByText("Clear failed!")).toBeInTheDocument();
    expect(screen.getByText("• WebView is locked by another process")).toBeInTheDocument();
  });

  it("disables buttons and shows a spinner when isClearing is true", () => {
    vi.mocked(useCacheManager).mockReturnValue({
      ...defaultMockValues,
      isClearing: true,
    });

    render(<CacheSettings />);

    const clearAllButton = screen.getByRole("button", { name: /Clear All Caches/i });
    expect(clearAllButton).toBeDisabled();

    // Check individual buttons are also disabled
    expect(screen.getByRole("button", { name: /^App Cache$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^WebView$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^GPU Cache$/i })).toBeDisabled();
  });
});
