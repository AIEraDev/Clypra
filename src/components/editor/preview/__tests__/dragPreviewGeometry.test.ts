import { describe, expect, it } from "vitest";
import type { TextClip } from "@/types";
import { buildNativeTextRasterKey } from "../nativeTextPreview";
import { applyDragPreviewGeometry } from "../dragPreviewGeometry";

const textClip = {
  id: "title",
  kind: "text",
  text: "HEY GUYS,\nABDULKABIR",
  fontFamily: "Inter",
  fontSize: 96,
  x: 100,
  y: 80,
  width: 640,
  height: 240,
  baseWidth: 640,
  baseHeight: 240,
} as TextClip;

describe("drag preview geometry", () => {
  it("CLY-TEXT-039: scales a text resize from one frozen raster layout during the drag", () => {
    const resized = applyDragPreviewGeometry(textClip, {
      x: 100,
      y: 80,
      width: 960,
      height: 360,
      baseWidth: 960,
      baseHeight: 360,
      rotation: 0,
      fontSize: 144,
    }) as TextClip;

    expect(resized).toMatchObject({
      width: 960,
      height: 360,
      baseWidth: textClip.baseWidth,
      baseHeight: textClip.baseHeight,
      fontSize: textClip.fontSize,
    });

    // The native presenter scales this one raster from the old base to the
    // new presentation rectangle. A changing base/font here would make the
    // raster and selection border advance on separate async schedules.
    expect(
      buildNativeTextRasterKey({
        layerId: resized.id,
        clipId: resized.id,
        role: "text",
        layerType: "text",
        zIndex: 1,
        x: resized.x,
        y: resized.y,
        width: resized.width,
        height: resized.height,
        baseWidth: resized.baseWidth,
        baseHeight: resized.baseHeight,
        rotation: 0,
        opacity: 1,
        inTransition: false,
        blendMode: "normal",
        text: resized.text,
        fontFamily: resized.fontFamily,
        fontSize: resized.fontSize,
        color: "#fff",
        fontWeight: 400,
        fontStyle: "normal",
        textAlign: "center",
        verticalAlign: "middle",
        lineHeight: 1.2,
        letterSpacing: 0,
      }),
    ).toBe(
      buildNativeTextRasterKey({
        layerId: resized.id,
        clipId: resized.id,
        role: "text",
        layerType: "text",
        zIndex: 1,
        x: resized.x,
        y: resized.y,
        width: textClip.width,
        height: textClip.height,
        baseWidth: textClip.baseWidth,
        baseHeight: textClip.baseHeight,
        rotation: 0,
        opacity: 1,
        inTransition: false,
        blendMode: "normal",
        text: resized.text,
        fontFamily: resized.fontFamily,
        fontSize: resized.fontSize,
        color: "#fff",
        fontWeight: 400,
        fontStyle: "normal",
        textAlign: "center",
        verticalAlign: "middle",
        lineHeight: 1.2,
        letterSpacing: 0,
      }),
    );
  });

  it("preserves persisted base bounds for a text move without a font resize", () => {
    const moved = applyDragPreviewGeometry(textClip, {
      x: 220,
      y: 120,
      width: textClip.width,
      height: textClip.height,
      rotation: 0,
    }) as TextClip;

    expect(moved).toMatchObject({
      x: 220,
      y: 120,
      baseWidth: textClip.baseWidth,
      baseHeight: textClip.baseHeight,
    });
  });
});
