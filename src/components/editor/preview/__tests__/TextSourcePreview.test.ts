import { describe, expect, it } from "vitest";
import { resolveTextSourcePreviewConfig } from "../TextSourcePreview";

describe("resolveTextSourcePreviewConfig", () => {
  it("preserves nested effect definition typography for source preview rendering", () => {
    const config = resolveTextSourcePreviewConfig({
      id: "studio-panel",
      name: "Studio Panel",
      presetType: "effect",
      text: "MY TEXT",
      fontSize: 100,
      font: {
        family: "Montserrat",
        weight: 900,
        style: "normal",
        letterSpacing: 6,
        lineHeight: 1.1,
      },
      fills: [{ type: "solid", color: "#ffffff" }],
      strokes: [],
      shadows: [],
      glows: [],
      panel: {
        color: "#111111",
        opacity: 100,
        radius: 0,
        paddingX: 48,
        paddingY: 22,
        stroke: { color: "#ffffff", width: 2 },
      },
    });

    expect(config.text).toBe("MY TEXT");
    expect(config.fontFamily).toBe("Montserrat Variable");
    expect(config.fontWeight).toBe(900);
    expect(config.fontStyle).toBe("normal");
    expect(config.letterSpacing).toBe(6);
    expect(config.lineHeight).toBe(1.1);
  });

  it("normalizes flat API font weight names to numeric canvas weights", () => {
    const config = resolveTextSourcePreviewConfig({
      id: "flat-effect",
      name: "Flat Effect",
      presetType: "effect",
      text: "MY TEXT",
      fontFamily: "Poppins",
      fontWeight: "ExtraBold",
      fontStyle: "normal",
      fontSize: 100,
    });

    expect(config.fontFamily).toBe("Poppins");
    expect(config.fontWeight).toBe(800);
  });
});
