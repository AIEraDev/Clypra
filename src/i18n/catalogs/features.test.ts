import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { t } from "@/i18n";
import { AudioTab } from "@/components/editor/media-tabs/AudioTab";
import * as audioLibraryApi from "@/features/audio-library/api/audioLibraryApi";
import * as textTemplateTypes from "@/features/text-templates/types";

vi.mock("@/features/audio-library/store/audioLibraryStore", () => ({
  useAudioLibraryStore: () => ({
    getDownloadState: () => null,
    startDownload: vi.fn(),
    isDownloaded: () => false,
  }),
}));

vi.mock("@/lib/api", () => ({
  getApiBaseUrl: () => "https://api.example.test",
  getApiHeaders: () => ({}),
}));

const translate = t as (key: string, params?: Record<string, string | number>) => string;

const remoteItem: audioLibraryApi.AudioLibraryItem = {
  id: "remote-track_01",
  name: "夜雨 / Night Rain RAW",
  category: "lo-fi",
  description: "Keep THIS description 原样",
  tags: ["Lo-Fi", "雨声_RAW"],
  author: "DJ 原作者",
  duration: 73,
  license: {
    type: "cc-by",
    url: "https://license.example/raw?lang=en",
    attributionRequired: true,
  },
  source: {
    provider: "RemoteProvider_RAW",
    url: "https://source.example/audio/remote-track_01",
  },
  audioUrl: "https://cdn.example/夜雨 RAW.wav",
  waveformUrl: "https://cdn.example/waveform_RAW.json",
  coverArtUrl: "https://cdn.example/cover_RAW.jpg",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("media and audio localization", () => {
  test("translates complete media and audio messages while preserving dynamic values", () => {
    expect([
      translate("features.media.importing"),
      translate("features.media.importMedia"),
      translate("features.media.emptyTitle"),
      translate("features.media.emptyDescription"),
      translate("features.media.removeFromTimeline"),
      translate("features.media.addToTrack"),
      translate("features.media.added"),
      translate("features.audio.loading"),
      translate("features.audio.emptyTitle"),
      translate("features.audio.emptyDescription"),
      translate("download.cached"),
      translate("features.audio.addToTimeline"),
      translate("features.audio.downloadAndAdd"),
    ]).toEqual([
      "正在导入…",
      "导入媒体",
      "尚未导入媒体",
      "导入视频、音频或图片即可开始",
      "从时间线移除",
      "添加到轨道",
      "已添加",
      "正在加载音频库…",
      "暂无已审核音频",
      "Clypra Studio 发布的音频将在 API 缓存刷新后显示于此。",
      "已缓存",
      "添加到时间线",
      "下载并添加",
    ]);

    expect(translate("features.media.importFailed", { file: "RAW_镜头 01.MOV" })).toBe("导入 RAW_镜头 01.MOV 失败");
    expect(translate("features.audio.loadFailed", { error: "HTTP 503: upstream/RAW_ERR" })).toBe("加载音频库失败：HTTP 503: upstream/RAW_ERR");
    expect(translate("editor.fallback.libraryAudio")).toBe("素材库音频");
  });

  test("maps stable audio category IDs to localized display messages", () => {
    const categoryLabelKeys = (
      audioLibraryApi as typeof audioLibraryApi & {
        AUDIO_LIBRARY_CATEGORY_LABEL_KEYS?: Record<string, string>;
      }
    ).AUDIO_LIBRARY_CATEGORY_LABEL_KEYS;

    expect(audioLibraryApi.AUDIO_LIBRARY_CATEGORIES).toEqual(["music", "cinematic", "upbeat", "lo-fi", "hip-hop", "ambient", "sfx"]);
    expect(categoryLabelKeys).toEqual({
      music: "features.audio.category.music",
      cinematic: "features.audio.category.cinematic",
      upbeat: "features.audio.category.upbeat",
      "lo-fi": "features.audio.category.loFi",
      "hip-hop": "features.audio.category.hipHop",
      ambient: "features.audio.category.ambient",
      sfx: "features.audio.category.sfx",
    });
    expect(audioLibraryApi.AUDIO_LIBRARY_CATEGORIES.map((id) => translate(categoryLabelKeys![id]))).toEqual(["音乐", "电影感", "欢快", "低保真", "嘻哈", "氛围", "音效"]);
  });

  test("returns remote audio metadata without translating any API field", async () => {
    const response = [remoteItem];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(response),
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(audioLibraryApi.AudioLibraryApi.getAudioByCategory("lo-fi")).resolves.toBe(response);
  });

  test("marks a real fetch rejection as the dedicated network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("socket RAW_E42")));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(audioLibraryApi.AudioLibraryApi.getAudioByCategory("music")).rejects.toMatchObject({
      name: "AudioLibraryNetworkError",
      message: "socket RAW_E42",
    });
  });

  test.each([null, {}])("rejects a malformed successful response without treating it as network data: %j", async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(body),
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(audioLibraryApi.AudioLibraryApi.getAudioByCategory("music")).rejects.toThrow("Invalid audio library response: expected an array");
  });

  test.each([
    ["null item", null],
    ["empty object", {}],
    ["required scalar", { ...remoteItem, id: 42 }],
    ["nested license", { ...remoteItem, license: { ...remoteItem.license, attributionRequired: "yes" } }],
    ["nested source", { ...remoteItem, source: { ...remoteItem.source, url: 42 } }],
    ["optional string array", { ...remoteItem, tags: ["Lo-Fi", 42] }],
    ["optional scalar", { ...remoteItem, coverArtUrl: 42 }],
  ])("rejects malformed AudioLibraryItem contract at its array index: %s", async (_case, malformedItem) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([remoteItem, malformedItem]),
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(audioLibraryApi.AudioLibraryApi.getAudioByCategory("music")).rejects.toThrow("Invalid audio library response: item 1 violates AudioLibraryItem contract");
  });

  test("returns a valid single audio asset without changing it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(remoteItem),
      }),
    );

    await expect(audioLibraryApi.AudioLibraryApi.getAudioAsset("lo-fi", remoteItem.id)).resolves.toBe(remoteItem);
  });

  test.each([null, {}, { ...remoteItem, source: null }])("rejects a malformed single AudioLibraryItem contract: %j", async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(body),
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(audioLibraryApi.AudioLibraryApi.getAudioAsset("lo-fi", "remote-track_01")).rejects.toThrow("Invalid audio library response: asset violates AudioLibraryItem contract");
  });

  test("renders localized AudioTab loading and empty states", async () => {
    let resolveRequest!: (items: audioLibraryApi.AudioLibraryItem[]) => void;
    vi.spyOn(audioLibraryApi.AudioLibraryApi, "getAudioByCategory").mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    render(React.createElement(AudioTab, {}));

    expect(screen.getByText("正在加载音频库…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "音乐" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "低保真" })).toBeInTheDocument();

    resolveRequest([]);
    expect(await screen.findByText("暂无已审核音频")).toBeInTheDocument();
    expect(screen.getByText("Clypra Studio 发布的音频将在 API 缓存刷新后显示于此。")).toBeInTheDocument();
  });

  test("uses the network message only for fetch rejection and preserves other TypeError details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("socket RAW_E42")));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { unmount } = render(React.createElement(AudioTab, {}));

    expect(await screen.findByText("无网络连接")).toBeInTheDocument();

    unmount();
    vi.spyOn(audioLibraryApi.AudioLibraryApi, "getAudioByCategory").mockRejectedValueOnce(new TypeError("opaque E42"));
    render(React.createElement(AudioTab, {}));

    await waitFor(() => expect(screen.getByText("加载音频库失败：opaque E42")).toBeInTheDocument());
    expect(screen.queryByText("无网络连接")).not.toBeInTheDocument();
  });

  test("renders a malformed item with the localized error prefix and raw contract detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([null]),
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(React.createElement(AudioTab, {}));

    expect(await screen.findByText("加载音频库失败：Invalid audio library response: item 0 violates AudioLibraryItem contract")).toBeInTheDocument();
    expect(screen.queryByText("无网络连接")).not.toBeInTheDocument();
  });
});

