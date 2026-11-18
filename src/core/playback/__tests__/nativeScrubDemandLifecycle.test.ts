import { describe, expect, it } from "vitest";
import { resolveNativeScrubDemandLifecycle } from "../nativeScrubDemandLifecycle";

describe("native scrub demand lifecycle", () => {
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
