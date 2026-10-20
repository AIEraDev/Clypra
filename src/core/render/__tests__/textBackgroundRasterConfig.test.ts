import { describe, expect, it } from "vitest";
import { buildPlainTextEffectConfig } from "../textRasterizer";
import type { EvaluatedTextLayer } from "../../evaluation/types";

function makeLayer(): EvaluatedTextLayer {
  return {
    layerType: "text",
    layerId: "background-title",
    clipId: "background-title",
    text: "Panel title",
    x: 100,
    y: 200,
    width: 480,
    height: 96,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    time: 0,
    clipStartTime: 0,
    clipDuration: 5,
    fontFamily: "Inter",
    fontSize: 48,
    fontWeight: 400,
    fontStyle: "normal",
    color: "#ffffff",
    textAlign: "center",
    verticalAlign: "middle",
    background: {
      color: "#007aff",
      padding: 8,
      width: 36,
      height: 12,
      opacity: 45,
      borderRadius: 6,
    },
  } as EvaluatedTextLayer;
}

describe("plain text background raster configuration", () => {
  it("CLY-TEXT-033: forwards independent panel padding, color, and opacity", () => {
    const config = buildPlainTextEffectConfig(makeLayer(), 600, 160, 48, 1, 1);

    expect(config).toMatchObject({
      panelEnabled: true,
      panelColor: "#007aff",
      panelOpacity: 45,
      panelPaddingX: 36,
      panelPaddingY: 12,
      panelRadius: 6,
    });
  });
});
