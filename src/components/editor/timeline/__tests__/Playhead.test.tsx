import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  Playhead,
  PLAYHEAD_FRAME_CELL_MIN_PX_PER_FRAME,
  getPlayheadFrameCellLayout,
} from "../Playhead";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";

const beginScrubMock = vi.fn();
const updateScrubMock = vi.fn();
const endScrubMock = vi.fn();
const seekMock = vi.fn();

vi.mock("@/hooks/usePlaybackClock", () => ({
  usePlaybackClock: () => ({
    time: 2.5,
    duration: 30,
    state: "stopped",
    speed: 1,
    frameRate: 30,
  }),
  useTransportControls: () => ({
    seek: seekMock,
    beginScrub: beginScrubMock,
    updateScrub: updateScrubMock,
    endScrub: endScrubMock,
  }),
  getPlaybackClock: () => ({
    time: 2.5,
    duration: 30,
    state: "stopped",
    speed: 1,
    frameRate: 30,
  }),
}));

vi.mock("@/core/interactions", () => ({
  getPreviewInteractionCoordinator: () => ({
    begin: vi.fn().mockReturnValue("token-123"),
    update: vi.fn(),
    commit: vi.fn(),
    cancel: vi.fn(),
  }),
}));

describe("Playhead Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTimelineStore.setState({ scrollLeft: 0 });
    useProjectStore.setState({
      project: {
        id: "test-proj",
        name: "Test",
        aspectRatio: "16:9",
        canvasWidth: 1920,
        canvasHeight: 1080,
        duration: 30,
        frameRate: 30,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
  });

  it("renders with default canonical rulerHeight of 24px and sticky handle dock", () => {
    const containerRef = {
      current: document.createElement("div"),
    };

    const { container } = render(
      <Playhead
        pixelsPerSecond={100}
        duration={30}
        containerRef={containerRef}
      />,
    );

    const playhead = container.querySelector(
      "[data-playhead='true']",
    ) as HTMLElement;
    expect(playhead).toBeDefined();

    // Check sticky handle dock
    const handleDock = playhead.querySelector(
      "[data-playhead-handle-dock='true']",
    ) as HTMLElement;
    expect(handleDock).toBeDefined();
    expect(handleDock.className).toContain("sticky");
    expect(handleDock.className).toContain("top-0");
    expect(handleDock.style.height).toBe("24px");

    // Check visual line starts at 24px and extends to bottom: 0
    const visualLine = playhead.querySelector(
      "[data-playhead-line='true']",
    ) as HTMLElement;
    expect(visualLine).toBeDefined();
    expect(visualLine.style.top).toBe("24px");
    expect(visualLine.style.bottom).toBe("0px");

    // Check handle circle is vertically centered inside 24px ruler
    const handle = playhead.querySelector(
      "[data-playhead-handle='true']",
    ) as HTMLElement;
    expect(handle).toBeDefined();
    expect(handle.style.top).toBe("6px"); // (24 - 12) / 2 = 6px
  });

  it("respects custom rulerHeight prop", () => {
    const containerRef = {
      current: document.createElement("div"),
    };

    const { container } = render(
      <Playhead
        pixelsPerSecond={100}
        duration={30}
        containerRef={containerRef}
        rulerHeight={32}
      />,
    );

    const playhead = container.querySelector(
      "[data-playhead='true']",
    ) as HTMLElement;

    const handleDock = playhead.querySelector(
      "[data-playhead-handle-dock='true']",
    ) as HTMLElement;
    expect(handleDock.style.height).toBe("32px");

    const visualLine = playhead.querySelector(
      "[data-playhead-line='true']",
    ) as HTMLElement;
    expect(visualLine.style.top).toBe("32px");

    const handle = playhead.querySelector(
      "[data-playhead-handle='true']",
    ) as HTMLElement;
    expect(handle.style.top).toBe("10px"); // (32 - 12) / 2 = 10px
  });

  it("initiates scrub on handle pointer down", () => {
    const mockContainer = document.createElement("div");
    mockContainer.scrollLeft = 0;
    mockContainer.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 1000,
        top: 0,
        bottom: 500,
        width: 1000,
        height: 500,
      }) as DOMRect;

    const containerRef = { current: mockContainer };

    const { container } = render(
      <Playhead
        pixelsPerSecond={100}
        duration={30}
        containerRef={containerRef}
        rulerHeight={24}
      />,
    );

    const handle = container.querySelector(
      "[data-playhead-handle='true']",
    ) as HTMLElement;

    fireEvent.pointerDown(handle, {
      clientX: 250,
      clientY: 10,
      pointerId: 1,
      button: 0,
    });

    expect(beginScrubMock).toHaveBeenCalledTimes(1);
  });

  describe("getPlayheadFrameCellLayout (W6 parity math)", () => {
    it("calculates frame cell bounds accurately from integer frame indices", () => {
      // 30 fps, 6000 pps, time 2.5s (frame 75), startOffset = 20
      const layout = getPlayheadFrameCellLayout(2.5, 6000, 30, 20);
      expect(layout.currentFrame).toBe(75);
      expect(layout.left).toBe(Math.round((75 * 6000) / 30) + 20); // 15020
      expect(layout.width).toBe(200); // 200 px/frame
    });

    it("guards against floating-point boundary rounding error using epsilon", () => {
      // In JS, 0.1 * 30 = 2.9999999999999996.
      // Plain Math.floor(0.1 * 30) incorrectly yields frame 2 instead of 3.
      const layoutAtExactBoundary = getPlayheadFrameCellLayout(0.1, 3000, 30, 20);
      expect(layoutAtExactBoundary.currentFrame).toBe(3);
      expect(layoutAtExactBoundary.left).toBe(Math.round((3 * 3000) / 30) + 20); // 320

      // Time just before boundary (0.099s) yields frame 2
      const layoutJustBefore = getPlayheadFrameCellLayout(0.099, 3000, 30, 20);
      expect(layoutJustBefore.currentFrame).toBe(2);
    });

    it("clamps negative or NaN time safely to frame 0", () => {
      const negative = getPlayheadFrameCellLayout(-1.5, 3000, 30, 20);
      expect(negative.currentFrame).toBe(0);
      expect(negative.left).toBe(20);

      const nanTime = getPlayheadFrameCellLayout(NaN, 3000, 30, 20);
      expect(nanTime.currentFrame).toBe(0);
      expect(nanTime.left).toBe(20);
    });

    it("matches exact integer pixel tick spacing across non-whole ratios", () => {
      // 2449 pps at 30 fps (81.633 px/frame)
      const pps = 2449;
      const fps = 30;
      for (let f = 0; f < 10; f++) {
        const layout = getPlayheadFrameCellLayout(f / fps, pps, fps, 0);
        const expectedLeft = Math.round((f * pps) / fps);
        const expectedRight = Math.round(((f + 1) * pps) / fps);
        expect(layout.left).toBe(expectedLeft);
        expect(layout.width).toBe(expectedRight - expectedLeft);
      }
    });
  });

  describe("Current-frame ruler cell visibility and positioning (W6)", () => {
    it("does not render frame cell when zoom is below 75 px/frame threshold", () => {
      const containerRef = { current: document.createElement("div") };

      // Standard zoom: 100 pps at 30fps (3.33 px/frame)
      const { container: c1 } = render(
        <Playhead pixelsPerSecond={100} duration={30} containerRef={containerRef} />,
      );
      expect(c1.querySelector("[data-playhead-frame-cell='true']")).toBeNull();

      // Intermediate zoom: 1549 pps at 30fps (51.6 px/frame, Screenshot 4)
      const { container: c2 } = render(
        <Playhead pixelsPerSecond={1549} duration={30} containerRef={containerRef} />,
      );
      expect(c2.querySelector("[data-playhead-frame-cell='true']")).toBeNull();
    });

    it("renders frame cell when zoom reaches or exceeds 75 px/frame threshold", () => {
      const containerRef = { current: document.createElement("div") };

      // Screenshot 2: 2449 pps at 30fps = 81.63 px/frame (>= 75 threshold)
      const { container: c1 } = render(
        <Playhead pixelsPerSecond={2449} duration={30} containerRef={containerRef} />,
      );
      const cell1 = c1.querySelector("[data-playhead-frame-cell='true']") as HTMLElement;
      expect(cell1).not.toBeNull();
      expect(cell1.style.height).toBe("24px");
      expect(cell1.className).toContain("pointer-events-none");

      // Screenshot 1: 6000 pps at 30fps = 200 px/frame (max zoom)
      // Clock mock is at 2.5s (frame 75).
      // frameLeft = Math.round(75 * 6000 / 30) + 20 = 15020px
      // frameWidth = 200px
      const { container: c2 } = render(
        <Playhead pixelsPerSecond={6000} duration={30} containerRef={containerRef} />,
      );
      const cell2 = c2.querySelector("[data-playhead-frame-cell='true']") as HTMLElement;
      expect(cell2).not.toBeNull();
      expect(cell2.style.left).toBe("15020px");
      expect(cell2.style.width).toBe("200px");
      expect(cell2.style.height).toBe("24px");
    });
  });
});
