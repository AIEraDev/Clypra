import { describe, it, expect } from "vitest";
import { createGPUChromaKeyFilter } from "../gpuFilters";

describe("GPU Chroma Keyer Filter", () => {
  it("creates a PixiJS Filter instance with chroma key shader configuration", () => {
    const filter = createGPUChromaKeyFilter([0.0, 1.0, 0.0], 0.4, 0.1, 0.2);
    expect(filter).toBeDefined();
    expect((filter as any).resources?.customUniforms).toBeDefined();
    expect((filter as any).resources.customUniforms.uniforms.uSimilarity).toBe(0.4);
    expect((filter as any).resources.customUniforms.uniforms.uSmoothness).toBe(0.1);
    expect((filter as any).resources.customUniforms.uniforms.uSpill).toBe(0.2);
  });
});
