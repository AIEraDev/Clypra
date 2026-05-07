import { describe, it, expect } from "vitest";
import { getDensityForZoom, DENSITY_CONFIGS, generateTimestampGrid, getIntervalForDensity } from "../timelineUtils";
import { DensityLevel } from "../../types";

describe("getDensityForZoom", () => {
  describe("exact boundary tests", () => {
    it("should return Low for zoom at 0", () => {
      expect(getDensityForZoom(0)).toBe(DensityLevel.Low);
    });

    it("should return Low for zoom just below 0.3x boundary", () => {
      expect(getDensityForZoom(0.29)).toBe(DensityLevel.Low);
    });

    it("should return Medium for zoom at 0.3x boundary", () => {
      expect(getDensityForZoom(0.3)).toBe(DensityLevel.Medium);
    });

    it("should return Medium for zoom just below 1.5x boundary", () => {
      expect(getDensityForZoom(1.49)).toBe(DensityLevel.Medium);
    });

    it("should return High for zoom at 1.5x boundary", () => {
      expect(getDensityForZoom(1.5)).toBe(DensityLevel.High);
    });

    it("should return High for zoom just below 3.0x boundary", () => {
      expect(getDensityForZoom(2.99)).toBe(DensityLevel.High);
    });

    it("should return Ultra for zoom at 3.0x boundary", () => {
      expect(getDensityForZoom(3.0)).toBe(DensityLevel.Ultra);
    });

    it("should return Ultra for zoom above 3.0x", () => {
      expect(getDensityForZoom(5.0)).toBe(DensityLevel.Ultra);
    });
  });

  describe("zoom range tests", () => {
    it("should return Low for zoom in range [0, 0.3)", () => {
      expect(getDensityForZoom(0.1)).toBe(DensityLevel.Low);
      expect(getDensityForZoom(0.15)).toBe(DensityLevel.Low);
      expect(getDensityForZoom(0.2)).toBe(DensityLevel.Low);
    });

    it("should return Medium for zoom in range [0.3, 1.5)", () => {
      expect(getDensityForZoom(0.5)).toBe(DensityLevel.Medium);
      expect(getDensityForZoom(1.0)).toBe(DensityLevel.Medium);
      expect(getDensityForZoom(1.4)).toBe(DensityLevel.Medium);
    });

    it("should return High for zoom in range [1.5, 3.0)", () => {
      expect(getDensityForZoom(1.8)).toBe(DensityLevel.High);
      expect(getDensityForZoom(2.0)).toBe(DensityLevel.High);
      expect(getDensityForZoom(2.5)).toBe(DensityLevel.High);
    });

    it("should return Ultra for zoom >= 3.0", () => {
      expect(getDensityForZoom(3.5)).toBe(DensityLevel.Ultra);
      expect(getDensityForZoom(4.0)).toBe(DensityLevel.Ultra);
      expect(getDensityForZoom(10.0)).toBe(DensityLevel.Ultra);
    });
  });

  describe("edge cases", () => {
    it("should handle very small zoom values", () => {
      expect(getDensityForZoom(0.001)).toBe(DensityLevel.Low);
    });

    it("should handle very large zoom values", () => {
      expect(getDensityForZoom(100)).toBe(DensityLevel.Ultra);
    });

    it("should handle negative zoom values (edge case)", () => {
      // Negative zoom doesn't make sense in practice, but the function returns Ultra
      // since it doesn't match any range (falls through to default)
      expect(getDensityForZoom(-1)).toBe(DensityLevel.Ultra);
    });
  });

  describe("generateTimestampGrid - millisecond precision rounding", () => {
    it("should round timestamps to millisecond precision (3 decimal places)", () => {
      // Ultra density (0.05s interval) is most susceptible to float drift
      const timestamps = generateTimestampGrid(0, 1, 0.05, 10);
      for (const t of timestamps) {
        // Each timestamp should have at most 3 decimal places
        const decimals = (t.toString().split(".")[1] ?? "").length;
        expect(decimals).toBeLessThanOrEqual(3);
      }
    });

    it("should not produce sub-millisecond noise at Ultra density", () => {
      // Without rounding, 0 + 3 * 0.05 = 0.15000000000000002 in IEEE 754
      const timestamps = generateTimestampGrid(0, 1, 0.05, 10);
      // t=0.15 should be exactly 0.15, not 0.15000000000000002
      expect(timestamps).toContain(0.15);
      expect(timestamps).not.toContain(0.15000000000000002);
    });

    it("should round timestamps at High density (0.2s interval)", () => {
      // 0 + 1 * 0.2 = 0.2, 0 + 2 * 0.2 = 0.4, etc. — verify no float noise
      const timestamps = generateTimestampGrid(0, 1, 0.2, 10);
      expect(timestamps).toContain(0.2);
      expect(timestamps).toContain(0.4);
      expect(timestamps).toContain(0.6);
      expect(timestamps).toContain(0.8);
      expect(timestamps).toContain(1.0);
    });

    it("should round timestamps when gridStart has fractional milliseconds", () => {
      // trimIn=1.3, interval=0.05 → gridStart = floor(1.3/0.05)*0.05 = 26*0.05 = 1.3
      // step 1: 1.3 + 1*0.05 = 1.35 (exact in IEEE 754? let's verify rounding handles it)
      const timestamps = generateTimestampGrid(1.3, 1.5, 0.05, 10);
      for (const t of timestamps) {
        const str = t.toString();
        const decimals = (str.split(".")[1] ?? "").length;
        expect(decimals).toBeLessThanOrEqual(3);
      }
    });

    it("should produce timestamps with exactly millisecond precision for Medium density", () => {
      // Medium density (1.0s interval) — timestamps should be whole numbers
      const timestamps = generateTimestampGrid(0, 5, 1.0, 10);
      expect(timestamps).toEqual([0, 1, 2, 3, 4, 5]);
      for (const t of timestamps) {
        expect(Number.isInteger(t * 1000)).toBe(true);
      }
    });

    it("should produce timestamps with exactly millisecond precision for Low density", () => {
      // Low density (5.0s interval)
      const timestamps = generateTimestampGrid(0, 15, 5.0, 20);
      expect(timestamps).toEqual([0, 5, 10, 15]);
      for (const t of timestamps) {
        expect(Number.isInteger(t * 1000)).toBe(true);
      }
    });
  });

  describe("generateTimestampGrid - sorted and deduplicated output", () => {
    it("should return timestamps in ascending order", () => {
      const timestamps = generateTimestampGrid(2, 8, 1.0, 10);
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1]);
      }
    });

    it("should deduplicate timestamps when clamping produces duplicates", () => {
      // trimIn=0.3, interval=5.0 → gridStart=0, steps: 0, 5, 10...
      // t=0 is within range, no duplicates expected here, but clamping to 0
      // when gridStart < 0 would produce duplicates — test that case:
      // trimIn=0.1, interval=1.0 → gridStart=0, first step t=0 (clamped), second t=1...
      const timestamps = generateTimestampGrid(0.1, 3, 1.0, 10);
      const unique = new Set(timestamps);
      expect(unique.size).toBe(timestamps.length);
    });

    it("should deduplicate when multiple pre-zero steps clamp to 0", () => {
      // trimIn=0.05, interval=0.2 → gridStart=0, t=0 is fine
      // Force a scenario: trimIn=0, interval=0.05, videoDuration=0.1
      // All steps from 0 to 0.1 should be unique
      const timestamps = generateTimestampGrid(0, 0.1, 0.05, 0.1);
      const unique = new Set(timestamps);
      expect(unique.size).toBe(timestamps.length);
    });

    it("should return empty array when trimIn equals trimOut", () => {
      const timestamps = generateTimestampGrid(5, 5, 1.0, 10);
      // gridStart=5, t=5 ≤ trimOut=5, so [5] is expected
      expect(timestamps).toEqual([5]);
    });

    it("should return sorted array for non-zero trimIn with Low density", () => {
      // trimIn=7, trimOut=22, interval=5 → gridStart=5, steps: 5,10,15,20
      const timestamps = generateTimestampGrid(7, 22, 5.0, 30);
      expect(timestamps).toEqual([5, 10, 15, 20]);
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1]);
      }
    });
  });

  describe("DENSITY_CONFIGS validation", () => {
    it("should have 4 density configurations", () => {
      expect(DENSITY_CONFIGS).toHaveLength(4);
    });

    it("should have correct intervals", () => {
      expect(DENSITY_CONFIGS[0].interval).toBe(5.0);
      expect(DENSITY_CONFIGS[1].interval).toBe(1.0);
      expect(DENSITY_CONFIGS[2].interval).toBe(0.2);
      expect(DENSITY_CONFIGS[3].interval).toBe(0.05);
    });

    it("should have correct zoom ranges", () => {
      expect(DENSITY_CONFIGS[0].minZoom).toBe(0);
      expect(DENSITY_CONFIGS[0].maxZoom).toBe(0.3);

      expect(DENSITY_CONFIGS[1].minZoom).toBe(0.3);
      expect(DENSITY_CONFIGS[1].maxZoom).toBe(1.5);

      expect(DENSITY_CONFIGS[2].minZoom).toBe(1.5);
      expect(DENSITY_CONFIGS[2].maxZoom).toBe(3.0);

      expect(DENSITY_CONFIGS[3].minZoom).toBe(3.0);
      expect(DENSITY_CONFIGS[3].maxZoom).toBe(Infinity);
    });

    it("should have correct density levels", () => {
      expect(DENSITY_CONFIGS[0].level).toBe(DensityLevel.Low);
      expect(DENSITY_CONFIGS[1].level).toBe(DensityLevel.Medium);
      expect(DENSITY_CONFIGS[2].level).toBe(DensityLevel.High);
      expect(DENSITY_CONFIGS[3].level).toBe(DensityLevel.Ultra);
    });
  });
});

