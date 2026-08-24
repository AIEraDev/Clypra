import { describe, expect, it, vi } from "vitest";
import { SeekController, qualityForScrubVelocity } from "../seekController";

describe("SeekController", () => {
  it("assigns monotonically increasing generations and notifies listeners", () => {
    const controller = new SeekController();
    const listener = vi.fn();
    controller.subscribe(listener);

    const first = controller.request({ time: 1, mode: "scrub", velocityPxPerSecond: 100 });
    const second = controller.request({ time: 2, mode: "scrub", velocityPxPerSecond: 3_000 });

    expect(second.generation).toBeGreaterThan(first.generation);
    expect(second.quality).toBe("quarter");
    expect(controller.isCurrent(second.generation)).toBe(true);
    expect(controller.isCurrent(first.generation)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("invalidates external transport interruptions", () => {
    const controller = new SeekController();
    const intent = controller.request({ time: 4, mode: "seek" });
    const generation = controller.invalidate();

    expect(generation).toBe(intent.generation + 1);
    expect(controller.getCurrent()).toBeNull();
    expect(controller.isCurrent(intent.generation)).toBe(false);
  });

  it("maps velocity to adaptive scrub quality", () => {
    expect(qualityForScrubVelocity(0)).toBe("full");
    expect(qualityForScrubVelocity(1_000)).toBe("half");
    expect(qualityForScrubVelocity(-3_000)).toBe("quarter");
  });

  it("does not accept requests after disposal", () => {
    const controller = new SeekController();
    controller.dispose();

    expect(() => controller.request({ time: 0, mode: "seek" })).toThrow(/disposed/i);
    expect(controller.isCurrent(1)).toBe(false);
  });
});
