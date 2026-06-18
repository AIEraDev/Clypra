import { describe, expect, it } from "vitest";
import { buildClipPropertyTransform } from "../PropertiesPanel";
import type { TextClip } from "@/types";

const baseTextClip: TextClip = {
  id: "text-1",
  kind: "text",
  trackId: "track-1",
  mediaId: "",
  startTime: 0,
  duration: 5,
  trimIn: 0,
  trimOut: 5,
  x: 200,
  y: 150,
  width: 300,
  height: 100,
  opacity: 1,
  rotation: 0,
  aspectRatioLocked: false,
  text: "CLYPRA",
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: 72,
  fontWeight: "normal",
  fontStyle: "normal",
  color: "#ffffff",
  align: "center",
  valign: "middle",
  lineHeight: 1.2,
  letterSpacing: 0,
  paddingX: 16,
  paddingY: 16,
};

const styledTextClip: TextClip = {
  ...baseTextClip,
  styleId: "boxed-title",
  styleDefinition: {
    id: "boxed-title",
    name: "Boxed Title",
    category: "outline",
    description: "",
    tags: [],
    boundingBox: { mode: "panel", paddingX: 50, paddingY: 25 },
    font: { family: "Montserrat", weight: 900, style: "normal", letterSpacing: 8, lineHeight: 1.1 },
    fills: [{ type: "solid", color: "#ffffff" }],
    strokes: [],
    shadows: [],
    panel: {
      color: "#111111",
      opacity: 100,
      radius: 0,
      paddingX: 48,
      paddingY: 22,
      stroke: { color: "#ffffff", width: 2 },
    },
  } as any,
};

describe("buildClipPropertyTransform", () => {
  it("includes recalculated text bounds when font size changes through properties", () => {
    const { oldTransform, newTransform } = buildClipPropertyTransform(baseTextClip, { fontSize: 520 }, 640, 960);

    expect(oldTransform.fontSize).toBe(72);
    expect(oldTransform.x).toBe(200);
    expect(oldTransform.y).toBe(150);
    expect(oldTransform.width).toBe(300);
    expect(oldTransform.height).toBe(100);

    expect(newTransform.fontSize).toBe(520);
    expect(newTransform.width).toBeGreaterThan(baseTextClip.width);
    expect(newTransform.height).toBeGreaterThan(baseTextClip.height);

    const oldCenterX = baseTextClip.x + baseTextClip.width / 2;
    const oldCenterY = baseTextClip.y + baseTextClip.height / 2;
    const newCenterX = Number(newTransform.x) + Number(newTransform.width) / 2;
    const newCenterY = Number(newTransform.y) + Number(newTransform.height) / 2;

    expect(newCenterX).toBeCloseTo(oldCenterX);
    expect(newCenterY).toBeCloseTo(oldCenterY);
  });

  it("keeps duration synchronized when trim points change through properties", () => {
    const { oldTransform, newTransform } = buildClipPropertyTransform(baseTextClip, { trimIn: 1.25 }, 640, 960);

    expect(oldTransform.trimIn).toBe(0);
    expect(oldTransform.duration).toBe(5);
    expect(newTransform.trimIn).toBe(1.25);
    expect(newTransform.duration).toBe(3.75);
  });

  it("recalculates bounds from the final update payload when typography edits clear effect style", () => {
    const { oldTransform, newTransform } = buildClipPropertyTransform(
      styledTextClip,
      {
        fontFamily: "Bebas Neue",
        styleId: undefined,
        styleDefinition: undefined,
      },
      640,
      960,
    );

    expect(oldTransform.styleId).toBe("boxed-title");
    expect(newTransform.styleId).toBeUndefined();
    expect(newTransform.styleDefinition).toBeUndefined();
    expect(newTransform.fontFamily).toBe("Bebas Neue");
    expect(newTransform.width).toBeGreaterThan(0);
    expect(newTransform.height).toBeGreaterThan(0);
    expect(newTransform.width).not.toBe(styledTextClip.width);
  });
});
