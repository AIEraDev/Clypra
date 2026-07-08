import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("pixi.js", () => {
  class MockFilter {
    destroy = vi.fn();
    resources: any = {
      customUniforms: {
        uniforms: {}
      }
    };
  }
  class MockBlurFilter extends MockFilter {
    strength = 0;
    constructor(opts?: any) {
      super();
      if (opts) this.strength = opts.strength;
    }
  }
  return {
    Filter: MockFilter,
    BlurFilter: MockBlurFilter,
  };
});

vi.mock("pixi-filters", () => {
  class MockAdjustmentFilter {
    destroy = vi.fn();
    brightness = 1;
    contrast = 1;
    saturation = 1;
    constructor(opts?: any) {
      if (opts) {
        if (opts.brightness !== undefined) this.brightness = opts.brightness;
        if (opts.contrast !== undefined) this.contrast = opts.contrast;
        if (opts.saturation !== undefined) this.saturation = opts.saturation;
      }
    }
  }
  return {
    AdjustmentFilter: MockAdjustmentFilter,
  };
});

vi.mock("@clypra/engine", () => {
  return {
    applyBodyEffectMask: vi.fn((key: string, data: any) => ({ source: data })),
    createGPUBodyOutlineFilter: vi.fn((maskTexture: any, colorHex: string, thickness: number) => ({
      destroy: vi.fn(),
      resources: { uMask: maskTexture.source, customUniforms: { uniforms: {} } }
    })),
    createGPUBodyGlowFilter: vi.fn((maskTexture: any, colorHex: string, radius: number, intensity: number) => ({
      destroy: vi.fn(),
      resources: { uMask: maskTexture.source, customUniforms: { uniforms: {} } }
    })),
    createGPUBodyParticlesFilter: vi.fn((maskTexture: any, colorHex: string, particleCount: number, intensity: number, time: number) => ({
      destroy: vi.fn(),
      resources: { uMask: maskTexture.source, customUniforms: { uniforms: {} } }
    })),
  };
});

import {
  getOrUpdateFilters,
  getRebuildCounter,
  resetRebuildCounter,
  releaseFilterCache,
  clearFilterCache,
} from "../filterCache";
import type { EvaluatedMediaLayer } from "../../evaluation/types";

describe("Filter Cache", () => {
  beforeEach(() => {
    resetRebuildCounter();
    clearFilterCache();
  });

  const baseMediaLayer: EvaluatedMediaLayer = {
    layerId: "layer-1",
    layerType: "media",
    clipId: "clip-1",
    mediaId: "media-1",
    mediaType: "video",
    clipKind: "video",
    role: "primary",
    zIndex: 0,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    rotation: 0,
    opacity: 1,
    inTransition: false,
    blendMode: "normal",
    sourcePath: "mock/path",
    sourceTime: 0,
    effects: [],
  };

  it("should initialize filter and update count on first run", () => {
    const layer: EvaluatedMediaLayer = {
      ...baseMediaLayer,
      effects: [
        {
          effectId: "fx-brightness",
          type: "video_effect",
          renderer: "brightness",
          intensity: 1.0,
          localTime: 0,
          parameters: { brightness: 1.2 },
        },
      ],
    };

    const filters = getOrUpdateFilters(layer, 1920, 1080, new Map());
    expect(filters.length).toBe(1);
    expect(getRebuildCounter()).toBe(1);
  });

  it("should stay flat (rebuild count does not increment) when only parameters change", () => {
    const layer1: EvaluatedMediaLayer = {
      ...baseMediaLayer,
      effects: [
        {
          effectId: "fx-brightness",
          type: "video_effect",
          renderer: "brightness",
          intensity: 1.0,
          localTime: 0,
          parameters: { brightness: 1.2 },
        },
      ],
    };

    // First call: initial build
    getOrUpdateFilters(layer1, 1920, 1080, new Map());
    expect(getRebuildCounter()).toBe(1);

    // Second call: parameter changes (brightness 1.2 -> 1.5)
    const layer2: EvaluatedMediaLayer = {
      ...baseMediaLayer,
      effects: [
        {
          effectId: "fx-brightness",
          type: "video_effect",
          renderer: "brightness",
          intensity: 1.0,
          localTime: 0,
          parameters: { brightness: 1.5 },
        },
      ],
    };

    getOrUpdateFilters(layer2, 1920, 1080, new Map());
    expect(getRebuildCounter()).toBe(1); // Rebuild count MUST stay flat
  });

  it("should increment rebuild count when structure changes", () => {
    const layer1: EvaluatedMediaLayer = {
      ...baseMediaLayer,
      effects: [
        {
          effectId: "fx-brightness",
          type: "video_effect",
          renderer: "brightness",
          intensity: 1.0,
          localTime: 0,
          parameters: { brightness: 1.2 },
        },
      ],
    };

    getOrUpdateFilters(layer1, 1920, 1080, new Map());
    expect(getRebuildCounter()).toBe(1);

    // Structural change: adding a second effect (blur)
    const layer2: EvaluatedMediaLayer = {
      ...baseMediaLayer,
      effects: [
        {
          effectId: "fx-brightness",
          type: "video_effect",
          renderer: "brightness",
          intensity: 1.0,
          localTime: 0,
          parameters: { brightness: 1.2 },
        },
        {
          effectId: "fx-blur",
          type: "video_effect",
          renderer: "blur",
          intensity: 1.0,
          localTime: 0,
          parameters: { blur: 10 },
        },
      ],
    };

    getOrUpdateFilters(layer2, 1920, 1080, new Map());
    expect(getRebuildCounter()).toBe(2); // Structure changed, rebuild counter must increment
  });

  it("should release cached filters properly on releaseFilterCache", () => {
    const layer: EvaluatedMediaLayer = {
      ...baseMediaLayer,
      effects: [
        {
          effectId: "fx-brightness",
          type: "video_effect",
          renderer: "brightness",
          intensity: 1.0,
          localTime: 0,
          parameters: { brightness: 1.2 },
        },
      ],
    };

    const filters = getOrUpdateFilters(layer, 1920, 1080, new Map());
    expect(filters.length).toBe(1);
    const filter = filters[0];

    releaseFilterCache("clip-1");
    expect(filter.destroy).toHaveBeenCalled();
  });

  it("should not rebuild body effect filters when mask changes, but should update uMask in-place", () => {
    const maskData1 = { id: "mask-frame-1" };
    const maskData2 = { id: "mask-frame-2" };

    const bodyMasks = new Map<string, any>();
    bodyMasks.set("layer-1_fx-outline", maskData1);

    const layer1: EvaluatedMediaLayer = {
      ...baseMediaLayer,
      effects: [
        {
          effectId: "fx-outline",
          type: "body_effect",
          renderer: "body_outline",
          intensity: 1.0,
          localTime: 0,
          parameters: { outlineColor: "#ffffff", thickness: 5 },
        },
      ],
    };

    // First frame: initial build with maskData1
    const filters1 = getOrUpdateFilters(layer1, 1920, 1080, bodyMasks);
    expect(filters1.length).toBe(1);
    expect(getRebuildCounter()).toBe(1);
    expect((filters1[0] as any).resources.uMask).toBe(maskData1);

    // Second frame: update maskData to maskData2
    bodyMasks.set("layer-1_fx-outline", maskData2);

    const filters2 = getOrUpdateFilters(layer1, 1920, 1080, bodyMasks);
    expect(filters2.length).toBe(1);
    expect(getRebuildCounter()).toBe(1); // Rebuild count must stay flat
    expect((filters2[0] as any).resources.uMask).toBe(maskData2); // uMask must update in-place
  });
});