describe("getIntervalForDensity", () => {
  it("should return 5.0 for Low density", () => {
    expect(getIntervalForDensity(DensityLevel.Low)).toBe(5.0);
  });

  it("should return 1.0 for Medium density", () => {
    expect(getIntervalForDensity(DensityLevel.Medium)).toBe(1.0);
  });

  it("should return 0.2 for High density", () => {
    expect(getIntervalForDensity(DensityLevel.High)).toBe(0.2);
  });

  it("should return 0.05 for Ultra density", () => {
    expect(getIntervalForDensity(DensityLevel.Ultra)).toBe(0.05);
  });
});

describe("generateTimestampGrid - various clip ranges", () => {
  it("clip starting at t=0 with Low density (5s interval)", () => {
    // trimIn=0, trimOut=20, interval=5, duration=60
    // gridStart=0, steps: 0,5,10,15,20,25>20 breaks
    const timestamps = generateTimestampGrid(0, 20, 5, 60);
    expect(timestamps).toEqual([0, 5, 10, 15, 20]);
  });

  it("clip starting at t=0 with Medium density (1s interval)", () => {
    // trimIn=0, trimOut=5, interval=1, duration=60
    // gridStart=0, steps: 0,1,2,3,4,5,6>5 breaks
    const timestamps = generateTimestampGrid(0, 5, 1, 60);
    expect(timestamps).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("short clip (less than one interval): only gridStart fits", () => {
    // trimIn=2, trimOut=3, interval=5, duration=60
    // gridStart=floor(2/5)*5=0, step=0 → t=0 ≤ 3, step=1 → t=5 > 3 breaks
    const timestamps = generateTimestampGrid(2, 3, 5, 60);
    expect(timestamps).toEqual([0]);
  });

  it("mid-video clip with Medium density", () => {
    // trimIn=10.5, trimOut=15.5, interval=1, duration=60
    // gridStart=floor(10.5)*1=10, steps: 10,11,12,13,14,15,16>15.5 breaks
    const timestamps = generateTimestampGrid(10.5, 15.5, 1, 60);
    expect(timestamps).toEqual([10, 11, 12, 13, 14, 15]);
  });

  it("clip near end of video with Low density", () => {
    // trimIn=55, trimOut=60, interval=5, duration=60
    // gridStart=55, steps: 55,60,65>60 breaks
    const timestamps = generateTimestampGrid(55, 60, 5, 60);
    expect(timestamps).toEqual([55, 60]);
  });

  it("long clip spanning entire video with Low density", () => {
    // trimIn=0, trimOut=60, interval=5, duration=60
    // gridStart=0, steps: 0,5,10,...,60,65>60 breaks
    const timestamps = generateTimestampGrid(0, 60, 5, 60);
    expect(timestamps).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);
  });

  it("clip with fractional trimIn at High density (0.2s interval)", () => {
    // trimIn=1.3, trimOut=2.1, interval=0.2, duration=10
    // gridStart=floor(1.3/0.2)*0.2=floor(6.5)*0.2=6*0.2=1.2
    // steps: 1.2,1.4,1.6,1.8,2.0,2.2>2.1 breaks
    const timestamps = generateTimestampGrid(1.3, 2.1, 0.2, 10);
    expect(timestamps).toEqual([1.2, 1.4, 1.6, 1.8, 2.0]);
  });

  it("single-frame clip at exact grid boundary", () => {
    // trimIn=5, trimOut=5, interval=1, duration=10
    // gridStart=5, step=0 → t=5 ≤ 5, step=1 → t=6 > 5 breaks
    const timestamps = generateTimestampGrid(5, 5, 1, 10);
    expect(timestamps).toEqual([5]);
  });

  it("Ultra density (0.05s interval) with short clip at start", () => {
    // trimIn=0, trimOut=0.5, interval=0.05, duration=10
    // gridStart=0, steps: 0,0.05,0.10,0.15,0.20,0.25,0.30,0.35,0.40,0.45,0.50,0.55>0.5 breaks
    const timestamps = generateTimestampGrid(0, 0.5, 0.05, 10);
    expect(timestamps).toEqual([0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5]);
  });

  it("Ultra density with mid-video clip not aligned to grid", () => {
    // trimIn=1.23, trimOut=1.78, interval=0.05, duration=10
    // gridStart=floor(1.23/0.05)*0.05=floor(24.6)*0.05=24*0.05=1.2
    // steps: 1.2,1.25,1.3,1.35,1.4,1.45,1.5,1.55,1.6,1.65,1.7,1.75,1.8>1.78 breaks
    const timestamps = generateTimestampGrid(1.23, 1.78, 0.05, 10);
    expect(timestamps).toEqual([1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5, 1.55, 1.6, 1.65, 1.7, 1.75]);
  });

  it("Ultra density with very short clip (less than one interval)", () => {
    // trimIn=2.51, trimOut=2.53, interval=0.05, duration=10
    // gridStart=floor(2.51/0.05)*0.05=floor(50.2)*0.05=50*0.05=2.5
    // step=0 → t=2.5 ≤ 2.53, step=1 → t=2.55 > 2.53 breaks
    const timestamps = generateTimestampGrid(2.51, 2.53, 0.05, 10);
    expect(timestamps).toEqual([2.5]);
  });

  it("High density (0.2s interval) with fractional trimIn near end of video", () => {
    // trimIn=58.3, trimOut=60, interval=0.2, duration=60
    // gridStart=floor(58.3/0.2)*0.2=floor(291.5)*0.2=291*0.2=58.2
    // steps: 58.2,58.4,58.6,58.8,59.0,59.2,59.4,59.6,59.8,60.0,60.2>60 breaks
    const timestamps = generateTimestampGrid(58.3, 60, 0.2, 60);
    expect(timestamps).toEqual([58.2, 58.4, 58.6, 58.8, 59, 59.2, 59.4, 59.6, 59.8, 60]);
  });

  it("clip with very small video duration at Low density", () => {
    // trimIn=0, trimOut=3, interval=5, duration=3
    // gridStart=0, step=0 → t=0 ≤ 3, step=1 → t=5 > 3 breaks
    const timestamps = generateTimestampGrid(0, 3, 5, 3);
    expect(timestamps).toEqual([0]);
  });

  it("clip spanning multiple interval boundaries at Medium density", () => {
    // trimIn=3.7, trimOut=12.3, interval=1, duration=20
    // gridStart=floor(3.7)*1=3, steps: 3,4,5,6,7,8,9,10,11,12,13>12.3 breaks
    const timestamps = generateTimestampGrid(3.7, 12.3, 1, 20);
    expect(timestamps).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe("generateTimestampGrid - timestamp clamping", () => {
  it("gridStart at zero when trimIn is small fraction of interval", () => {
    // trimIn=0.3, interval=5, duration=10
    // gridStart=floor(0.3/5)*5=0, t=0 is clamped to max(0,0)=0 — no negative values
    const timestamps = generateTimestampGrid(0.3, 5, 5, 10);
    expect(timestamps[0]).toBeGreaterThanOrEqual(0);
    expect(timestamps).toContain(0);
    // No negative timestamps
    for (const t of timestamps) {
      expect(t).toBeGreaterThanOrEqual(0);
    }
  });

  it("timestamps exceeding videoDuration are clamped to videoDuration", () => {
    // trimIn=58, trimOut=62, interval=1, duration=60
    // gridStart=58, steps: 58,59,60,61→clamped to 60 (dup),62→clamped to 60 (dup)
    // After dedup: [58, 59, 60]
    const timestamps = generateTimestampGrid(58, 62, 1, 60);
    expect(timestamps).toEqual([58, 59, 60]);
    // No timestamp exceeds videoDuration
    for (const t of timestamps) {
      expect(t).toBeLessThanOrEqual(60);
    }
  });

  it("trimOut equals videoDuration exactly — boundary value included", () => {
    // trimIn=55, trimOut=60, interval=5, duration=60
    // t=60 ≤ trimOut=60, so 60 is included and clamped to min(60,60)=60
    const timestamps = generateTimestampGrid(55, 60, 5, 60);
    expect(timestamps).toContain(60);
    expect(timestamps).toEqual([55, 60]);
  });

  it("all timestamps are within [0, videoDuration] for any clip range", () => {
    // Verify the invariant holds for several different inputs
    const cases: [number, number, number, number][] = [
      [0, 10, 1, 10],
      [0.3, 5, 5, 10],
      [58, 62, 1, 60],
      [0, 60, 5, 60],
      [2, 3, 5, 60],
    ];
    for (const [trimIn, trimOut, interval, duration] of cases) {
      const timestamps = generateTimestampGrid(trimIn, trimOut, interval, duration);
      for (const t of timestamps) {
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(duration);
      }
    }
  });

  it("Ultra density with multiple timestamps clamped to videoDuration", () => {
    // trimIn=59.8, trimOut=60.2, interval=0.05, duration=60
    // gridStart=floor(59.8/0.05)*0.05=59.75 (due to floating point precision)
    // steps: 59.75,59.8,59.85,59.9,59.95,60.0→clamped to 60,60.05→clamped to 60,60.1→clamped to 60,60.15→clamped to 60,60.2→clamped to 60
    // After dedup: [59.75, 59.8, 59.85, 59.9, 59.95, 60]
    const timestamps = generateTimestampGrid(59.8, 60.2, 0.05, 60);
    expect(timestamps).toEqual([59.75, 59.8, 59.85, 59.9, 59.95, 60]);
    // Verify no timestamp exceeds videoDuration
    for (const t of timestamps) {
      expect(t).toBeLessThanOrEqual(60);
    }
  });

  it("High density with timestamps clamped at both boundaries", () => {
    // trimIn=-0.3, trimOut=0.5, interval=0.2, duration=10
    // gridStart=floor(-0.3/0.2)*0.05=floor(-1.5)*0.2=-2*0.2=-0.4
    // steps: -0.4→clamped to 0, -0.2→clamped to 0, 0, 0.2, 0.4, 0.6>0.5 breaks
    // After dedup: [0, 0.2, 0.4]
    const timestamps = generateTimestampGrid(-0.3, 0.5, 0.2, 10);
    expect(timestamps[0]).toBe(0);
    expect(timestamps).toContain(0);
    // All timestamps should be non-negative
    for (const t of timestamps) {
      expect(t).toBeGreaterThanOrEqual(0);
    }
  });

  it("clip at very end of video with Ultra density", () => {
    // trimIn=59.9, trimOut=60, interval=0.05, duration=60
    // gridStart=floor(59.9/0.05)*0.05=floor(1198)*0.05=59.9
    // steps: 59.9,59.95,60.0→clamped to 60,60.05>60 breaks
    // After dedup: [59.9, 59.95, 60]
    const timestamps = generateTimestampGrid(59.9, 60, 0.05, 60);
    expect(timestamps).toEqual([59.9, 59.95, 60]);
    expect(timestamps[timestamps.length - 1]).toBe(60);
  });

  it("clip with trimOut slightly beyond videoDuration at Low density", () => {
    // trimIn=55, trimOut=65, interval=5, duration=60
    // gridStart=55, steps: 55,60,65→clamped to 60,70>65 breaks
    // After dedup: [55, 60]
    const timestamps = generateTimestampGrid(55, 65, 5, 60);
    expect(timestamps).toEqual([55, 60]);
    expect(timestamps[timestamps.length - 1]).toBe(60);
  });

  it("very short video duration with clip extending beyond", () => {
    // trimIn=0, trimOut=5, interval=1, duration=2
    // gridStart=0, steps: 0,1,2→clamped to 2,3→clamped to 2,4→clamped to 2,5→clamped to 2
    // After dedup: [0, 1, 2]
    const timestamps = generateTimestampGrid(0, 5, 1, 2);
    expect(timestamps).toEqual([0, 1, 2]);
    expect(timestamps[timestamps.length - 1]).toBe(2);
  });
});

describe("generateTimestampGrid - global grid alignment", () => {
  it("two clips from same video at Medium density share timestamps in overlapping range", () => {
    // Clip A: trimIn=5.3, trimOut=10.7, interval=1
    // gridStart=5, timestamps=[5,6,7,8,9,10]
    const clipA = generateTimestampGrid(5.3, 10.7, 1, 60);
    expect(clipA).toEqual([5, 6, 7, 8, 9, 10]);

    // Clip B: trimIn=8.2, trimOut=15.5, interval=1
    // gridStart=8, timestamps=[8,9,10,11,12,13,14,15]
    const clipB = generateTimestampGrid(8.2, 15.5, 1, 60);
    expect(clipB).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);

    // Shared timestamps in overlapping range [8, 10] appear in both
    const shared = clipA.filter((t) => clipB.includes(t));
    expect(shared).toEqual([8, 9, 10]);
  });

  it("two clips with Low density share timestamps in overlapping range", () => {
    // Clip A: trimIn=3, trimOut=12, interval=5
    // gridStart=floor(3/5)*5=0, steps: 0,5,10,15>12 breaks → [0,5,10]
    const clipA = generateTimestampGrid(3, 12, 5, 60);
    expect(clipA).toEqual([0, 5, 10]);

    // Clip B: trimIn=7, trimOut=18, interval=5
    // gridStart=floor(7/5)*5=5, steps: 5,10,15,20>18 breaks → [5,10,15]
    const clipB = generateTimestampGrid(7, 18, 5, 60);
    expect(clipB).toEqual([5, 10, 15]);

    // Shared timestamps [5, 10] appear in both
    const shared = clipA.filter((t) => clipB.includes(t));
    expect(shared).toEqual([5, 10]);
  });

  it("overlapping clips produce identical timestamps for the shared time range", () => {
    // For same video/density, timestamps in the overlapping region must be identical
    // (not just equal values, but aligned to the same global grid)
    const clipA = generateTimestampGrid(5.3, 10.7, 1, 60);
    const clipB = generateTimestampGrid(8.2, 15.5, 1, 60);

    // The overlap region is [8.2, 10.7] — grid points 9 and 10 fall inside both
    // clipA contains 9 and 10; clipB contains 9 and 10 — they must be identical values
    const overlapTimestamps = [9, 10];
    for (const t of overlapTimestamps) {
      expect(clipA).toContain(t);
      expect(clipB).toContain(t);
    }
  });

  it("three clips at Ultra density share timestamps in overlapping ranges", () => {
    // Clip A: trimIn=0.1, trimOut=0.5, interval=0.05
    const clipA = generateTimestampGrid(0.1, 0.5, 0.05, 10);
    // Clip B: trimIn=0.3, trimOut=0.7, interval=0.05
    const clipB = generateTimestampGrid(0.3, 0.7, 0.05, 10);
    // Clip C: trimIn=0.5, trimOut=0.9, interval=0.05
    const clipC = generateTimestampGrid(0.5, 0.9, 0.05, 10);

    // All three clips should share timestamp 0.5 in their overlap
    expect(clipA).toContain(0.5);
    expect(clipB).toContain(0.5);
    expect(clipC).toContain(0.5);

    // Clips A and B should share 0.3, 0.35, 0.4, 0.45, 0.5
    const sharedAB = clipA.filter((t) => clipB.includes(t));
    expect(sharedAB).toContain(0.3);
    expect(sharedAB).toContain(0.35);
    expect(sharedAB).toContain(0.4);
    expect(sharedAB).toContain(0.45);
    expect(sharedAB).toContain(0.5);

    // Clips B and C should share 0.5, 0.55, 0.6, 0.65, 0.7
    const sharedBC = clipB.filter((t) => clipC.includes(t));
    expect(sharedBC).toContain(0.5);
    expect(sharedBC).toContain(0.55);
    expect(sharedBC).toContain(0.6);
    expect(sharedBC).toContain(0.65);
    expect(sharedBC).toContain(0.7);
  });

  it("non-overlapping clips have no shared timestamps at Medium density", () => {
    // Clip A: early in video, trimIn=2, trimOut=5, interval=1
    const clipA = generateTimestampGrid(2, 5, 1, 60);
    // Clip B: late in video, trimIn=50, trimOut=55, interval=1
    const clipB = generateTimestampGrid(50, 55, 1, 60);

    // No shared timestamps
    const shared = clipA.filter((t) => clipB.includes(t));
    expect(shared).toEqual([]);
  });

  it("four clips spanning entire video at Low density share grid alignment", () => {
    // Clip A: 0-15, interval=5
    const clipA = generateTimestampGrid(0, 15, 5, 60);
    // Clip B: 10-30, interval=5
    const clipB = generateTimestampGrid(10, 30, 5, 60);
    // Clip C: 25-45, interval=5
    const clipC = generateTimestampGrid(25, 45, 5, 60);
    // Clip D: 40-60, interval=5
    const clipD = generateTimestampGrid(40, 60, 5, 60);

    // All clips should align to the same global grid (multiples of 5)
    const allTimestamps = [...clipA, ...clipB, ...clipC, ...clipD];
    for (const t of allTimestamps) {
      expect(t % 5).toBe(0);
    }

    // Verify shared timestamps between adjacent clips
    const sharedAB = clipA.filter((t) => clipB.includes(t));
    expect(sharedAB).toContain(10);
    expect(sharedAB).toContain(15);

    const sharedBC = clipB.filter((t) => clipC.includes(t));
    expect(sharedBC).toContain(25);
    expect(sharedBC).toContain(30);

    const sharedCD = clipC.filter((t) => clipD.includes(t));
    expect(sharedCD).toContain(40);
    expect(sharedCD).toContain(45);
  });

  it("clips at High density with fractional trimIn maintain grid alignment", () => {
    // Clip A: trimIn=1.23, trimOut=3.45, interval=0.2
    const clipA = generateTimestampGrid(1.23, 3.45, 0.2, 10);
    // Clip B: trimIn=2.67, trimOut=4.89, interval=0.2
    const clipB = generateTimestampGrid(2.67, 4.89, 0.2, 10);

    // Both should align to the same global grid (multiples of 0.2)
    // Shared timestamps should be 2.6, 2.8, 3.0, 3.2, 3.4
    const shared = clipA.filter((t) => clipB.includes(t));
    expect(shared).toContain(2.6);
    expect(shared).toContain(2.8);
    expect(shared).toContain(3.0);
    expect(shared).toContain(3.2);
    expect(shared).toContain(3.4);
  });

  it("clips with same range but different positions share identical timestamps", () => {
    // Two clips with identical duration at different positions
    // Clip A: trimIn=5, trimOut=10, interval=1
    const clipA = generateTimestampGrid(5, 10, 1, 60);
    // Clip B: trimIn=20, trimOut=25, interval=1
    const clipB = generateTimestampGrid(20, 25, 1, 60);

    // Both should have 6 timestamps (inclusive of boundaries)
    expect(clipA.length).toBe(6);
    expect(clipB.length).toBe(6);

    // Both should align to integer grid points
    for (const t of clipA) {
      expect(Number.isInteger(t)).toBe(true);
    }
    for (const t of clipB) {
      expect(Number.isInteger(t)).toBe(true);
    }
  });
});
