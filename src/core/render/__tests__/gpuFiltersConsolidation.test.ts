import { describe, it, expect } from "vitest";
import { PIXI_STANDARD_VERTEX_SHADER } from "../shaders/standardVertex";
import { createGPUPixelateFilter, createGPUScanlinesFilter, createGPURGBSplitFilter } from "../gpuFilters";

describe("GPU Shader Consolidation & Filter Pipeline", () => {
  it("exports a non-empty canonical WebGL2 vertex shader string", () => {
    expect(PIXI_STANDARD_VERTEX_SHADER).toBeDefined();
    expect(PIXI_STANDARD_VERTEX_SHADER).toContain("in vec2 aPosition;");
    expect(PIXI_STANDARD_VERTEX_SHADER).toContain("filterVertexPosition");
  });

  it("instantiates custom GPU filters without errors", () => {
    const pixelate = createGPUPixelateFilter(8);
    expect(pixelate).toBeDefined();

    const scanlines = createGPUScanlinesFilter(100, 0.5);
    expect(scanlines).toBeDefined();

    const rgbSplit = createGPURGBSplitFilter(5, -5);
    expect(rgbSplit).toBeDefined();
  });
});
