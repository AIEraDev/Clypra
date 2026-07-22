import { afterEach, describe, expect, test } from "vitest";

import { setLanguage } from "@/i18n";
import { SpatialTier, TemporalTier } from "@/lib/renderEngine/types";
import {
  formatCadenceSeconds,
  getTimelineTemporalDetail,
  getTimelineTierLabel,
} from "./timelineZoom";

describe("timeline zoom localization", () => {
  afterEach(() => setLanguage("zhCN"));

  test("resolves every spatial and temporal tier in the current language", () => {
    expect([
      getTimelineTierLabel(SpatialTier.L0),
      getTimelineTierLabel(SpatialTier.L1),
      getTimelineTierLabel(SpatialTier.L2),
      getTimelineTierLabel(SpatialTier.L3),
    ]).toEqual(["概览", "标准", "细节", "帧级"]);

    setLanguage("en");

    expect([
      getTimelineTierLabel(SpatialTier.L0),
      getTimelineTierLabel(SpatialTier.L1),
      getTimelineTierLabel(SpatialTier.L2),
      getTimelineTierLabel(SpatialTier.L3),
    ]).toEqual(["Overview", "Standard", "Detail", "Frame"]);

    expect([
      getTimelineTemporalDetail(10).label,
      getTimelineTemporalDetail(50).label,
      getTimelineTemporalDetail(150).label,
      getTimelineTemporalDetail(400).label,
    ]).toEqual(["Sparse cadence", "Readable cadence", "Edit cadence", "Frame cadence"]);
    expect(getTimelineTemporalDetail(400).temporalTier).toBe(TemporalTier.L3);
  });

  test("formats cadence units in the current language without changing precision", () => {
    expect(formatCadenceSeconds(2)).toBe("2 秒");
    expect(formatCadenceSeconds(1.5)).toBe("1.5 秒");
    expect(formatCadenceSeconds(0.25)).toBe("250 毫秒");

    setLanguage("en");

    expect(formatCadenceSeconds(2)).toBe("2s");
    expect(formatCadenceSeconds(1.5)).toBe("1.5s");
    expect(formatCadenceSeconds(0.25)).toBe("250ms");
  });
});