describe("text and caption localization", () => {
  test("keeps template category IDs stable while resolving separate Chinese labels", () => {
    const categoryLabelKeys = (
      textTemplateTypes as typeof textTemplateTypes & {
        TEMPLATE_CATEGORY_LABEL_KEYS?: Record<string, string>;
      }
    ).TEMPLATE_CATEGORY_LABEL_KEYS;

    expect(textTemplateTypes.TEMPLATE_CATEGORIES).toEqual([
      "lower-third",
      "title-card",
      "caption",
      "callout",
      "social",
      "countdown",
    ]);
    expect(categoryLabelKeys).toEqual({
      "lower-third": "features.text.category.lowerThird",
      "title-card": "features.text.category.titleCard",
      caption: "features.text.category.caption",
      callout: "features.text.category.callout",
      social: "features.text.category.social",
      countdown: "features.text.category.countdown",
    });
    expect(textTemplateTypes.TEMPLATE_CATEGORIES.map((id) => translate(categoryLabelKeys![id]))).toEqual([
      "下三分之一字幕",
      "标题卡",
      "字幕",
      "标注",
      "社交",
      "倒计时",
    ]);
  });

  test("translates complete dynamic caption messages without changing model or error details", () => {
    const model = "large-v3_REMOTE";
    const error = "ENOENT /models/Whisper_RAW.bin?source=https://cdn.example/raw";

    expect(translate("features.text.favorites", { count: 7 })).toBe("收藏（7）");
    expect(translate("features.text.favoriteTemplates", { count: 3 })).toBe("收藏的模板（3）");
    expect(translate("features.text.auto.successDescription", { count: 26 })).toBe("已生成 26 个带样式的字幕片段，并与当前时间线精准对齐。");
    expect(translate("features.text.auto.localFailure", { error })).toBe(`本地转录失败：${error}。将改用上下文模拟模式…`);
    expect(translate("features.captions.modelNotDownloaded", { model })).toBe(`Whisper 模型“${model}”尚未下载。请先前往“设置”→“字幕”下载该模型。`);
    expect(translate("features.captions.modelFilesMissing", { model })).toBe(`未在磁盘上找到模型“${model}”的文件。模型可能已被删除或损坏，请前往“设置”→“字幕”重新下载。`);
    expect(translate("features.captions.modelVerificationFailed", { error })).toBe(`验证模型文件失败：${error}。请检查“设置”→“字幕”。`);
    expect(translate("features.captions.transcriptionError", { error })).toBe(`转录错误：${error}`);
    expect(translate("features.captions.processingError", { error })).toBe(`生成字幕时出错：${error}`);
    expect(translate("features.captions.modelNeeded", { model })).toBe(`生成字幕前需下载“${model}”模型。`);
  });

  test("translates template and effect card controls while preserving remote names", () => {
    const name = "REMOTE 名称 / RAW_01";

    expect([
      translate("features.templates.downloading"),
      translate("features.templates.addToTimeline"),
      translate("features.templates.download"),
      translate("features.effects.downloading"),
      translate("features.effects.addTextToTimeline"),
      translate("features.effects.addEffectToTimeline"),
      translate("features.effects.downloadAndAddText"),
      translate("features.effects.downloadAndAddEffect"),
    ]).toEqual([
      "正在下载…",
      "添加模板到时间线",
      "下载模板",
      "正在下载…",
      "添加文字到时间线",
      "添加文字效果到时间线",
      "下载并添加文字到时间线",
      "下载并添加文字效果到时间线",
    ]);
    expect(translate("features.templates.favorite", { name })).toBe(`收藏 ${name}`);
    expect(translate("features.templates.unfavorite", { name })).toBe(`取消收藏 ${name}`);
    expect(translate("features.effects.favorite", { name })).toBe(`收藏 ${name}`);
    expect(translate("features.effects.unfavorite", { name })).toBe(`取消收藏 ${name}`);
  });
});

