import React from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import * as captionsTabModule from "../CaptionsTab";
import { CaptionsTab } from "../CaptionsTab";
import { TextTab } from "../TextTab";
import { useCaptionStore } from "@/store/captionStore";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";

const mocks = vi.hoisted(() => ({
  loadTemplates: vi.fn(),
  onAddToTimeline: vi.fn(),
}));

vi.mock("@/features/text-templates/templateStore", () => {
  const templates = [
    {
      id: "remote-lower-third_RAW",
      label: "Remote Lower Third / 原始名",
      name: "Remote Lower Third NAME_RAW",
      category: "lower-third",
      description: "Keep description RAW",
      tags: ["tag_RAW"],
      thumbnail: "https://cdn.example/lower_RAW.png",
      preview: "https://cdn.example/lower_RAW.mp4",
      duration: 3,
      canvasWidth: 1920,
      canvasHeight: 1080,
      layers: [],
    },
    {
      id: "remote-title-card_RAW",
      label: "Remote Title Card / 原始名",
      category: "title-card",
      thumbnail: "https://cdn.example/title_RAW.png",
      preview: "https://cdn.example/title_RAW.mp4",
      duration: 3,
      canvasWidth: 1920,
      canvasHeight: 1080,
      layers: [],
    },
  ];
  const useTemplateStore = Object.assign(
    () => ({
      templates,
      loadTemplates: mocks.loadTemplates,
      selectTemplate: vi.fn(),
      isApiConnected: true,
      isLoading: false,
    }),
    { getState: () => ({ templates }) },
  );

  return { useTemplateStore };
});

vi.mock("@/features/text-effects/store/effectsStore", () => ({
  useEffectsStore: () => ({ selectedEffect: null, clearSelected: vi.fn() }),
}));

vi.mock("@/store/favoritesStore", () => ({
  useFavoritesStore: () => ({
    favorites: [],
    downloadedEffects: [],
    downloadedTemplates: [],
    downloadingIds: [],
    toggleFavorite: vi.fn(),
    startDownload: vi.fn(),
    completeDownload: vi.fn(),
    cancelDownload: vi.fn(),
  }),
}));

vi.mock("@/features/text-effects/components/EffectGrid", () => ({
  EffectGrid: () => <div>effect-grid</div>,
}));

vi.mock("@/features/text-effects/components/EffectPreview", () => ({
  EffectPreview: () => <div>effect-preview</div>,
}));

vi.mock("@/components/ui/TemplateCard", () => ({
  TemplateCard: ({ template }: { template: { label: string; name?: string } }) => <div>{template.name || template.label}｜{template.label}</div>,
}));

beforeEach(() => {
  mocks.loadTemplates.mockClear();
  mocks.onAddToTimeline.mockClear();
  useProjectStore.setState({ project: null, mediaAssets: [] });
  useTimelineStore.setState({ tracks: [], clips: [] });
  useCaptionStore.setState((state) => ({
    captionSettings: {
      ...state.captionSettings,
      activeModel: "tiny",
      models: {
        ...state.captionSettings.models,
        tiny: {
          status: "idle",
          progressBytes: 0,
          totalBytes: 0,
          speedBytesPerSec: 0,
        },
      },
    },
  }));
});

describe("TextTab localized category state", () => {
  test("uses stable category IDs while rendering Chinese labels and untouched remote template names", async () => {
    const user = userEvent.setup();
    render(<TextTab onAddToTimeline={mocks.onAddToTimeline} />);

    await user.click(screen.getByRole("button", { name: "模板" }));

    expect(screen.getByRole("button", { name: "下三分之一字幕" })).toBeInTheDocument();
    expect(screen.getByText("Remote Lower Third NAME_RAW｜Remote Lower Third / 原始名")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "标题卡" }));

    expect(screen.getByText("Remote Title Card / 原始名｜Remote Title Card / 原始名")).toBeInTheDocument();
    expect(screen.queryByText("Remote Lower Third NAME_RAW｜Remote Lower Third / 原始名")).not.toBeInTheDocument();
  });

  test("adds the fixed Chinese default text without changing the serialized item type", async () => {
    const user = userEvent.setup();
    render(<TextTab onAddToTimeline={mocks.onAddToTimeline} />);

    await user.click(screen.getByRole("button", { name: "添加文字" }));

    expect(mocks.onAddToTimeline).toHaveBeenCalledWith({ name: "文字" }, "text");
  });
});

describe("CaptionsTab critical localized state", () => {
  test("recognizes legacy English and new Chinese caption track names", () => {
    const isCaptionTrackName = (
      captionsTabModule as typeof captionsTabModule & {
        isCaptionTrackName?: (name: string) => boolean;
      }
    ).isCaptionTrackName;

    expect(["Caption", "subtitle-main", "字幕", "自动字幕", "普通文字"].map((name) => isCaptionTrackName?.(name))).toEqual([true, true, true, true, false]);
  });

  test("model settings action depends on error kind rather than English copy", () => {
    const needsSettings = (
      captionsTabModule as typeof captionsTabModule & {
        captionErrorNeedsSettings?: (error: { kind: string; message: string } | null) => boolean;
      }
    ).captionErrorNeedsSettings;

    expect(needsSettings?.({ kind: "model-required", message: "此中文文案可任意改写" })).toBe(true);
    expect(needsSettings?.({ kind: "generation", message: "not downloaded" })).toBe(false);
  });

  test("renders Chinese controls and preserves the selected model in the missing-model message", async () => {
    const user = userEvent.setup();
    render(<CaptionsTab />);

    expect(screen.getByRole("button", { name: "导入字幕" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出 SRT" })).toBeInTheDocument();
    expect(screen.getByText("生成字幕前需下载“tiny”模型。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "自动生成字幕" }));

    expect(screen.getByText("Whisper 模型“tiny”尚未下载。请先前往“设置”→“字幕”下载该模型。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开设置" })).toBeInTheDocument();
  });
});
