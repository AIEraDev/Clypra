import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyTextInvalidation,
  InteractiveTextRenderCoordinator,
} from "../InteractiveTextRenderCoordinator";

describe("InteractiveTextRenderCoordinator", () => {
  let callbacks: {
    apply: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
  };
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    rafCallbacks = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafCallbacks[id - 1] = () => undefined;
    });
    callbacks = { apply: vi.fn() as any, commit: vi.fn() as any };
  });

  it("classifies edits by the cheapest safe invalidation", () => {
    expect(classifyTextInvalidation({ color: "#fff" })).toBe("paint");
    expect(classifyTextInvalidation({ fontFamily: "Inter" })).toBe("layout");
    expect(classifyTextInvalidation({ styleId: "glow" })).toBe("raster");
    expect(classifyTextInvalidation({ x: 10, y: 20 })).toBe("transform");
  });

  it("applies only the latest draft once per RAF and commits once", () => {
    const coordinator = new InteractiveTextRenderCoordinator(callbacks as any);
    const token = coordinator.begin({ clipId: "clip-1", operation: "content-edit", property: "content" });

    coordinator.update(token, { text: "a" }, { text: "" });
    coordinator.update(token, { text: "ab" }, { text: "" });
    expect(callbacks.apply).not.toHaveBeenCalled();
    expect(rafCallbacks).toHaveLength(1);

    rafCallbacks.shift()?.(0);
    expect(callbacks.apply).toHaveBeenCalledOnce();
    expect(callbacks.apply.mock.calls[0][1]).toEqual({ text: "ab" });

    coordinator.finish();
    expect(callbacks.commit).toHaveBeenCalledOnce();
    expect(callbacks.commit.mock.calls[0][1]).toEqual({ text: "" });
    expect(callbacks.commit.mock.calls[0][2]).toEqual({ text: "ab" });
    coordinator.dispose();
  });

  it("cancels pending work without applying or committing it", () => {
    const coordinator = new InteractiveTextRenderCoordinator(callbacks as any);
    const token = coordinator.begin({ clipId: "clip-1", operation: "property-edit", property: "color" });
    coordinator.update(token, { color: "#fff" }, { color: "#000" });
    coordinator.cancel();
    rafCallbacks.forEach((callback) => callback(0));
    expect(callbacks.apply).not.toHaveBeenCalled();
    expect(callbacks.commit).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it("reports stageCoverage 'complete' and unattributedTimeMs = 0 when all samples have core stages", () => {
    const coordinator = new InteractiveTextRenderCoordinator(callbacks as any);
    const token = coordinator.begin({ clipId: "clip-1", operation: "property-edit", property: "color" });

    coordinator.observeRender({
      rasterMs: 4.5,
      paintMs: 1.2,
      totalMs: 6.0,
      cacheHit: false,
    });
    coordinator.observeRender({
      rasterMs: 3.8,
      paintMs: 0.9,
      totalMs: 5.1,
      cacheHit: true,
    });

    coordinator.finish(true);
    expect(callbacks.commit).toHaveBeenCalledOnce();
    const meta = callbacks.commit.mock.calls[0][3];
    expect(meta.stageCoverage).toBe("complete");
    expect(meta.unattributedTimeMs).toBe(0);
    expect(meta.renderCount).toBe(2);
    expect(meta.cacheHits).toBe(1);
    expect(meta.cacheMisses).toBe(1);
    expect(meta.stageTimings).toBeDefined();
    expect(meta.stageTimings.rasterMs).toBeGreaterThan(0);
    expect(meta.stageTimings.totalMs).toBeGreaterThan(0);
    coordinator.dispose();
  });

  it("reports stageCoverage 'partial' and non-zero unattributedTimeMs when some samples lack raster stage data", () => {
    const coordinator = new InteractiveTextRenderCoordinator(callbacks as any);
    const token = coordinator.begin({ clipId: "clip-1", operation: "content-edit", property: "content" });

    // Sample 1 has rasterMs
    coordinator.observeRender({
      rasterMs: 5.0,
      totalMs: 7.0,
    });
    // Sample 2 only has totalMs, missing rasterMs
    coordinator.observeRender({
      totalMs: 6.0,
    });

    coordinator.finish(true);
    expect(callbacks.commit).toHaveBeenCalledOnce();
    const meta = callbacks.commit.mock.calls[0][3];
    expect(meta.stageCoverage).toBe("partial");
    expect(meta.unattributedTimeMs).toBeGreaterThanOrEqual(0);
    expect(meta.renderCount).toBe(2);
    coordinator.dispose();
  });

  it("reports stageCoverage 'unattributed' when zero samples or only generic totalMs exist", () => {
    const coordinator = new InteractiveTextRenderCoordinator(callbacks as any);
    const token = coordinator.begin({ clipId: "clip-1", operation: "property-edit", property: "color" });

    // No observeRender calls made
    coordinator.finish(true);
    expect(callbacks.commit).toHaveBeenCalledOnce();
    const meta = callbacks.commit.mock.calls[0][3];
    expect(meta.stageCoverage).toBe("unattributed");
    expect(meta.unattributedTimeMs).toBeGreaterThanOrEqual(0);
    expect(meta.renderCount).toBe(0);
    expect(meta.stageTimings).toBeUndefined();
    coordinator.dispose();
  });

  it("escalates invalidation priority when updates require higher invalidation levels", () => {
    const coordinator = new InteractiveTextRenderCoordinator(callbacks as any);
    const token = coordinator.begin({ clipId: "clip-1", operation: "property-edit", property: "color" });

    expect(coordinator.getActiveToken()?.clipId).toBe("clip-1");

    // Initially paint invalidation
    coordinator.update(token, { color: "#ff0000" });

    // Escalates to layout when fontFamily is patched
    coordinator.update(token, { fontFamily: "Roboto" });

    // Escalates to raster when styleId is patched
    coordinator.update(token, { styleId: "neon" });

    rafCallbacks.shift()?.(0);
    expect(callbacks.apply).toHaveBeenCalledWith("clip-1", expect.objectContaining({
      color: "#ff0000",
      fontFamily: "Roboto",
      styleId: "neon",
    }), expect.objectContaining({
      invalidation: "raster",
    }));

    coordinator.dispose();
  });
});

