import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { formatExportFailure } from "@/components/ui/ExportDialog";
import { ExportPresetCard } from "@/components/ui/ExportPresetCard";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { t } from "@/i18n";
import { renderViaCloud } from "@/lib/export/cloudExport";
import { PRESET_CONFIGS, PRESET_ORDER } from "@/lib/export/exportPresets";
import { getExportPresets } from "@/lib/export/videoExport";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("export workflow localization", () => {
  test("translates the export workflow and preset display names", () => {
    expect(t("system.export.title")).toBe("导出视频");
    expect(t("system.export.settings.title")).toBe("导出设置");
    expect(t("system.export.ffmpeg.checking")).toBe("正在检查 FFmpeg…");
    expect(t("system.export.progress.exporting")).toBe("正在导出视频…");
    expect(t("system.export.complete.title")).toBe("导出完成！");
    expect(t("system.export.failed.title")).toBe("导出失败");

    expect(t("system.export.preset.720pFast")).toBe("720p 快速");
    expect(t("system.export.preset.1080pFast")).toBe("1080p 快速");
    expect(t("system.export.preset.1080pQuality")).toBe("1080p 高质量");
    expect(t("system.export.preset.4kQuality")).toBe("4K 高质量");
    expect(t("system.export.preset.prores422hq")).toBe("ProRes 422 HQ");
    expect(t("system.export.tier.professional")).toBe("专业级");
  });

  test("interpolates export progress without translating technical values", () => {
    expect(
      t("system.export.mobile.encodingVideoFrame", {
        current: 37,
        total: 240,
      }),
    ).toBe("正在编码视频帧 37/240…");
    expect(t("system.export.complete.frameCount", { count: 240 })).toBe(
      "240 帧",
    );
    expect(t("system.export.progress.percent")).toBe("百分比");
  });

  test("wraps failures while preserving raw project, file, path, URL, and FFmpeg detail", () => {
    const detail =
      "项目 Client H.265 / 文件 final-ProRes.mov /Users/kk/Videos/final-ProRes.mov https://render.example/jobs/42\nFFmpeg stderr: Invalid pixel format yuv422p10le (CRF 18, 60 FPS)";

    expect(t("system.export.failed.detail", { error: detail })).toBe(
      `导出失败：${detail}`,
    );
    expect(t("system.export.cloud.failed", { error: detail })).toBe(
      `云端渲染失败：${detail}`,
    );
    expect(
      t("system.export.videoAcquireFailed", {
        time: "1.25",
        error: detail,
      }),
    ).toBe(`无法获取时间 1.25s 处片段的视频：${detail}。为防止输出损坏，导出已中止。`);
  });

  test("keeps preset IDs and encoder settings stable while resolving display keys in the card", () => {
    expect(PRESET_ORDER).toEqual([
      "720p-fast",
      "1080p-fast",
      "1080p-quality",
      "4k-quality",
      "prores-422hq",
    ]);
    expect(PRESET_ORDER.map((key) => PRESET_CONFIGS[key].labelKey)).toEqual([
      "system.export.preset.720pFast",
      "system.export.preset.1080pFast",
      "system.export.preset.1080pQuality",
      "system.export.preset.4kQuality",
      "system.export.preset.prores422hq",
    ]);

    const config = PRESET_CONFIGS["4k-quality"];
    expect(config).toMatchObject({
      labelKey: "system.export.preset.4kQuality",
      tierLabelKey: "system.export.tier.quality",
      shortLabel: "4K",
      resolution: "3840×2160",
      codec: "H.265",
      codecLabel: "H.265 / HEVC",
      codecValue: "h265",
      preset: "medium",
      crf: 20,
      pixelFormat: "yuv420p",
    });

    render(createElement(ExportPresetCard, {
      presetKey: "4k-quality",
      config,
      selected: false,
      disabled: false,
      onSelect: vi.fn(),
    }));

    expect(screen.getByRole("button", { name: "4K 高质量" })).toBeInTheDocument();
    expect(screen.getByText("H.265 / HEVC")).toBeInTheDocument();
    expect(screen.getByText("高质量")).toBeInTheDocument();
    expect(screen.getByText("3840×2160")).toBeInTheDocument();

    expect(getExportPresets()).toEqual({
      "720p-fast": {
        width: 1280,
        height: 720,
        codec: "h264",
        preset: "fast",
        crf: 23,
        pixelFormat: "yuv420p",
      },
      "1080p-fast": {
        width: 1920,
        height: 1080,
        codec: "h264",
        preset: "fast",
        crf: 23,
        pixelFormat: "yuv420p",
      },
      "1080p-quality": {
        width: 1920,
        height: 1080,
        codec: "h264",
        preset: "slow",
        crf: 18,
        pixelFormat: "yuv420p",
      },
      "4k-quality": {
        width: 3840,
        height: 2160,
        codec: "h265",
        preset: "medium",
        crf: 20,
        pixelFormat: "yuv420p",
      },
      "prores-422hq": {
        width: 1920,
        height: 1080,
        codec: "prores",
        preset: "medium",
        crf: 0,
        pixelFormat: "yuv422p10le",
      },
    });
  });

  test("localizes only the ProgressRing percent label", () => {
    render(createElement(ProgressRing, { progress: 0.47 }));

    expect(screen.getByText("47")).toBeInTheDocument();
    expect(screen.getByText("百分比")).toBeInTheDocument();
  });

  test("preserves string and Error details in a complete Chinese export failure", () => {
    const detail = "FFmpeg failed: /tmp/Client H.264.mov: Invalid CRF 52";

    expect(formatExportFailure(detail)).toBe(`导出失败：${detail}`);
    expect(formatExportFailure(new Error(detail))).toBe(`导出失败：${detail}`);
    expect(formatExportFailure({ message: detail })).toBe(`导出失败：${detail}`);
  });

  test("emits Chinese cloud progress while preserving the download URL", async () => {
    vi.useFakeTimers();
    const output = new Blob(["video"], { type: "video/mp4" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(output),
    });
    vi.stubGlobal("fetch", fetchMock);
    const statuses: string[] = [];

    const result = renderViaCloud(
      { id: "Client Project H.265" } as never,
      { clips: [], tracks: [], transitions: [], mediaAssets: [], duration: 1 },
      ({ status }) => statuses.push(status),
    );
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe(output);
    expect(statuses).toEqual([
      "正在连接云端渲染服务…",
      "正在上传项目描述…",
      "正在上传媒体资源…",
      "云端正在渲染帧（无界面模式）…",
      "正在完成合成…",
      "正在下载渲染后的视频…",
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    );
  });
});
