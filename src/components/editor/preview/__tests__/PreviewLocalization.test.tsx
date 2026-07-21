import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const previewMocks = vi.hoisted(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  const project = {
    id: "preview-project",
    name: "Preview Project",
    createdAt: 0,
    updatedAt: 0,
    aspectRatio: "16:9" as const,
    canvasWidth: 1920,
    canvasHeight: 1080,
    frameRate: 30,
    duration: 10,
  };
  const clockState = {
    time: 0,
    duration: 10,
    state: "paused",
    speed: 1,
    frameRate: 30,
  };

  return {
    gpuShouldFail: false,
    uiState: {
      sourceAsset: {
        id: "image-1",
        name: "Remote Poster.png",
        path: "https://cdn.example/Remote%20Poster.png",
        type: "image",
        duration: 3,
        width: 1920,
        height: 1080,
        size: 1024,
      },
      sourceTextPreset: {},
      sourceInPoint: 1,
      sourceOutPoint: 2,
      markSourceIn: vi.fn(),
      markSourceOut: vi.fn(),
      clearSelection: vi.fn(),
    },
    projectState: {
      project,
      mediaAssets: [],
      updateProject: vi.fn(),
      addMediaAsset: vi.fn(),
      showToast: vi.fn(),
    },
    timelineState: {
      tracks: [],
      clips: [],
      transitions: [],
      epoch: 0,
      addClip: vi.fn(),
      addTrack: vi.fn(),
      insertTrackAt: vi.fn(),
      getTimelineEndTime: vi.fn(() => 0),
    },
    settingsState: {
      previewQuality: "medium" as const,
      setPreviewQuality: vi.fn(),
    },
    clockState,
    clock: {
      ...clockState,
      isSeeking: false,
      subscribe: vi.fn(() => () => {}),
      completeSeek: vi.fn(),
      getState: vi.fn(() => "paused"),
      getTime: vi.fn(() => 0),
      play: vi.fn(),
      pause: vi.fn(),
      seek: vi.fn(),
    },
    playbackControls: {
      seek: vi.fn(),
      setSpeed: vi.fn(),
      setDuration: vi.fn(),
      setFrameRate: vi.fn(),
    },
    transportControls: {
      play: vi.fn(),
      pause: vi.fn(),
      setActiveContext: vi.fn(),
    },
  };
});

vi.mock("@/store/uiStore", () => ({
  useUIStore: (selector?: (state: typeof previewMocks.uiState) => unknown) =>
    selector ? selector(previewMocks.uiState) : previewMocks.uiState,
}));

vi.mock("@/store/projectStore", () => {
  const useProjectStore = (selector?: (state: typeof previewMocks.projectState) => unknown) =>
    selector ? selector(previewMocks.projectState) : previewMocks.projectState;
  useProjectStore.getState = () => previewMocks.projectState;
  return { useProjectStore };
});

vi.mock("@/store/timelineStore", () => {
  const useTimelineStore = (selector?: (state: typeof previewMocks.timelineState) => unknown) =>
    selector ? selector(previewMocks.timelineState) : previewMocks.timelineState;
  useTimelineStore.getState = () => previewMocks.timelineState;
  return {
    getInsertIndexForNewTrack: vi.fn(() => 0),
    useTimelineStore,
  };
});

vi.mock("@/store/settingsStore", () => ({
  useSettingsStore: (selector: (state: typeof previewMocks.settingsState) => unknown) =>
    selector(previewMocks.settingsState),
}));

vi.mock("@/hooks/usePreviewMode", () => ({
  usePreviewMode: () => ({ exitSourceMode: vi.fn() }),
}));

vi.mock("@/hooks/usePlaybackClock", () => ({
  getPlaybackClock: () => previewMocks.clock,
  usePlaybackClock: () => previewMocks.clockState,
  usePlaybackControls: () => previewMocks.playbackControls,
  useTransportControls: () => previewMocks.transportControls,
}));

vi.mock("@/core/runtime/ProjectSession", () => ({
  getActiveSessionOrNull: () => null,
  subscribeToSessionChanges: () => () => {},
}));

vi.mock("@/core/platform", () => ({
  platform: {
    convertFileSrc: (value: string) => value,
    appCacheDir: vi.fn(),
    joinPaths: vi.fn(),
  },
}));

vi.mock("@/hooks/useViewportController", () => ({
  useViewportState: () => ({ zoom: 1, panX: 0, panY: 0 }),
}));

vi.mock("../../viewport/ViewportControls", () => ({
  useViewportKeyboardShortcuts: vi.fn(),
  useViewportWheelZoom: vi.fn(),
  useViewportPan: () => ({ isPanning: false, spacePressed: false }),
}));

vi.mock("@/lib/utils/coordinateSystem", () => ({
  calculateDisplayTransform: () => ({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    displayWidth: 640,
    displayHeight: 360,
  }),
}));

vi.mock("@/lib/preview/PreviewQualityManager", () => ({
  PreviewQualityTier: {},
  PreviewQualityManager: class {
    updateViewport() {}
  },
}));

vi.mock("@/core/interactions", () => ({
  getTransformController: () => ({ getState: () => ({}) }),
}));

vi.mock("@/core/render/pixiSceneCompositor", () => ({
  PixiSceneCompositor: class {},
}));

