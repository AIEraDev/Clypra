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
    render(<TimelineRuler pixelsPerSecond={100} scrollLeft={100} sequenceDuration={20} />);

    const tenSecondLabel = screen.getByText("00:10");
    expect(tenSecondLabel.parentElement?.style.left).toBe("1000px");
    expect(tenSecondLabel.style.left).toBe("6px");
    expect(tenSecondLabel.style.transform).toBe("none");
  });

  it("adds markers using ruler-local content coordinates", () => {
    const { container } = render(<TimelineRuler pixelsPerSecond={100} scrollLeft={100} sequenceDuration={20} />);
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

  it("switches from frame labels to timecode labels across zoom levels", () => {
    const { rerender } = render(
      <TimelineRuler pixelsPerSecond={500} scrollLeft={0} sequenceDuration={20} />,
    );

    expect(screen.getAllByText("10f").length).toBeGreaterThan(0);
    expect(screen.getByText("00:00")).toBeInTheDocument();

    rerender(
      <TimelineRuler pixelsPerSecond={100} scrollLeft={0} sequenceDuration={20} />,
    );

    expect(screen.getByText("00:01")).toBeInTheDocument();
    expect(screen.queryByText("10f")).not.toBeInTheDocument();
  });

  it("computes tick positions from the integer frame index without float accumulation drift (W5)", () => {
    const { container } = render(
      <TimelineRuler pixelsPerSecond={6000} scrollLeft={0} sequenceDuration={1} startOffset={20} />,
    );
    const tickDivs = container.querySelectorAll("div[style*='position: absolute'][style*='left:']");
    const leftPositions = Array.from(tickDivs).map((el) => (el as HTMLElement).style.left);
    expect(leftPositions).toContain("20px");
    expect(leftPositions).toContain("220px");
    expect(leftPositions).toContain("420px");
  });

  it("updates marker pin position visually during drag before mouseup [CLY-BUG-006]", () => {
    useTimelineStore.setState({
      markers: [
        { id: "m1", time: 2.0, name: "Test Marker", color: "#3b82f6" },
      ],
      scrollLeft: 0,
      pixelsPerSecond: 100,
    });

    render(<TimelineRuler pixelsPerSecond={100} scrollLeft={0} sequenceDuration={20} />);

    const pin = screen.getByTitle("Test Marker");
    expect(pin.style.left).toBe("var(--dx, 200px)");

    fireEvent.mouseDown(pin, { clientX: 200 });
    fireEvent.mouseMove(window, { clientX: 300 });

    expect(pin.style.left).toBe("300px");

    fireEvent.mouseUp(window, { clientX: 300 });
    expect(useTimelineStore.getState().markers[0]?.time).toBe(3);
  });
});
