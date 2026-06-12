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
});
