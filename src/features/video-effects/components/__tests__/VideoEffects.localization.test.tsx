import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { VideoEffectsApi } from "../../api/videoEffectsApi";
import { EffectPicker } from "../EffectPicker";
import { EffectsPanel } from "../EffectsPanel";
import { RendererEffectsBrowser } from "../RendererEffectsBrowser";
import { useFavoritesStore } from "@/store/favoritesStore";
import type { EffectPreset } from "../../types";

vi.mock("@/lib/api", () => ({
  getApiBaseUrl: () => "https://api.example.test",
  getApiHeaders: () => ({}),
}));

vi.mock("@clypra-studio/engine", () => ({
  getEffectsByCategory: vi.fn(() => []),
}));

const bodyEffects: EffectPreset[] = [
  {
    id: "body-trending_RAW",
    name: "REMOTE Trending / 原始名",
    type: "body-effect",
    category: "trending",
    description: "REMOTE description RAW",
    thumbnail: "https://cdn.example/trending_RAW.png",
    renderer: "body_glow",
    params: { intensity: 0.4 },
    tags: ["REMOTE_TAG"],
    intensity: { min: 0, max: 1, default: 0.4, step: 0.1 },
  },
  {
    id: "body-energy_RAW",
    name: "REMOTE Energy / 原始名",
    type: "body-effect",
    category: "energy",
    description: "REMOTE energy description RAW",
    thumbnail: "https://cdn.example/energy_RAW.png",
    renderer: "body_particles",
    params: { intensity: 0.8 },
    tags: ["ENERGY_RAW"],
    intensity: { min: 0, max: 1, default: 0.8, step: 0.1 },
  },
];

const rendererEffect = {
  id: "video-remote_RAW",
  name: "REMOTE Video / 原始名",
  type: "video-effect" as const,
  category: "essentials",
  description: "REMOTE renderer description RAW",
  thumbnail: "https://cdn.example/video_RAW.png",
  renderer: "glitch" as const,
  params: { intensity: 0.7 },
  parameterSchema: { intensity: { type: "number", min: 0, max: 1 } },
  tags: ["VIDEO_TAG_RAW"],
  intensity: { min: 0, max: 1, default: 0.7, step: 0.1 },
};

beforeEach(() => {
  vi.restoreAllMocks();
  useFavoritesStore.setState({
    favorites: [],
    downloadedEffects: [],
    downloadedTemplates: [],
    downloadingIds: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("video effect browser localization", () => {
  test("shows Chinese tabs and category names while retaining stable category IDs", async () => {
    const rendererSpy = vi.spyOn(VideoEffectsApi, "getRendererEffectsByCategory").mockResolvedValue([rendererEffect]);
    vi.spyOn(VideoEffectsApi, "getBodyEffects").mockResolvedValue(bodyEffects);

    render(<EffectsPanel />);

    expect(screen.getByRole("button", { name: "视频" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "基础" })).toBeInTheDocument();
    await waitFor(() => expect(rendererSpy).toHaveBeenCalledWith("essentials"));

    fireEvent.click(screen.getByRole("button", { name: "故障" }));
    await waitFor(() => expect(rendererSpy).toHaveBeenCalledWith("glitch"));

    fireEvent.click(screen.getByRole("button", { name: "身体" }));
    expect(await screen.findByText("REMOTE Trending / 原始名")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "能量" }));
    expect(await screen.findByText("REMOTE Energy / 原始名")).toBeInTheDocument();
    expect(screen.queryByText("REMOTE Trending / 原始名")).not.toBeInTheDocument();
  });

  test("localizes body search, empty, download, and accessible card controls without translating remote names", async () => {
    vi.spyOn(VideoEffectsApi, "getBodyEffects").mockResolvedValue(bodyEffects);
    useFavoritesStore.setState({ downloadingIds: [bodyEffects[0].id] });

    render(<EffectPicker onSelect={vi.fn()} />);

    expect(screen.getByPlaceholderText("搜索身体效果…")).toBeInTheDocument();
    expect(await screen.findByText(bodyEffects[0].name)).toBeInTheDocument();
    expect(screen.getByText("正在下载…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `收藏 ${bodyEffects[0].name}` })).toHaveAttribute("title", `收藏 ${bodyEffects[0].name}`);
    expect(screen.getByRole("button", { name: "下载并添加效果" })).toHaveAttribute("title", "下载并添加效果");

    fireEvent.change(screen.getByPlaceholderText("搜索身体效果…"), { target: { value: "NO_MATCH_RAW" } });
    expect(screen.getByText("未找到效果")).toBeInTheDocument();
    expect(screen.getByText("请尝试其他搜索词或分类")).toBeInTheDocument();
  });

  test("shows a generic Chinese body-load error and logs the original error only", async () => {
    const rawError = "HTTP 503 RAW_BODY_SECRET";
    vi.spyOn(VideoEffectsApi, "getBodyEffects").mockRejectedValue(new Error(rawError));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<EffectPicker onSelect={vi.fn()} />);

    expect(await screen.findByText("加载身体效果失败")).toBeInTheDocument();
    expect(screen.queryByText(rawError)).not.toBeInTheDocument();
    expect(consoleSpy).toHaveBeenCalledWith("Failed to load body effects:", expect.objectContaining({ message: rawError }));
  });

  test("localizes renderer loading and empty states", async () => {
    let resolveEffects!: (effects: EffectPreset[]) => void;
    vi.spyOn(VideoEffectsApi, "getRendererEffectsByCategory").mockReturnValue(
      new Promise((resolve) => {
        resolveEffects = resolve;
      }),
    );

    render(<RendererEffectsBrowser />);

    expect(screen.getByText("正在加载效果…")).toBeInTheDocument();
    await act(async () => resolveEffects([]));
    expect(await screen.findByText("未找到效果")).toBeInTheDocument();
    expect(screen.getByText("请尝试其他搜索词或分类")).toBeInTheDocument();
  });

  test("keeps renderer metadata raw and gives each icon button a Chinese accessible name and title", async () => {
    vi.spyOn(VideoEffectsApi, "getRendererEffectsByCategory").mockResolvedValue([rendererEffect]);

    render(<RendererEffectsBrowser />);

    expect(await screen.findByText(rendererEffect.name)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `收藏 ${rendererEffect.name}` })).toHaveAttribute("title", `收藏 ${rendererEffect.name}`);
    expect(screen.getByRole("button", { name: "下载动画预览" })).toHaveAttribute("title", "下载动画预览");
    expect(screen.getByRole("button", { name: "下载并添加效果" })).toHaveAttribute("title", "下载并添加效果");
  });
});