describe("sticker, filter, and transition localization", () => {
  test("resolves stable category IDs to Simplified Chinese labels", () => {
    expect([
      "emoji", "text", "gaming", "sports", "animals", "love", "mood", "food", "travel", "birthday", "frames", "shapes", "fashion", "retro", "illustration",
    ].map((id) => translate(`features.stickers.category.${id}`))).toEqual([
      "表情", "文字", "游戏", "体育", "动物", "爱心", "情绪", "美食", "旅行", "生日", "边框", "形状", "时尚", "复古", "插画",
    ]);
    expect([
      "essentials", "portrait", "landscape", "cinematic", "movies", "vintage", "vibrant", "mono", "aesthetic", "life",
    ].map((id) => translate(`features.filters.category.${id}`))).toEqual([
      "基础", "人像", "风景", "电影感", "电影", "复古", "鲜艳", "黑白", "美学", "生活",
    ]);
    expect([
      "geometric", "opticalDistortion", "temporal", "particleDissolve", "lightBased", "depthBased", "physicsSimulated",
    ].map((id) => translate(`features.transitions.category.${id}`))).toEqual([
      "几何", "光学畸变", "时间", "粒子溶解", "光效", "景深", "物理模拟",
    ]);
  });

  test("preserves remote names inside complete localized messages", () => {
    const name = "REMOTE 名称 / RAW_01";
    expect(translate("features.stickers.preview", { name })).toBe(`${name} 预览`);
    expect(translate("features.filters.preview", { name })).toBe(`${name} 预览`);
    expect(translate("features.filters.added", { name })).toBe(`已添加 ${name} 滤镜`);
    expect(translate("features.transitions.added", { name })).toBe(`已添加 ${name} 转场`);
  });
});

