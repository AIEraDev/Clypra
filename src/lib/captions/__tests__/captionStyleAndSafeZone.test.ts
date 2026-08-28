import { describe, it, expect } from "vitest";
import { resolveEffectiveCaptionStyle } from "../captionStyle";
import { getSafeZoneBounds, checkSafeZoneCompliance } from "../safeZone";
import type { TemplateTextProperties } from "@/features/text-templates/types";

describe("Caption Style Cascade & Safe Zone Engine", () => {
  const defaultTrackStyle: TemplateTextProperties = {
    text: "",
    fontFamily: "Inter Variable",
    fontSize: 48,
    color: "#ffffff",
    align: "center",
    verticalAlign: "middle",
    fontWeight: 700,
    fontStyle: "normal",
    lineHeight: 1.25,
    letterSpacing: 0,
  };

  describe("resolveEffectiveCaptionStyle", () => {
    it("returns track defaults when no cue override is provided", () => {
      const resolved = resolveEffectiveCaptionStyle(defaultTrackStyle);
      expect(resolved).toEqual(defaultTrackStyle);
    });

    it("overrides only explicit fields without altering other track defaults", () => {
      const cueOverride: Partial<TemplateTextProperties> = {
        color: "#facc15",
        fontSize: 54,
      };

      const resolved = resolveEffectiveCaptionStyle(defaultTrackStyle, cueOverride);
      expect(resolved.color).toBe("#facc15");
      expect(resolved.fontSize).toBe(54);
      expect(resolved.fontFamily).toBe("Inter Variable");
      expect(resolved.fontWeight).toBe(700);
      expect(resolved.align).toBe("center");
    });

    it("deep merges parameterOverrides when provided", () => {
      const trackWithParams: TemplateTextProperties = {
        ...defaultTrackStyle,
        parameterOverrides: {
          glowRadius: 10,
          opacity: 0.8,
        },
      };

      const resolved = resolveEffectiveCaptionStyle(trackWithParams, {
        parameterOverrides: {
          opacity: 1.0,
          highlightColor: "#ff0000",
        },
      });

      expect(resolved.parameterOverrides).toEqual({
        glowRadius: 10,
        opacity: 1.0,
        highlightColor: "#ff0000",
      });
    });

    it("ignores undefined properties in cue override", () => {
      const resolved = resolveEffectiveCaptionStyle(defaultTrackStyle, {
        color: undefined,
        fontSize: undefined,
      });

      expect(resolved.color).toBe("#ffffff");
      expect(resolved.fontSize).toBe(48);
    });
  });

  describe("Safe Zone Computation", () => {
    it("computes exact EBU R95 80% Title Safe and 90% Action Safe boundaries", () => {
      const { actionSafe, titleSafe } = getSafeZoneBounds(1920, 1080);

      // Action Safe (5% margin)
      expect(actionSafe.minX).toBe(96);
      expect(actionSafe.maxX).toBe(1824);
      expect(actionSafe.minY).toBe(54);
      expect(actionSafe.maxY).toBe(1026);
      expect(actionSafe.width).toBe(1728);
      expect(actionSafe.height).toBe(972);

      // Title Safe (10% margin)
      expect(titleSafe.minX).toBe(192);
      expect(titleSafe.maxX).toBe(1728);
      expect(titleSafe.minY).toBe(108);
      expect(titleSafe.maxY).toBe(972);
      expect(titleSafe.width).toBe(1536);
      expect(titleSafe.height).toBe(864);
    });

    it("approves bounding boxes completely within Title Safe", () => {
      // Centered bottom subtitle: x = 460, y = 880, width = 1000, height = 60
      // Right edge = 1460 (<= 1728), bottom = 940 (<= 972)
      const compliance = checkSafeZoneCompliance(
        { x: 460, y: 880, width: 1000, height: 60 },
        1920,
        1080,
      );

      expect(compliance.isTitleSafe).toBe(true);
      expect(compliance.isActionSafe).toBe(true);
      expect(compliance.overflows).toHaveLength(0);
      expect(compliance.warning).toBeNull();
    });

    it("generates warning when text exceeds Title Safe but remains in Action Safe", () => {
      // Wide caption: x = 100, y = 880, width = 1700, height = 60
      // Left edge = 100 (< 192 Title Safe, but > 96 Action Safe)
      // Right edge = 1800 (> 1728 Title Safe, but < 1824 Action Safe)
      const compliance = checkSafeZoneCompliance(
        { x: 100, y: 880, width: 1700, height: 60 },
        1920,
        1080,
      );

      expect(compliance.isTitleSafe).toBe(false);
      expect(compliance.isActionSafe).toBe(true);
      expect(compliance.overflows).toContain("left");
      expect(compliance.overflows).toContain("right");
      expect(compliance.warning).toContain("Title Safe (80%) area");
    });

    it("generates critical action safe warning when text clips outer frame", () => {
      // Bottom subtitle extending too low: y = 980, height = 60 -> bottom = 1040 (> 1026 Action Safe)
      const compliance = checkSafeZoneCompliance(
        { x: 460, y: 980, width: 1000, height: 60 },
        1920,
        1080,
      );

      expect(compliance.isTitleSafe).toBe(false);
      expect(compliance.isActionSafe).toBe(false);
      expect(compliance.overflows).toContain("bottom");
      expect(compliance.warning).toContain("Action Safe area");
    });
  });
});
