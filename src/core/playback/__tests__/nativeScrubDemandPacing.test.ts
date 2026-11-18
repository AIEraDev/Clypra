import { describe, expect, it } from "vitest";
import {
  decideNativeScrubDemandDispatch,
  NATIVE_FORWARD_SCRUB_DEMAND_INTERVAL_MS,
} from "../nativeScrubDemandPacing";

describe("native scrub demand pacing", () => {
  it("coalesces rapid forward targets but keeps backward and released seeks immediate", () => {
    const first = decideNativeScrubDemandDispatch(null, 100, true, 1_000);
    expect(first.shouldDispatch).toBe(true);

    const rapidForward = decideNativeScrubDemandDispatch(
      first.next,
      103,
      true,
      1_000 + NATIVE_FORWARD_SCRUB_DEMAND_INTERVAL_MS - 1,
    );
    expect(rapidForward.shouldDispatch).toBe(false);
    expect(rapidForward.next).toEqual(first.next);

    const backward = decideNativeScrubDemandDispatch(
      rapidForward.next,
      99,
      true,
      1_001,
    );
    expect(backward.shouldDispatch).toBe(true);
    expect(backward.next?.frameIndex).toBe(99);

    const released = decideNativeScrubDemandDispatch(
      backward.next,
      120,
      false,
      1_002,
    );
    expect(released.shouldDispatch).toBe(true);
    expect(released.next).toBeNull();
  });
});
