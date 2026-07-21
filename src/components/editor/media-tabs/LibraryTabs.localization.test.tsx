import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StickersTab } from "./StickersTab";
import { FiltersTab } from "./FiltersTab";
import { TransitionsTab } from "./TransitionsTab";
import { StickersApi, type StickerItem } from "@/features/stickers/api/stickersApi";
import { FiltersApi } from "@/features/filters/api/filtersApi";
import { TransitionsApi } from "@/features/transitions/api/transitionsApi";
import type { FilterAsset } from "@/features/filters/types";
import type { TransitionAsset } from "@/features/transitions/types";

const mocks = vi.hoisted(() => {
  const stickerStore = {
    initializeCache: vi.fn().mockResolvedValue(undefined),
    getDownloadState: vi.fn(() => null),
    startDownload: vi.fn().mockResolvedValue({}),
    isDownloaded: vi.fn(() => false),
    getCachedSticker: vi.fn(() => null),
  };
  const useStickersStore = Object.assign(vi.fn(() => stickerStore), { getState: () => stickerStore });
  return {
    stickerStore,
    useStickersStore,
    filterCache: {
      initialize: vi.fn().mockResolvedValue(undefined),
      isCached: vi.fn(() => false),
      ensureDownloaded: vi.fn().mockResolvedValue({}),
    },
    previewAsset: vi.fn(),
    showToast: vi.fn(),
  };
});

vi.mock("@/lib/api", () => ({ getApiBaseUrl: () => "https://api.example.test", getApiHeaders: () => ({}) }));
vi.mock("@/features/stickers/store/stickersStore", () => ({ useStickersStore: mocks.useStickersStore }));
vi.mock("@/features/filters/cache/filterCache", () => ({ filterCacheManager: mocks.filterCache }));
vi.mock("@/store/favoritesStore", () => ({ useFavoritesStore: () => ({ favorites: [], toggleFavorite: vi.fn() }) }));
vi.mock("@/store/projectStore", () => ({ useProjectStore: { getState: () => ({ showToast: mocks.showToast }) } }));
vi.mock("@/store/uiStore", () => ({
  useUIStore: (selector?: (state: { selectedClipIds: string[]; previewAsset: typeof mocks.previewAsset }) => unknown) => {
    const state = { selectedClipIds: ["left", "right"], previewAsset: mocks.previewAsset };
    return selector ? selector(state) : state;
  },
}));
vi.mock("@/store/timelineStore", () => ({ useTimelineStore: (selector: (state: { tracks: unknown[]; clips: unknown[] }) => unknown) => selector({ tracks: [], clips: [] }) }));

const sticker: StickerItem = {
  id: "sticker_RAW_01",
  name: "REMOTE 贴纸 / RAW",
  category: "emoji",
  thumbnailUrl: "https://cdn.example/thumb_RAW.png",
  lottieUrl: "https://cdn.example/data_RAW.json",
  preview: "https://cdn.example/preview_RAW.webm",
};

const filter: FilterAsset = {
  id: "filter_RAW_01",
  name: "REMOTE 滤镜 / RAW",
  type: "filter",
  category: "essentials",
  description: "RAW description",
  thumbnail: "https://cdn.example/filter_RAW.jpg",
  pipeline: "v2",
  effectStack: [{ type: "RAW_EFFECT", params: { amount: 0.75 } }],
};

const transition: TransitionAsset = {
  id: "transition_RAW_01",
  name: "REMOTE 转场 / RAW",
  type: "transition",
  category: "geometric",
  description: "RAW description",
  thumbnail: "https://cdn.example/transition_RAW.jpg",
  preview: "https://cdn.example/transition_RAW.webm",
  renderer: "renderer_RAW_01",
};

afterEach(() => {
  vi.restoreAllMocks();
  mocks.stickerStore.isDownloaded.mockReturnValue(false);
  mocks.filterCache.isCached.mockReturnValue(false);
});

