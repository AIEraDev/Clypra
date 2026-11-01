import { describe, expect, it } from "vitest";
import {
  ZOOM_SPRING_MAX_DT_MS,
  ZOOM_SPRING_TAU_MS,
  hasZoomSettled,
  stepZoomSpring,
  zoomSettleEpsilon,
} from "../zoomSpringMath";

function run(current: number, target: number, durationMs: number, frameMs: number): number {
  let c = current;
  for (let t = 0; t < durationMs - 1e-9; t += frameMs) c = stepZoomSpring(c, target, frameMs);
  return c;
}

describe("stepZoomSpring", () => {
  it("moves monotonically toward the target in both directions", () => {
    let up = 100;
    let down = 6000;
    for (let i = 0; i < 40; i++) {
      const nu = stepZoomSpring(up, 2000, 16.67);
      const nd = stepZoomSpring(down, 50, 16.67);
      expect(nu).toBeGreaterThan(up);
      expect(nu).toBeLessThanOrEqual(2000);
      expect(nd).toBeLessThan(down);
      expect(nd).toBeGreaterThanOrEqual(50);
      up = nu;
      down = nd;
    }
  });

  it("interpolates geometrically (log space), not linearly", () => {
    // alpha = 0.5 when dt = tau * ln 2
    const mid = stepZoomSpring(10, 1000, ZOOM_SPRING_TAU_MS * Math.LN2);
    expect(mid).toBeCloseTo(100, 0); // geometric mean, not 505
  });

  it("is frame-rate independent: 60 Hz and 120 Hz agree after the same elapsed time", () => {
    const a = run(100, 249, 200, 1000 / 60);
    const b = run(100, 249, 200, 1000 / 120);
    expect(Math.abs(Math.log(a / b))).toBeLessThan(0.005);
  });

  it("caps a stalled frame so the zoom cannot teleport", () => {
    const stalled = stepZoomSpring(100, 6000, 5000);
    const capped = stepZoomSpring(100, 6000, ZOOM_SPRING_MAX_DT_MS);
    expect(stalled).toBeCloseTo(capped, 9);
    expect(stalled).toBeLessThan(6000);
  });

  it("returns current for a non-positive dt and the target for a broken current", () => {
    expect(stepZoomSpring(100, 200, 0)).toBe(100);
    expect(stepZoomSpring(100, 200, -5)).toBe(100);
    expect(stepZoomSpring(NaN, 200, 16)).toBe(200);
    expect(stepZoomSpring(0, 200, 16)).toBe(200);
    expect(stepZoomSpring(100, NaN, 16)).toBe(100);
  });
});

describe("settle criterion", () => {
  it("derives a relative tolerance of 0.5 px across the lane", () => {
    expect(zoomSettleEpsilon(1200)).toBeCloseTo(0.5 / 1200, 9);
    expect(zoomSettleEpsilon(0)).toBeCloseTo(0.5 / 1200, 9); // fallback width
    expect(zoomSettleEpsilon(1e9)).toBe(1e-5); // floor
    expect(zoomSettleEpsilon(10)).toBe(1e-2); // ceiling
  });

  it("scales with zoom: the same absolute gap is settled at high zoom and not at low zoom", () => {
    expect(hasZoomSettled(6000, 6000.08, 1200)).toBe(true); // 0.08 px/s at 6000 px/s: invisible
    expect(hasZoomSettled(10, 10.08, 1200)).toBe(false); // 0.08 px/s at 10 px/s: ~0.8 % off
  });
});

describe("notch response (2.49x step at 60 Hz)", () => {
  it("is 99% of the way in <= 250 ms and visually settled in <= 400 ms", () => {
    const start = 1000;
    const target = start * 2.49;
    let c = start;
    let t99: number | null = null;
    let settled: number | null = null;
    const dt = 1000 / 60;
    for (let t = dt; t < 2000; t += dt) {
      c = stepZoomSpring(c, target, dt);
      if (t99 === null && Math.log(c / start) / Math.log(target / start) >= 0.99) t99 = t;
      if (settled === null && hasZoomSettled(c, target, 1200)) settled = t;
    }
    expect(t99).not.toBeNull();
    expect(t99 as number).toBeLessThanOrEqual(250);
    expect(settled as number).toBeLessThanOrEqual(400);
  });
});
