import { describe, it, expect, beforeEach, vi } from "vitest";
import { computeSpatialTier, validateSrpConfig, setSrpConfig, getSrpConfig, computeTextureSize, alignToMultipleOf4, computeDprMultiplier } from "../srp";
import { SpatialTier, QualityPreset, DEFAULT_SRP_CONFIG, SPATIAL_TIER_DIMS } from "../types";

beforeEach(() => {
  // Reset to defaults between tests
  setSrpConfig({ ...DEFAULT_SRP_CONFIG });
});

describe("alignToMultipleOf4", () => {
  it("leaves values already aligned", () => {
    expect(alignToMultipleOf4(80)).toBe(80);
    expect(alignToMultipleOf4(4)).toBe(4);
    expect(alignToMultipleOf4(0)).toBe(0);
  });
  it("rounds up non-aligned values", () => {
    expect(alignToMultipleOf4(45)).toBe(48);
    expect(alignToMultipleOf4(67)).toBe(68);
    expect(alignToMultipleOf4(90)).toBe(92);
    expect(alignToMultipleOf4(135)).toBe(136);
  });
});

describe("computeDprMultiplier", () => {
  it("returns 1.0 for standard displays", () => {
    expect(computeDprMultiplier(1.0)).toBe(1.0);
    expect(computeDprMultiplier(1.49)).toBe(1.0);
  });
  it("returns DPR for retina displays", () => {
    expect(computeDprMultiplier(1.5)).toBe(1.5);
    expect(computeDprMultiplier(2.0)).toBe(2.0);
    expect(computeDprMultiplier(3.0)).toBe(3.0);
  });
});

describe("computeTextureSize", () => {
  it("returns base dims (mult of 4) for DPR 1.0", () => {
    const [w, h] = computeTextureSize(SpatialTier.L0, 1.0);
    expect(w % 4).toBe(0);
    expect(h % 4).toBe(0);
    expect(w).toBe(160);
    expect(h).toBe(92); // 90 → aligned to 92
  });
  it("scales and aligns for DPR 2.0", () => {
    const [w, h] = computeTextureSize(SpatialTier.L0, 2.0);
    expect(w % 4).toBe(0);
    expect(h % 4).toBe(0);
    expect(w).toBe(320); // 160×2
    expect(h).toBe(180); // 90×2=180 (already aligned)
  });
  it("all tiers produce mult-of-4 dims at DPR 1.0", () => {
    for (const tier of [SpatialTier.L0, SpatialTier.L1, SpatialTier.L2, SpatialTier.L3]) {
      const [w, h] = computeTextureSize(tier, 1.0);
      expect(w % 4, `L${tier} width ${w} not aligned`).toBe(0);
      expect(h % 4, `L${tier} height ${h} not aligned`).toBe(0);
    }
  });
});

describe("computeSpatialTier — default config", () => {
  it("maps zoom 0.3 → L0", () => {
    const { spatialTier } = computeSpatialTier(0.3, 1.0);
    expect(spatialTier).toBe(SpatialTier.L0);
  });
  it("maps zoom 0.7 → L1", () => {
    const { spatialTier } = computeSpatialTier(0.7, 1.0);
    expect(spatialTier).toBe(SpatialTier.L1);
  });
  it("maps zoom 1.5 → L2", () => {
    const { spatialTier } = computeSpatialTier(1.5, 1.0);
    expect(spatialTier).toBe(SpatialTier.L2);
  });
  it("maps zoom 3.0 → L3 (High preset)", () => {
    const { spatialTier } = computeSpatialTier(3.0, 1.0, QualityPreset.High);
    expect(spatialTier).toBe(SpatialTier.L3);
  });
  it("clamps zoom below min to L0", () => {
    const { spatialTier } = computeSpatialTier(0.1, 1.0);
    expect(spatialTier).toBe(SpatialTier.L0);
  });
  it("clamps zoom above max to L3 (High preset)", () => {
    const { spatialTier } = computeSpatialTier(10.0, 1.0, QualityPreset.High);
    expect(spatialTier).toBe(SpatialTier.L3);
  });
});

describe("computeSpatialTier — quality preset filtering", () => {
  it("Low preset caps at L1", () => {
    const { spatialTier } = computeSpatialTier(3.0, 1.0, QualityPreset.Low);
    expect(spatialTier).toBeLessThanOrEqual(SpatialTier.L1);
  });
  it("Medium preset caps at L2", () => {
    const { spatialTier } = computeSpatialTier(3.0, 1.0, QualityPreset.Medium);
    expect(spatialTier).toBeLessThanOrEqual(SpatialTier.L2);
  });
  it("High preset allows L3", () => {
    const { spatialTier } = computeSpatialTier(3.0, 1.0, QualityPreset.High);
    expect(spatialTier).toBe(SpatialTier.L3);
  });
});

describe("validateSrpConfig", () => {
  it("accepts valid ascending config", () => {
    expect(validateSrpConfig(DEFAULT_SRP_CONFIG)).toBe(true);
  });
  it("rejects overlapping ranges", () => {
    expect(
      validateSrpConfig({
        [SpatialTier.L0]: { min: 0, max: 1 },
        [SpatialTier.L1]: { min: 0.5, max: 2 }, // overlap
        [SpatialTier.L2]: { min: 2, max: 4 },
        [SpatialTier.L3]: { min: 4, max: 8 },
      }),
    ).toBe(false);
  });
  it("rejects degenerate range (min >= max)", () => {
    expect(
      validateSrpConfig({
        ...DEFAULT_SRP_CONFIG,
        [SpatialTier.L0]: { min: 1, max: 1 },
      }),
    ).toBe(false);
  });
  it("falls back to defaults and warns on invalid config", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setSrpConfig({
      [SpatialTier.L0]: { min: 1, max: 0 }, // invalid
      [SpatialTier.L1]: { min: 0.5, max: 2 },
      [SpatialTier.L2]: { min: 2, max: 4 },
      [SpatialTier.L3]: { min: 4, max: 8 },
    });
    expect(warn).toHaveBeenCalled();
    expect(getSrpConfig()).toEqual(DEFAULT_SRP_CONFIG);
    warn.mockRestore();
  });
});
