import { describe, expect, it } from "vitest";
import { getCanvasBackgroundLayer } from "../canvasBackground";

describe("getCanvasBackgroundLayer", () => {
  it("applies background opacity to solid backgrounds", () => {
    const layer = getCanvasBackgroundLayer({
      type: "solid",
      color: "#123456",
      opacity: 0.35,
    });

    expect(layer.className).toBe("");
    expect(layer.style.background).toBe("#123456");
    expect(layer.style.opacity).toBe(0.35);
  });

  it("builds gradient backgrounds with opacity", () => {
    const layer = getCanvasBackgroundLayer({
      type: "gradient",
      opacity: 0.5,
      gradient: {
        type: "linear",
        angle: 45,
        stops: [
          { color: "#111111", offset: 0 },
          { color: "#eeeeee", offset: 100 },
        ],
      },
    });

    expect(layer.style.background).toBe("linear-gradient(45deg, #111111, #eeeeee)");
    expect(layer.style.opacity).toBe(0.5);
  });

  it("returns animated shader class and speed-adjusted duration", () => {
    const layer = getCanvasBackgroundLayer({
      type: "shader",
      opacity: 0.8,
      shader: {
        presetId: "neon_grid",
        speed: 2,
        intensity: 1.4,
      },
    });

    expect(layer.className).toContain("clypra-canvas-bg-shader");
    expect(layer.className).toContain("clypra-canvas-bg-shader-neon_grid");
    expect(layer.style.opacity).toBe(0.8);
    expect(layer.style.animationDuration).toBe("6s");
    expect(layer.style["--clypra-bg-intensity" as never]).toBe("1.4");
  });

  it("uses a full-opacity checkerboard for transparent canvas mode", () => {
    const layer = getCanvasBackgroundLayer({
      type: "solid",
      color: "#000000",
      opacity: 0.1,
      isTransparent: true,
    });

    expect(String(layer.style.background)).toContain("data:image/svg+xml");
    expect(layer.style.opacity).toBe(1);
  });
});
