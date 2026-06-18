import React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Timeline } from "../Timeline";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useUIStore } from "@/store/uiStore";

const seekMock = vi.fn();
const setDurationMock = vi.fn();
const trackPropsSpy = vi.fn();
const mockRuntimeRef = { current: null as any };

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((value: string) => value),
}));

vi.mock("@/hooks/usePlaybackClock", () => ({
  usePlaybackClock: () => ({
    time: 0,
    duration: 20,
    state: "stopped",
    speed: 1,
    frameRate: 30,
  }),
  usePlaybackControls: () => ({
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: seekMock,
    setSpeed: vi.fn(),
    setDuration: setDurationMock,
    setFrameRate: vi.fn(),
  }),
  useTransport: () => null,
  useTransportControls: () => ({
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    setSpeed: vi.fn(),
    setActiveContext: vi.fn(),
  }),
  useTransportSnapshot: () => ({
    time: 0,
    state: "stopped",
    duration: 20,
    speed: 1,
    contextType: null,
  }),
}));


vi.mock("@/hooks/useRenderRuntime", () => ({
  useRenderRuntime: () => mockRuntimeRef.current,
}));

vi.mock("../TimelineToolbar", () => ({
  TimelineToolbar: () => <div>Toolbar</div>,
}));

vi.mock("../TimelineRuler", () => ({
  TimelineRuler: () => <div data-testid="timeline-ruler">Ruler</div>,
}));

vi.mock("../TrackLabel", () => ({
  TrackLabel: (props: any) => <div data-track-label="true">TrackLabel-{props.track.id}</div>,
}));

vi.mock("../Track", () => ({
  Track: (props: any) => {
    trackPropsSpy(props);
    return (
      <div data-timeline-interactive="true" data-track-id={props.track.id} style={{ height: `${props.track.height}px` }}>
        Interactive Clip
      </div>
    );
  },
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
    trackPropsSpy.mockClear();
    useUIStore.setState({ selectedClipIds: [] });
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
    const scroller = container.querySelector("#timeline-tracks-container") as HTMLDivElement;
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
    useTimelineStore.setState({
      clips: [
        { id: "c1", trackId: "track-1", mediaId: "m1", startTime: 0, duration: 3, trimIn: 0, trimOut: 3, x: 0, y: 0, width: 100, height: 100, opacity: 1, rotation: 0 },
      ],
    });
    render(<Timeline />);

    fireEvent.click(screen.getByText("Interactive Clip"));
    fireEvent.click(screen.getByText("Playhead"));

    expect(seekMock).not.toHaveBeenCalled();
  });
});

