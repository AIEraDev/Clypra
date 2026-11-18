import { describe, expect, it } from "vitest";
import {
  resolveNativeScrubDemandLifecycle,
  resolveNativeScrubDirection,
  shouldInvalidateNativeScrubDemand,
} from "../nativeScrubDemandLifecycle";

describe("native scrub demand lifecycle", () => {
  it("classifies forward, backward, and stationary target movement", () => {
    expect(resolveNativeScrubDirection(null, 100)).toBe("stationary");
    expect(resolveNativeScrubDirection(100, 100)).toBe("stationary");
    expect(resolveNativeScrubDirection(100, 101)).toBe("forward");
    expect(resolveNativeScrubDirection(101, 100)).toBe("backward");
  });

  it("does not invalidate native decode for a forward scrub continuation", () => {
    expect(
      shouldInvalidateNativeScrubDemand(
        { time: 1, isScrubbing: true },
        { time: 2, isScrubbing: true },
      ),
    ).toBe(false);
  });

  it("keeps reversal, release, and a new interaction as cancellation boundaries", () => {
    expect(
      shouldInvalidateNativeScrubDemand(
        { time: 2, isScrubbing: true },
        { time: 1, isScrubbing: true },
      ),
    ).toBe(true);
    expect(
      shouldInvalidateNativeScrubDemand(
        { time: 2, isScrubbing: true },
        { time: 2, isScrubbing: false },
      ),
    ).toBe(true);
    expect(
      shouldInvalidateNativeScrubDemand(null, { time: 1, isScrubbing: true }),
    ).toBe(true);
  });

  it("keeps the cancellation epoch across forward targets but fences reverse and release", () => {
    const first = resolveNativeScrubDemandLifecycle(null, 10, 100, true);
    const forward = resolveNativeScrubDemandLifecycle(
      first.next,
      11,
      104,
      true,
    );
    expect(forward.cancellationEpoch).toBe(10);

    const reverse = resolveNativeScrubDemandLifecycle(
      forward.next,
      12,
      99,
      true,
    );
    expect(reverse.cancellationEpoch).toBe(12);

    const released = resolveNativeScrubDemandLifecycle(
      reverse.next,
      13,
      101,
      false,
    );
    expect(released.cancellationEpoch).toBe(13);
  });
});
