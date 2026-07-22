import { describe, expect, test } from "vitest";

import { SpatialTier, TemporalTier } from "@/lib/renderEngine/types";
import {
  formatCadenceSeconds,
  TIMELINE_TEMPORAL_LABELS,
  TIMELINE_TIER_LABELS,
} from "./timelineZoom";

describe("timeline zoom localization", () => {
  test("uses Chinese labels for every spatial and temporal tier", () => {
    expect([
      TIMELINE_TIER_LABELS[SpatialTier.L0],
      TIMELINE_TIER_LABELS[SpatialTier.L1],
      TIMELINE_TIER_LABELS[SpatialTier.L2],
      TIMELINE_TIER_LABELS[SpatialTier.L3],
    ]).toEqual(["概览", "标准", "细节", "帧级"]);

    expect([
      TIMELINE_TEMPORAL_LABELS[TemporalTier.L0],
      TIMELINE_TEMPORAL_LABELS[TemporalTier.L1],
      TIMELINE_TEMPORAL_LABELS[TemporalTier.L2],
      TIMELINE_TEMPORAL_LABELS[TemporalTier.L3],
    ]).toEqual(["稀疏采样", "易读采样", "编辑采样", "逐帧采样"]);
  });

  test("formats cadence in natural Chinese without changing precision", () => {
    expect(formatCadenceSeconds(2)).toBe("2 秒");
    expect(formatCadenceSeconds(1.5)).toBe("1.5 秒");
    expect(formatCadenceSeconds(0.25)).toBe("250 毫秒");
  });
});
