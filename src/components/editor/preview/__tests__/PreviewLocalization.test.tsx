import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";

import { AspectSelector } from "../AspectSelector";
import { PlaybackQualitySelector } from "../PlaybackQualitySelector";
import { PlaybackSpeedSelector } from "../PlaybackSpeedSelector";
import { PreviewTransport } from "../PreviewTransport";
import { TelemetryOverlay } from "../TelemetryOverlay";
import { VolumeControl } from "../VolumeControl";
import { WebGLUnavailableError } from "../WebGLUnavailableError";
import { SafeOverlay } from "../../viewport/SafeOverlay";

describe("preview localization", () => {
  test("exposes Chinese transport actions and the disabled timeline reason", () => {
    const onPlayPause = vi.fn();
    const { rerender } = render(
      <PreviewTransport
        currentTime={0}
        duration={5}
        isPlaying={false}
        disabled
        onPlayPause={onPlayPause}
        onSeek={vi.fn()}
        onStepBack={vi.fn()}
        onStepForward={vi.fn()}
        formatTime={(value) => `${value.toFixed(2)}s`}
      />,
    );

    for (const name of ["上一帧", "播放", "下一帧"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "时间线上无片段");
    }

    rerender(
      <PreviewTransport
        currentTime={1}
        duration={5}
        isPlaying
        onPlayPause={onPlayPause}
        onSeek={vi.fn()}
        formatTime={(value) => `${value.toFixed(2)}s`}
      />,
    );
    const pause = screen.getByRole("button", { name: "暂停" });
    expect(pause).toHaveAttribute("title", "暂停");
    fireEvent.click(pause);
    expect(onPlayPause).toHaveBeenCalledOnce();
  });

  test("keeps speed values stable while localizing the selected action", () => {
    const setSpeed = vi.fn();
    const setSpeedMenuOpen = vi.fn();
    render(
      <PlaybackSpeedSelector
        playbackSpeed={1.25}
        speedMenuOpen
        setSpeedMenuOpen={setSpeedMenuOpen}
        setSpeed={setSpeed}
      />,
    );

    const trigger = screen.getByRole("button", { name: "播放速度：1.25x" });
    expect(trigger).toHaveAttribute("title", "播放速度：1.25x");
    expect(screen.getByRole("option", { name: "0.25x" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("option", { name: "1.25x" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("option", { name: "2x" }));
    expect(setSpeed).toHaveBeenCalledWith(2);
    expect(setSpeedMenuOpen).toHaveBeenCalledWith(false);
  });

  test("maps quality IDs to Chinese labels and descriptions", () => {
    const setPreviewQuality = vi.fn();
    render(
      <PlaybackQualitySelector
        previewQuality="medium"
        qualityMenuOpen
        setQualityMenuOpen={vi.fn()}
        setPreviewQuality={setPreviewQuality}
      />,
    );

    const trigger = screen.getByRole("button", { name: "播放质量" });
    expect(trigger).toHaveAttribute("title", "播放质量");
    expect(trigger).toHaveTextContent("中等质量");
    expect(screen.queryByText("medium")).not.toBeInTheDocument();
    expect(screen.getByText("原始视频分辨率")).toBeInTheDocument();
    expect(screen.getByText("流畅播放，不影响导出视频")).toBeInTheDocument();
    expect(screen.getByText("更流畅播放，不影响导出视频")).toBeInTheDocument();
    expect(screen.getByText("最流畅播放，不影响导出视频")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: /高质量/ }));
    expect(setPreviewQuality).toHaveBeenCalledWith("high");
  });

  test("localizes aspect labels without changing preset values", () => {
    const selectAspectPreset = vi.fn();
    render(
      <AspectSelector
        aspectMenuOpen
        setAspectMenuOpen={vi.fn()}
        previewAspectPreset="original"
        selectAspectPreset={selectAspectPreset}
        canvasWidth={1920}
        canvasHeight={1080}
      />,
    );

    const trigger = screen.getByRole("button", { name: "预览宽高比" });
    expect(trigger).toHaveAttribute("title", "预览宽高比");
    expect(trigger).toHaveTextContent("原始");
    expect(screen.getByRole("option", { name: "16:9（YouTube）" })).toHaveAttribute("title", "16:9（YouTube）");
    expect(screen.getByRole("option", { name: "9:16（Reels/Shorts）" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "1:1（Instagram）" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "4:5（Instagram）" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "16:9（YouTube）" }));
    expect(selectAspectPreset).toHaveBeenCalledWith("16:9");
  });

  test("updates localized mute actions and labels the volume range", () => {
    function VolumeHarness() {
      const [muted, setMuted] = useState(false);
      const [volume, setVolume] = useState(80);
      return <VolumeControl isMuted={muted} setIsMuted={setMuted} volume={volume} setVolume={setVolume} />;
    }

    render(<VolumeHarness />);
    const mute = screen.getByRole("button", { name: "将音频静音" });
    expect(mute).toHaveAttribute("title", "静音");
    fireEvent.click(mute);
    expect(screen.getByRole("button", { name: "取消音频静音" })).toHaveAttribute("title", "取消静音");

    const volume = screen.getByRole("slider", { name: "音量" });
    fireEvent.change(volume, { target: { value: "42" } });
    expect(volume).toHaveValue("42");
  });

  test("renders Chinese WebGL, telemetry, and safe-area status copy", () => {
    const { rerender } = render(<WebGLUnavailableError />);
    expect(screen.getByText("WebGL 不可用")).toBeInTheDocument();
    expect(screen.getByText(/Clypra 需要 WebGL/)).toHaveTextContent("请更新显卡驱动，或尝试其他浏览器。");

    rerender(
      <TelemetryOverlay
        showTelemetry
        telemetryStats={{
          avgEvaluationTimeMs: 1.2,
          avgRasterTimeMs: 2.3,
          avgTotalTimeMs: 3.5,
          cacheHitRate: 0.75,
          active: 4,
          droppedFrames: 2,
          driftMagnitude: 0.05,
        }}
      />,
    );
    for (const text of ["渲染遥测", "评估：", "栅格化：", "总计：", "缓存命中率：", "活动数：", "丢帧：", "最大漂移：", "1.20ms", "75%", "50ms"]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }

    rerender(<SafeOverlay visible displayWidth={1000} displayHeight={500} displayOffset={{ x: 0, y: 0 }} />);
    expect(screen.getByText("动作安全区 (90%)")).toBeInTheDocument();
    expect(screen.getByText("标题安全区 (80%)")).toBeInTheDocument();
  });
});
