import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { t } from "@/i18n";
import { AudioTab } from "@/components/editor/media-tabs/AudioTab";
import * as audioLibraryApi from "@/features/audio-library/api/audioLibraryApi";

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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([remoteItem]),
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(audioLibraryApi.AudioLibraryApi.getAudioByCategory("lo-fi")).resolves.toEqual([remoteItem]);
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

  test("renders a malformed successful response with the localized error prefix", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(null),
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(React.createElement(AudioTab, {}));

    expect(await screen.findByText("加载音频库失败：Invalid audio library response: expected an array")).toBeInTheDocument();
    expect(screen.queryByText("无网络连接")).not.toBeInTheDocument();
  });
});
