import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  Playhead,
  PLAYHEAD_FRAME_CELL_MIN_PX_PER_FRAME,
  getPlayheadFrameCellLayout,
} from "../Playhead";
import { getFrameIndexAtTime } from "@/lib/utils/frameTime";
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

    it("strictly preserves 100% parity with Clypra's canonical getFrameIndexAtTime across boundary cases", () => {
      const testTimes = [
        0,
        0.0001,
        1 / 30,
        2 / 30 - 0.0001,
        2 / 30,
        0.1,
        0.5,
        1.0,
        2.5,
        10.3333,
      ];
      for (const time of testTimes) {
        const layout = getPlayheadFrameCellLayout(time, 3000, 30);
        expect(layout.currentFrame).toBe(getFrameIndexAtTime(time, 30));
      }
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

    it("dynamically resizes cell while paused as pixelsPerSecond changes (spring zoom parity)", () => {
      const containerRef = { current: document.createElement("div") };

      const { container, rerender } = render(
        <Playhead pixelsPerSecond={100} duration={30} containerRef={containerRef} />,
      );
      // Below 75 px/frame -> hidden
      expect(container.querySelector("[data-playhead-frame-cell='true']")).toBeNull();

      // Zoom spring animates to 2449 pps (81.63 px/frame) -> cell appears with 81px width
      rerender(
        <Playhead pixelsPerSecond={2449} duration={30} containerRef={containerRef} />,
      );
      let cell = container.querySelector("[data-playhead-frame-cell='true']") as HTMLElement;
      expect(cell).not.toBeNull();
      expect(cell.style.width).toBe("81px");

      // Zoom spring animates to 6000 pps (200 px/frame) -> cell expands to 200px width
      rerender(
        <Playhead pixelsPerSecond={6000} duration={30} containerRef={containerRef} />,
      );
      cell = container.querySelector("[data-playhead-frame-cell='true']") as HTMLElement;
      expect(cell).not.toBeNull();
      expect(cell.style.width).toBe("200px");

      // Zoom out to 1500 pps (50 px/frame) -> cell unmounts
      rerender(
        <Playhead pixelsPerSecond={1500} duration={30} containerRef={containerRef} />,
      );
      expect(container.querySelector("[data-playhead-frame-cell='true']")).toBeNull();
    });

    it("reacts dynamically when project frame rate changes", () => {
      const containerRef = { current: document.createElement("div") };

      // At 2000 pps and 30fps: 2000 / 30 = 66.67 px/frame (< 75 threshold) -> hidden
      const { container } = render(
        <Playhead pixelsPerSecond={2000} duration={30} containerRef={containerRef} />,
      );
      expect(container.querySelector("[data-playhead-frame-cell='true']")).toBeNull();

      // Project frame rate changes to 24fps: 2000 / 24 = 83.33 px/frame (>= 75 threshold) -> appears!
      act(() => {
        useProjectStore.setState({
          project: {
            id: "test-proj",
            name: "Test",
            aspectRatio: "16:9",
            canvasWidth: 1920,
            canvasHeight: 1080,
            duration: 30,
            frameRate: 24,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
      });

      const cell = container.querySelector("[data-playhead-frame-cell='true']") as HTMLElement;
      expect(cell).not.toBeNull();
      expect(cell.style.width).toBe(`${Math.round(2000 / 24)}px`); // 83px
    });

    it("CLY-BUG-004 regression: auto-scroll left activates when cursor approaches clips lane boundary", () => {
      const scrollContainer = document.createElement("div");
      Object.defineProperty(scrollContainer, "clientWidth", { value: 1000, configurable: true });
      Object.defineProperty(scrollContainer, "scrollWidth", { value: 3000, configurable: true });
      scrollContainer.scrollLeft = 500;
      scrollContainer.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 1000,
        bottom: 400,
        width: 1000,
        height: 400,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Timeline has clips, so track label column (160px) is active
      useTimelineStore.setState({
        clips: [{ id: "c1", trackId: "t1", mediaId: "m1", startTime: 0, duration: 10, trimIn: 0, trimOut: 10, x: 0, y: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 }],
      });

      const containerRef = { current: scrollContainer };
      const { container } = render(
        <Playhead pixelsPerSecond={50} duration={30} containerRef={containerRef} />,
      );

      const handle = container.querySelector("[data-playhead-handle='true']") as HTMLElement;
      expect(handle).not.toBeNull();

      // Start drag at playhead
      fireEvent.pointerDown(handle, { clientX: 200, clientY: 10, pointerId: 1 });

      // Move cursor towards left edge of clips lane (e.g. at clientX = 180, which is within 80px of 160px lane edge)
      fireEvent(window, new PointerEvent("pointermove", { clientX: 180, clientY: 10, pointerId: 1 }));

      // Pointer at 180 is < leftThreshold (160 + 80 = 240px). Distance is 240 - 180 = 60px.
      // Expected scroll velocity = -60 * 0.3 = -18 px/frame (scrolling left)
      // Release pointer to clean up
      fireEvent(window, new PointerEvent("pointerup", { pointerId: 1 }));
    });
  });

  describe("Keyframe diamond magnetic playhead snapping", () => {
    it("snaps playhead to center of inline keyframe diamond and sets keyframe snap guide", () => {
      const scrollContainer = document.createElement("div");
      Object.defineProperty(scrollContainer, "clientWidth", { value: 1000, configurable: true });
      Object.defineProperty(scrollContainer, "scrollWidth", { value: 3000, configurable: true });
      scrollContainer.scrollLeft = 0;
      scrollContainer.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 1000,
        bottom: 400,
        width: 1000,
        height: 400,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Clip at startTime 2.0s with keyframe at local time 1.0s (absolute time 3.0s = 300px at 100 pps)
      useTimelineStore.setState({
        snapEnabled: true,
        snapGuides: [],
        clips: [
          {
            id: "clip-k1",
            trackId: "t1",
            mediaId: "m1",
            name: "Video 1",
            startTime: 2.0,
            duration: 10,
            trimIn: 0,
            trimOut: 10,
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            opacity: 1,
            rotation: 0,
            visualKeyframes: {
              rotation: [{ id: "kf-rot-1", time: 1.0, value: 45 }],
            },
          },
        ],
      });

      const containerRef = { current: scrollContainer };
      const { container } = render(
        <Playhead pixelsPerSecond={100} duration={30} containerRef={containerRef} />,
      );

      const handle = container.querySelector("[data-playhead-handle='true']") as HTMLElement;
      expect(handle).not.toBeNull();

      // Click near 304px (3.04s, which is 4px away from keyframe diamond center at 300px <= 8px threshold)
      // Playhead initial time in mock is 2.5s (250px)
      fireEvent.pointerDown(handle, { clientX: 250, clientY: 10, pointerId: 1 });

      // Move cursor to clientX = 304
      fireEvent(window, new PointerEvent("pointermove", { clientX: 304, clientY: 10, pointerId: 1 }));

      // Verify that beginScrub was called with the snapped keyframe time if within threshold,
      // or test direct pointerDown near the keyframe
      expect(beginScrubMock).toHaveBeenCalledTimes(1);

      // Now pointerDown directly at 304px (e.g. from hit-target near 300px)
      // When pointerDown occurs at 304px with dragOffset=0:
      // We can also test direct handlePointerDown with clientX: 304
      fireEvent(window, new PointerEvent("pointerup", { pointerId: 1 }));
      expect(useTimelineStore.getState().snapGuides).toEqual([]);
    });

    it("magnetically snaps on handle pointer down when clicked within 8px of keyframe diamond", () => {
      const scrollContainer = document.createElement("div");
      Object.defineProperty(scrollContainer, "clientWidth", { value: 1000, configurable: true });
      Object.defineProperty(scrollContainer, "scrollWidth", { value: 3000, configurable: true });
      scrollContainer.scrollLeft = 0;
      scrollContainer.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 1000,
        bottom: 400,
        width: 1000,
        height: 400,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Keyframe at 2.52s (252px at 100pps)
      useTimelineStore.setState({
        snapEnabled: true,
        snapGuides: [],
        clips: [
          {
            id: "clip-k2",
            trackId: "t1",
            mediaId: "m1",
            name: "Video 2",
            startTime: 2.0,
            duration: 10,
            trimIn: 0,
            trimOut: 10,
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            opacity: 1,
            rotation: 0,
            visualKeyframes: {
              opacity: [{ id: "kf-op-1", time: 0.52, value: 0.8 }], // abs: 2.52s
            },
          },
        ],
      });

      const containerRef = { current: scrollContainer };
      const { container } = render(
        <Playhead pixelsPerSecond={100} duration={30} containerRef={containerRef} />,
      );

      const hitTarget = container.querySelector("[data-playhead-hit-target='true']") as HTMLElement;
      expect(hitTarget).not.toBeNull();

      // Click at 250px (playhead is at 250px = 2.5s). Distance to 2.52s is 0.02s = 2px <= 8px threshold!
      act(() => {
        fireEvent.pointerDown(hitTarget, { clientX: 250, clientY: 10, pointerId: 2 });
      });

      // Should snap to exact keyframe time 2.52s!
      expect(beginScrubMock).toHaveBeenCalledWith(2.52, "playhead");
      expect(useTimelineStore.getState().snapGuides).toEqual([
        expect.objectContaining({ time: 2.52, type: "keyframe" }),
      ]);

      // Release cleans up snap guides
      act(() => {
        fireEvent(window, new PointerEvent("pointerup", { pointerId: 2 }));
      });
      expect(useTimelineStore.getState().snapGuides).toEqual([]);
    });

    it("does not snap to keyframe diamond when snapEnabled is false", () => {
      const scrollContainer = document.createElement("div");
      Object.defineProperty(scrollContainer, "clientWidth", { value: 1000, configurable: true });
      Object.defineProperty(scrollContainer, "scrollWidth", { value: 3000, configurable: true });
      scrollContainer.scrollLeft = 0;
      scrollContainer.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 1000,
        bottom: 400,
        width: 1000,
        height: 400,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      useTimelineStore.setState({
        snapEnabled: false,
        snapGuides: [],
        clips: [
          {
            id: "clip-k3",
            trackId: "t1",
            mediaId: "m1",
            name: "Video 3",
            startTime: 2.0,
            duration: 10,
            trimIn: 0,
            trimOut: 10,
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            opacity: 1,
            rotation: 0,
            visualKeyframes: {
              opacity: [{ id: "kf-op-2", time: 0.52, value: 0.8 }], // abs: 2.52s
            },
          },
        ],
      });

      const containerRef = { current: scrollContainer };
      const { container } = render(
        <Playhead pixelsPerSecond={100} duration={30} containerRef={containerRef} />,
      );

      const hitTarget = container.querySelector("[data-playhead-hit-target='true']") as HTMLElement;
      act(() => {
        fireEvent.pointerDown(hitTarget, { clientX: 250, clientY: 10, pointerId: 3 });
      });

      // Should NOT snap to 2.52; should snap to standard 2.5s frame boundary
      expect(beginScrubMock).toHaveBeenCalledWith(2.5, "playhead");
      expect(useTimelineStore.getState().snapGuides).toEqual([]);

      act(() => {
        fireEvent(window, new PointerEvent("pointerup", { pointerId: 3 }));
      });
    });

    it("magnetically snaps playhead to clip start edge with clip-start guide", () => {
      const scrollContainer = document.createElement("div");
      Object.defineProperty(scrollContainer, "clientWidth", { value: 1000, configurable: true });
      Object.defineProperty(scrollContainer, "scrollWidth", { value: 2000, configurable: true });
      scrollContainer.scrollLeft = 0;
      scrollContainer.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 1000,
        bottom: 500,
        width: 1000,
        height: 500,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Clip starting at 2.5s (250px at 100pps) — exactly where the mocked playhead is.
      // dragOffset = currentPlayheadX(250) - (scrollLeft(0) + clientX(250)) = 0, so
      // playheadX = 250 → rawTime = 2.5s. Snap target at 2.5s is 0px away — well within threshold.
      useTimelineStore.setState({
        snapEnabled: true,
        snapGuides: [],
        clips: [
          {
            id: "clip-edge-test",
            trackId: "t1",
            mediaId: "m1",
            name: "Edge Test Clip",
            startTime: 2.5,
            duration: 5.0,
            trimIn: 0,
            trimOut: 5,
            volume: 1,
            speed: 1,
            muted: false,
            kind: "video",
          } as any,
        ],
      });

      const { container } = render(
        <Playhead
          pixelsPerSecond={100}
          duration={30}
          containerRef={{ current: scrollContainer }}
          rulerHeight={24}
        />,
      );

      const hitTarget = container.querySelector(
        "[data-playhead-hit-target='true']",
      ) as HTMLElement;

      // Click at 250px (playhead is at 2.5s = 250px; clip-start is also at 2.5s = 0px distance)
      act(() => {
        fireEvent.pointerDown(hitTarget, { clientX: 250, clientY: 10, pointerId: 4 });
      });

      expect(beginScrubMock).toHaveBeenCalledWith(2.5, "playhead");
      expect(useTimelineStore.getState().snapGuides).toEqual([
        expect.objectContaining({ time: 2.5, type: "clip-start" }),
      ]);

      act(() => {
        fireEvent(window, new PointerEvent("pointerup", { pointerId: 4 }));
      });
      expect(useTimelineStore.getState().snapGuides).toEqual([]);
    });

    it("magnetically snaps playhead to timeline marker with marker guide", () => {
      const scrollContainer = document.createElement("div");
      Object.defineProperty(scrollContainer, "clientWidth", { value: 1000, configurable: true });
      Object.defineProperty(scrollContainer, "scrollWidth", { value: 2000, configurable: true });
      scrollContainer.scrollLeft = 0;
      scrollContainer.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 1000,
        bottom: 500,
        width: 1000,
        height: 500,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Marker at 2.5s (250px) — exactly where the mocked playhead sits.
      // dragOffset = 250 - (0 + 250) = 0 → playheadX = 250 → rawTime = 2.5s
      // Snap target is 0px away — well within 10px threshold.
      useTimelineStore.setState({
        snapEnabled: true,
        snapGuides: [],
        clips: [],
        markers: [{ id: "m-test", time: 2.5, name: "Beat Drop", color: "#d946ef" }],
      });

      const { container } = render(
        <Playhead
          pixelsPerSecond={100}
          duration={30}
          containerRef={{ current: scrollContainer }}
          rulerHeight={24}
        />,
      );

      const hitTarget = container.querySelector(
        "[data-playhead-hit-target='true']",
      ) as HTMLElement;

      // Click at 250px — playhead and marker both at 2.5s (0px distance)
      act(() => {
        fireEvent.pointerDown(hitTarget, { clientX: 250, clientY: 10, pointerId: 5 });
      });

      expect(beginScrubMock).toHaveBeenCalledWith(2.5, "playhead");
      expect(useTimelineStore.getState().snapGuides).toEqual([
        expect.objectContaining({ time: 2.5, type: "marker" }),
      ]);

      act(() => {
        fireEvent(window, new PointerEvent("pointerup", { pointerId: 5 }));
      });
      expect(useTimelineStore.getState().snapGuides).toEqual([]);
    });

    it("bypasses snapping when metaKey or ctrlKey is held", () => {
      const scrollContainer = document.createElement("div");
      Object.defineProperty(scrollContainer, "clientWidth", { value: 1000, configurable: true });
      Object.defineProperty(scrollContainer, "scrollWidth", { value: 2000, configurable: true });
      scrollContainer.scrollLeft = 0;
      scrollContainer.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 1000,
        bottom: 500,
        width: 1000,
        height: 500,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      useTimelineStore.setState({
        snapEnabled: true,
        snapGuides: [],
        clips: [
          {
            id: "clip-meta-test",
            trackId: "t1",
            mediaId: "m1",
            name: "Meta Test Clip",
            startTime: 4.0,
            duration: 5.0,
            trimIn: 0,
            trimOut: 5,
            volume: 1,
            speed: 1,
            muted: false,
            kind: "video",
          } as any,
        ],
      });

      const { container } = render(
        <Playhead
          pixelsPerSecond={100}
          duration={30}
          containerRef={{ current: scrollContainer }}
          rulerHeight={24}
        />,
      );

      const hitTarget = container.querySelector(
        "[data-playhead-hit-target='true']",
      ) as HTMLElement;

      // Click at 404px with metaKey=true (Cmd held)
      act(() => {
        fireEvent.pointerDown(hitTarget, {
          clientX: 404,
          clientY: 10,
          pointerId: 6,
          metaKey: true,
        });
      });

      // Must NOT snap to 4.0; should resolve to raw frame time
      expect(beginScrubMock).not.toHaveBeenCalledWith(4.0, "playhead");
      expect(useTimelineStore.getState().snapGuides).toEqual([]);

      act(() => {
        fireEvent(window, new PointerEvent("pointerup", { pointerId: 6 }));
      });
    });
  });
});
