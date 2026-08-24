import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TimelineToolbar } from "../TimelineToolbar";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";

vi.mock("@/hooks/usePlaybackClock", () => ({
  getPlaybackClock: () => ({
    time: 2,
  }),
  usePlaybackClock: () => ({ currentTime: 2, isPlaying: false }),
  useTransportControls: () => ({ play: vi.fn(), pause: vi.fn(), seek: vi.fn() }),
}));

describe("TimelineToolbar zoom controls", () => {
  let scroller: HTMLDivElement;

  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [{ id: "track-1", type: "video", name: "Video 1", muted: false, locked: false, visible: true, height: 68 }],
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
      zoomLevel: 1,
      scrollLeft: 100,
      pixelsPerSecond: 100,
    });
    useUIStore.setState({ selectedClipIds: [] });

    scroller = document.createElement("div");
    scroller.id = "timeline-tracks-container";
    Object.defineProperty(scroller, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(scroller, "scrollLeft", { value: 100, writable: true, configurable: true });
    Object.defineProperty(scroller, "scrollWidth", { value: 2160, configurable: true });
    document.body.appendChild(scroller);
  });

  afterEach(() => {
    scroller.remove();
  });

  it("keeps the visible playhead anchored when zooming with toolbar buttons", () => {
    render(<TimelineToolbar />);

    fireEvent.click(screen.getByLabelText("Zoom in timeline"));

    expect(useTimelineStore.getState().pixelsPerSecond).toBeCloseTo(125, 5);
    expect(scroller.scrollLeft).toBeCloseTo(150, 5);
    expect(useTimelineStore.getState().scrollLeft).toBeCloseTo(150, 5);
  });

  it("coalesces rapid slider movement into one animation-frame update", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, value: vi.fn(() => true) });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, value: vi.fn() });

    render(<TimelineToolbar />);
    const slider = screen.getByRole("slider", { name: "Timeline zoom" });

    fireEvent.pointerDown(slider, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 140 });
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 180 });

    expect(callbacks).toHaveLength(1);
    act(() => callbacks[0](0));
    expect(useTimelineStore.getState().zoomLevel).not.toBe(1);
  });
});
