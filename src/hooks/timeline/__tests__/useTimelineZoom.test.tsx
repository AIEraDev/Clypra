import React, { useRef } from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useTimelineZoom } from "../useTimelineZoom";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { getTimelineMaxPps, TIMELINE_MIN_PPS } from "@/lib/timeline/timelineZoom";

function TestTimelineZoomContainer() {
  const containerRef = useRef<HTMLDivElement>(null);
  useTimelineZoom(containerRef, true);
  return (
    <div
      ref={containerRef}
      id="timeline-tracks-container"
      style={{ width: "800px", height: "400px", overflow: "hidden" }}
    >
      <div
        data-timeline-ruler="true"
        className="ruler"
        style={{ width: "100%", height: "24px" }}
      />
      <div className="tracks" style={{ width: "100%", height: "376px" }} />
    </div>
  );
}

describe("useTimelineZoom discrete wheel notch traversal and stacking (W4)", () => {
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;
  /** Monotonic mock clock shared by performance.now() and RAF callbacks. */
  let mockNow: number;

  beforeEach(() => {
    mockNow = 1000;
    rafCallbacks = new Map();
    nextRafId = 1;
    // Advance mock clock 16.67 ms each call so the time-based spring integrates correctly.
    vi.spyOn(performance, "now").mockImplementation(() => {
      mockNow += 1000 / 60;
      return mockNow;
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextRafId++;
      rafCallbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafCallbacks.delete(id);
    });

    useProjectStore.setState({
      project: { frameRate: 30 } as any,
    });

    useTimelineStore.setState({
      pixelsPerSecond: 10,
      zoomLevel: 0.1,
      scrollLeft: 0,
      tracks: [
        {
          id: "track-1",
          type: "video",
          name: "V1",
          muted: false,
          locked: false,
          visible: true,
          height: 68,
        },
      ],
      clips: [
        {
          id: "clip-1",
          kind: "video",
          trackId: "track-1",
          mediaId: "asset-1",
          startTime: 0,
          duration: 300,
          trimIn: 0,
          trimOut: 300,
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          opacity: 1,
          rotation: 0,
        } as any,
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function flushAllFrames(max = 120): void {
    let count = 0;
    while (rafCallbacks.size > 0 && count < max) {
      const entries = Array.from(rafCallbacks.entries());
      rafCallbacks.clear();
      for (const [, cb] of entries) {
        // mockNow is already advanced by the performance.now() spy; pass current value.
        cb(mockNow);
      }
      count++;
    }
  }

  function setupContainer(container: HTMLElement) {
    const scroller = container.querySelector(
      "#timeline-tracks-container",
    ) as HTMLDivElement;
    Object.defineProperty(scroller, "clientWidth", {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(scroller, "clientHeight", {
      value: 400,
      configurable: true,
    });
    Object.defineProperty(scroller, "scrollLeft", {
      value: 0,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(scroller, "scrollWidth", {
      value: 50000,
      configurable: true,
    });
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
    return scroller;
  }

  it("traverses full working range in 6–7 notches for deltaY of 4, 10, and 100", async () => {
    for (const deltaY of [4, 10, 100]) {
      const { container, unmount } = render(<TestTimelineZoomContainer />);
      const scroller = setupContainer(container);

      // Start at nominal min (10 px/s)
      act(() => {
        useTimelineStore.getState().setPixelsPerSecond(10);
      });
      expect(useTimelineStore.getState().pixelsPerSecond).toBe(10);

      // 6 zoom-in notches: must be close to max (~2400-6000)
      for (let i = 0; i < 6; i++) {
        act(() => {
          scroller.dispatchEvent(
            new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              clientX: 400,
              clientY: 200,
              deltaY: -deltaY,
              deltaMode: WheelEvent.DOM_DELTA_PIXEL,
              ctrlKey: true,
            }),
          );
          flushAllFrames();
        });
      }

      const ppsAt6 = useTimelineStore.getState().pixelsPerSecond;
      expect(ppsAt6).toBeGreaterThan(2000);
      expect(ppsAt6).toBeLessThanOrEqual(6000);

      // 7th notch: reaches maxPps (6,000 px/s)
      act(() => {
        scroller.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            clientX: 400,
            clientY: 200,
            deltaY: -deltaY,
            deltaMode: WheelEvent.DOM_DELTA_PIXEL,
            ctrlKey: true,
          }),
        );
        flushAllFrames();
      });

      expect(useTimelineStore.getState().pixelsPerSecond).toBe(6000);

      // 8th notch: saturates without overshoot
      act(() => {
        scroller.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            clientX: 400,
            clientY: 200,
            deltaY: -deltaY,
            deltaMode: WheelEvent.DOM_DELTA_PIXEL,
            ctrlKey: true,
          }),
        );
        flushAllFrames();
      });
      expect(useTimelineStore.getState().pixelsPerSecond).toBe(6000);

      unmount();
    }
  });

  it("coalesces 3 notches in one animation frame into 3 full steps", async () => {
    const { container } = render(<TestTimelineZoomContainer />);
    const scroller = setupContainer(container);

    act(() => {
      useTimelineStore.getState().setPixelsPerSecond(100);
    });

    // Dispatch 3 notches before rAF flush
    act(() => {
      for (let i = 0; i < 3; i++) {
        scroller.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            clientX: 400,
            clientY: 200,
            deltaY: -100,
            deltaMode: WheelEvent.DOM_DELTA_PIXEL,
            ctrlKey: true,
          }),
        );
      }
    });

    act(() => {
      flushAllFrames();
    });

    const step = Math.pow(6000 / 10, 1 / 7);
    const expected = 100 * Math.pow(step, 3);
    expect(useTimelineStore.getState().pixelsPerSecond).toBeCloseTo(expected, 0);
  });

  it("stacks onto the spring target during in-flight animation without losing magnitude", async () => {
    const { container } = render(<TestTimelineZoomContainer />);
    const scroller = setupContainer(container);

    act(() => {
      useTimelineStore.getState().setPixelsPerSecond(100);
    });

    // First notch
    act(() => {
      scroller.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: 400,
          clientY: 200,
          deltaY: -100,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          ctrlKey: true,
        }),
      );
    });

    // Advance only 1 rAF frame (spring is in flight, NOT settled)
    act(() => {
      const next = rafCallbacks.entries().next();
      if (!next.done) {
        const [id, cb] = next.value;
        rafCallbacks.delete(id);
        cb(performance.now());
      }
    });

    // Second notch arrives mid-flight
    act(() => {
      scroller.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: 400,
          clientY: 200,
          deltaY: -100,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          ctrlKey: true,
        }),
      );
      flushAllFrames();
    });

    const step = Math.pow(6000 / 10, 1 / 7);
    const expected = 100 * Math.pow(step, 2);
    expect(useTimelineStore.getState().pixelsPerSecond).toBeCloseTo(expected, 0);
  });

  it("implements D3 plain-wheel-over-ruler policy: zooms over ruler without Ctrl, leaves tracks alone", async () => {
    const { container } = render(<TestTimelineZoomContainer />);
    const scroller = setupContainer(container);
    const ruler = container.querySelector(".ruler") as HTMLDivElement;
    const tracks = container.querySelector(".tracks") as HTMLDivElement;

    act(() => {
      useTimelineStore.getState().setPixelsPerSecond(100);
    });

    // Plain wheel over tracks: NO zoom change
    act(() => {
      tracks.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: 400,
          clientY: 200,
          deltaY: -100,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          ctrlKey: false,
        }),
      );
      flushAllFrames();
    });
    expect(useTimelineStore.getState().pixelsPerSecond).toBe(100);

    // Plain wheel over ruler: ZOOMS!
    act(() => {
      ruler.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: 400,
          clientY: 10,
          deltaY: -100,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          ctrlKey: false,
        }),
      );
      flushAllFrames();
    });
    expect(useTimelineStore.getState().pixelsPerSecond).toBeGreaterThan(100);
  });

  it("preserves continuous exponential path for small trackpad gestures (deltaY < 4)", async () => {
    const { container } = render(<TestTimelineZoomContainer />);
    const scroller = setupContainer(container);

    act(() => {
      useTimelineStore.getState().setPixelsPerSecond(100);
    });

    act(() => {
      scroller.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: 400,
          clientY: 200,
          deltaY: -1.5,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          ctrlKey: true,
        }),
      );
      flushAllFrames();
    });

    // Small trackpad delta produces smooth subtle zoom (~2%), not a full discrete 2.49x step
    const pps = useTimelineStore.getState().pixelsPerSecond;
    expect(pps).toBeGreaterThan(100);
    expect(pps).toBeLessThan(110);
  });

  it("caps maximum zoom during wheel zoom based on sequence duration (32M px WebKit ceiling)", async () => {
    // 2-hour sequence (7,200 seconds)
    const longDuration = 7200;
    const effectiveMax = getTimelineMaxPps(30, longDuration); // 32,000,000 / 7200 = 4,444.44 px/s

    function LongSequenceContainer() {
      const containerRef = useRef<HTMLDivElement>(null);
      useTimelineZoom(containerRef, true, longDuration);
      return (
        <div
          ref={containerRef}
          id="timeline-tracks-container"
          style={{ width: "800px", height: "400px", overflow: "hidden" }}
        />
      );
    }

    const { container } = render(<LongSequenceContainer />);
    const scroller = setupContainer(container);

    act(() => {
      useTimelineStore.getState().setPixelsPerSecond(3000);
    });

    // 10 aggressive zoom-in notches
    for (let i = 0; i < 10; i++) {
      act(() => {
        scroller.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            clientX: 400,
            clientY: 200,
            deltaY: -100,
            deltaMode: WheelEvent.DOM_DELTA_PIXEL,
            ctrlKey: true,
          }),
        );
        flushAllFrames();
      });
    }

    const pps = useTimelineStore.getState().pixelsPerSecond;
    expect(pps).toBeCloseTo(effectiveMax, 1);
    expect(pps).toBeLessThanOrEqual(effectiveMax);
    expect(pps * longDuration).toBeLessThanOrEqual(32_000_000);
  });
});
