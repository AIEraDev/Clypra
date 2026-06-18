import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TimelineToolbar } from "../TimelineToolbar";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";

vi.mock("@/hooks/usePlaybackClock", () => ({
  getPlaybackClock: () => ({
    time: 2,
  }),
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

    expect(useTimelineStore.getState().pixelsPerSecond).toBeCloseTo(110, 5);
    expect(scroller.scrollLeft).toBeCloseTo(120, 5);
    expect(useTimelineStore.getState().scrollLeft).toBeCloseTo(120, 5);
  });
});
