import { describe, expect, it } from "vitest";
import { RationalTime, getExactRateFraction } from "../rationalTime";

describe("RationalTime & Exact Rate Engine", () => {
  it("resolves exact broadcast rate fractions", () => {
    expect(getExactRateFraction(23.976)).toEqual([24000, 1001]);
    expect(getExactRateFraction(29.97)).toEqual([30000, 1001]);
    expect(getExactRateFraction(59.94)).toEqual([60000, 1001]);
    expect(getExactRateFraction(24)).toEqual([24, 1]);
    expect(getExactRateFraction(25)).toEqual([25, 1]);
    expect(getExactRateFraction(30)).toEqual([30, 1]);
    expect(getExactRateFraction(60)).toEqual([60, 1]);
  });

  it("stores frame value and rate timebase", () => {
    const t = new RationalTime(60, 120);
    expect(t.value).toBe(60);
    expect(t.rate).toBe(120);
    expect(t.toSeconds()).toBe(0.5);
  });

  it("performs drift-free rational addition and subtraction", () => {
    const t1 = RationalTime.fromFrames(1001, 29.97); // 1001 frames at 30000/1001 fps = exactly 1001 * 1001 / 30000 s
    const t2 = RationalTime.fromFrames(1001, 29.97);
    const sum = t1.add(t2);
    expect(sum.toFrames(29.97)).toBe(2002);

    const diff = sum.subtract(t1);
    expect(diff.toFrames(29.97)).toBe(1001);
    expect(diff.equals(t1)).toBe(true);
  });

  it("rescales between different frame rates", () => {
    // 24 frames at 24fps = 1 second
    const t24 = new RationalTime(24, 24);
    expect(t24.toSeconds()).toBe(1.0);

    const t60 = t24.rescaledTo(60);
    expect(t60.toSeconds()).toBe(1.0);
    expect(t60.toFrames()).toBe(60);
  });

  it("correctly compares RationalTime instances", () => {
    const a = new RationalTime(10, 30);
    const b = new RationalTime(20, 30);
    const c = new RationalTime(1, 3);

    expect(a.compare(b)).toBe(-1);
    expect(b.compare(a)).toBe(1);
    expect(a.compare(c)).toBe(0);
    expect(a.equals(c)).toBe(true);
  });
});