vi.mock("@/core/evaluation/evaluator", () => ({
  evaluateTimelineSceneCached: vi.fn(),
}));

vi.mock("../../transform/TransformOverlay", () => ({
  TransformOverlayMemoized: () => null,
}));

vi.mock("@/features/text-effects/store/effectsStore", () => ({
  useEffectsStore: { getState: () => ({ definitions: {} }) },
}));

vi.mock("@/features/stickers/store/stickersStore", () => ({
  useStickersStore: { getState: () => ({ getCachedSticker: vi.fn() }) },
}));

vi.mock("../VideoSourcePreview", () => ({ VideoSourcePreview: () => null }));
vi.mock("../AudioSourcePreview", () => ({ AudioSourcePreview: () => null }));
vi.mock("../ImageSourcePreview", () => ({ ImageSourcePreview: () => null }));
vi.mock("../TextSourcePreview", () => ({ TextSourcePreview: () => null }));
vi.mock("../StickerSourcePreview", () => ({ StickerSourcePreview: () => null }));
vi.mock("@/lib/text/textClip", () => ({ createTextClip: vi.fn() }));
vi.mock("@/lib/timeline/timelineClip", () => ({ createClipFromAsset: vi.fn() }));

vi.mock("@/lib/cache/gpuTextureCache", () => ({
  GPUTextureCache: class {
    constructor() {
      if (previewMocks.gpuShouldFail) {
        throw new Error("GPU unavailable in test");
      }
    }
    hasTexture() { return true; }
    clear() {}
    renderTexture() {}
    uploadTexture() {}
    dispose() {}
  },
}));

vi.mock("@/lib/cache/globalGPUCache", () => ({
  globalGPUCache: {
    isInitialized: () => false,
    getCache: () => null,
    registerViewport: vi.fn(),
    unregisterViewport: vi.fn(),
  },
}));

vi.mock("@/lib/utils/performanceMetrics", () => ({
  performanceMetrics: {
    trackTextureRender: vi.fn(),
    trackTextureUpload: vi.fn(),
    trackScrubLatency: vi.fn(),
  },
}));

vi.mock("@/lib/utils/id", () => ({ generateId: () => "gpu-preview-test" }));
vi.mock("@/lib/platform/tauri", () => ({ normalizePathForTauriInvoke: (value: string) => value }));

import { AspectSelector } from "../AspectSelector";
import { GPUPreview } from "../GPUPreview";
import { PixiProgramPreview } from "../PixiProgramPreview";
import { PlaybackQualitySelector } from "../PlaybackQualitySelector";
import { PlaybackSpeedSelector } from "../PlaybackSpeedSelector";
import { PreviewTransport } from "../PreviewTransport";
import { SourcePreview } from "../SourcePreview";
import { TelemetryOverlay } from "../TelemetryOverlay";
import { VolumeControl } from "../VolumeControl";
import { WebGLUnavailableError } from "../WebGLUnavailableError";
import { SafeOverlay } from "../../viewport/SafeOverlay";

beforeEach(() => {
  previewMocks.gpuShouldFail = false;
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    value: 450,
  });
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as typeof ResizeObserver;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("preview localization", () => {
  test("renders Chinese source mark controls while preserving shortcut keys", () => {
    render(<SourcePreview />);

    const markIn = screen.getByRole("button", { name: "标记入点 (I)" });
    expect(markIn).toHaveAttribute("title", "标记入点 (I)");
    expect(markIn).toHaveTextContent("入点");
    expect(markIn).not.toHaveTextContent("IN");

    const markOut = screen.getByRole("button", { name: "标记出点 (O)" });
    expect(markOut).toHaveAttribute("title", "标记出点 (O)");
    expect(markOut).toHaveTextContent("出点");
    expect(markOut).not.toHaveTextContent("OUT");
  });

  test("renders the localized Pixi program preview empty state", async () => {
    render(<PixiProgramPreview />);

    const title = await screen.findByText("节目预览 (PixiJS)");
    expect(title).toBeInTheDocument();
    expect(title.nextElementSibling).toHaveTextContent("WebGL 管线");
    expect(screen.getByText("序列无片段")).toBeInTheDocument();
    expect(screen.getByText("1920×1080 • 30 FPS")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "填满预览" })).toHaveAttribute("title", "填满预览");
  });

  test("hides GPU initialization guidance after the cache initializes", async () => {
    const { container } = render(
      <GPUPreview
        videoPath="/tmp/Remote Clip.mp4"
        currentTime={0}
        isPlaying={false}
        width={1920}
        height={1080}
        duration={5}
      />,
    );

    expect(container.querySelector("canvas")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("GPU 预览正在初始化…")).not.toBeInTheDocument();
    });
  });

  test("falls back to HTML5 video when GPU cache initialization fails", async () => {
    previewMocks.gpuShouldFail = true;
    const { container } = render(
      <GPUPreview
        videoPath="/tmp/Remote Clip.mp4"
        currentTime={0}
        isPlaying={false}
        width={1920}
        height={1080}
        duration={5}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector("video")).toBeInTheDocument();
    });
    expect(screen.queryByText("GPU 预览正在初始化…")).not.toBeInTheDocument();
  });

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

    const trigger = screen.getByRole("button", { name: "播放质量：中等质量" });
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

    const trigger = screen.getByRole("button", { name: "预览宽高比：原始" });
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
