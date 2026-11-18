import { describe, expect, it } from "vitest";
import {
  decidePausedNativeDemandAction,
  type PausedNativeDemandIdentity,
} from "../pausedNativeDemandState";

const demand = (
  overrides: Partial<PausedNativeDemandIdentity> = {},
): PausedNativeDemandIdentity => ({
  requestKey: "revision:frame-100",
  generation: 10,
  frameIndex: 100,
  cancellationEpoch: 10,
  isScrubbing: true,
  ...overrides,
});

describe("paused native demand state", () => {
  it("dispatches exactly once for repeated RAF ticks at an unchanged target", () => {
    const active = demand();
    expect(decidePausedNativeDemandAction(null, active)).toBe("dispatch");
    expect(decidePausedNativeDemandAction(active, demand())).toBe("hold");
  });

  it("holds a forward scrub target until the active native operation is terminal", () => {
    expect(
      decidePausedNativeDemandAction(
        demand(),
        demand({ requestKey: "revision:frame-120", generation: 11, frameIndex: 120 }),
      ),
    ).toBe("hold");
  });

  it("replaces the active target for reverse scrub and release boundaries", () => {
    expect(
      decidePausedNativeDemandAction(
        demand(),
        demand({ requestKey: "revision:frame-90", generation: 11, frameIndex: 90, cancellationEpoch: 11 }),
      ),
    ).toBe("replace");
    expect(
      decidePausedNativeDemandAction(
        demand(),
        demand({ requestKey: "revision:frame-101", generation: 12, frameIndex: 101, cancellationEpoch: 12, isScrubbing: false }),
      ),
    ).toBe("replace");
  });
});
