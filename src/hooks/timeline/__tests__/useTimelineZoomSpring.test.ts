import { beforeEach, describe, expect, it, vi } from "vitest";
import { TimelineZoomSpring, type ZoomAnchor } from "../useTimelineZoomSpring";
import { useTimelineStore } from "@/store/timelineStore";

describe("TimelineZoomSpring synchronization", () => {
  let container: HTMLDivElement;
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;
  const mockAnchor: ZoomAnchor = {
    anchorTime: 1.0,
    localTimelineX: 100,
    containerWidth: 800,
    viewportEndSeconds: 60,
    hasClips: true,
  };

  beforeEach(() => {
    rafCallbacks = new Map();
    nextRafId = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextRafId++;
      rafCallbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafCallbacks.delete(id);
    });
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function flushNextFrame(): boolean {
    const next = rafCallbacks.entries().next();
    if (next.done) return false;
    const [id, callback] = next.value;
    rafCallbacks.delete(id);
    callback(0);
    return true;
  }

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

  it("settles within a bounded number of RAF frames", () => {
    const spring = new TimelineZoomSpring(container);
    spring.setTarget(200, mockAnchor);

    let frames = 0;
    while (flushNextFrame()) {
      frames += 1;
      expect(frames).toBeLessThan(100);
    }

    expect(frames).toBeGreaterThan(0);
    expect(useTimelineStore.getState().pixelsPerSecond).toBe(200);
    expect(rafCallbacks.size).toBe(0);
    spring.dispose();
  });

  it("does not notify subscribers for an idempotent PPS update", () => {
    let notifications = 0;
    const unsubscribe = useTimelineStore.subscribe(() => {
      notifications += 1;
    });

    useTimelineStore.getState().setPixelsPerSecond(100);

    expect(notifications).toBe(0);
    unsubscribe();
  });

  it("ignores a stale callback after disposal", () => {
    const spring = new TimelineZoomSpring(container);
    spring.setTarget(200, mockAnchor);
    const queuedCallback = rafCallbacks.values().next().value as FrameRequestCallback;

    spring.dispose();
    queuedCallback(0);

    expect(useTimelineStore.getState().pixelsPerSecond).toBe(100);
    expect(rafCallbacks.size).toBe(0);
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
