import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PreviewPanel } from "../PreviewPanel";
import { useProjectStore } from "../../../store/projectStore";
import { useTimelineStore } from "../../../store/timelineStore";
import { usePlaybackStore } from "../../../store/playbackStore";

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
    usePlaybackStore.setState({
      isPlaying: false,
      currentTime: 2,
      duration: 20,
      frameRate: 30,
      intervalId: null,
    });
  });

  it("renders timeline layers instead of selected media", () => {
    render(<PreviewPanel />);
    expect(screen.getAllByTestId("preview-layer").length).toBe(2);
  });

  it("shows fallback text when no active timeline layers at current time", () => {
    usePlaybackStore.setState({ currentTime: 15 });
    render(<PreviewPanel />);
    expect(screen.getByText("Preview")).toBeInTheDocument();
  });

  it("uses active media intrinsic ratio for Original when exactly one visual layer is active", () => {
    useTimelineStore.setState({
      tracks: [{ id: "t1", type: "video", name: "V1", muted: false, locked: false, visible: true, height: 68 }],
      clips: [{ id: "c1", trackId: "t1", mediaId: "m1", startTime: 0, duration: 10, trimIn: 0, trimOut: 10, x: 0, y: 0, width: 320, height: 180, opacity: 100, rotation: 0 }],
    });
    render(<PreviewPanel />);

    const viewport = screen.getByTestId("program-preview-viewport");
    expect(parseFloat(viewport.style.width)).toBeCloseTo(450, 1);
    expect(parseFloat(viewport.style.height)).toBeCloseTo(800, 1);
  });

  it("falls back to project ratio for Original when multiple layers are active", () => {
    render(<PreviewPanel />);
    const viewport = screen.getByTestId("program-preview-viewport");
    expect(parseFloat(viewport.style.width)).toBeCloseTo(1200, 1);
    expect(parseFloat(viewport.style.height)).toBeCloseTo(675, 1);
  });
});
