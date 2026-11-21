import { describe, it, expect, beforeEach } from "vitest";
import { viewportTelemetry } from "../viewportTelemetry";

describe("viewportTelemetry", () => {
  beforeEach(() => {
    viewportTelemetry.reset();
  });

  it("starts with zero counters", () => {
    const snap = viewportTelemetry.getSnapshot();
    expect(snap.windowComputationsTotal).toBe(0);
    expect(snap.totalClipsInTimeline).toBe(0);
    expect(snap.visibleClipsMounted).toBe(0);
    expect(snap.culledClipsSkipped).toBe(0);
    expect(snap.lifetimeCulledClipsTotal).toBe(0);
    expect(snap.lifetimeVisibleClipsTotal).toBe(0);
    expect(snap.cullingRatioPct).toBe(0);
  });

  it("records window computation and calculates culling ratio", () => {
    // 100 total clips, 20 visible -> 80 culled (80% culling ratio)
    viewportTelemetry.recordWindowComputation(100, 20);

    const snap = viewportTelemetry.getSnapshot();
    expect(snap.windowComputationsTotal).toBe(1);
    expect(snap.totalClipsInTimeline).toBe(100);
    expect(snap.visibleClipsMounted).toBe(20);
    expect(snap.culledClipsSkipped).toBe(80);
    expect(snap.lifetimeCulledClipsTotal).toBe(80);
    expect(snap.lifetimeVisibleClipsTotal).toBe(20);
    expect(snap.cullingRatioPct).toBeCloseTo(80.0);
  });

  it("accumulates lifetime totals across multiple window computations", () => {
    viewportTelemetry.recordWindowComputation(100, 20); // 80 culled
    viewportTelemetry.recordWindowComputation(100, 30); // 70 culled

    const snap = viewportTelemetry.getSnapshot();
    expect(snap.windowComputationsTotal).toBe(2);
    expect(snap.lifetimeCulledClipsTotal).toBe(150);
    expect(snap.lifetimeVisibleClipsTotal).toBe(50);
    // 150 / 200 = 75%
    expect(snap.cullingRatioPct).toBeCloseTo(75.0);
  });

  it("resets cleanly", () => {
    viewportTelemetry.recordWindowComputation(50, 10);
    viewportTelemetry.reset();

    const snap = viewportTelemetry.getSnapshot();
    expect(snap.windowComputationsTotal).toBe(0);
    expect(snap.lifetimeCulledClipsTotal).toBe(0);
    expect(snap.cullingRatioPct).toBe(0);
  });
});
