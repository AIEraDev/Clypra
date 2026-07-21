import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CacheSettings } from "../CacheSettings";
import { useCacheManager } from "@/hooks/useCacheManager";
import { t } from "@/i18n";

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

    expect(screen.getByText(t("settings.cache.management.title"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.cache.status"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.cache.localStorageItems"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.cache.itemCount", { count: 10 }))).toBeInTheDocument();
    expect(screen.getByText(t("settings.cache.sessionStorageItems"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.cache.itemCount", { count: 5 }))).toBeInTheDocument();
    expect(screen.getByText(t("settings.cache.gpuTextures"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.cache.textureCount", { count: 20 }))).toBeInTheDocument();
    expect(screen.getByText(t("settings.cache.gpuMemory"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.cache.sizeMB", { size: "45" }))).toBeInTheDocument();
  });

  it("calls clearAllCaches with localStorage: false on Clear All click", () => {
    render(<CacheSettings />);

    const clearAllButton = screen.getByRole("button", { name: new RegExp(t("settings.cache.clearAll")) });
    fireEvent.click(clearAllButton);

    expect(mockClearAllCaches).toHaveBeenCalledWith({ localStorage: false });
  });

  it("calls clearAppCache on App Cache button click", () => {
    render(<CacheSettings />);

    const appCacheButton = screen.getByRole("button", { name: t("settings.cache.appCache") });
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

    const gpuCacheButton = screen.getByRole("button", { name: t("settings.cache.gpuCache") });
    fireEvent.click(gpuCacheButton);

    expect(mockClearGPUCache).toHaveBeenCalled();
  });

  it("displays success message correctly when lastResult is success", () => {
    vi.mocked(useCacheManager).mockReturnValue({
      ...defaultMockValues,
      lastResult: {
        success: true,
        message: "All caches cleared successfully!",
      },
    });

    render(<CacheSettings />);

    expect(screen.getByText(t("settings.cache.allCleared"))).toBeInTheDocument();
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

    expect(
      screen.getByText(t("settings.cache.operationFailed", { error: "Clear failed!" })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `• ${t("settings.cache.operationFailed", {
          error: "WebView is locked by another process",
        })}`,
      ),
    ).toBeInTheDocument();
  });

  it("disables buttons and shows a spinner when isClearing is true", () => {
    vi.mocked(useCacheManager).mockReturnValue({
      ...defaultMockValues,
      isClearing: true,
    });

    render(<CacheSettings />);

    const clearAllButton = screen.getByRole("button", { name: new RegExp(t("settings.cache.clearAll")) });
    expect(clearAllButton).toBeDisabled();

    // Check individual buttons are also disabled
    expect(screen.getByRole("button", { name: t("settings.cache.appCache") })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^WebView$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: t("settings.cache.gpuCache") })).toBeDisabled();
  });
});
