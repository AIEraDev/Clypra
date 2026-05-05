import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Timeline } from "../Timeline";
import { useTimelineStore } from "../../../../store/timelineStore";
import { useProjectStore } from "../../../../store/projectStore";

const seekMock = vi.fn();
const setDurationMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((value: string) => value),
}));

vi.mock("../../../../hooks/usePlayback", () => ({
  usePlayback: () => ({
    currentTime: 0,
    duration: 20,
    seek: seekMock,
    setDuration: setDurationMock,
    isPlaying: false,
    frameRate: 30,
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    formatTime: vi.fn(),
  }),
}));

vi.mock("../TimelineToolbar", () => ({
  TimelineToolbar: () => <div>Toolbar</div>,
}));

vi.mock("../TimelineRuler", () => ({
  TimelineRuler: () => <div data-testid="timeline-ruler">Ruler</div>,
}));

vi.mock("../TrackList", () => ({
  TrackList: () => <div>TrackList</div>,
}));

vi.mock("../Track", () => ({
  Track: () => <div data-timeline-interactive="true">Interactive Clip</div>,
}));

vi.mock("../Playhead", () => ({
  Playhead: () => <div data-timeline-interactive="true">Playhead</div>,
}));

vi.mock("../GhostTrack", () => ({
  GhostTrack: () => null,
}));

vi.mock("../EmptyTimelineDropZone", () => ({
  EmptyTimelineDropZone: () => null,
}));

vi.mock("react-dnd", () => ({
  useDragLayer: () => ({ isDragging: false }),
}));

describe("Timeline click behavior", () => {
  beforeEach(() => {
    seekMock.mockClear();
    setDurationMock.mockClear();
    useTimelineStore.setState({
      tracks: [{ id: "track-1", type: "video", name: "Video 1", muted: false, locked: false, visible: true, height: 68 }],
      clips: [],
      zoomLevel: 1,
      scrollLeft: 0,
      pixelsPerSecond: 100,
    });
    useProjectStore.setState({ project: null, mediaAssets: [], recentProjects: [] });
  });

  it("seeks when clicking empty timeline area", () => {
    const { container } = render(<Timeline />);
    const scroller = container.querySelector(".overflow-x-auto") as HTMLDivElement;
    expect(scroller).toBeTruthy();

    Object.defineProperty(scroller, "scrollLeft", { value: 50, configurable: true });
    scroller.getBoundingClientRect = () =>
      ({
        left: 10,
        top: 0,
        right: 500,
        bottom: 100,
        width: 490,
        height: 100,
        x: 10,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.click(scroller, { clientX: 210, clientY: 20 });
    expect(seekMock).toHaveBeenCalledTimes(1);
    expect(seekMock).toHaveBeenCalledWith(2.5);
  });

  it("does not seek when clicking interactive timeline elements", () => {
    render(<Timeline />);

    fireEvent.click(screen.getByText("Interactive Clip"));
    fireEvent.click(screen.getByText("Playhead"));

    expect(seekMock).not.toHaveBeenCalled();
  });
});

describe("Timeline wheel zoom", () => {
  beforeEach(() => {
    seekMock.mockClear();
    setDurationMock.mockClear();
    useTimelineStore.setState({
      tracks: [{ id: "track-1", type: "video", name: "Video 1", muted: false, locked: false, visible: true, height: 68 }],
      clips: [],
      zoomLevel: 1,
      scrollLeft: 200,
      pixelsPerSecond: 100,
      rippleEditEnabled: false,
    });
    useProjectStore.setState({ project: null, mediaAssets: [], recentProjects: [] });
  });

  it("Ctrl+wheel changes pixelsPerSecond and scroll (zoom-to-cursor)", async () => {
    const { container } = render(<Timeline />);
    const scroller = container.querySelector("#timeline-tracks-container") as HTMLDivElement;
    expect(scroller).toBeTruthy();

    Object.defineProperty(scroller, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(scroller, "scrollLeft", { value: 200, writable: true, configurable: true });

    scroller.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 400,
        width: 800,
        height: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    await act(async () => {});

    const beforePps = useTimelineStore.getState().pixelsPerSecond;
    // deltaY < 0 → zoom in (increase pps)
    scroller.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: 400,
        clientY: 50,
        deltaY: -120,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        ctrlKey: true,
      }),
    );

    const afterPps = useTimelineStore.getState().pixelsPerSecond;
    expect(afterPps).toBeGreaterThan(beforePps);
    expect(afterPps).toBeLessThanOrEqual(500);

    // Anchor time was (200 + 400) / 100 = 6s; scroll should move to keep ~that time under x=400
    expect(scroller.scrollLeft).toBeGreaterThan(200);
    expect(useTimelineStore.getState().scrollLeft).toBe(scroller.scrollLeft);
  });

  it("plain wheel without Ctrl does not change pixelsPerSecond", async () => {
    render(<Timeline />);
    const el = document.getElementById("timeline-tracks-container") as HTMLDivElement;
    expect(el).toBeTruthy();

    Object.defineProperty(el, "clientWidth", { value: 800, configurable: true });

    await act(async () => {});

    const before = useTimelineStore.getState().pixelsPerSecond;
    el.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 50,
        deltaY: -500,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        ctrlKey: false,
      }),
    );

    expect(useTimelineStore.getState().pixelsPerSecond).toBe(before);
  });

  it("normalizes DOM_DELTA_LINE wheel delta", async () => {
    render(<Timeline />);
    const el = document.getElementById("timeline-tracks-container") as HTMLDivElement;
    Object.defineProperty(el, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(el, "scrollLeft", { value: 0, writable: true, configurable: true });
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    await act(async () => {});

    const before = useTimelineStore.getState().pixelsPerSecond;
    el.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 50,
        deltaY: 1,
        deltaMode: WheelEvent.DOM_DELTA_LINE,
        ctrlKey: true,
      }),
    );
    expect(useTimelineStore.getState().pixelsPerSecond).not.toBe(before);
  });
});
