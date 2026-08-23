import { beforeEach, describe, expect, it, vi } from "vitest";
import { TimelineZoomSpring, type ZoomAnchor } from "../useTimelineZoomSpring";
import { useTimelineStore } from "@/store/timelineStore";

describe("TimelineZoomSpring synchronization", () => {
  let container: HTMLDivElement;
  const mockAnchor: ZoomAnchor = {
    anchorTime: 1.0,
    localTimelineX: 100,
    containerWidth: 800,
    viewportEndSeconds: 60,
    hasClips: true,
  };

  beforeEach(() => {
    container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(container, "scrollLeft", { value: 0, writable: true, configurable: true });
    useTimelineStore.setState({
      pixelsPerSecond: 100,
      zoomLevel: 1.0,
      scrollLeft: 0,
      clips: [{ id: "c1", startTime: 0, duration: 10 } as any],
    });
  });

  it("initializes with the store pixelsPerSecond", () => {
    const spring = new TimelineZoomSpring(container);
    expect(spring.getCurrentPps()).toBe(100);
    spring.dispose();
  });

  it("immediately tracks external zoom changes (buttons / slider) when idle without jumping", () => {
    const spring = new TimelineZoomSpring(container);

    // Simulate user clicking Zoom Out button / moving slider to 0 (10 pps)
    useTimelineStore.getState().setPixelsPerSecond(10);

    // spring.getCurrentPps() must immediately return 10 (not the stale 100)
    expect(spring.getCurrentPps()).toBe(10);

    // Simulate mouse wheel tick scaling by 1.1x from the current base
    const basePps = spring.getCurrentPps();
    expect(basePps).toBe(10);
    const targetPps = basePps * 1.1; // 11

    spring.setTarget(targetPps, mockAnchor);

    // Base of the animation is 10, target is 11
    expect(spring.getCurrentPps()).toBe(10);

    spring.dispose();
  });

  it("interrupts in-flight spring animation when an external zoom update occurs", () => {
    const spring = new TimelineZoomSpring(container);

    // Start a wheel zoom towards 200
    spring.setTarget(200, mockAnchor);

    // User clicks "Fit Sequence" or a toolbar button setting zoom to 30
    useTimelineStore.getState().setPixelsPerSecond(30);

    // Spring should immediately adopt the external value and be idle
    expect(spring.getCurrentPps()).toBe(30);

    spring.dispose();
  });

  it("cleans up store subscription on dispose", () => {
    const spring = new TimelineZoomSpring(container);
    spring.dispose();

    // Changing store after dispose should not throw or affect spring
    expect(() => {
      useTimelineStore.getState().setPixelsPerSecond(50);
    }).not.toThrow();
  });
});