describe("localized sticker, filter, and transition tabs", () => {
  test("renders sticker categories, loading, empty state, dynamic preview, and download ARIA while keeping the stable API ID", async () => {
    let resolve!: (items: StickerItem[]) => void;
    const request = vi.spyOn(StickersApi, "getStickersByCategory").mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = render(<StickersTab />);

    expect(screen.getByText("正在加载贴纸…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "表情" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "插画" })).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith("emoji");

    resolve([]);
    expect(await screen.findByText("未找到贴纸")).toBeInTheDocument();
    view.unmount();

    vi.spyOn(StickersApi, "getStickersByCategory").mockResolvedValue([sticker]);
    render(<StickersTab />);
    expect(await screen.findByText(sticker.name)).toBeInTheDocument();
    expect(screen.getByAltText(`${sticker.name} 预览`)).toHaveAttribute("src", sticker.preview);
    expect(screen.getByRole("button", { name: "下载贴纸" })).toBeInTheDocument();
  });

  test("localizes known filter IDs, passes unknown remote names through, and sends only stable IDs to the API", async () => {
    vi.spyOn(FiltersApi, "getCategories").mockResolvedValue([
      { id: "essentials", name: "REMOTE Essentials", description: "RAW" },
      { id: "remote-category_RAW", name: "Remote Category RAW", description: "RAW" },
    ]);
    const request = vi.spyOn(FiltersApi, "getByCategory").mockReturnValue(new Promise(() => undefined));
    render(<FiltersTab />);

    expect(screen.getByText("正在加载滤镜…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "基础" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Remote Category RAW" }));
    await waitFor(() => expect(request).toHaveBeenLastCalledWith("remote-category_RAW"));
  });

  test("keeps filter data and dynamic names raw while localizing preview and download ARIA", async () => {
    vi.spyOn(FiltersApi, "getCategories").mockResolvedValue([]);
    vi.spyOn(FiltersApi, "getByCategory").mockResolvedValue([filter]);
    render(<FiltersTab />);

    expect(await screen.findByText(filter.name)).toBeInTheDocument();
    expect(screen.getByAltText(`${filter.name} 预览`)).toHaveAttribute("src", filter.thumbnail);
    expect(screen.getByRole("button", { name: "下载滤镜" })).toBeInTheDocument();
    expect(filter).toMatchObject({ id: "filter_RAW_01", pipeline: "v2", effectStack: [{ type: "RAW_EFFECT" }] });
  });

  test("renders localized filter failure and empty states", async () => {
    vi.spyOn(FiltersApi, "getCategories").mockResolvedValue([]);
    vi.spyOn(FiltersApi, "getByCategory").mockRejectedValueOnce(new Error("REMOTE_ERR_RAW"));
    const view = render(<FiltersTab />);
    expect(await screen.findByText("加载滤镜失败：REMOTE_ERR_RAW")).toBeInTheDocument();
    view.unmount();

    vi.spyOn(FiltersApi, "getByCategory").mockResolvedValue([]);
    render(<FiltersTab />);
    expect(await screen.findByText("未找到匹配的滤镜")).toBeInTheDocument();
  });

  test("renders transition categories, loading, empty state, and stable API IDs", async () => {
    let resolve!: (items: TransitionAsset[]) => void;
    const request = vi.spyOn(TransitionsApi, "getByCategory").mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<TransitionsTab />);

    expect(screen.getByText("正在加载转场…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "几何" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "物理模拟" })).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith("geometric");
    resolve([]);
    expect(await screen.findByText("未找到匹配的转场")).toBeInTheDocument();
  });

  test("keeps transition renderer, name, and preview raw while localizing the real add button", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(TransitionsApi, "getByCategory").mockResolvedValue([transition]);
    const onAddToTimeline = vi.fn();
    render(<TransitionsTab onAddToTimeline={onAddToTimeline} />);

    expect(await screen.findByText(transition.name)).toBeInTheDocument();
    expect(document.querySelector("video")).toHaveAttribute("src", transition.preview);
    fireEvent.click(screen.getByRole("button", { name: "添加到时间线" }));
    expect(onAddToTimeline).toHaveBeenCalledWith(transition, "transitions");
    expect(transition.renderer).toBe("renderer_RAW_01");
  });
});
