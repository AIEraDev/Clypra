import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderEngine } from "../renderEngine";
import { QualityPreset, SpatialTier } from "../types";

beforeEach(() => {
  Object.defineProperty(window, "devicePixelRatio", {
    value: 1,
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RenderRuntime clip registration", () => {
  it("seeds a newly registered clip at the normal-zoom tier", () => {
    const runtime = new RenderEngine("project-1");

    runtime.registerClip("clip-1");

    expect(runtime.getRenderState("clip-1").currentTier.spatialTier).toBe(SpatialTier.L1);
    runtime.teardown();
  });

  it("seeds a newly registered clip at L1 after zoom 0.75", () => {
    const runtime = new RenderEngine("project-1");

    runtime.notifyZoom(0.75);
    runtime.registerClip("clip-1");

    expect(runtime.getRenderState("clip-1").currentTier.spatialTier).toBe(SpatialTier.L1);
    runtime.teardown();
  });

  it("seeds a newly registered clip at L2 after zoom 1.5", () => {
    const runtime = new RenderEngine("project-1");

    runtime.notifyZoom(1.5);
    runtime.registerClip("clip-1");

    expect(runtime.getRenderState("clip-1").currentTier.spatialTier).toBe(SpatialTier.L2);
    runtime.teardown();
  });

  it("caps a newly registered clip at L2 for high zoom with default Medium quality", () => {
    const runtime = new RenderEngine("project-1");

    runtime.notifyZoom(2.5);
    runtime.registerClip("clip-1");

    expect(runtime.getRenderState("clip-1").currentTier.spatialTier).toBe(SpatialTier.L2);
    runtime.teardown();
  });

  it("allows L3 for high zoom when quality preset is High", () => {
    const runtime = new RenderEngine("project-1", { qualityPreset: QualityPreset.High });

    runtime.notifyZoom(2.5);
    runtime.registerClip("clip-1");

    expect(runtime.getRenderState("clip-1").currentTier.spatialTier).toBe(SpatialTier.L3);
    runtime.teardown();
  });
});
