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
});