describe("video effect browser localization", () => {
  test("translates tabs, stable category labels, browser states, and controls", () => {
    expect([
      translate("features.videoEffects.tab.video"),
      translate("features.videoEffects.tab.body"),
      ...["essentials", "glitch", "retro", "light", "motion", "color"].map((id) =>
        translate(`features.videoEffects.video.category.${id}`),
      ),
      ...["trending", "motion", "aura", "wings", "energy", "fun"].map((id) =>
        translate(`features.videoEffects.body.category.${id}`),
      ),
      translate("features.videoEffects.body.searchPlaceholder"),
      translate("features.videoEffects.body.loadFailed"),
      translate("features.videoEffects.loading"),
      translate("features.videoEffects.emptyTitle"),
      translate("features.videoEffects.emptyDescription"),
      translate("features.videoEffects.downloading"),
      translate("features.videoEffects.downloadPreview"),
      translate("features.videoEffects.addToTimeline"),
      translate("features.videoEffects.downloadAndAdd"),
    ]).toEqual([
      "视频",
      "身体",
      "基础",
      "故障",
      "复古",
      "光效",
      "动态",
      "色彩",
      "热门",
      "动态",
      "光环",
      "翅膀",
      "能量",
      "趣味",
      "搜索身体效果…",
      "加载身体效果失败",
      "正在加载效果…",
      "未找到效果",
      "请尝试其他搜索词或分类",
      "正在下载…",
      "下载动画预览",
      "添加效果到时间线",
      "下载并添加效果",
    ]);
  });

  test("preserves remote names in favorite control labels", () => {
    const name = "REMOTE Effect / 原始名_RAW";

    expect(translate("features.videoEffects.favorite", { name })).toBe(`收藏 ${name}`);
    expect(translate("features.videoEffects.unfavorite", { name })).toBe(`取消收藏 ${name}`);
  });
});
