import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { PreviewPanel } from "../PreviewPanel";
import { PreviewMonitorWorkspace } from "../PreviewMonitorWorkspace";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { useSettingsStore } from "@/store/settingsStore";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
}));

class MockResizeObserver {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe() {}
  disconnect() {}
  trigger() {
    this.cb([], this as unknown as ResizeObserver);
  }
}

// @ts-expect-error test global mock
global.ResizeObserver = class extends MockResizeObserver {
  observe() {
    this.trigger();
  }
};

describe("PreviewPanel timeline rendering", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 1200 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 800 });

    // Mock canvas for tests
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      setTransform: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      measureText: vi.fn(() => ({ width: 100 })),
      clearRect: vi.fn(),
      font: "",
      textAlign: "left",
      textBaseline: "alphabetic",
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
    })) as any;

    useProjectStore.setState({
      project: {
        id: "p1",
        name: "p",
        createdAt: 0,
        updatedAt: 0,
        aspectRatio: "16:9",
        canvasWidth: 1920,
        canvasHeight: 1080,
        frameRate: 30,
        duration: 20,
      },
      mediaAssets: [
        { id: "m1", name: "v1", path: "/v1.mp4", type: "video", duration: 20, width: 1080, height: 1920, posterFrame: "/v1.jpg", size: 1 },
        { id: "m2", name: "i1", path: "/i1.png", type: "image", duration: 0, width: 2000, height: 1000, posterFrame: "/i1.png", size: 1 },
      ],
      recentProjects: [],
    });
    useTimelineStore.setState({
      tracks: [
        { id: "t1", type: "video", name: "V1", muted: false, locked: false, visible: true, height: 68 },
        { id: "t2", type: "video", name: "V2", muted: false, locked: false, visible: true, height: 68 },
      ],
      clips: [
        { id: "c1", trackId: "t1", mediaId: "m1", startTime: 0, duration: 10, trimIn: 0, trimOut: 10, x: 0, y: 0, width: 320, height: 180, opacity: 100, rotation: 0 },
        { id: "c2", trackId: "t2", mediaId: "m2", startTime: 0, duration: 10, trimIn: 0, trimOut: 10, x: 20, y: 20, width: 200, height: 100, opacity: 80, rotation: 0 },
      ],
      zoomLevel: 1,
      scrollLeft: 0,
      pixelsPerSecond: 100,
    });
    useUIStore.setState({ previewMode: "program", sourceAsset: null, sourceTextPreset: null });

    // Mock playback clock
    const clock = getPlaybackClock();
    clock.seek(2);
  });

  it("renders timeline layers using canvas", () => {
    render(<PreviewPanel />);
    // Canvas-based rendering - check for canvas element instead of DOM layers
    expect(screen.getByTestId("program-preview-canvas")).toBeInTheDocument();
  });

  it("shows canvas when no active timeline layers at current time", () => {
    const clock = getPlaybackClock();
    clock.seek(15);

    render(<PreviewPanel />);
    // Canvas is still rendered, just empty
    expect(screen.getByTestId("program-preview-canvas")).toBeInTheDocument();
  });

  it("uses active media intrinsic ratio for Original when exactly one visual layer is active", () => {
    useTimelineStore.setState({
      tracks: [{ id: "t1", type: "video", name: "V1", muted: false, locked: false, visible: true, height: 68 }],
      clips: [{ id: "c1", trackId: "t1", mediaId: "m1", startTime: 0, duration: 10, trimIn: 0, trimOut: 10, x: 0, y: 0, width: 320, height: 180, opacity: 100, rotation: 0 }],
    });
    render(<PreviewPanel />);

    const viewport = screen.getByTestId("program-preview-viewport");
    // Viewport should be sized based on available space and aspect ratio
    expect(parseFloat(viewport.style.width)).toBeGreaterThan(0);
    expect(parseFloat(viewport.style.height)).toBeGreaterThan(0);
  });

  it("falls back to project ratio for Original when multiple layers are active", () => {
    render(<PreviewPanel />);
    const viewport = screen.getByTestId("program-preview-viewport");
    // Viewport should be sized based on project aspect ratio
    expect(parseFloat(viewport.style.width)).toBeGreaterThan(0);
    expect(parseFloat(viewport.style.height)).toBeGreaterThan(0);
  });

  it("keeps a forced Program monitor in dual-player layout when Source mode is selected", () => {
    useUIStore.setState({ previewMode: "source" });

    render(<PreviewPanel mode="program" />);

    expect(screen.getByTestId("program-preview-canvas")).toBeInTheDocument();
  });

  it("keeps Source and Program in separate monitor spaces when source media is active in dual-player layout", () => {
    useSettingsStore.setState({ layoutPreset: "dual-player" });
    useUIStore.setState({
      previewMode: "source",
      sourceAsset: {
        id: "source-1",
        name: "Source",
        type: "video",
        path: "/source.mp4",
        duration: 10,
        size: 1,
      },
    });

    render(<PreviewMonitorWorkspace orientation="row" />);

    expect(screen.getByTestId("program-preview-canvas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
    expect(document.querySelector('[data-preview-monitor="source"]')).toBeInTheDocument();
    expect(document.querySelector('[data-preview-monitor="program"]')).toBeInTheDocument();
  });

  it("renders a single preview monitor at a time when source media is active in non-dual layout", () => {
    useSettingsStore.setState({ layoutPreset: "default" });
    useUIStore.setState({
      previewMode: "source",
      sourceAsset: {
        id: "source-1",
        name: "Source",
        type: "video",
        path: "/source.mp4",
        duration: 10,
        size: 1,
      },
    });

    render(<PreviewMonitorWorkspace orientation="row" />);

    // Should NOT render dual-monitor split
    expect(document.querySelector('[data-preview-workspace="source-program"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-preview-monitor="program"]')).not.toBeInTheDocument();
    // Should render single source preview
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("hides program preview and renders audio source preview when previewing audio", () => {
    useUIStore.setState({
      previewMode: "source",
      sourceAsset: {
        id: "audio-item-1",
        name: "Cinematic Ambient",
        type: "audio",
        path: "/music/track.mp3",
        duration: 45,
        size: 2048,
      },
    });

    render(<PreviewPanel />);

    // Program preview canvas must be completely absent from the DOM
    expect(screen.queryByTestId("program-preview-canvas")).not.toBeInTheDocument();
    expect(document.querySelector('[data-preview-space="source"]')).toBeInTheDocument();
    expect(screen.getByText(/previewing/i)).toBeInTheDocument();
    expect(screen.getByText(/— audio/i)).toBeInTheDocument();
    expect(document.querySelector("audio")).toHaveAttribute("src", "/music/track.mp3");
  });

  it("calls previewAsset for audio and ensures program preview is replaced by audio preview", () => {
    useUIStore.setState({ previewMode: "program", sourceAsset: null });
    const { rerender } = render(<PreviewPanel />);
    expect(screen.getByTestId("program-preview-canvas")).toBeInTheDocument();

    // Trigger audio preview
    act(() => {
      useUIStore.getState().previewAsset({
        id: "audio-preview-2",
        name: "Sondre Track",
        type: "audio",
        path: "/audio/sondre.wav",
        duration: 78,
        size: 5000,
      });
    });

    rerender(<PreviewPanel />);
    // Program preview canvas must be completely absent from the DOM
    expect(screen.queryByTestId("program-preview-canvas")).not.toBeInTheDocument();
    expect(document.querySelector('[data-preview-space="source"]')).toBeInTheDocument();
    expect(screen.getByText(/previewing/i)).toBeInTheDocument();
    expect(screen.getByText(/— audio/i)).toBeInTheDocument();
    expect(document.querySelector("audio")).toHaveAttribute("src", "/audio/sondre.wav");
  });
});