describe("Timeline drag interactions", () => {
  beforeEach(() => {
    trackPropsSpy.mockClear();
    useUIStore.setState({ selectedClipIds: [] });
    useTimelineStore.setState({
      tracks: [
        { id: "track-1", type: "video", name: "Video 1", muted: false, locked: false, visible: true, height: 68 },
        { id: "track-2", type: "video", name: "Video 2", muted: false, locked: false, visible: true, height: 68 },
      ],
      mainVideoTrackId: "track-1",
      clips: [
        { id: "c1", trackId: "track-1", mediaId: "m1", startTime: 0, duration: 3, trimIn: 0, trimOut: 3, x: 0, y: 0, width: 100, height: 100, opacity: 1, rotation: 0 },
        { id: "c2", trackId: "track-1", mediaId: "m2", startTime: 3, duration: 2, trimIn: 0, trimOut: 2, x: 0, y: 0, width: 100, height: 100, opacity: 1, rotation: 0 },
      ],
      zoomLevel: 1,
      scrollLeft: 0,
      pixelsPerSecond: 100,
      rippleEditEnabled: false,
    });
    useProjectStore.setState({
      project: null,
      mediaAssets: [
        { id: "m1", name: "v1", path: "/v1.mp4", type: "video", duration: 10, width: 1920, height: 1080, size: 1 },
        { id: "m2", name: "v2", path: "/v2.mp4", type: "video", duration: 10, width: 1920, height: 1080, size: 1 },
      ],
      recentProjects: [],
    });
  });

  const setupRects = (container: HTMLElement) => {
    const scroller = container.querySelector("#timeline-tracks-container") as HTMLDivElement;
    Object.defineProperty(scroller, "scrollLeft", { value: 0, writable: true, configurable: true });
    scroller.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 300, width: 1000, height: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const rows = Array.from(container.querySelectorAll("[data-track-id]")) as HTMLElement[];
    rows.forEach((el, i) => {
      el.getBoundingClientRect = () => ({ left: 0, top: i * 68, right: 1000, bottom: i * 68 + 68, width: 1000, height: 68, x: 0, y: i * 68, toJSON: () => ({}) }) as DOMRect;
    });
  };

  it("drags clip to different track", () => {
    const { container } = render(<Timeline />);
    setupRects(container);
    const firstTrackProps = trackPropsSpy.mock.calls[0][0];

    act(() => {
      firstTrackProps.onClipDragStart("c1", 100, 10);
    });
    act(() => {
      firstTrackProps.onClipDragMove("c1", 0, 0, 400, 80);
    });
    act(() => {
      firstTrackProps.onClipDragEnd("c1");
    });

    const c1 = useTimelineStore.getState().clips.find((c) => c.id === "c1");
    expect(c1?.trackId).toBe("track-2");
  });

  it("drags clip within same track", () => {
    const { container } = render(<Timeline />);
    setupRects(container);
    const firstTrackProps = trackPropsSpy.mock.calls[0][0];

    act(() => {
      firstTrackProps.onClipDragStart("c1", 100, 10);
      firstTrackProps.onClipDragMove("c1", 0, 0, 700, 20);
      firstTrackProps.onClipDragEnd("c1");
    });

    const c1 = useTimelineStore.getState().clips.find((c) => c.id === "c1");
    expect(c1?.trackId).toBe("track-1");
    expect((c1?.startTime ?? 0) + c1!.duration).toBeLessThanOrEqual(10);
  });

  it("rejects drag to locked track", () => {
    useTimelineStore.setState((s) => ({
      tracks: s.tracks.map((t) => (t.id === "track-2" ? { ...t, locked: true } : t)),
    }));
    const { container } = render(<Timeline />);
    setupRects(container);
    const firstTrackProps = trackPropsSpy.mock.calls[0][0];

    act(() => {
      firstTrackProps.onClipDragStart("c1", 100, 10);
    });
    act(() => {
      firstTrackProps.onClipDragMove("c1", 0, 0, 400, 80);
    });
    act(() => {
      firstTrackProps.onClipDragEnd("c1");
    });

    const c1 = useTimelineStore.getState().clips.find((c) => c.id === "c1");
    expect(c1?.trackId).toBe("track-1");
  });

  it("cancels drag on ESC and restores original placement", () => {
    const { container } = render(<Timeline />);
    setupRects(container);
    const firstTrackProps = trackPropsSpy.mock.calls[0][0];

    act(() => {
      firstTrackProps.onClipDragStart("c1", 100, 10);
      firstTrackProps.onClipDragMove("c1", 0, 0, 400, 80);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    const c1 = useTimelineStore.getState().clips.find((c) => c.id === "c1");
    expect(c1?.trackId).toBe("track-1");
    expect(c1?.startTime).toBe(0);
  });

  it("drags selected clip group together", () => {
    useTimelineStore.setState({ mainVideoTrackId: "track-2" });
    useUIStore.setState({ selectedClipIds: ["c1", "c2"] });
    const { container } = render(<Timeline />);
    setupRects(container);
    const firstTrackProps = trackPropsSpy.mock.calls[0][0];

    act(() => {
      firstTrackProps.onClipDragStart("c1", 100, 10);
      firstTrackProps.onClipDragMove("c1", 0, 0, 400, 80);
      firstTrackProps.onClipDragEnd("c1");
    });

    const state = useTimelineStore.getState();
    expect(state.clips.find((c) => c.id === "c1")?.trackId).toBe("track-2");
    expect(state.clips.find((c) => c.id === "c2")?.trackId).toBe("track-2");
  });

  it("removes a non-main source track when it becomes empty after drop", () => {
    useTimelineStore.setState({
      mainVideoTrackId: "track-1",
      tracks: [
        { id: "track-1", type: "video", name: "Main", muted: false, locked: false, visible: true, height: 68 },
        { id: "track-2", type: "video", name: "Aux", muted: false, locked: false, visible: true, height: 68 },
      ],
      clips: [{ id: "c2", trackId: "track-2", mediaId: "m2", startTime: 0, duration: 2, trimIn: 0, trimOut: 2, x: 0, y: 0, width: 100, height: 100, opacity: 1, rotation: 0 }],
    });

    const { container } = render(<Timeline />);
    setupRects(container);
    const track2Props = trackPropsSpy.mock.calls.map((c) => c[0]).find((p) => p.track.id === "track-2");
    expect(track2Props).toBeTruthy();

    act(() => {
      track2Props.onClipDragStart("c2", 100, 80);
      track2Props.onClipDragMove("c2", 0, 0, 400, 10); // move to track-1 row
      track2Props.onClipDragEnd("c2");
    });

    const state = useTimelineStore.getState();
    expect(state.clips.find((c) => c.id === "c2")?.trackId).toBe("track-1");
    expect(state.tracks.some((t) => t.id === "track-2")).toBe(false);
  });

  it("allows moving clips freely without main track protection", () => {
    useTimelineStore.setState({
      mainVideoTrackId: "track-1",
      tracks: [
        { id: "track-1", type: "video", name: "Main", muted: false, locked: false, visible: true, height: 68 },
        { id: "track-2", type: "video", name: "Aux", muted: false, locked: false, visible: true, height: 68 },
      ],
      clips: [
        { id: "c1", trackId: "track-1", mediaId: "m1", startTime: 0, duration: 3, trimIn: 0, trimOut: 3, x: 0, y: 0, width: 100, height: 100, opacity: 1, rotation: 0 },
        { id: "c2", trackId: "track-2", mediaId: "m2", startTime: 0, duration: 2, trimIn: 0, trimOut: 2, x: 0, y: 0, width: 100, height: 100, opacity: 1, rotation: 0 },
      ],
    });

    const { container } = render(<Timeline />);
    setupRects(container);
    const track1Props = trackPropsSpy.mock.calls.map((c) => c[0]).find((p) => p.track.id === "track-1");
    expect(track1Props).toBeTruthy();

    // Move clip from main track - should succeed (no protection)
    act(() => {
      track1Props.onClipDragStart("c1", 100, 10);
      track1Props.onClipDragMove("c1", 0, 0, 400, 80); // move to track-2 row
      track1Props.onClipDragEnd("c1");
    });

    // Clip should be movable - no longer blocked by main track protection
    const state = useTimelineStore.getState();
    const clip = state.clips.find((c) => c.id === "c1");
    expect(clip).toBeDefined();
    // Track should still exist (not removed)
    expect(state.tracks.some((t) => t.id === "track-1")).toBe(true);
  });
});

describe("Timeline wheel zoom", () => {
  beforeEach(() => {
    // Coalesced zoom uses requestAnimationFrame; run flush synchronously in tests.
    vi.stubGlobal("requestAnimationFrame", (cb: (time: number) => void) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Ctrl+wheel changes pixelsPerSecond and scroll (zoom-to-cursor)", async () => {
    const { container } = render(<Timeline />);
    const scroller = container.querySelector("#timeline-tracks-container") as HTMLDivElement;
    expect(scroller).toBeTruthy();

    Object.defineProperty(scroller, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(scroller, "scrollLeft", { value: 200, writable: true, configurable: true });
    // jsdom does not lay out children; without this the auto-scroll effect clamps scroll to 0.
    Object.defineProperty(scroller, "scrollWidth", { value: 5000, configurable: true });

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
    // deltaY < 0 → zoom in (increase pps). Zoom handler coalesces to requestAnimationFrame.
    await act(async () => {
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
    });

    const afterPps = useTimelineStore.getState().pixelsPerSecond;
    expect(afterPps).toBeGreaterThan(beforePps);
    expect(afterPps).toBeLessThanOrEqual(400);

    // Anchor time was (200 + 400) / 100 = 6s; scroll should move to keep ~that time under x=400
    expect(scroller.scrollLeft).toBeGreaterThan(200);
    expect(useTimelineStore.getState().scrollLeft).toBe(scroller.scrollLeft);
  });

  it("Ctrl+wheel anchors to the timeline lane when track labels are visible", async () => {
    useTimelineStore.setState({
      clips: [
        {
          id: "clip-1",
          kind: "video",
          trackId: "track-1",
          mediaId: "asset-1",
          startTime: 0,
          duration: 20,
          trimIn: 0,
          trimOut: 20,
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          opacity: 1,
          rotation: 0,
        } as any,
      ],
      scrollLeft: 200,
      pixelsPerSecond: 100,
      zoomLevel: 1,
    });

    const { container } = render(<Timeline />);
    const scroller = container.querySelector("#timeline-tracks-container") as HTMLDivElement;

    Object.defineProperty(scroller, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(scroller, "scrollLeft", { value: 200, writable: true, configurable: true });
    Object.defineProperty(scroller, "scrollWidth", { value: 2160, configurable: true });
    scroller.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    await act(async () => {});

    await act(async () => {
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
    });

    const afterPps = useTimelineStore.getState().pixelsPerSecond;
    const expected = ((200 + (400 - 160)) / 100) * afterPps - (400 - 160);

    expect(scroller.scrollLeft).toBeCloseTo(expected, 5);
    expect(useTimelineStore.getState().scrollLeft).toBe(scroller.scrollLeft);
  });

  it("notifies render runtime with normalized zoom scale", async () => {
    const runtime = {
      attach: vi.fn(() => vi.fn()),
      notifyZoom: vi.fn(),
    };

    // Set the mock runtime for this test
    mockRuntimeRef.current = runtime;

    useTimelineStore.setState({ pixelsPerSecond: 250, zoomLevel: 2.5 });

    render(<Timeline />);

    await act(async () => {});

    expect(runtime.notifyZoom).toHaveBeenCalledWith(2.5);
    expect(runtime.notifyZoom).not.toHaveBeenCalledWith(250);

    // Reset mock
    mockRuntimeRef.current = null;
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
    el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    await act(async () => {});

    const before = useTimelineStore.getState().pixelsPerSecond;
    await act(async () => {
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
    });
    expect(useTimelineStore.getState().pixelsPerSecond).not.toBe(before);
  });
});
