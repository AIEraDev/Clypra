import { describe, it, expect } from "vitest";
import { PRESET_CONFIGS, PRESET_ORDER } from "../exportPresets";

describe("Export Presets Extension (GIF & WebM)", () => {
  it("includes Animated GIF and WebM VP9 in PRESET_ORDER", () => {
    expect(PRESET_ORDER).toContain("gif-animated");
    expect(PRESET_ORDER).toContain("webm-vp9");
  });

  it("configures Animated GIF preset with correct dimensions and codec", () => {
    const gifConfig = PRESET_CONFIGS["gif-animated"];
    expect(gifConfig).toBeDefined();
    expect(gifConfig.codecValue).toBe("gif");
    expect(gifConfig.width).toBe(480);
    expect(gifConfig.height).toBe(270);
    expect(gifConfig.pixelFormat).toBe("rgb24");
  });

  it("configures WebM VP9 preset with 1080p resolution and vp9 codec", () => {
    const webmConfig = PRESET_CONFIGS["webm-vp9"];
    expect(webmConfig).toBeDefined();
    expect(webmConfig.codecValue).toBe("vp9");
    expect(webmConfig.width).toBe(1920);
    expect(webmConfig.height).toBe(1080);
    expect(webmConfig.pixelFormat).toBe("yuv420p");
  });
});
