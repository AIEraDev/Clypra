import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TimelineRuler } from "../TimelineRuler";
import { useTimelineStore } from "@/store/timelineStore";

vi.mock("@/hooks/usePlaybackClock", () => ({
  usePlaybackClock: () => ({
    time: 0,
    duration: 20,
    state: "stopped",
    speed: 1,
    frameRate: 30,
  }),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("TimelineRuler coordinate mapping", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    useTimelineStore.setState({
      markers: [],
      scrollLeft: 100,
      pixelsPerSecond: 100,
    });
  });

  it("positions tick labels in content coordinates without subtracting scroll twice", () => {
    render(<TimelineRuler pixelsPerSecond={100} scrollLeft={100} />);

    const tenSecondLabel = screen.getByText("00:10");
    expect(tenSecondLabel.parentElement?.style.left).toBe("1000px");
  });

  it("adds markers using ruler-local content coordinates", () => {
    const { container } = render(<TimelineRuler pixelsPerSecond={100} scrollLeft={100} />);
    const ruler = container.firstElementChild as HTMLDivElement;
    ruler.getBoundingClientRect = () =>
      ({
        left: -100,
        top: 0,
        right: 1100,
        bottom: 24,
        width: 1200,
        height: 24,
        x: -100,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.doubleClick(ruler, { clientX: 450 });

    expect(useTimelineStore.getState().markers[0]?.time).toBe(5.5);
  });
});
